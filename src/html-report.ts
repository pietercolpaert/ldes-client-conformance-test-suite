import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SuiteSummary } from "./types.js";

export async function generateReportSite(
  reportsRoot: string,
  outDir: string,
): Promise<SuiteSummary[]> {
  const versionDir = path.join(outDir, "1.0");
  const summaries = (await loadSummaries(reportsRoot)).filter(
    (summary) => summary.metadata.adapter.id !== "reference",
  );
  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(versionDir, "reports"), { recursive: true });

  for (const summary of summaries) {
    const source = path.dirname(
      await findSummaryForAdapter(reportsRoot, summary.metadata.adapter.id),
    );
    const target = path.join(versionDir, "reports", summary.metadata.adapter.id);
    await mkdir(target, { recursive: true });
    await copyIfPresent(path.join(source, "summary.json"), path.join(target, "summary.json"));
    await copyIfPresent(path.join(source, "earl.ttl"), path.join(target, "earl.ttl"));
    await copyIfPresent(path.join(source, "coverage.json"), path.join(target, "coverage.json"));
    await copyIfPresent(path.join(source, "coverage.md"), path.join(target, "coverage.md"));
    await copyIfPresent(path.join(source, "evidence"), path.join(target, "evidence"));
  }

  await writeFile(path.join(outDir, "index.html"), renderRedirectIndex());
  await writeFile(path.join(versionDir, "index.html"), renderIndex(summaries));
  await writeFile(path.join(versionDir, "report.css"), REPORT_CSS);
  await writeFile(path.join(outDir, ".nojekyll"), "");
  return summaries;
}

async function loadSummaries(root: string): Promise<SuiteSummary[]> {
  const found: SuiteSummary[] = [];
  await walk(root, async (file) => {
    if (path.basename(file) !== "summary.json") return;
    const parsed = JSON.parse(await readFile(file, "utf8")) as SuiteSummary;
    if (parsed.metadata?.adapter?.id && Array.isArray(parsed.tests)) {
      found.push(parsed);
    }
  });
  return found.sort((left, right) =>
    left.metadata.adapter.client.name.localeCompare(
      right.metadata.adapter.client.name,
    ),
  );
}

async function findSummaryForAdapter(
  root: string,
  adapterId: string,
): Promise<string> {
  let match = "";
  await walk(root, async (file) => {
    if (match || path.basename(file) !== "summary.json") return;
    const parsed = JSON.parse(await readFile(file, "utf8")) as SuiteSummary;
    if (parsed.metadata?.adapter?.id === adapterId) match = file;
  });
  if (!match) throw new Error(`could not locate report for adapter ${adapterId}`);
  return match;
}

async function walk(
  directory: string,
  visit: (file: string) => Promise<void>,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(child, visit);
    else await visit(child);
  }
}

async function copyIfPresent(source: string, target: string): Promise<void> {
  try {
    await cp(source, target, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function renderIndex(summaries: SuiteSummary[]): string {
  const generatedAt =
    summaries.map((summary) => summary.metadata.generatedAt).sort().at(-1) ??
    new Date().toISOString();
  const cards = summaries.map(renderClient).join("\n");
  const testCatalog = renderTestCatalog(summaries);
  const coverage = summaries[0]?.coverage;
  const coverageText = coverage
    ? `${coverage.requirementsWithTests} of ${coverage.totalRequirements} reviewed requirements have executable mappings; the remaining ${coverage.requirementsWithRationales} have explicit scope or deferral rationales.`
    : "Requirement coverage is included with each client report.";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="LDES 1.0 client conformance results">
  <meta name="theme-color" content="#5252cf">
  <title>LDES 1.0 client conformance</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css?family=Open+Sans:300,400,400italic,700,700italic" rel="stylesheet">
  <link rel="stylesheet" href="report.css">
</head>
<body>
  <header class="hero">
    <div class="hero__inner">
      <div class="brand">
        <img src="https://tree.linkeddatafragments.org/img/logo-ldes.svg" alt="LDES logo" class="brand__logo">
        <p class="brand__text">Linked Data Event Streams</p>
      </div>
      <div class="hero__copy">
        <p class="eyebrow">Client conformance</p>
        <h1>LDES 1.0 client conformance</h1>
        <p class="lede">Independent, black-box results derived from deterministic HTTP and RDF scenarios. ${escapeHtml(coverageText)} Group claims apply only to the named tests and pinned client revision.</p>
        <p class="timestamp">Report generated <time datetime="${escapeHtml(generatedAt)}">${escapeHtml(formatDate(generatedAt))}</time></p>
      </div>
    </div>
  </header>
  <main>
    <section class="legend" aria-label="EARL outcome legend">
      ${badge("passed", "Passed")}
      ${badge("failed", "Failed")}
      ${badge("cantTell", "Could not determine")}
      ${badge("inapplicable", "Inapplicable")}
      ${badge("untested", "Untested")}
    </section>
    ${testCatalog}
    <section class="clients" aria-label="Client reports">
      ${cards || '<p class="empty">No conformance reports were found.</p>'}
    </section>
    <aside class="method">
      <h2>How to read this report</h2>
      <p><strong>Failed</strong> means the client’s observable output did not match the normative test oracle. <strong>Could not determine</strong> means the adapter or required runtime could not complete the observation, so it is not a client failure and provides no evidence of conformance. <strong>Inapplicable</strong> is also not a pass. This report does not award a single “fully conformant” badge; group claims and advisory failures must be read together. EARL and JSON evidence are retained for independent processing.</p>
    </aside>
  </main>
  <footer>
    <a href="https://w3id.org/ldes/specification">LDES 1.0 specification</a>
    <span aria-hidden="true">·</span>
    <a href="https://www.w3.org/TR/EARL10-Schema/">EARL 1.0</a>
  </footer>
</body>
</html>`;
}

function renderRedirectIndex(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0; url=1.0/">
  <title>LDES 1.0 client conformance</title>
  <link rel="canonical" href="1.0/">
</head>
<body>
  <p><a href="1.0/">Open the LDES 1.0 client conformance report.</a></p>
</body>
</html>`;
}

function renderTestCatalog(summaries: SuiteSummary[]): string {
  const tests = new Map<string, SuiteSummary["tests"][number]>();
  for (const summary of summaries) {
    for (const test of summary.tests) tests.set(test.iri, test);
  }
  const cards = [...tests.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((test) => {
      const iri = testIri(test);
      return `<article class="test-card" id="${escapeHtml(fragmentId(iri))}">
      <p class="eyebrow">${escapeHtml(humanize(test.group) ?? "Unclassified")}</p>
      <h3><a href="#${escapeHtml(fragmentId(iri))}">${escapeHtml(test.title)}</a></h3>
      <p>${escapeHtml(test.description ?? "No manifest description is available for this test.")}</p>
      <p class="test-meta"><code>${escapeHtml(test.id)}</code> · <a href="${escapeHtml(iri)}">${escapeHtml(iri)}</a></p>
      <p class="requirements">${escapeHtml(test.requirements.join(", ") || test.requirement || "No requirement mapping")} ${test.requirementLevel ? `<span class="level">${escapeHtml(test.requirementLevel.toUpperCase())}</span>` : ""}</p>
    </article>`;
    })
    .join("\n");
  return `<section class="test-catalog" aria-label="Dereferenceable conformance tests">
      <div class="section-heading">
        <p class="eyebrow">Dereferenceable test cases</p>
        <h2>LDES 1.0 conformance tests</h2>
        <p>Each test has a stable hash IRI under <code>https://www.pieter.pm/ldes-client-conformance-test-suite/1.0#</code>. EARL assertions use these IRIs directly.</p>
      </div>
      <div class="test-grid">${cards || '<p class="empty">No test metadata was found.</p>'}</div>
    </section>`;
}

function renderClient(summary: SuiteSummary): string {
  const { adapter, probe } = summary.metadata;
  const resultBase = `reports/${encodeURIComponent(adapter.id)}`;
  const availability = probe.available
    ? '<span class="availability availability--ready">Adapter available</span>'
    : `<span class="availability availability--missing">Adapter unavailable: ${escapeHtml(probe.reason ?? "unknown reason")}</span>`;
  const determined = (summary.counts.passed ?? 0) + (summary.counts.failed ?? 0);
  const score = determined
    ? `<strong>${summary.counts.passed ?? 0}</strong><span>/ ${determined} determined tests passed</span>`
    : '<strong class="score__unknown">Not run</strong><span>no conformance determination</span>';
  const tests = summary.tests
    .map(
      (test) => {
        const iri = testIri(test);
        return `<tr>
        <td><span class="outcome outcome--${test.outcome}">${label(test.outcome)}</span></td>
        <td><strong><a href="#${escapeHtml(fragmentId(iri))}">${escapeHtml(test.title)}</a></strong><span class="test-id">${escapeHtml(test.id)}</span></td>
        <td>${escapeHtml(humanize(test.group) ?? "—")}</td>
        <td>${escapeHtml(test.requirements?.join(", ") || test.requirement || "—")} ${test.requirementLevel ? `<span class="level">${escapeHtml(test.requirementLevel.toUpperCase())}</span>` : ""}</td>
        <td>${test.diagnostics.length ? `<details><summary>${test.diagnostics.length} diagnostic${test.diagnostics.length === 1 ? "" : "s"}</summary><pre>${escapeHtml(test.diagnostics.join("\n"))}</pre></details>` : "—"}</td>
        <td><a href="${resultBase}/${escapeHtml(test.evidence)}">JSON</a></td>
      </tr>`;
      },
    )
    .join("\n");

  return `<article class="client">
    <div class="client__heading">
      <div>
        <p class="eyebrow">${escapeHtml(adapter.name)}</p>
        <h2><a href="${escapeHtml(adapter.client.homepage)}">${escapeHtml(adapter.client.name)}</a></h2>
        <p class="revision">revision <code>${escapeHtml(probe.clientRevision ?? adapter.client.revision)}</code>${probe.clientVersion ? ` · version ${escapeHtml(probe.clientVersion)}` : ""}</p>
      </div>
      <div class="score" aria-label="${determined ? `${summary.counts.passed ?? 0} of ${determined} determined tests passed` : "No conformance determination"}">
        ${score}
      </div>
    </div>
    ${availability}
    ${renderGroupClaims(summary)}
    <div class="counts">
      ${badge("passed", String(summary.counts.passed ?? 0))}
      ${badge("failed", String(summary.counts.failed ?? 0))}
      ${badge("cantTell", String(summary.counts.cantTell ?? 0))}
      <a class="machine-link" href="${resultBase}/earl.ttl">EARL Turtle</a>
      <a class="machine-link" href="${resultBase}/summary.json">Summary JSON</a>
      <a class="machine-link" href="${resultBase}/coverage.json">Coverage JSON</a>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Outcome</th><th>Test</th><th>Group</th><th>Requirement</th><th>Details</th><th>Evidence</th></tr></thead>
        <tbody>${tests}</tbody>
      </table>
    </div>
  </article>`;
}

function fragmentId(iri: string): string {
  return iri.slice(iri.indexOf("#") + 1);
}

function testIri(test: SuiteSummary["tests"][number]): string {
  return test.iri ?? `https://www.pieter.pm/ldes-client-conformance-test-suite/1.0#${test.id
    .replace(/^tests\/1\.0\//u, "")
    .replaceAll("/", "-")}`;
}

function renderGroupClaims(summary: SuiteSummary): string {
  if (!summary.groupClaims?.length) {
    return '<p class="legacy-note">This report predates group-claim scoring; rerun the adapter to populate it.</p>';
  }
  return `<div class="group-claims" aria-label="Compliance group claims">
    ${summary.groupClaims.map((claim) =>
      `<span class="group-claim"><strong>${escapeHtml(humanize(claim.group) ?? claim.group)}</strong> ${badge(claim.outcome, label(claim.outcome))}${claim.dependsOn ? `<small>depends on ${escapeHtml(humanize(claim.dependsOn) ?? claim.dependsOn)}</small>` : ""}</span>`
    ).join("")}
  </div>`;
}

function badge(outcome: string, text: string): string {
  return `<span class="badge badge--${outcome}"><span class="dot"></span>${escapeHtml(text)}</span>`;
}

function label(outcome: string): string {
  return (
    {
      passed: "Passed",
      failed: "Failed",
      cantTell: "Could not determine",
      inapplicable: "Inapplicable",
      untested: "Untested",
    }[outcome] ?? outcome
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function humanize(value?: string): string | undefined {
  return value?.replace(/([a-z])([A-Z])/gu, "$1 $2");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const REPORT_CSS = `
:root {
  color-scheme: light;
  --prim: #5252cf;
  --sec: #7950e6;
  --ink: #1e1e32;
  --muted: #626278;
  --paper: #f8f8ff;
  --panel: #ffffff;
  --line: #dedcf2;
  --ldes: var(--prim);
  --ldes-dark: #38389b;
  --ldes-soft: #eeeeff;
  --pass: #16834b;
  --fail: #c43d3d;
  --unknown: #9a6700;
  --quiet: #687785;
  font-family: "Open Sans", Verdana, Arial, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; color: var(--ink); background: var(--paper); line-height: 1.55; }
a { color: var(--prim); text-underline-offset: .16em; }
a:hover { color: var(--sec); }
.hero { color: var(--ink); background: white; border-bottom: .45rem solid var(--prim); }
.hero__inner, main, footer { width: min(1220px, calc(100% - 2rem)); margin-inline: auto; }
.hero__inner { display: grid; grid-template-columns: minmax(14rem, 22rem) 1fr; gap: 3rem; align-items: center; padding: 3.2rem 0 3rem; }
.brand { text-align: center; }
.brand__logo { display: block; width: min(100%, 22rem); height: auto; margin: 0 auto 1rem; }
.brand__text { margin: 0; color: var(--prim); font-size: 1.7rem; font-weight: 700; line-height: 1.25; }
.hero__copy { max-width: 790px; }
.eyebrow { margin: 0 0 .55rem; color: var(--prim); font-size: .76rem; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
h1 { max-width: 850px; margin: 0; font-size: clamp(2.1rem, 5.5vw, 4.4rem); line-height: 1; letter-spacing: 0; }
.lede { max-width: 760px; margin: 1.5rem 0 0; font-size: 1.08rem; color: #44445e; }
.timestamp { margin: 1.35rem 0 0; font-size: .85rem; color: var(--muted); }
main { padding-block: 2rem 4rem; }
.legend, .counts { display: flex; flex-wrap: wrap; gap: .65rem; align-items: center; }
.legend { margin-bottom: 2rem; }
.badge { display: inline-flex; align-items: center; gap: .45rem; padding: .38rem .7rem; border: 1px solid var(--line); border-radius: 999px; background: white; font-size: .78rem; font-weight: 750; }
.dot { width: .62rem; height: .62rem; border-radius: 50%; background: var(--quiet); }
.badge--passed .dot { background: var(--pass); }
.badge--failed .dot { background: var(--fail); }
.badge--cantTell .dot { background: var(--unknown); }
.section-heading { margin: 0 0 1rem; }
.section-heading h2 { margin: 0; font-size: clamp(1.5rem, 3vw, 2.3rem); }
.section-heading p:not(.eyebrow) { max-width: 780px; margin: .45rem 0 0; color: var(--muted); }
.test-catalog { margin-bottom: 2rem; }
.test-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); gap: .9rem; }
.test-card { padding: 1rem; border: 1px solid var(--line); border-radius: .65rem; background: white; }
.test-card h3 { margin: 0; font-size: 1rem; line-height: 1.35; }
.test-card h3 a { color: inherit; text-decoration-color: var(--line); }
.test-card p { margin: .55rem 0 0; color: #44445e; font-size: .82rem; }
.test-card .eyebrow { margin: 0 0 .4rem; font-size: .66rem; }
.test-meta { overflow-wrap: anywhere; }
.requirements { color: var(--muted); }
.clients { display: grid; gap: 1.5rem; }
.client { overflow: hidden; border: 1px solid var(--line); border-radius: .65rem; background: var(--panel); box-shadow: 0 12px 35px rgb(82 82 207 / .08); }
.client__heading { display: flex; justify-content: space-between; gap: 1.5rem; padding: 1.6rem 1.6rem .9rem; }
.client h2 { margin: 0; font-size: clamp(1.35rem, 3vw, 2rem); }
.client h2 a { color: inherit; text-decoration: none; }
.revision { margin: .35rem 0 0; color: var(--muted); font-size: .84rem; }
code { overflow-wrap: anywhere; }
.score { min-width: 7rem; text-align: right; }
.score strong { display: block; font-size: 2.2rem; line-height: 1; color: var(--prim); }
.score .score__unknown { font-size: 1.25rem; color: var(--unknown); }
.score span { font-size: .78rem; color: var(--muted); }
.availability { display: block; margin: 0 1.6rem .9rem; padding: .65rem .8rem; border-radius: .45rem; font-size: .82rem; }
.availability--ready { color: #075f35; background: #e7f7ee; }
.availability--missing { color: #744c00; background: #fff3cd; }
.counts { padding: 0 1.6rem 1.25rem; }
.group-claims { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: .65rem; margin: 0 1.6rem 1rem; }
.legacy-note { margin: 0 1.6rem 1rem; color: var(--muted); font-size: .82rem; }
.group-claim { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .4rem; padding: .65rem; border: 1px solid var(--line); border-radius: .45rem; }
.group-claim small { flex-basis: 100%; color: var(--muted); }
.machine-link { margin-left: .25rem; font-size: .82rem; font-weight: 700; }
.table-wrap { overflow-x: auto; border-top: 1px solid var(--line); }
table { width: 100%; border-collapse: collapse; font-size: .82rem; }
th, td { padding: .9rem .8rem; border-bottom: 1px solid #e7edf2; text-align: left; vertical-align: top; }
th { color: var(--muted); background: #f6f5ff; font-size: .69rem; letter-spacing: .07em; text-transform: uppercase; }
.outcome { display: inline-block; min-width: 5.5rem; padding: .24rem .4rem; border-radius: .3rem; color: white; text-align: center; font-size: .67rem; font-weight: 800; }
.outcome--passed { background: var(--pass); }
.outcome--failed { background: var(--fail); }
.outcome--cantTell { background: var(--unknown); }
.outcome--inapplicable, .outcome--untested { background: var(--quiet); }
.test-id { display: block; margin-top: .22rem; color: var(--muted); font-family: ui-monospace, monospace; font-size: .7rem; }
.level { display: inline-block; margin-left: .3rem; padding: .1rem .28rem; border: 1px solid var(--line); border-radius: .25rem; font-size: .6rem; font-weight: 850; }
details summary { cursor: pointer; color: var(--prim); font-weight: 700; }
pre { max-width: 36rem; max-height: 14rem; overflow: auto; padding: .7rem; white-space: pre-wrap; background: #f3f6f8; border-radius: .35rem; font-size: .7rem; }
.method { margin-top: 2rem; padding: 1.35rem 1.5rem; border-left: .35rem solid var(--prim); background: var(--ldes-soft); }
.method h2 { margin: 0 0 .35rem; font-size: 1.1rem; }
.method p { margin: 0; color: #3f3f63; }
footer { display: flex; gap: .7rem; padding-block: 1.5rem 3rem; color: var(--muted); font-size: .82rem; }
.empty { padding: 2rem; border: 1px dashed var(--line); background: white; }
@media (max-width: 680px) {
  .hero__inner { grid-template-columns: 1fr; gap: 2rem; padding-block: 2.4rem; }
  .brand { text-align: left; }
  .brand__logo { width: min(100%, 17rem); margin-inline: 0; }
  .brand__text { font-size: 1.35rem; }
  .client__heading { flex-direction: column; }
  .score { text-align: left; }
}
`;
