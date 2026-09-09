import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AdapterEvent,
  ExpectedEvent,
  ExpectedRequest,
  ExpectedTiming,
  TestCase,
  TestResult,
  RequestLogEntry,
  Scenario,
} from "./types.js";
import { datasetEquals } from "./rdf.js";
import { expandFixturePlaceholders } from "./fixture-iri.js";

export async function evaluate(
  test: TestCase,
  events: AdapterEvent[],
  requests: RequestLogEntry[],
  scenario?: Scenario,
): Promise<TestResult> {
  const expected = await loadExpectedEvents(test.expectedPath);
  const diagnostics: string[] = [];
  const expectedTypes = new Set(expected.flatMap(expectedEventTypes));
  const observedTypes = new Set([
    "member",
    "run-end",
    "error",
    ...expectedTypes,
  ]);
  const observed = events.filter((event) => observedTypes.has(event.type));

  if (observed.length !== expected.length) {
    diagnostics.push(`expected ${expected.length} observable events, got ${observed.length}`);
  }

  // Permute only contiguous member blocks within one run. Terminal and context
  // boundaries remain observable; ordered ties must be explicitly declared.
  for (let index = 0; index < Math.min(observed.length, expected.length); index += 1) {
    const wanted = expected[index];
    const ordered = scenario?.runs?.find((run) => run.id === observed[index].runId)?.mode === "ordered"
      || test.group === "OrderedTraversal";
    if (wanted.type === "member" && (!ordered || wanted.tieGroup)) {
      let end = index + 1;
      while (end < expected.length && expected[end].type === "member" &&
        expected[end].runId === wanted.runId &&
        (!ordered || expected[end].tieGroup === wanted.tieGroup)) end += 1;
      const remaining = observed.slice(index, end);
      for (let cursor = index; cursor < end; cursor += 1) {
        let match = -1;
        for (let candidate = 0; candidate < remaining.length; candidate += 1) {
          if (remaining[candidate].runId === observed[index].runId &&
            !(await compareExpectedEvent(test, cursor, remaining[candidate], expected[cursor])).length) {
            match = candidate;
            break;
          }
        }
        if (match < 0) diagnostics.push(`event ${cursor}: missing matching member in permitted member block`);
        else remaining.splice(match, 1);
      }
      index = end - 1;
    } else {
      diagnostics.push(...await compareExpectedEvent(test, index, observed[index], wanted));
    }
  }

  await evaluateRequests(test, requests, diagnostics);
  await evaluateTimings(test, requests, diagnostics);
  await evaluateEventTimings(test, events, requests, diagnostics);
  evaluateRequestBudget(scenario, requests, diagnostics);

  return {
    test,
    outcome: diagnostics.length ? "failed" : "passed",
    events,
    requests,
    diagnostics,
  };
}

async function evaluateTimings(
  test: TestCase,
  requests: RequestLogEntry[],
  diagnostics: string[],
): Promise<void> {
  const filePath = path.join(path.dirname(test.expectedPath), "timing.json");
  let expected: ExpectedTiming[];
  try {
    expected = JSON.parse(await readFile(filePath, "utf8")) as ExpectedTiming[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const wanted of expected) {
    const matching = requests
      .filter((request) =>
        request.path === wanted.path &&
        (!wanted.phase || request.phase === wanted.phase)
      )
      .sort((left, right) => left.sequence - right.sequence);
    if (matching.length < 2) {
      diagnostics.push(
        `request timing ${wanted.phase ? `${wanted.phase}:` : ""}${wanted.path}: ` +
        `expected at least 2 requests, got ${matching.length}`,
      );
      continue;
    }
    const label = `request timing ${wanted.phase ? `${wanted.phase}:` : ""}${wanted.path}`;
    const first = Date.parse(matching[0].timestamp);
    const last = Date.parse(matching.at(-1)!.timestamp);
    const span = last - first;
    if (wanted.minSpanMs !== undefined && (!Number.isFinite(span) || span < wanted.minSpanMs)) {
      diagnostics.push(
        `${label}: expected a span of at least ${wanted.minSpanMs}ms, got ${span}ms`,
      );
    }
    if (wanted.minGapMs !== undefined) {
      for (let index = 1; index < matching.length; index += 1) {
        const gap = Date.parse(matching[index].timestamp) -
          Date.parse(matching[index - 1].timestamp);
        if (!Number.isFinite(gap) || gap < wanted.minGapMs) {
          diagnostics.push(
            `${label}: request ${index + 1} followed request ${index} after ${gap}ms, ` +
            `expected at least ${wanted.minGapMs}ms between consecutive requests`,
          );
        }
      }
    }
  }
}

function evaluateRequestBudget(
  scenario: Scenario | undefined,
  requests: RequestLogEntry[],
  diagnostics: string[],
): void {
  if (scenario?.requestBudget === undefined) return;
  if (requests.length > scenario.requestBudget) {
    diagnostics.push(
      `request budget exceeded: expected at most ${scenario.requestBudget}, got ${requests.length}`,
    );
  }
}

async function compareExpectedEvent(
  test: TestCase,
  index: number,
  actual: AdapterEvent,
  wanted: ExpectedEvent,
): Promise<string[]> {
  if (wanted.oneOf?.length) {
    const attempts = await Promise.all(
      wanted.oneOf.map((candidate) => compareSingleExpectedEvent(test, index, actual, candidate)),
    );
    if (attempts.some((messages) => messages.length === 0)) return [];
    return [
      `event ${index}: matched none of ${wanted.oneOf.length} allowed alternatives: ${
        attempts.map((messages) => messages.join("; ")).join(" | ")
      }`,
    ];
  }
  return await compareSingleExpectedEvent(test, index, actual, wanted);
}

async function compareSingleExpectedEvent(
  test: TestCase,
  index: number,
  actual: AdapterEvent,
  wanted: ExpectedEvent,
): Promise<string[]> {
  const diagnostics: string[] = [];
  if (wanted.type && actual.type !== wanted.type) {
    diagnostics.push(`expected type ${wanted.type}, got ${actual.type}`);
    return diagnostics.map((message) => `event ${index}: ${message}`);
  }
  if (wanted.runId && actual.runId !== expandFixturePlaceholders(wanted.runId, test.scenarioPath)) {
    diagnostics.push(`expected runId ${wanted.runId}, got ${actual.runId}`);
  }
  if (wanted.id && actual.id !== expandFixturePlaceholders(wanted.id, test.scenarioPath)) {
    diagnostics.push(`expected member ${wanted.id}, got ${actual.id ?? "<none>"}`);
  }
  if (wanted.status && actual.status !== expandFixturePlaceholders(wanted.status, test.scenarioPath)) {
    diagnostics.push(`expected status ${wanted.status}, got ${actual.status ?? "<none>"}`);
  }
  if (wanted.kind && actual.kind !== expandFixturePlaceholders(wanted.kind, test.scenarioPath)) {
    diagnostics.push(`expected error kind ${wanted.kind}, got ${actual.kind ?? "<none>"}`);
  }
  for (const [key, value] of Object.entries(wanted)) {
    if (["type", "id", "runId", "status", "kind", "datasetFile", "oneOf", "tieGroup", "dateTime"].includes(key)) {
      continue;
    }
    if (!deepEqual(
      normalizeExpectedValue(setValue(key, actual[key]), test),
      normalizeExpectedValue(setValue(key, value), test),
    )) {
      diagnostics.push(
        `expected ${key}=${JSON.stringify(value)}, got ${JSON.stringify(actual[key])}`,
      );
    }
  }
  for (const key of wanted.dateTime ?? []) {
    if (typeof actual[key] !== "string" || !Number.isFinite(Date.parse(actual[key] as string))) {
      diagnostics.push(`expected ${key} to be a date-time`);
    }
  }
  if (wanted.datasetFile) {
    const expectedDataset = await readFile(path.join(path.dirname(test.expectedPath), wanted.datasetFile), "utf8");
    if (!actual.dataset) {
      diagnostics.push(`expected dataset, got none`);
    } else if (!datasetEquals(
      normalizeFixtureOrigin(actual.dataset),
      normalizeFixtureOrigin(expandFixturePlaceholders(expectedDataset, test.scenarioPath)),
    )) {
      diagnostics.push(`member dataset did not match ${wanted.datasetFile}`);
    }
  }
  return diagnostics.map((message) => `event ${index}: ${message}`);
}

function expectedEventTypes(event: ExpectedEvent): Array<Required<ExpectedEvent>["type"]> {
  return event.oneOf?.flatMap(expectedEventTypes) ?? (event.type ? [event.type] : []);
}

function normalizeFixtureOrigin(value: string): string {
  return value
    .replaceAll("{{origin}}", "https://fixture.test")
    .replaceAll(/http:\/\/127\.0\.0\.1:\d+/gu, "https://fixture.test");
}

async function evaluateRequests(
  test: TestCase,
  requests: RequestLogEntry[],
  diagnostics: string[],
): Promise<void> {
  const filePath = path.join(path.dirname(test.expectedPath), "requests.json");
  let expected: ExpectedRequest[];
  try {
    expected = JSON.parse(await readFile(filePath, "utf8")) as ExpectedRequest[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const wanted of expected) {
    const matching = requests.filter(
      (request) =>
        request.path === wanted.path &&
        (!wanted.phase || request.phase === wanted.phase) &&
        (wanted.status === undefined || request.status === wanted.status),
    );
    const minimum = wanted.count ?? wanted.minCount ?? 1;
    const maximum = wanted.count ?? wanted.maxCount ?? Number.POSITIVE_INFINITY;
    if (matching.length < minimum || matching.length > maximum) {
      diagnostics.push(
        `request ${wanted.phase ? `${wanted.phase}:` : ""}${wanted.path}: expected count ${range(minimum, maximum)}, got ${matching.length}`,
      );
    }
    for (const request of matching) {
      const headers = lowerCaseHeaders(request.headers);
      for (const name of wanted.presentHeaders ?? []) {
        if (!headers[name.toLowerCase()]?.trim()) diagnostics.push(`request ${request.path}: missing ${name}`);
      }
      for (const [name, value] of Object.entries(wanted.headers ?? {})) {
        if (headers[name.toLowerCase()] !== value) {
          diagnostics.push(
            `request ${request.phase}:${request.path}: expected ${name}: ${value}, got ${headers[name.toLowerCase()] ?? "<absent>"}`,
          );
        }
      }
      for (const [name, value] of Object.entries(wanted.headerIncludes ?? {})) {
        if (!headers[name.toLowerCase()]?.includes(value)) {
          diagnostics.push(
            `request ${request.phase}:${request.path}: expected ${name} to include ${value}`,
          );
        }
      }
      for (const name of wanted.absentHeaders ?? []) {
        if (headers[name.toLowerCase()] !== undefined) {
          diagnostics.push(`request ${request.phase}:${request.path}: expected ${name} to be absent`);
        }
      }
    }
  }
}

async function loadExpectedEvents(filePath: string): Promise<ExpectedEvent[]> {
  const lines = (await readFile(filePath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => JSON.parse(line) as ExpectedEvent);
}

function lowerCaseHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? value.join(", ") : value,
    ]),
  );
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeExpectedValue(value: unknown, test: TestCase): unknown {
  if (typeof value === "string") {
    return normalizeFixtureOrigin(expandFixturePlaceholders(value, test.scenarioPath));
  }
  if (Array.isArray(value)) return value.map((child) => normalizeExpectedValue(child, test));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalizeExpectedValue(child, test)]),
    );
  }
  return value;
}

function range(minimum: number, maximum: number): string {
  if (minimum === maximum) return String(minimum);
  if (!Number.isFinite(maximum)) return `at least ${minimum}`;
  return `${minimum}..${maximum}`;
}

function setValue(key: string, value: unknown): unknown {
  // These context fields are sets: neither their order nor a repeated entry
  // carries meaning, so compare them normalized.
  return ["shapes", "viewDescriptions", "retentionPolicies", "emptyRetentionPolicies"]
      .includes(key) && Array.isArray(value)
    ? [...new Set(value)].sort() : value;
}

async function evaluateEventTimings(test: TestCase, events: AdapterEvent[], requests: RequestLogEntry[], diagnostics: string[]): Promise<void> {
  let expected: Array<{ member: string; path: string; relation: "before-completion" | "after-completion" }>;
  try { expected = JSON.parse(await readFile(path.join(path.dirname(test.expectedPath), "event-timing.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  for (const wanted of expected) {
    const member = events.find((event) => event.type === "member" && event.id === wanted.member);
    const request = requests.find((entry) => entry.path === wanted.path);
    const emitted = Date.parse(String(member?.receivedAt));
    const completed = Date.parse(String(request?.completedAt));
    if (!Number.isFinite(emitted) || !Number.isFinite(completed) ||
      (wanted.relation === "before-completion" ? emitted >= completed : emitted < completed)) {
      diagnostics.push(`member ${wanted.member}: expected ${wanted.relation} of ${wanted.path}`);
    }
  }
}
