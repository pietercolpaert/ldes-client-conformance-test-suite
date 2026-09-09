import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadProcessAdapter } from "../../dist/adapter.js";

test("a process adapter supports probe, reset, and one terminal event", async () => {
  const adapter = await loadProcessAdapter("fake");
  const probe = await adapter.probe();
  assert.equal(probe.available, true);
  assert.equal(probe.adapterId, "fake");

  const stateDirectory = await mkdtemp(
    path.join(os.tmpdir(), "ldes-ct-adapter-"),
  );
  await writeFile(path.join(stateDirectory, "stale"), "remove me");
  await adapter.reset(stateDirectory);

  const events = await adapter.run({
    protocolVersion: 0,
    runId: "contract-run",
    entrypoint: "http://127.0.0.1:1/not-fetched",
    mode: "unordered",
    stateDirectory,
    phase: "fixture",
  });
  assert.ok(Number.isFinite(Date.parse(events[0].receivedAt)));
  assert.deepEqual(events.map(({receivedAt, ...event}) => event), [
    {
      protocolVersion: 0,
      type: "run-end",
      runId: "contract-run",
      status: "completed",
    },
  ]);
});

test("a process adapter can be loaded from an external adapter root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ldes-ct-adapters-"));
  const adapterDirectory = path.join(root, "external");
  await mkdir(adapterDirectory, { recursive: true });
  const adapterScript = path.join(adapterDirectory, "adapter.mjs");
  await writeFile(
    adapterScript,
    `const operation = process.argv.at(-1);
if (operation === "probe") {
  console.log(JSON.stringify({
    protocolVersion: 0,
    available: true,
    adapterId: "external",
    capabilities: {
      modes: ["unordered"],
      memberExtraction: true,
      context: false,
      persistentState: false
    }
  }));
} else if (operation === "reset") {
  process.stdin.resume();
} else if (operation === "run") {
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => body += chunk);
  process.stdin.on("end", () => {
    const input = JSON.parse(body);
    console.log(JSON.stringify({
      protocolVersion: 0,
      type: "run-end",
      runId: input.runId,
      status: "completed"
    }));
  });
}
`,
  );
  await writeFile(
    path.join(adapterDirectory, "adapter.json"),
    JSON.stringify(
      {
        protocolVersion: 0,
        id: "external",
        name: "External adapter",
        revision: "test",
        client: {
          id: "external-client",
          name: "External client",
          homepage: "https://example.test/external",
          revision: "test",
        },
        command: ["node", adapterScript],
        capabilities: {
          modes: ["unordered"],
          memberExtraction: true,
          context: false,
          persistentState: false,
        },
      },
      null,
      2,
    ),
  );

  const adapter = await loadProcessAdapter("external", root);
  assert.equal((await adapter.probe()).adapterId, "external");
});

/** Build a throwaway process adapter whose `run` behaves however a test needs. */
async function fakeAdapter(runBody, { timeoutMs } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ldes-ct-neg-"));
  const directory = path.join(root, "misbehaving");
  await mkdir(directory, { recursive: true });
  const script = path.join(directory, "adapter.mjs");
  const capabilities = {
    modes: ["unordered"],
    memberExtraction: true,
    context: false,
    persistentState: false,
  };
  await writeFile(
    script,
    `const operation = process.argv.at(-1);
const capabilities = ${JSON.stringify(capabilities)};
if (operation === "probe") {
  console.log(JSON.stringify({ protocolVersion: 0, available: true, adapterId: "misbehaving", capabilities }));
} else if (operation === "reset") {
  process.stdin.resume();
} else if (operation === "run") {
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => body += chunk);
  process.stdin.on("end", () => {
    const input = JSON.parse(body);
    const emit = (event) => console.log(JSON.stringify({ protocolVersion: 0, runId: input.runId, ...event }));
    const NQ = "<https://example.test/a> <https://example.test/p> <https://example.test/o> .\\n";
    ${runBody}
  });
}
`,
  );
  await writeFile(
    path.join(directory, "adapter.json"),
    JSON.stringify({
      protocolVersion: 0,
      id: "misbehaving",
      name: "Misbehaving adapter",
      revision: "test",
      ...(timeoutMs ? { timeoutMs } : {}),
      client: {
        id: "misbehaving-client",
        name: "Misbehaving client",
        homepage: "https://example.test/misbehaving",
        revision: "test",
      },
      command: ["node", script],
      capabilities,
    }),
  );
  return await loadProcessAdapter("misbehaving", root);
}

const input = {
  protocolVersion: 0,
  runId: "neg-run",
  entrypoint: "http://127.0.0.1:1/not-fetched",
  mode: "unordered",
  stateDirectory: os.tmpdir(),
  phase: "fixture",
};

test("invalid adapter output is rejected and keeps the events parsed before it", async () => {
  const adapter = await fakeAdapter(`
    emit({ type: "member", id: "https://example.test/a", dataset: NQ, mediaType: "application/n-quads" });
    console.log("this is not JSON");
    emit({ type: "run-end", status: "completed" });
  `);
  const error = await adapter.run(input).then(() => null, (reason) => reason);
  assert.match(error.message, /invalid JSON on stdout line 2/u);
  // The member seen before the malformed line must survive into the evidence.
  assert.deepEqual(error.events.map((event) => event.id), ["https://example.test/a"]);
});

test("an unknown event type is a protocol error", async () => {
  const adapter = await fakeAdapter(`
    emit({ type: "not-a-real-event-type" });
    emit({ type: "run-end", status: "completed" });
  `);
  await assert.rejects(adapter.run(input));
});

test("more than one terminal event is rejected", async () => {
  const adapter = await fakeAdapter(`
    emit({ type: "run-end", status: "completed" });
    emit({ type: "run-end", status: "completed" });
  `);
  await assert.rejects(adapter.run(input), /2 terminal events/u);
});

test("a terminal event that is not last is rejected", async () => {
  const adapter = await fakeAdapter(`
    emit({ type: "run-end", status: "completed" });
    emit({ type: "member", id: "https://example.test/after-the-end", dataset: NQ, mediaType: "application/n-quads" });
  `);
  await assert.rejects(adapter.run(input), /last in the trace/u);
});

test("a missing terminal event is rejected", async () => {
  const adapter = await fakeAdapter(`emit({ type: "member", id: "https://example.test/a", dataset: NQ, mediaType: "application/n-quads" });`);
  await assert.rejects(adapter.run(input), /0 terminal events/u);
});

test("a nonzero exit carries stderr into the diagnostic", async () => {
  const adapter = await fakeAdapter(`
    emit({ type: "member", id: "https://example.test/a", dataset: NQ, mediaType: "application/n-quads" });
    process.stderr.write("client stack trace line\\n");
    process.exit(3);
  `);
  const error = await adapter.run(input).then(() => null, (reason) => reason);
  assert.match(error.message, /exited with 3/u);
  assert.match(error.message, /client stack trace line/u);
  assert.match(error.message, /after 1 stdout line/u);
});

test("a timeout carries stderr and the line count into the diagnostic", async () => {
  const adapter = await fakeAdapter(`
    emit({ type: "member", id: "https://example.test/a", dataset: NQ, mediaType: "application/n-quads" });
    process.stderr.write("still working\\n");
    setInterval(() => {}, 1000);
  `, { timeoutMs: 700 });
  const error = await adapter.run(input).then(() => null, (reason) => reason);
  assert.match(error.message, /timed out after 700ms/u);
  assert.match(error.message, /still working/u);
  assert.match(error.message, /after 1 stdout line/u);
  assert.deepEqual(error.events.map((event) => event.id), ["https://example.test/a"]);
});
