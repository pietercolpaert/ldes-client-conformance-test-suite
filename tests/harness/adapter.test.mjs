import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
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
