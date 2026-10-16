import { spawn } from "node:child_process";
import path from "node:path";
import {
  exists,
  gitRevision,
  readInput,
  resetState,
  writeDocument,
} from "../common.mjs";

const operation = process.argv[2];
const clientRoot = path.resolve(
  process.env.LDES_CT_EUROPEANA_ROOT ?? ".clients/europeana",
);
const jar = path.resolve(
  process.env.LDES_CT_EUROPEANA_ADAPTER_JAR ??
    "adapters/europeana/target/europeana-adapter.jar",
);

if (operation === "probe") {
  const available = await exists(jar);
  await writeDocument({
      protocolVersion: 0,
      available,
      adapterId: "europeana",
      clientVersion: "0.1-SNAPSHOT",
      clientRevision: gitRevision(clientRoot),
      capabilities: {
        modes: ["ordered", "unordered"],
        memberExtraction: true,
        context: true,
        persistentState: true,
      },
      reason: available
        ? undefined
        : `adapter host JAR not found (expected ${path.relative(process.cwd(), jar)}); run adapters/europeana/build.sh`,
    });
} else if (operation === "reset") {
  await resetState(await readInput());
} else if (operation === "run") {
  const input = await readInput();
  await forwardJava(jar, input);
} else {
  throw new Error(`unknown operation: ${operation}`);
}

async function forwardJava(jarPath, input) {
  await new Promise((resolve, reject) => {
    const child = spawn("java", ["-jar", jarPath], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Java host exited with ${code}`)),
    );
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}
