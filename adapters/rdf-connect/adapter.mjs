import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  exists,
  protocolWriter,
  quadsToNQuads,
  readInput,
  resetState,
  writeDocument,
} from "../common.mjs";

const operation = process.argv[2];
const root = path.resolve(
  process.env.LDES_CT_RDF_CONNECT_ROOT ?? ".clients/rdf-connect",
);
const modulePath = path.join(root, "dist", "lib", "client.js");

if (operation === "probe") {
  const available = await exists(modulePath);
  await writeDocument({
      protocolVersion: 0,
      available,
      adapterId: "rdf-connect",
      clientVersion: "0.3.3",
      clientRevision: "00b062d3c4e4c31d99ff38ce985df44c389e2952",
      capabilities: {
        modes: ["unordered", "ordered"],
        memberExtraction: true,
        context: true,
        persistentState: true,
      },
      reason: available
        ? undefined
        : `client build not found (expected ${path.relative(process.cwd(), modulePath)}); set LDES_CT_RDF_CONNECT_ROOT`,
    });
} else if (operation === "reset") {
  await resetState(await readInput());
} else if (operation === "run") {
  const input = await readInput();
  const emit = protocolWriter();
  try {
    const { replicateLDES, intoConfig } = await import(
      pathToFileURL(modulePath).toString()
    );
    const client = replicateLDES(
      intoConfig({
        url: input.entrypoint,
        statePath: input.stateDirectory,
        noShape: true,
        onlyDefaultGraph: false,
        polling: false,
        concurrentFetches: 1,
      }),
      input.mode === "ordered" ? "ascending" : "none",
    );
    client.on("description", (description) => {
      emit({
        protocolVersion: 0,
        type: "context",
        runId: input.runId,
        eventStream: client.streamId?.value,
        timestampPath: description.timestampPath?.value,
        versionOfPath: description.versionOfPath?.value,
        dataset: quadsToNQuads(description.shapeQuads ?? []),
        mediaType: "application/n-quads",
      });
    });
    const reader = client.stream({ highWaterMark: 10 }).getReader();
    let emitted = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      emitted += 1;
      emit({
        protocolVersion: 0,
        type: "member",
        runId: input.runId,
        id: item.value.id.value,
        dataset: quadsToNQuads(item.value.quads),
        mediaType: "application/n-quads",
      });
    }
    emit({
      protocolVersion: 0,
      type: "statistics",
      runId: input.runId,
      membersEmitted: emitted,
      fragmentsFetched: client.fragmentCount,
    });
    emit({
      protocolVersion: 0,
      type: "run-end",
      runId: input.runId,
      status: "completed",
    });
  } catch (error) {
    emit({
      protocolVersion: 0,
      type: "error",
      runId: input.runId,
      kind: "client",
      message: error instanceof Error ? error.message : String(error),
    });
  }
} else {
  throw new Error(`unknown operation: ${operation}`);
}
