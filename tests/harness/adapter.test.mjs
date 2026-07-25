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
  assert.deepEqual(events, [
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
