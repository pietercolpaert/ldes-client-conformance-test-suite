import { spawn } from "node:child_process";
import path from "node:path";
import {
  exists,
  readInput,
  resetState,
  writeDocument,
} from "../common.mjs";

const operation = process.argv[2];
const jar = path.resolve(
  process.env.LDES_CT_OPENLDES_ADAPTER_JAR ??
    "adapters/openldes-ldi/target/openldes-ldi-adapter.jar",
);

if (operation === "probe") {
  const available = await exists(jar);
  await writeDocument({
      protocolVersion: 0,
      available,
      adapterId: "openldes-ldi",
      clientVersion: "3.1.1",
      clientRevision: "52b1feb8ac8f0da77e9e353d4b1dac664857d612",
      capabilities: {
        modes: ["unordered"],
        memberExtraction: true,
        context: false,
        persistentState: true,
      },
      reason: available
        ? undefined
        : `adapter host JAR not found (expected ${path.relative(process.cwd(), jar)}); run adapters/openldes-ldi/build.sh`,
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
