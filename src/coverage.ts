import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TestCase, TestResult } from "./types.js";

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

const LEVEL_RANK: Record<string, number> = { May: 0, Should: 1, Must: 2 };
const NORMATIVE_RANK: Record<string, number> = { MAY: 0, SHOULD: 1, MUST: 2 };

/**
 * A mapping is not evidence. `verified` means at least one mapped test actually
 * passed in this run; `mapped` means a mapping exists but nothing observed it,
 * because every mapped test was skipped, errored or failed. Rationales are
 * reported per classification and never counted as executable coverage.
 */
export interface CoverageReport {
  specification: string;
  generatedAt: string;
  totals: {
    requirements: number;
    verified: number;
    mappedNotVerified: number;
    advisoryEvidenceOnly: number;
    withTests: number;
    withRationales: number;
    rationalesByClassification: Record<Rationale["classification"], number>;
    blockingGaps: number;
  };
  requirements: Array<Requirement & {
    tests: string[];
    status: "verified" | "mapped" | "rationalized" | "gap";
    evidence?: Partial<Record<TestResult["outcome"], string[]>>;
    advisoryEvidenceOnly?: boolean;
    rationale?: Rationale;
  }>;
}

export async function writeCoverageReport(
  tests: TestCase[],
  outDir: string,
  enforce = true,
  results: TestResult[] = [],
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

  const outcomes = new Map(results.map((result) => [result.test.id, result.outcome]));
  const levels = new Map(tests.map((test) => [test.id, test.requirementLevel]));

  const requirements = inventory.map((requirement) => {
    const testIds = mapped.get(requirement.id) ?? [];
    const rationale = rationales[requirement.id];
    const evidence: Partial<Record<TestResult["outcome"], string[]>> = {};
    for (const id of testIds) {
      const outcome = outcomes.get(id);
      if (!outcome) continue;
      (evidence[outcome] ??= []).push(id);
    }
    // Evidence is advisory-only when a mandatory row is observed exclusively by
    // fixtures that declare a weaker level than the requirement itself.
    const strongest = Math.max(
      -1,
      ...testIds.map((id) => LEVEL_RANK[levels.get(id) ?? ""] ?? -1),
    );
    const advisoryEvidenceOnly = testIds.length > 0 &&
      strongest >= 0 &&
      strongest < (NORMATIVE_RANK[requirement.level] ?? -1);
    const status = testIds.length
      ? (evidence.passed?.length ? "verified" as const : "mapped" as const)
      : rationale
        ? "rationalized" as const
        : "gap" as const;
    return {
      ...requirement,
      tests: testIds,
      status,
      ...(results.length ? { evidence } : {}),
      ...(advisoryEvidenceOnly ? { advisoryEvidenceOnly } : {}),
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
      verified: requirements.filter((requirement) => requirement.status === "verified").length,
      mappedNotVerified: requirements.filter((requirement) => requirement.status === "mapped").length,
      advisoryEvidenceOnly: requirements.filter((requirement) => requirement.advisoryEvidenceOnly).length,
      withTests: requirements.filter((requirement) => requirement.tests.length > 0).length,
      withRationales: requirements.filter((requirement) => requirement.status === "rationalized").length,
      rationalesByClassification: {
        boundary: countClassification(requirements, "boundary"),
        optional: countClassification(requirements, "optional"),
        manual: countClassification(requirements, "manual"),
        deferred: countClassification(requirements, "deferred"),
      },
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

function countClassification(
  requirements: CoverageReport["requirements"],
  classification: Rationale["classification"],
): number {
  return requirements.filter((requirement) =>
    requirement.status === "rationalized" && requirement.rationale?.classification === classification
  ).length;
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
  if (!rows.length || new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error("requirement inventory must contain unique requirement IDs");
  }
  return rows;
}

function stripMarkdown(value: string): string {
  return value.trim().replaceAll(/\[([^\]]+)\]\[[^\]]+\]/gu, "$1");
}

function renderMarkdown(report: CoverageReport): string {
  const rationalized = report.totals.rationalesByClassification;
  const lines = [
    "# LDES 1.0 requirement coverage",
    "",
    `Generated from the dated normative inventory. ${report.totals.requirements} requirements reviewed.`,
    "",
    "A mapping is not evidence. The counts below are deliberately separate: a",
    "rationale explains why a requirement is not executed and must never be read",
    "as coverage.",
    "",
    `- **${report.totals.verified}** behaviorally verified: at least one mapped test passed in this run.`,
    `- **${report.totals.mappedNotVerified}** mapped but not verified: a mapping exists, but no mapped test passed (skipped, inconclusive, or failing).`,
    `- **${report.totals.advisoryEvidenceOnly}** observed only by fixtures declaring a weaker level than the requirement, so the evidence is advisory.`,
    `- **${report.totals.withRationales}** rationalized, not executed: ${rationalized.boundary} boundary, ${rationalized.optional} optional, ${rationalized.manual} manual, ${rationalized.deferred} deferred.`,
    `- **${report.totals.blockingGaps}** applicable client MUST/SHOULD requirements are neither mapped nor rationalized.`,
    "",
    "| Requirement | Level | Group | Status | Evidence strength | Tests or rationale |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const requirement of report.requirements) {
    const detail = requirement.tests.length
      ? requirement.tests.map((test) => `\`${test}\``).join("<br>")
      : requirement.rationale
        ? `${requirement.rationale.classification}: ${requirement.rationale.rationale}`
        : "No test or rationale";
    const strength = [
      requirement.advisoryEvidenceOnly ? "advisory level only" : "",
      ...Object.entries(requirement.evidence ?? {})
        .filter(([, ids]) => ids.length)
        .map(([outcome, ids]) => `${outcome}: ${ids.length}`),
    ].filter(Boolean).join("; ") || "not executed";
    lines.push(
      `| ${requirement.id} | ${requirement.level} | ${requirement.group} | ${requirement.status} | ${strength} | ${detail.replaceAll("|", "\\|")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
