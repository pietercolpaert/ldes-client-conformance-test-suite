import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TestCase } from "./types.js";

interface Requirement {
  id: string;
  source: string;
  level: string;
  subject: string;
  group: string;
  testability: string;
  obligation: string;
}

interface Rationale {
  classification: "boundary" | "optional" | "manual" | "deferred";
  rationale: string;
}

export interface CoverageReport {
  specification: string;
  generatedAt: string;
  totals: {
    requirements: number;
    withTests: number;
    withRationales: number;
    blockingGaps: number;
  };
  requirements: Array<Requirement & {
    tests: string[];
    status: "tested" | "rationalized" | "gap";
    rationale?: Rationale;
  }>;
}

export async function writeCoverageReport(
  tests: TestCase[],
  outDir: string,
  enforce = true,
): Promise<CoverageReport> {
  const inventoryPath = path.resolve("docs/requirements.md");
  const rationalesPath = path.resolve("docs/coverage-rationales.json");
  const inventory = parseInventory(await readFile(inventoryPath, "utf8"));
  const rationales = JSON.parse(await readFile(rationalesPath, "utf8")) as Record<string, Rationale>;
  const mapped = new Map<string, string[]>();
  for (const test of tests) {
    for (const requirement of test.requirements) {
      const testIds = mapped.get(requirement) ?? [];
      testIds.push(test.id);
      mapped.set(requirement, testIds);
    }
  }

  const requirements = inventory.map((requirement) => {
    const testIds = mapped.get(requirement.id) ?? [];
    const rationale = rationales[requirement.id];
    return {
      ...requirement,
      tests: testIds,
      status: testIds.length ? "tested" as const : rationale ? "rationalized" as const : "gap" as const,
      ...(rationale ? { rationale } : {}),
    };
  });
  const unknownMappings = [...mapped.keys()].filter(
    (id) => !inventory.some((requirement) => requirement.id === id),
  );
  if (unknownMappings.length) {
    throw new Error(`test manifests map unknown requirement IDs: ${unknownMappings.join(", ")}`);
  }
  const blocking = requirements.filter(
    (requirement) =>
      requirement.status === "gap" &&
      requirement.subject === "Client" &&
      (requirement.level === "MUST" || requirement.level === "SHOULD"),
  );
  const report: CoverageReport = {
    specification: "https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/",
    generatedAt: new Date().toISOString(),
    totals: {
      requirements: requirements.length,
      withTests: requirements.filter((requirement) => requirement.status === "tested").length,
      withRationales: requirements.filter((requirement) => requirement.status === "rationalized").length,
      blockingGaps: blocking.length,
    },
    requirements,
  };
  await writeFile(path.join(outDir, "coverage.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(outDir, "coverage.md"), renderMarkdown(report));
  if (enforce && blocking.length) {
    throw new Error(
      `coverage gate failed: ${blocking.map((requirement) => requirement.id).join(", ")}`,
    );
  }
  return report;
}

function parseInventory(source: string): Requirement[] {
  const rows: Requirement[] = [];
  const pattern =
    /^\| (LDES10-[A-Z]+-\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gmu;
  for (const match of source.matchAll(pattern)) {
    rows.push({
      id: match[1].trim(),
      source: stripMarkdown(match[2]),
      level: match[3].trim(),
      subject: match[4].trim(),
      group: match[5].trim(),
      testability: match[6].trim(),
      obligation: match[7].trim(),
    });
  }
  if (rows.length !== 100) {
    throw new Error(`expected 100 reviewed LDES 1.0 requirements, parsed ${rows.length}`);
  }
  return rows;
}

function stripMarkdown(value: string): string {
  return value.trim().replaceAll(/\[([^\]]+)\]\[[^\]]+\]/gu, "$1");
}

function renderMarkdown(report: CoverageReport): string {
  const lines = [
    "# LDES 1.0 requirement coverage",
    "",
    `Generated from the dated normative inventory. ${report.totals.withTests} of ${report.totals.requirements} reviewed requirements have executable test mappings; ${report.totals.withRationales} have an explicit boundary, optionality, manual, or deferred rationale; ${report.totals.blockingGaps} applicable client MUST/SHOULD requirements are unmapped.`,
    "",
    "| Requirement | Level | Group | Status | Tests or rationale |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const requirement of report.requirements) {
    const detail = requirement.tests.length
      ? requirement.tests.map((test) => `\`${test}\``).join("<br>")
      : requirement.rationale
        ? `${requirement.rationale.classification}: ${requirement.rationale.rationale}`
        : "No test or rationale";
    lines.push(
      `| ${requirement.id} | ${requirement.level} | ${requirement.group} | ${requirement.status} | ${detail.replaceAll("|", "\\|")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
