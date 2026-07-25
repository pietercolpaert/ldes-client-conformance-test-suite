import type { ReportMetadata, TestResult } from "./types.js";

const ASSERTOR =
  "https://w3id.org/ldes/conformance/assertor/node-runner";

export function renderEarl(
  results: TestResult[],
  metadata: ReportMetadata,
): string {
  const subject = `urn:ldes-ct:subject:${encodeURIComponent(metadata.adapter.client.id)}:${encodeURIComponent(metadata.probe.clientRevision ?? metadata.adapter.client.revision)}`;
  const lines = [
    "@prefix earl: <http://www.w3.org/ns/earl#> .",
    "@prefix ct: <https://w3id.org/ldes/conformance/vocab#> .",
    "@prefix dct: <http://purl.org/dc/terms/> .",
    "@prefix doap: <http://usefulinc.com/ns/doap#> .",
    "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
    "",
    `<${ASSERTOR}> a earl:Software, earl:Assertor;`,
    `    dct:title "LDES client conformance runner";`,
    `    doap:revision "${literal(metadata.suiteVersion)}" .`,
    "",
    `<${subject}> a earl:Software, earl:TestSubject;`,
    `    dct:title "${literal(metadata.adapter.client.name)}";`,
    `    doap:homepage <${metadata.adapter.client.homepage}>;`,
    `    doap:revision "${literal(metadata.probe.clientRevision ?? metadata.adapter.client.revision)}" .`,
    "",
  ];

  for (const [index, result] of results.entries()) {
    const assertion = `urn:ldes-ct:assertion:${encodeURIComponent(metadata.adapter.id)}:${index + 1}`;
    const evidence = `evidence/${result.test.id.replaceAll("/", "__")}.json`;
    lines.push(`<${assertion}> a earl:Assertion;`);
    lines.push(`    earl:assertedBy <${ASSERTOR}>;`);
    lines.push(`    earl:subject <${subject}>;`);
    lines.push(`    earl:test <${result.test.iri}>;`);
    lines.push("    earl:mode earl:automatic;");
    lines.push("    earl:result [");
    lines.push("        a earl:TestResult;");
    lines.push(`        earl:outcome earl:${result.outcome};`);
    lines.push(`        dct:date "${metadata.generatedAt}"^^xsd:dateTime;`);
    lines.push(`        ct:evidence <${evidence}>`);
    lines.push("    ] .");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function literal(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
