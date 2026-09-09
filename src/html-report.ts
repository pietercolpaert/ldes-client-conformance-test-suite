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

type Test = SuiteSummary["tests"][number];

/** Report order for the compliance groups; unknown groups sort after these. */
const GROUP_ORDER = [
  "UnorderedTraversal",
  "MemberExtraction",
  "OrderedTraversal",
  "ContextInformation",
  "RetentionInterpretation",
];

function byGroup<T extends { group?: string }>(
  tests: T[],
): Array<{ group: string; label: string; tests: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const test of tests) {
    const key = test.group ?? "Unclassified";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(test);
    else buckets.set(key, [test]);
  }
  const rank = (group: string): number => {
    const index = GROUP_ORDER.indexOf(group);
    return index === -1 ? GROUP_ORDER.length : index;
  };
  return [...buckets.entries()]
    .map(([group, groupTests]) => ({
      group,
      label: humanize(group) ?? group,
      tests: groupTests,
    }))
    .sort((left, right) =>
      rank(left.group) - rank(right.group) || left.label.localeCompare(right.label)
    );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Collapsed group panel. Test detail is hidden until a reader opens a group,
 * asks for the whole overview, or dereferences a specific test IRI, which the
 * page script resolves by opening the ancestor panels of the fragment target.
 */
function groupPanel(label: string, summaryMeta: string, body: string): string {
  return `<details class="group" data-group>
        <summary>
          <span class="group__name">${escapeHtml(label)}</span>
          <span class="group__meta">${escapeHtml(summaryMeta)}</span>
        </summary>
        ${body}
      </details>`;
}

function tableWrap(head: string, rows: string): string {
  return `<div class="table-wrap">
          <table class="data-table">
            <thead><tr>${head}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
}

function toggleAll(target: string, showLabel: string): string {
  return `<button class="toggle-all" type="button" data-toggle-all="${escapeHtml(target)}">${escapeHtml(showLabel)}</button>`;
}

function renderIndex(summaries: SuiteSummary[]): string {
  const generatedAt =
    summaries.map((summary) => summary.metadata.generatedAt).sort().at(-1) ??
    new Date().toISOString();
  const softwareOverview = renderSoftwareOverview(summaries);
  const clients = summaries.map(renderClient).join("\n");
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
  <nav class="topnav" aria-label="Linked Data Event Streams">
    <a class="nav-brand" href="https://ldes.tech/">
      <img class="nav-logo" src="https://tree.linkeddatafragments.org/img/logo-ldes.svg" alt="Linked Data Event Streams">
    </a>
    <ul>
      <li><a href="https://ldes.tech/">Home</a></li>
      <li><a href="https://w3id.org/ldes/specification">Specification</a></li>
      <li><a href="https://github.com/pietercolpaert/ldes-client-conformance-test-suite">Test suite</a></li>
    </ul>
  </nav>
  <header class="site-header">
    <h1>LDES 1.0 client conformance</h1>
    <p class="tagline">Independent, black-box results derived from deterministic HTTP and RDF scenarios. Group claims apply only to the named tests and the pinned client revision.</p>
    <p class="timestamp">Report generated <time datetime="${escapeHtml(generatedAt)}">${escapeHtml(formatDate(generatedAt))}</time></p>
  </header>
  <main class="container">
    <section aria-label="Requirement coverage">
      <h2>Requirement coverage</h2>
      <p class="section-intro">${escapeHtml(coverageText)}</p>
      <div class="legend" aria-label="EARL outcome legend">
        ${badge("passed", "Passed")}
        ${badge("failed", "Failed")}
        ${badge("advisory", "Advisory failed")}
        ${badge("cantTell", "Could not determine")}
        ${badge("inapplicable", "Inapplicable")}
        ${badge("untested", "Untested")}
      </div>
    </section>
    ${softwareOverview}
    ${clients || '<p class="empty">No conformance reports were found.</p>'}
    ${testCatalog}
    <section class="method" aria-label="How to read this report">
      <h2>How to read this report</h2>
      <p><strong>Failed</strong> means the client’s observable output did not match a required normative test oracle. <strong>Advisory failed</strong> means a SHOULD-level expectation was not met; it is reported as evidence but does not fail the main compliance group. <strong>Could not determine</strong> means the adapter or required runtime could not complete the observation, so it is not a client failure and provides no evidence of conformance. <strong>Inapplicable</strong> is also not a pass. This report does not award a single “fully conformant” badge; group claims and advisory failures must be read together. EARL and JSON evidence are retained for independent processing.</p>
    </section>
  </main>
  <footer>
    <p>
      <a href="https://w3id.org/ldes/specification">LDES 1.0 specification</a>
      <span aria-hidden="true">·</span>
      <a href="https://www.w3.org/TR/EARL10-Schema/">EARL 1.0</a>
      <span aria-hidden="true">·</span>
      <a href="https://ldes.tech/">ldes.tech</a>
    </p>
  </footer>
  <script>${PAGE_SCRIPT}</script>
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
  const tests = new Map<string, Test>();
  for (const summary of summaries) {
    for (const test of summary.tests) tests.set(test.iri, test);
  }
  const all = [...tests.values()].sort((left, right) => left.id.localeCompare(right.id));
  const panels = byGroup(all)
    .map(({ label, tests: groupTests }) => {
      const rows = groupTests
        .map((test) => {
          const iri = testIri(test);
          const fragment = fragmentId(iri);
          return `<tr id="${escapeHtml(fragment)}">
              <td>
                <a class="test-title" href="#${escapeHtml(fragment)}">${escapeHtml(test.title)}</a>
                <code class="test-id">${escapeHtml(test.id)}</code>
                <p class="test-desc">${escapeHtml(test.description ?? "No manifest description is available for this test.")}</p>
                <a class="test-iri" href="${escapeHtml(iri)}">#${escapeHtml(fragment)}</a>
              </td>
              <td>${escapeHtml(test.requirements?.join(", ") || test.requirement || "No requirement mapping")}</td>
              <td>${levelCell(test)}</td>
            </tr>`;
        })
        .join("\n");
      return groupPanel(
        label,
        plural(groupTests.length, "test"),
        tableWrap("<th>Test</th><th>Requirements</th><th>Level</th>", rows),
      );
    })
    .join("\n");
  return `<section class="catalog" id="test-catalog" aria-label="Dereferenceable conformance tests">
      <h2>Conformance test cases</h2>
      <p class="section-intro">Every test has a stable hash IRI under <code>https://www.pieter.pm/ldes-client-conformance-test-suite/1.0#</code>, and EARL assertions use those IRIs directly. Test detail is collapsed by default: open a group below, show the whole catalogue, or follow a test IRI to jump straight to it.</p>
      ${toggleAll("#test-catalog", "Show all test cases")}
      ${panels || '<p class="empty">No test metadata was found.</p>'}
    </section>`;
}

function renderSoftwareOverview(summaries: SuiteSummary[]): string {
  const rows = summaries.map((summary) => {
    const { adapter, probe } = summary.metadata;
    const status = complianceStatus(summary);
    const resultBase = `reports/${encodeURIComponent(adapter.id)}`;
    const clientTarget = `client-${adapter.id}`;
    const revision = probe.clientRevision ?? adapter.client.revision;
    const version = probe.clientVersion ?? adapter.client.version;
    return `<tr class="software-row" data-target="${escapeHtml(clientTarget)}">
          <th scope="row">
            <a class="software-link" href="#${escapeHtml(clientTarget)}">${escapeHtml(adapter.client.name)}</a>
            <span class="software-meta">${version ? `version ${escapeHtml(version)} · ` : ""}revision <code>${escapeHtml(shortRevision(revision))}</code></span>
          </th>
          <td>${escapeHtml(implementedFeatures(summary))}</td>
          <td><time datetime="${escapeHtml(summary.metadata.generatedAt)}">${escapeHtml(formatDate(summary.metadata.generatedAt))}</time></td>
          <td>
            ${badge(status.outcome, status.label)}
            <a class="earl-link" href="${resultBase}/earl.ttl">EARL report</a>
          </td>
        </tr>`;
  }).join("\n");
  return `<section class="software-overview" aria-label="Tested software overview">
      <h2>Tested software</h2>
      <p class="section-intro">The table lists each tested client, the capabilities declared by its adapter probe, the report timestamp, and the machine-readable EARL assertions. Select a software row to open its detailed test results.</p>
      <div class="table-wrap">
        <table class="data-table overview-table">
          <thead><tr><th>Software</th><th>Implemented</th><th>Last tested</th><th>Spec compliance</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">No conformance reports were found.</td></tr>'}</tbody>
        </table>
      </div>
    </section>`;
}

function renderClient(summary: SuiteSummary): string {
  const { adapter, probe } = summary.metadata;
  const resultBase = `reports/${encodeURIComponent(adapter.id)}`;
  const clientId = `client-${adapter.id}`;
  const availability = probe.available
    ? '<p class="availability availability--ready">Adapter available</p>'
    : `<p class="availability availability--missing">Adapter unavailable: ${escapeHtml(probe.reason ?? "unknown reason")}</p>`;
  const mandatory = summary.tests.filter((test) => test.requirementLevel === "Must");
  const mandatoryPassed = mandatory.filter((test) => test.outcome === "passed").length;
  const mandatoryDetermined = mandatory.filter((test) =>
    test.outcome === "passed" || test.outcome === "failed"
  ).length;
  const advisoryFailed = summary.tests.filter((test) =>
    test.requirementLevel === "Should" && test.outcome === "failed"
  ).length;
  const requiredFailed = mandatory.filter((test) => test.outcome === "failed").length;
  const status = complianceStatus(summary);
  const score = mandatoryDetermined
    ? `<strong>${mandatoryPassed}<span class="score__of">/${mandatoryDetermined}</span></strong><span class="score__label">required determined tests passed</span>`
    : '<strong class="score__unknown">Not run</strong><span class="score__label">no conformance determination</span>';

  const panels = byGroup(summary.tests)
    .map(({ label: groupLabel, tests: groupTests }) => {
      const tally = ["passed", "failed", "cantTell", "inapplicable", "untested"]
        .map((outcome) => ({
          outcome,
          count: groupTests.filter((test) => outcomeClass(test) === outcome).length,
        }))
        .filter((entry) => entry.count);
      const advisory = groupTests.filter((test) => outcomeClass(test) === "advisory").length;
      const meta = [
        ...tally.map((entry) => `${entry.count} ${label(entry.outcome).toLowerCase()}`),
        ...(advisory ? [`${advisory} advisory failed`] : []),
      ].join(" · ");
      const rows = groupTests
        .map((test) => {
          const iri = testIri(test);
          const fragment = fragmentId(iri);
          return `<tr>
              <td><span class="outcome outcome--${escapeHtml(outcomeClass(test))}">${escapeHtml(testLabel(test))}</span></td>
              <td>
                <a class="test-title" href="#${escapeHtml(fragment)}">${escapeHtml(test.title)}</a>
                <code class="test-id">${escapeHtml(test.id)}</code>
              </td>
              <td>${escapeHtml(test.requirements?.join(", ") || test.requirement || "—")}${levelCell(test, true)}</td>
              <td>${test.diagnostics.length ? `<details class="diagnostics"><summary>${escapeHtml(plural(test.diagnostics.length, "diagnostic"))}</summary><pre>${escapeHtml(test.diagnostics.join("\n"))}</pre></details>` : "—"}</td>
              <td><a href="${resultBase}/${escapeHtml(test.evidence)}">JSON</a></td>
            </tr>`;
        })
        .join("\n");
      return groupPanel(
        groupLabel,
        meta || plural(groupTests.length, "test"),
        tableWrap(
          "<th>Outcome</th><th>Test</th><th>Requirement</th><th>Details</th><th>Evidence</th>",
          rows,
        ),
      );
    })
    .join("\n");

  return `<details class="client" id="${escapeHtml(clientId)}" data-client-report aria-label="${escapeHtml(adapter.client.name)}">
      <summary class="client__heading">
        <div>
          <h2><a href="${escapeHtml(adapter.client.homepage)}">${escapeHtml(adapter.client.name)}</a></h2>
          <p class="revision">Tested through the ${escapeHtml(adapter.name)} · revision <code>${escapeHtml(probe.clientRevision ?? adapter.client.revision)}</code>${probe.clientVersion ? ` · version ${escapeHtml(probe.clientVersion)}` : ""}</p>
        </div>
        ${badge(status.outcome, status.label)}
        <p class="score" aria-label="${mandatoryDetermined ? `${mandatoryPassed} of ${mandatoryDetermined} required determined tests passed` : "No conformance determination"}">${score}</p>
      </summary>
      ${availability}
      ${renderGroupClaims(summary)}
      <div class="counts">
        ${badge("passed", plural(summary.counts.passed ?? 0, "passed"))}
        ${badge("failed", `${requiredFailed} required failed`)}
        ${advisoryFailed ? badge("advisory", `${advisoryFailed} advisory failed`) : ""}
        ${badge("cantTell", `${summary.counts.cantTell ?? 0} could not determine`)}
      </div>
      <p class="machine-links">
        <a href="${resultBase}/earl.ttl">EARL Turtle</a>
        <a href="${resultBase}/summary.json">Summary JSON</a>
        <a href="${resultBase}/coverage.json">Coverage JSON</a>
      </p>
      <h3>Results by compliance group</h3>
      ${toggleAll(`#${clientId}`, "Show all tests")}
      ${panels || '<p class="empty">No test results were recorded.</p>'}
    </details>`;
}

function implementedFeatures(summary: SuiteSummary): string {
  const capabilities = summary.metadata.probe.capabilities ?? summary.metadata.adapter.capabilities;
  const features = [
    capabilities.modes.length ? `${capabilities.modes.join(" and ")} traversal` : "no traversal mode declared",
    capabilities.memberExtraction ? "member extraction" : undefined,
    capabilities.context ? "context information" : undefined,
    capabilities.persistentState ? "persistent state" : undefined,
    capabilities.polling ? "polling" : undefined,
    capabilities.treeProfileExtraction ? "TREE profile extraction" : undefined,
    capabilities.serviceRuntime ? "service runtime" : undefined,
  ].filter((feature): feature is string => Boolean(feature));
  return features.join(", ");
}

function complianceStatus(summary: SuiteSummary): { outcome: string; label: string } {
  if (!summary.metadata.probe.available) return { outcome: "cantTell", label: "Could not determine" };
  const mandatory = summary.tests.filter((test) => test.requirementLevel === "Must");
  if (mandatory.some((test) => test.outcome === "failed")) return { outcome: "failed", label: "No" };
  if (mandatory.some((test) => test.outcome === "cantTell" || test.outcome === "untested")) {
    return { outcome: "cantTell", label: "Could not determine" };
  }
  const applicable = mandatory.filter((test) => test.outcome !== "inapplicable");
  if (applicable.length && applicable.every((test) => test.outcome === "passed")) {
    return { outcome: "passed", label: "Yes, for declared features" };
  }
  return { outcome: "inapplicable", label: "No applicable required tests" };
}

function shortRevision(revision: string): string {
  return revision.length > 12 ? revision.slice(0, 12) : revision;
}

function levelCell(test: Test, inline = false): string {
  if (!test.requirementLevel) return inline ? "" : "—";
  const text = escapeHtml(test.requirementLevel.toUpperCase());
  return `<span class="level level--${escapeHtml(test.requirementLevel.toLowerCase())}">${text}</span>`;
}

function outcomeClass(test: Test): string {
  return test.outcome === "failed" && test.requirementLevel === "Should"
    ? "advisory"
    : test.outcome;
}

function testLabel(test: Test): string {
  return test.outcome === "failed" && test.requirementLevel === "Should"
    ? "Advisory failed"
    : label(test.outcome);
}

function fragmentId(iri: string): string {
  return iri.slice(iri.indexOf("#") + 1);
}

function testIri(test: Test): string {
  return test.iri ?? `https://www.pieter.pm/ldes-client-conformance-test-suite/1.0#${test.id
    .replace(/^tests\/1\.0\//u, "")
    .replaceAll("/", "-")}`;
}

function renderGroupClaims(summary: SuiteSummary): string {
  if (!summary.groupClaims?.length) {
    return '<p class="legacy-note">This report predates group-claim scoring; rerun the adapter to populate it.</p>';
  }
  const rows = summary.groupClaims
    .map((claim) => {
      const applicable = claim.applicableMandatoryTests ?? claim.mandatoryTests;
      const scope = applicable === claim.mandatoryTests
        ? `${claim.passedMandatoryTests} of ${claim.mandatoryTests}`
        : `${claim.passedMandatoryTests} of ${applicable} applicable (${claim.mandatoryTests} total)`;
      return `<tr>
            <th scope="row">${escapeHtml(humanize(claim.group) ?? claim.group)}</th>
            <td>${badge(claim.outcome, label(claim.outcome))}</td>
            <td>${escapeHtml(scope)}</td>
            <td>${claim.diagnostics?.length ? escapeHtml(claim.diagnostics.join(" ")) : "—"}</td>
          </tr>`;
    })
    .join("\n");
  return `<div class="table-wrap">
        <table class="data-table claims">
          <thead><tr><th>Compliance group</th><th>Claim</th><th>Mandatory tests passed</th><th>Notes</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
}

function badge(outcome: string, text: string): string {
  return `<span class="badge badge--${escapeHtml(outcome)}">${escapeHtml(text)}</span>`;
}

function label(outcome: string): string {
  return (
    {
      passed: "Passed",
      failed: "Failed",
      advisory: "Advisory failed",
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

/**
 * Two ways to open collapsed test detail: a per-section "show all" button, and
 * dereferencing a test IRI. Fragment navigation into a closed <details> is not
 * reliably handled across browsers, so open the target's ancestors explicitly
 * and then bring it into view.
 */
const PAGE_SCRIPT = `
(function () {
  function revealTarget() {
    var hash = location.hash.slice(1);
    if (!hash) return;
    var target = document.getElementById(decodeURIComponent(hash));
    if (!target) return;
    if (target.tagName === "DETAILS") target.open = true;
    for (var node = target.parentNode; node && node.nodeType === 1; node = node.parentNode) {
      if (node.tagName === "DETAILS") node.open = true;
    }
    Array.prototype.forEach.call(document.querySelectorAll(".is-target"), function (el) {
      el.classList.remove("is-target");
    });
    target.classList.add("is-target");
    target.scrollIntoView({ block: "center" });
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-target]"), function (row) {
    row.addEventListener("click", function (event) {
      if (event.target.closest("a")) return;
      var id = row.getAttribute("data-target");
      var target = document.getElementById(id);
      if (target && target.tagName === "DETAILS") target.open = true;
      location.hash = id;
    });
  });

  function syncButton(button, open) {
    button.textContent = button.getAttribute(open ? "data-hide" : "data-show");
    button.setAttribute("aria-expanded", open ? "true" : "false");
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-toggle-all]"), function (button) {
    var scope = document.querySelector(button.getAttribute("data-toggle-all"));
    if (!scope) return;
    var show = button.textContent;
    button.setAttribute("data-show", show);
    button.setAttribute("data-hide", show.replace(/^Show/, "Hide"));
    syncButton(button, false);
    button.addEventListener("click", function () {
      var panels = scope.querySelectorAll("details[data-group]");
      var open = button.getAttribute("aria-expanded") !== "true";
      Array.prototype.forEach.call(panels, function (panel) { panel.open = open; });
      syncButton(button, open);
    });
    scope.addEventListener("toggle", function () {
      var panels = scope.querySelectorAll("details[data-group]");
      var anyClosed = Array.prototype.some.call(panels, function (panel) { return !panel.open; });
      syncButton(button, !anyClosed);
    }, true);
  });

  window.addEventListener("hashchange", revealTarget);
  revealTarget();
})();
`;

const REPORT_CSS = `
/* Palette, type and spacing follow the ldes.tech stylesheet so the generated
   report reads as part of the same site. */
:root {
  color-scheme: light;
  --primary: #5252cf;
  --primary-dark: #3d3da3;
  --primary-light: #6d67e4;
  --primary-rgb: 82, 82, 207;
  --accent: #15a88a;
  --text: #2b2b33;
  --bg: #fff;
  --line: #e3e3f2;
  --hairline: #eee;
  --muted: #666;
  --quiet-text: #4a4a55;
  --wash: #f5f5fc;
  --wash-strong: #ececf9;
  --font-body: 'Open Sans', sans-serif;
  --font-mono: 'Fira Mono', 'Courier New', monospace;
  --pass: #157f48;
  --fail: #bf3535;
  --warn: #8a6100;
  --neutral: #6b6b78;
}

html { font-size: 16px; box-sizing: border-box; max-width: 100%; overflow-x: hidden; }
*, *:before, *:after { box-sizing: inherit; }

body {
  font-family: var(--font-body);
  line-height: 1.6;
  margin: 0;
  color: var(--text);
  background: var(--bg);
  max-width: 100%;
  overflow-x: hidden;
}

a { color: var(--primary); text-decoration: none; }
a:hover { color: var(--primary-light); text-decoration: underline; }
code { font-family: var(--font-mono); overflow-wrap: anywhere; }

/* Top navigation */
.topnav {
  width: 100%;
  background: var(--primary);
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2rem;
  flex-wrap: wrap;
}
.nav-brand { display: flex; align-items: center; }
.nav-logo { height: 2.4rem; filter: brightness(0) invert(1); }
.topnav ul { display: flex; flex-wrap: wrap; gap: 0.25rem; list-style: none; margin: 0; padding: 0; }
.topnav ul a {
  display: inline-block;
  color: white;
  font-weight: 600;
  padding: 0.5rem 0.9rem;
  border-radius: 4px;
}
.topnav ul a:hover { background: rgba(255, 255, 255, 0.18); text-decoration: none; }

/* Hero header */
header.site-header {
  background: var(--wash);
  color: var(--primary);
  padding: 3.5rem 1.5rem;
  text-align: center;
}
header.site-header h1 { font-size: 2.2rem; font-weight: 700; margin: 0 0 0.5rem; letter-spacing: 0.02em; }
header.site-header p.tagline {
  font-size: 1.2rem;
  font-weight: 300;
  margin: 0 auto;
  max-width: 42rem;
  opacity: 0.95;
}
header.site-header p.timestamp { margin: 1.25rem 0 0; font-size: 0.85rem; color: var(--quiet-text); }

/* Main content */
.container { max-width: 1080px; margin: auto; padding: 1rem 1.25rem; }
section { margin: 2.5rem 0; }
h2 { font-size: 1.6rem; color: var(--primary); margin-bottom: 1rem; }
h3 { color: var(--primary-dark); font-size: 1.1rem; margin: 2rem 0 0.75rem; }
.section-intro { color: var(--quiet-text); max-width: 62rem; }

/* Badges */
.legend, .counts { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 1rem 0; }
.badge {
  display: inline-block;
  font-size: 0.78rem;
  background: var(--primary);
  color: white;
  padding: 0.2rem 0.7rem;
  border-radius: 4px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.badge--passed { background: var(--pass); }
.badge--failed { background: var(--fail); }
.badge--advisory { background: var(--primary-light); }
.badge--cantTell { background: var(--warn); }
.badge--inapplicable, .badge--untested { background: var(--neutral); }

/* Data tables */
.table-wrap { overflow-x: auto; }
table.data-table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
  margin: 1rem 0 2rem;
}
table.data-table th, table.data-table td {
  padding: 0.8rem 1rem;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--hairline);
  font-size: 0.9rem;
}
table.data-table thead th { background: var(--primary); color: white; font-weight: 700; }
table.data-table tr:last-child td { border-bottom: none; }
table.data-table tbody th[scope="row"] { font-weight: 700; color: var(--primary-dark); }
table.claims { margin-bottom: 1rem; }

/* Software overview */
.overview-table tbody tr { cursor: pointer; }
.overview-table tbody tr:hover { background: var(--wash); }
.software-link { font-weight: 700; }
.software-meta { display: block; margin-top: 0.2rem; color: var(--muted); font-size: 0.8rem; font-weight: 400; }
.earl-link { display: block; margin-top: 0.35rem; font-size: 0.82rem; font-weight: 700; }

/* Client sections */
.client {
  border: 1px solid var(--line);
  border-radius: 4px;
  margin: 2rem 0;
  background: #fff;
  box-shadow: none;
}
.client[open] { padding-bottom: 1.25rem; }
.client__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 1.25rem 1.4rem;
  cursor: pointer;
  list-style: none;
}
.client__heading::-webkit-details-marker { display: none; }
.client__heading:hover { background: var(--wash); }
.client[open] > .client__heading { border-bottom: 1px solid var(--line); background: var(--wash); }
.client h2 { margin: 0; font-size: 1.4rem; }
.client h2 a { color: var(--primary); }
.revision { margin: 0.35rem 0 0; color: var(--muted); font-size: 0.85rem; }
.score { margin: 0; text-align: right; }
.score strong { display: block; font-size: 2rem; line-height: 1.1; color: var(--primary); font-weight: 700; }
.score .score__of { font-size: 1.1rem; font-weight: 400; color: var(--muted); }
.score .score__unknown { font-size: 1.2rem; color: var(--warn); }
.score .score__label { font-size: 0.78rem; color: var(--muted); }
.availability { margin: 1rem 0; padding: 0.6rem 0.8rem; border-radius: 4px; font-size: 0.85rem; }
.availability--ready { color: #0f5c33; background: #e7f7ee; }
.availability--missing { color: #744c00; background: #fff3cd; }
.legacy-note { color: var(--muted); font-size: 0.85rem; }
.machine-links { margin: 0.5rem 0 0; font-size: 0.85rem; }
.machine-links a { font-weight: 700; margin-right: 1rem; }
.client > .availability,
.client > .table-wrap,
.client > .counts,
.client > .machine-links,
.client > h3,
.client > .toggle-all,
.client > .group,
.client > .legacy-note,
.client > .empty { margin-left: 1.4rem; margin-right: 1.4rem; }

/* Collapsed group panels */
.toggle-all {
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--primary);
  background: var(--wash);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0.3rem 0.9rem;
  cursor: pointer;
  margin-bottom: 0.75rem;
}
.toggle-all:hover { background: var(--wash-strong); color: var(--primary-dark); }
details.group {
  border: 1px solid var(--line);
  border-radius: 4px;
  margin-bottom: 0.5rem;
  background: #fff;
}
details.group > summary {
  cursor: pointer;
  padding: 0.7rem 1rem;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.75rem;
  list-style: none;
}
details.group > summary::-webkit-details-marker { display: none; }
details.group > summary::before {
  content: "";
  flex: none;
  width: 0.45rem;
  height: 0.45rem;
  border-right: 2px solid var(--primary);
  border-bottom: 2px solid var(--primary);
  transform: rotate(-45deg);
  transition: transform 0.15s ease;
}
details.group[open] > summary::before { transform: rotate(45deg); }
details.group > summary:hover { background: var(--wash); }
details.group[open] > summary { border-bottom: 1px solid var(--line); }
.group__name { font-weight: 700; color: var(--primary-dark); }
.group__meta { color: var(--muted); font-size: 0.82rem; }
details.group .table-wrap { padding: 0 1rem; }
details.group table.data-table { border: none; margin: 0.75rem 0; }

/* Test rows */
.test-title { font-weight: 700; }
.test-id { display: block; margin-top: 0.15rem; color: var(--muted); font-size: 0.75rem; }
.test-desc { margin: 0.4rem 0; color: var(--quiet-text); font-size: 0.85rem; max-width: 46rem; }
.test-iri { font-family: var(--font-mono); font-size: 0.78rem; }
.outcome {
  display: inline-block;
  min-width: 6rem;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  color: white;
  text-align: center;
  font-size: 0.72rem;
  font-weight: 700;
  background: var(--neutral);
}
.outcome--passed { background: var(--pass); }
.outcome--failed { background: var(--fail); }
.outcome--advisory { background: var(--primary-light); }
.outcome--cantTell { background: var(--warn); }
.level {
  display: inline-block;
  margin-left: 0.35rem;
  padding: 0.05rem 0.35rem;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--primary-dark);
  white-space: nowrap;
}
.diagnostics summary { cursor: pointer; color: var(--primary); font-weight: 700; font-size: 0.82rem; }
pre {
  max-width: 34rem;
  max-height: 14rem;
  overflow: auto;
  margin: 0.5rem 0 0;
  padding: 0.6rem;
  white-space: pre-wrap;
  background: rgba(var(--primary-rgb), 0.06);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

/* Dereferenced test target */
.is-target { background: #f0fbf8; }
.is-target > td:first-child { box-shadow: inset 0.2rem 0 0 var(--accent); }
.client.is-target { box-shadow: inset 0.25rem 0 0 var(--accent); }

/* Method note */
.method {
  border: 1px solid var(--line);
  border-left: 4px solid var(--primary-light);
  border-radius: 4px;
  padding: 1.25rem 1.4rem;
  background: var(--wash);
}
.method h2 { font-size: 1.2rem; margin-bottom: 0.5rem; }
.method p { margin: 0; color: var(--quiet-text); }

.empty { padding: 1.25rem; border: 1px dashed var(--line); border-radius: 4px; color: var(--muted); }

footer {
  font-size: 0.85rem;
  color: var(--muted);
  padding: 2rem 1rem;
  text-align: center;
  background: white;
  border-top: 1px solid var(--line);
  margin-top: 3rem;
}
footer p { margin: 0; }
footer a { color: var(--primary); }

@media (max-width: 640px) {
  header.site-header { padding: 2.5rem 1rem; }
  header.site-header h1 { font-size: 1.7rem; }
  header.site-header p.tagline { font-size: 1.05rem; }
  .client__heading { flex-direction: column; }
  .score { text-align: left; }
  table.data-table th, table.data-table td { padding: 0.6rem 0.7rem; }
}
`;
