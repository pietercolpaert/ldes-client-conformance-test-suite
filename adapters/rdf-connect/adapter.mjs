import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  exists,
  gitRevision,
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
      clientRevision: gitRevision(root),
      capabilities: {
        modes: ["unordered", "ordered"],
        memberExtraction: true,
        context: true,
        persistentState: true,
        polling: true,
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
        polling: Boolean(input.followForMs),
        concurrentFetches: input.concurrency ?? 1,
      }),
      input.mode === "ordered" ? "ascending" : "none",
    );
    client.on("description", (description) => {
      emit({
        protocolVersion: 0,
        type: "context",
        runId: input.runId,
        eventStream: client.streamId?.value,
        rootNode: description.rootNode?.value,
        shapes: description.shapes?.map((shape) => shape.value),
        viewDescriptions: description.viewDescriptions?.map((viewDescription) => viewDescription.value),
        retentionPolicies: description.retentionPolicies?.map((retentionPolicy) => retentionPolicy.value),
        emptyRetentionPolicies: description.emptyRetentionPolicies?.map((retentionPolicy) => retentionPolicy.value),
        timestampPath: description.timestampPath?.value,
        sequencePath: description.sequencePath?.value,
        versionOfPath: description.versionOfPath?.value,
        versionTimestampPath: description.versionTimestampPath?.value,
        versionSequencePath: description.versionSequencePath?.value,
        pollingInterval: description.pollingInterval,
        dataset: quadsToNQuads(description.contextQuads ?? description.shapeQuads ?? []),
        mediaType: "application/n-quads",
      });
    });
    const reader = client.stream({ highWaterMark: 10 }).getReader();
    let emitted = 0;
    const followDeadline = input.followForMs
      ? new Promise((resolve) => setTimeout(() => resolve("follow-deadline"), input.followForMs))
      : undefined;
    while (true) {
      const item = followDeadline
        ? await Promise.race([reader.read(), followDeadline])
        : await reader.read();
      if (item === "follow-deadline") {
        await reader.cancel();
        break;
      }
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
      lastRun: new Date().toISOString(),
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
