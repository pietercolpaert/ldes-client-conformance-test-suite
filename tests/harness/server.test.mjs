import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FixtureServer } from '../../dist/server.js';
import { parseRdf, resetContextCache } from '../../dist/rdf.js';

async function serve(routes) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ldes-server-'));
  const scenarioPath = path.join(directory, 'scenario.yaml');
  await writeFile(scenarioPath, 'version: 0');
  await writeFile(path.join(directory, 'slow.txt'), 'slow-tail');
  await writeFile(path.join(directory, 'body.txt'), 'body');
  const server = new FixtureServer({ version: 0, entrypoint: '/fast', routes }, scenarioPath);
  await server.start();
  return server;
}

test('a delayed chunked response does not stamp another request completion', async () => {
  const server = await serve([
    {
      path: '/slow',
      requests: [{
        response: {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          body: 'body.txt',
          chunks: [{ body: 'slow.txt', delayMs: 150 }],
        },
      }],
    },
    { path: '/fast', requests: [{ response: { status: 200, headers: { 'content-type': 'text/plain' }, body: 'body.txt' } }] },
  ]);
  try {
    // /slow is still writing its tail when /fast is logged and completed.
    const slow = fetch(`${server.origin}/slow`).then((response) => response.text());
    await new Promise((resolve) => setTimeout(resolve, 30));
    await fetch(`${server.origin}/fast`).then((response) => response.text());
    assert.equal(await slow, 'bodyslow-tail');

    const bySlot = Object.fromEntries(server.requests.map((entry) => [entry.path, entry]));
    assert.equal(server.requests.length, 2);
    for (const entry of server.requests) {
      assert.ok(entry.completedAt, `${entry.path} has no completedAt`);
      assert.ok(
        Date.parse(entry.completedAt) >= Date.parse(entry.timestamp),
        `${entry.path} completed before it started`,
      );
    }
    // The chunked route must be the one that finished last.
    assert.ok(
      Date.parse(bySlot['/slow'].completedAt) > Date.parse(bySlot['/fast'].completedAt),
      'the delayed chunked response was credited with the wrong completion time',
    );
  } finally {
    await server.stop();
  }
});

test('query strings select distinct routes', async () => {
  const server = await serve([
    { path: '/page?cursor=1', requests: [{ response: { status: 200, headers: { 'content-type': 'text/plain' }, body: 'body.txt' } }] },
    { path: '/page?cursor=2', requests: [{ response: { status: 404 } }] },
  ]);
  try {
    assert.equal((await fetch(`${server.origin}/page?cursor=1`)).status, 200);
    assert.equal((await fetch(`${server.origin}/page?cursor=2`)).status, 404);
    assert.deepEqual(server.requests.map((entry) => entry.path), ['/page?cursor=1', '/page?cursor=2']);
  } finally {
    await server.stop();
  }
});

test('the JSON-LD context loader refuses non-loopback documents', async () => {
  resetContextCache();
  const document = JSON.stringify({
    '@context': 'https://example.invalid/context.jsonld',
    '@id': 'https://example.test/a',
  });
  await assert.rejects(
    parseRdf(document, 'application/ld+json', 'https://example.test/'),
    /non-loopback JSON-LD context/u,
    'the suite must never reach the public network while parsing a fixture',
  );
});
