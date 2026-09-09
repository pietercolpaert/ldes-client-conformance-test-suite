import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeCoverageReport } from '../../dist/coverage.js';

// LDES10-EXTRACT-004 is a client MUST; LDES10-EXTRACT-001 is a MAY.
const testCase = (id, requirements, requirementLevel) => ({
  id, iri: `https://example.test/${id}`, directory: '.', manifestPath: '.',
  scenarioPath: '.', expectedPath: '.', title: id, requirements,
  requirementLevel, requiredCapabilities: [],
});

async function report(tests, results) {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'ldes-coverage-'));
  const generated = await writeCoverageReport(tests, outDir, false, results);
  const markdown = await readFile(path.join(outDir, 'coverage.md'), 'utf8');
  const row = (id) => generated.requirements.find((entry) => entry.id === id);
  return { generated, markdown, row };
}

test('a mapping alone is not evidence: only a passing test verifies a requirement', async () => {
  const mapped = testCase('mapped-only', ['LDES10-EXTRACT-004'], 'Must');
  const { row: skipped } = await report([mapped], [
    { test: mapped, outcome: 'inapplicable', events: [], requests: [], diagnostics: [] },
  ]);
  assert.equal(skipped('LDES10-EXTRACT-004').status, 'mapped');
  assert.deepEqual(skipped('LDES10-EXTRACT-004').evidence, { inapplicable: ['mapped-only'] });

  for (const outcome of ['failed', 'cantTell']) {
    const { row } = await report([mapped], [
      { test: mapped, outcome, events: [], requests: [], diagnostics: [] },
    ]);
    assert.equal(row('LDES10-EXTRACT-004').status, 'mapped', `${outcome} must not verify`);
  }

  const { row: passing } = await report([mapped], [
    { test: mapped, outcome: 'passed', events: [], requests: [], diagnostics: [] },
  ]);
  assert.equal(passing('LDES10-EXTRACT-004').status, 'verified');
});

test('a mandatory row observed only by a weaker fixture is reported as advisory', async () => {
  const advisory = testCase('advisory', ['LDES10-EXTRACT-004'], 'May');
  const { generated, row, markdown } = await report([advisory], [
    { test: advisory, outcome: 'passed', events: [], requests: [], diagnostics: [] },
  ]);
  assert.equal(row('LDES10-EXTRACT-004').advisoryEvidenceOnly, true);
  assert.equal(generated.totals.advisoryEvidenceOnly, 1);
  assert.match(markdown, /advisory level only/u);

  const mandatory = testCase('mandatory', ['LDES10-EXTRACT-004'], 'Must');
  const { row: strong } = await report([mandatory], [
    { test: mandatory, outcome: 'passed', events: [], requests: [], diagnostics: [] },
  ]);
  assert.equal(strong('LDES10-EXTRACT-004').advisoryEvidenceOnly, undefined);

  // A MAY row observed by a MAY fixture is not advisory-only.
  const optional = testCase('optional', ['LDES10-EXTRACT-001'], 'May');
  const { row: may } = await report([optional], [
    { test: optional, outcome: 'passed', events: [], requests: [], diagnostics: [] },
  ]);
  assert.equal(may('LDES10-EXTRACT-001').advisoryEvidenceOnly, undefined);
});

test('rationales are counted per classification and never as coverage', async () => {
  const { generated, markdown } = await report([], []);
  assert.equal(generated.totals.verified, 0);
  assert.equal(generated.totals.withTests, 0);
  assert.ok(generated.totals.withRationales > 0);
  const byClass = generated.totals.rationalesByClassification;
  assert.equal(
    byClass.boundary + byClass.optional + byClass.manual + byClass.deferred,
    generated.totals.withRationales,
  );
  assert.match(markdown, /rationalized, not executed/u);
});

test('unknown requirement IDs in a manifest are rejected', async () => {
  await assert.rejects(
    report([testCase('bogus', ['LDES10-NOPE-999'], 'Must')], []),
    /unknown requirement IDs/u,
  );
});
