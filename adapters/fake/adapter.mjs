import {
  protocolWriter,
  readInput,
  resetState,
  writeDocument,
} from "../common.mjs";

const operation = process.argv[2];

if (operation === "probe") {
  await writeDocument({
    protocolVersion: 0,
    available: true,
    adapterId: "fake",
    clientVersion: "1",
    clientRevision: "fixture",
    capabilities: {
      modes: ["unordered"],
      memberExtraction: true,
      context: false,
      persistentState: true,
    },
  });
} else if (operation === "reset") {
  await resetState(await readInput());
} else if (operation === "run") {
  const input = await readInput();
  const emit = protocolWriter();
  emit({
    protocolVersion: 0,
    type: "run-end",
    runId: input.runId,
    status: "completed",
  });
} else {
  throw new Error(`unknown operation: ${operation}`);
}
