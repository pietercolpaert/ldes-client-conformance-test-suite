import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AdapterInput,
  EarlOutcome,
  ReportMetadata,
  SuiteSummary,
  TestResult,
} from "./types.js";
import type { Adapter } from "./adapter.js";
import { discoverTests } from "./discovery.js";
import { renderEarl } from "./earl.js";
import { evaluate } from "./oracle.js";
import { getScenarioPhases, getScenarioRuns, loadScenario, resolveBodyPath } from "./scenario.js";
import { FixtureServer } from "./server.js";
import { writeCoverageReport } from "./coverage.js";
import { parseNQuads, parseRdf, resetContextCache } from "./rdf.js";
import type { ExpectedEvent } from "./types.js";
import { expandFixturePlaceholders } from "./fixture-iri.js";

const SUITE_VERSION = "0.1.0";

export interface RunOptions {
  testsRoot: string;
  outDir: string;
  adapter: Adapter;
}

export async function runSuite(options: RunOptions): Promise<TestResult[]> {
  const tests = await discoverTests(options.testsRoot);
  const results: TestResult[] = [];
  await rm(options.outDir, { recursive: true, force: true });
  await mkdir(options.outDir, { recursive: true });

  let probe;
  try {
    probe = await options.adapter.probe();
  } catch (error) {
    probe = {
      protocolVersion: 0 as const,
      available: false,
      adapterId: options.adapter.declaration.id,
      reason: diagnostic(error),
    };
  }

  const metadata: ReportMetadata = {
    generatedAt: new Date().toISOString(),
    suiteVersion: SUITE_VERSION,
    adapter: options.adapter.declaration,
    probe,
  };

  if (!probe.available) {
    for (const test of tests) {
      const result: TestResult = {
        test,
        outcome: "cantTell",
        events: [],
        requests: [],
        diagnostics: [`adapter unavailable: ${probe.reason ?? "no reason supplied"}`],
      };
      results.push(result);
      await writeEvidence(options.outDir, result);
    }
  } else {
    for (const test of tests) {
      const reason = await inapplicableReason(
        test,
        probe.capabilities ?? options.adapter.declaration.capabilities,
      );
      results.push(reason ? inapplicable(test, reason) : await runTest(options, test));
      await writeEvidence(options.outDir, results.at(-1)!);
    }
  }

  const coverage = await writeCoverageReport(
    tests,
    options.outDir,
    path.resolve(options.testsRoot) === path.resolve("tests"),
    results,
  );
  const summary = summarize(results, metadata, coverage.totals);
  await writeFile(
    path.join(options.outDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await writeFile(
    path.join(options.outDir, "earl.ttl"),
    renderEarl(results, metadata),
  );
  return results;
}

async function runTest(
  options: RunOptions,
  test: Awaited<ReturnType<typeof discoverTests>>[number],
): Promise<TestResult> {
  const scenario = await loadScenario(test.scenarioPath);
  const server = new FixtureServer(scenario, test.scenarioPath);
  const events: import("./types.js").AdapterEvent[] = [];
  const stateDirectory = path.resolve(
    options.outDir,
    "state",
    test.id.replaceAll("/", "__"),
  );
  try {
    await mkdir(stateDirectory, { recursive: true });
    resetContextCache();
    await options.adapter.reset(stateDirectory);
    await server.start();
    for (const run of getScenarioRuns(scenario)) {
      server.setPhase(run.phase);
      const input: AdapterInput = {
        protocolVersion: 0,
        runId: run.id,
        entrypoint: server.entrypointUrl(),
        mode: run.mode ?? "unordered",
        stateDirectory,
        phase: run.phase,
        concurrency: run.concurrency,
        followForMs: run.followForMs,
        deadline: new Date(
          Date.now() + (options.adapter.declaration.timeoutMs ?? 30_000),
        ).toISOString(),
      };
      events.push(...await options.adapter.run(input));
    }
    return await evaluate(test, events, server.requests, scenario);
  } catch (error) {
    return {
      test,
      outcome: "cantTell",
      events: [...events, ...((error as { events?: import("./types.js").AdapterEvent[] }).events ?? [])],
      requests: server.requests,
      diagnostics: [diagnostic(error)],
    };
  } finally {
    await server.stop();
  }
}

async function writeEvidence(outDir: string, result: TestResult): Promise<void> {
  const evidencePath = path.join(
    outDir,
    "evidence",
    `${result.test.id.replaceAll("/", "__")}.json`,
  );
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
}

function summarize(
  results: TestResult[],
  metadata: ReportMetadata,
  coverage: {
    requirements: number;
    verified: number;
    withTests: number;
    advisoryEvidenceOnly: number;
    withRationales: number;
    blockingGaps: number;
  },
): SuiteSummary {
  const counts = results.reduce<Record<string, number>>(
    (accumulator, result) => {
      accumulator[result.outcome] = (accumulator[result.outcome] ?? 0) + 1;
      return accumulator;
    },
    {},
  );
  for (const outcome of [
    "passed",
    "failed",
    "cantTell",
    "inapplicable",
    "untested",
  ] satisfies EarlOutcome[]) {
    counts[outcome] ??= 0;
  }
  return {
    metadata,
    total: results.length,
    counts,
    groupClaims: summarizeGroups(results),
    coverage: {
      totalRequirements: coverage.requirements,
      requirementsVerified: coverage.verified,
      requirementsWithTests: coverage.withTests,
      requirementsAdvisoryEvidenceOnly: coverage.advisoryEvidenceOnly,
      requirementsWithRationales: coverage.withRationales,
      blockingGaps: coverage.blockingGaps,
      artifact: "coverage.json",
    },
    tests: results.map((result) => ({
      id: result.test.id,
      iri: result.test.iri,
      title: result.test.title,
      description: result.test.description,
      group: result.test.group,
      requirement: result.test.requirement,
      requirements: result.test.requirements,
      requiredCapabilities: result.test.requiredCapabilities,
      requirementLevel: result.test.requirementLevel,
      outcome: result.outcome,
      diagnostics: result.diagnostics,
      evidence: `evidence/${result.test.id.replaceAll("/", "__")}.json`,
    })),
  };
}

// Applicability follows the modes a scenario's runs actually declare, not the
// compliance group it reports into. LDES 1.0 permits an ordered-only client, so
// a shared obligation exercised in ordered mode must stay applicable while
// still reporting against the group of the requirement it observes.
async function inapplicableReason(
  test: Awaited<ReturnType<typeof discoverTests>>[number],
  capabilities: Adapter["declaration"]["capabilities"],
): Promise<string | undefined> {
  const group = test.group;
  const scenario = await loadScenario(test.scenarioPath);
  const unsupported = [
    ...new Set(getScenarioRuns(scenario).map((run) => run.mode ?? "unordered")),
  ].filter((mode) => !capabilities.modes.includes(mode));
  if (unsupported.length) {
    return `scenario runs require ${unsupported.join(" and ")} mode; adapter declares ${
      capabilities.modes.join(", ") || "no modes"
    }`;
  }
  if (
    test.requiredCapabilities.includes("TreeProfileExtraction") &&
    !capabilities.treeProfileExtraction
  ) {
    return "adapter does not declare TREE Profile extraction";
  }
  if (
    test.requiredCapabilities.includes("Polling") &&
    !capabilities.polling
  ) {
    return "adapter does not declare autonomous polling";
  }
  if (group === "MemberExtraction" && !capabilities.memberExtraction) {
    return "adapter does not declare generic member extraction";
  }
  if ((group === "ContextInformation" || group === "RetentionInterpretation") && !capabilities.context) {
    return "adapter does not expose context information through the adapter contract";
  }
  return undefined;
}

function inapplicable(
  test: Awaited<ReturnType<typeof discoverTests>>[number],
  reason: string,
): TestResult {
  return {
    test,
    outcome: "inapplicable",
    events: [],
    requests: [],
    diagnostics: [reason],
  };
}

function summarizeGroups(results: TestResult[]): SuiteSummary["groupClaims"] {
  const orderedGroups = [
    "UnorderedTraversal",
    "MemberExtraction",
    "OrderedTraversal",
    "ContextInformation",
  ];
  const claims = orderedGroups.map((group) => {
    const mandatory = results.filter(
      (result) => result.test.group === group && result.test.requirementLevel === "Must",
    );
    // An inapplicable test is not a penalty and not evidence: it is excluded
    // from the claim rather than counted as a missing pass. Without this, a
    // client that declares one mode only would report "untested" for a group
    // whose applicable mandatory tests all passed.
    const applicable = mandatory.filter((result) => result.outcome !== "inapplicable");
    const skipped = mandatory.length - applicable.length;
    const diagnostics: string[] = [];
    let outcome: EarlOutcome;
    if (!applicable.length) {
      outcome = "inapplicable";
    } else if (applicable.some((result) => result.outcome === "failed")) {
      outcome = "failed";
    } else if (applicable.some((result) => result.outcome === "cantTell")) {
      outcome = "cantTell";
    } else if (applicable.every((result) => result.outcome === "passed")) {
      outcome = "passed";
    } else {
      outcome = "untested";
    }
    if (skipped) {
      diagnostics.push(
        `${skipped} of ${mandatory.length} mandatory tests were inapplicable to this client and are excluded from the claim`,
      );
    }
    return {
      group,
      outcome,
      mandatoryTests: mandatory.length,
      applicableMandatoryTests: applicable.length,
      passedMandatoryTests: applicable.filter((result) => result.outcome === "passed").length,
      diagnostics,
    };
  });
  return claims;
}

function diagnostic(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

export async function validateFixtures(testsRoot: string): Promise<string[]> {
  const tests = await discoverTests(testsRoot);
  const messages: string[] = [];
  for (const test of tests) {
    const scenario = await loadScenario(test.scenarioPath);
    for (const phase of getScenarioPhases(scenario)) {
      for (const route of phase.routes) {
        for (const request of route.requests) {
          const response = request.response;
          if ((!response.body && !response.chunks?.length) || response.status < 200 || response.status >= 300) continue;
          const contentType = response.headers?.["content-type"] ??
            response.headers?.["Content-Type"];
          if (!contentType || !isRdfMediaType(contentType)) continue;
          const body = (await Promise.all([...(response.body ? [response.body] : []), ...(response.chunks ?? []).map((chunk) => chunk.body)].map((body) => readFile(resolveBodyPath(test.scenarioPath, body), "utf8")))).join("")
            .replaceAll("{{origin}}", "http://127.0.0.1:49152");
          await parseRdf(
            expandFixturePlaceholders(body, test.scenarioPath, "http://127.0.0.1:49152"),
            contentType,
            `http://127.0.0.1:49152${route.path}`,
            { async load(url: string) {
              const location = new URL(url);
              if (location.origin !== "http://127.0.0.1:49152") throw new Error(`fixture context must be local: ${url}`);
              const context = phase.routes.find((candidate) => candidate.path === location.pathname + location.search)?.requests[0].response;
              if (!context?.body) throw new Error(`missing fixture context ${url}`);
              return JSON.parse(expandFixturePlaceholders(await readFile(resolveBodyPath(test.scenarioPath, context.body), "utf8"), test.scenarioPath, location.origin));
            } },
          );
        }
      }
    }
    const events = (await readFile(test.expectedPath, "utf8"))
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ExpectedEvent);
    for (const event of events.flatMap(flattenExpected)) {
      if (!event.datasetFile) continue;
      const dataset = await readFile(
        path.join(path.dirname(test.expectedPath), event.datasetFile),
        "utf8",
      );
      parseNQuads(
        expandFixturePlaceholders(dataset, test.scenarioPath, "http://127.0.0.1:49152"),
      );
    }
    messages.push(`${test.id}: ok`);
  }
  return messages;
}

function isRdfMediaType(contentType: string): boolean {
  return [
    "application/n-quads",
    "application/n-triples",
    "application/trig",
    "text/turtle",
    "application/ld+json",
  ].includes(contentType.split(";")[0].trim().toLowerCase());
}

function flattenExpected(event: ExpectedEvent): ExpectedEvent[] {
  return [event, ...(event.oneOf?.flatMap(flattenExpected) ?? [])];
}
