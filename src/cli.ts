import path from "node:path";
import {
  loadProcessAdapter,
  referenceAdapter,
  type Adapter,
} from "./adapter.js";
import { generateReportSite } from "./html-report.js";
import { runReferenceClient } from "./reference-client.js";
import { runSuite, validateFixtures } from "./runner.js";

const CANDIDATE_ADAPTERS = [
  "rdf-connect",
  "openldes-ldi",
  "europeana",
];

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "run") {
    const selected = readOption(args, "--adapter") ?? "reference";
    const adapterIds =
      selected === "all" ? CANDIDATE_ADAPTERS : [selected];
    const adaptersRoot = readOption(args, "--adapters") ?? "adapters";
    const testsRoot = readOption(args, "--tests") ?? "tests";
    const requestedOut = readOption(args, "--out");
    let hasNonPass = false;

    for (const adapterId of adapterIds) {
      const adapter = await resolveAdapter(adapterId, adaptersRoot);
      const outDir =
        requestedOut && adapterIds.length === 1
          ? requestedOut
          : path.join(requestedOut ?? "reports", adapterId);
      const results = await runSuite({ testsRoot, outDir, adapter });
      for (const result of results) {
        console.log(`${result.outcome.toUpperCase()} ${adapterId} ${result.test.id}`);
        for (const diagnostic of result.diagnostics) {
          console.log(`  ${diagnostic}`);
        }
      }
      hasNonPass ||= results.some((result) => result.outcome !== "passed");
    }
    if (hasNonPass && !args.includes("--no-fail")) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "site") {
    const reportsRoot = readOption(args, "--reports") ?? "reports";
    const outDir = readOption(args, "--out") ?? "site";
    const summaries = await generateReportSite(reportsRoot, outDir);
    console.log(`Generated ${outDir}/1.0/index.html from ${summaries.length} client reports`);
    return;
  }

  if (command === "validate") {
    const testsRoot = readOption(args, "--tests") ?? "tests";
    for (const message of await validateFixtures(testsRoot)) {
      console.log(message);
    }
    return;
  }

  console.log("Usage:");
  console.log("  node dist/cli.js run --adapter reference|all|<id> [--adapters adapters] [--no-fail]");
  console.log("  node dist/cli.js site --reports reports --out site");
  console.log("  node dist/cli.js validate --tests tests");
}

async function resolveAdapter(adapterId: string, adaptersRoot: string): Promise<Adapter> {
  if (adapterId === "reference") {
    return referenceAdapter(runReferenceClient);
  }
  return await loadProcessAdapter(adapterId, adaptersRoot);
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
