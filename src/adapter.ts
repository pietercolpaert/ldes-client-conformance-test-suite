import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AdapterDeclaration,
  AdapterEvent,
  AdapterInput,
  AdapterProbe,
} from "./types.js";

export interface Adapter {
  declaration: AdapterDeclaration;
  probe(): Promise<AdapterProbe>;
  reset(stateDirectory: string): Promise<void>;
  run(input: AdapterInput): Promise<AdapterEvent[]>;
}

export async function loadProcessAdapter(
  adapterId: string,
  adaptersRoot = "adapters",
): Promise<Adapter> {
  const declarationPath = path.resolve(adaptersRoot, adapterId, "adapter.json");
  const declaration = JSON.parse(
    await readFile(declarationPath, "utf8"),
  ) as AdapterDeclaration;
  validateDeclaration(declaration, adapterId);
  return new ProcessAdapter(declaration);
}

export function referenceAdapter(
  runReference: (input: AdapterInput) => Promise<AdapterEvent[]>,
): Adapter {
  const declaration: AdapterDeclaration = {
    protocolVersion: 0,
    id: "reference",
    name: "LDES conformance reference adapter",
    revision: "workspace",
    client: {
      id: "reference-client",
      name: "Reference LDES test client",
      homepage: "https://w3id.org/ldes/conformance/",
      version: "0.1.0",
      revision: "workspace",
    },
    command: [],
    capabilities: {
      modes: ["unordered", "ordered"],
      memberExtraction: true,
      context: true,
      persistentState: true,
      treeProfileExtraction: true,
    },
  };
  return {
    declaration,
    async probe() {
      return {
        protocolVersion: 0,
        available: true,
        adapterId: declaration.id,
        clientVersion: declaration.client.version,
        clientRevision: declaration.client.revision,
        capabilities: declaration.capabilities,
      };
    },
    async reset() {},
    run: runReference,
  };
}

class ProcessAdapter implements Adapter {
  constructor(readonly declaration: AdapterDeclaration) {}

  async probe(): Promise<AdapterProbe> {
    const result = await this.invoke("probe");
    const probe = JSON.parse(result.stdout.trim()) as AdapterProbe;
    if (
      probe.protocolVersion !== 0 ||
      typeof probe.available !== "boolean" ||
      probe.adapterId !== this.declaration.id
    ) {
      throw new Error(`adapter ${this.declaration.id} returned an invalid probe document`);
    }
    return probe;
  }

  async reset(stateDirectory: string): Promise<void> {
    await this.invoke("reset", {
      protocolVersion: 0,
      stateDirectory,
    });
  }

  async run(input: AdapterInput): Promise<AdapterEvent[]> {
    const result = await this.invoke("run", input);
    const events: AdapterEvent[] = [];
    for (const [index, line] of result.stdout.split(/\r?\n/u).entries()) {
      if (!line.trim()) continue;
      let event: AdapterEvent;
      try {
        event = JSON.parse(line) as AdapterEvent;
      } catch {
        throw new Error(
          `adapter ${this.declaration.id} emitted invalid JSON on stdout line ${index + 1}: ${line}`,
        );
      }
      validateEvent(event, input, index + 1);
      events.push(event);
    }
    const terminals = events.filter(
      (event) => event.type === "run-end" || event.type === "error",
    );
    if (terminals.length !== 1) {
      throw new Error(
        `adapter ${this.declaration.id} emitted ${terminals.length} terminal events; expected exactly one`,
      );
    }
    if (result.stderr.trim()) {
      terminals[0].adapterStderr = result.stderr.slice(-16_000);
    }
    return events;
  }

  private async invoke(
    operation: "probe" | "run" | "reset",
    input?: unknown,
  ): Promise<{ stdout: string; stderr: string }> {
    const [executable, ...configuredArguments] = this.declaration.command;
    if (!executable) {
      throw new Error(`adapter ${this.declaration.id} has no command`);
    }
    const timeoutMs = this.declaration.timeoutMs ?? 30_000;
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, [...configuredArguments, operation], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...this.declaration.environment,
        },
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        rejectOnce(
          new Error(
            `adapter ${this.declaration.id} ${operation} timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      child.stdout!.setEncoding("utf8");
      child.stderr!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr!.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", rejectOnce);
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code !== 0) {
          reject(
            new Error(
              `adapter ${this.declaration.id} ${operation} exited with ${code ?? signal}: ${stderr.trim()}`,
            ),
          );
          return;
        }
        resolve({ stdout, stderr });
      });
      if (input !== undefined) {
        child.stdin!.end(`${JSON.stringify(input)}\n`);
      }

      function rejectOnce(error: Error): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  }
}

function validateDeclaration(
  declaration: AdapterDeclaration,
  requestedId: string,
): void {
  if (
    declaration.protocolVersion !== 0 ||
    declaration.id !== requestedId ||
    !Array.isArray(declaration.command) ||
    declaration.command.length === 0
  ) {
    throw new Error(`invalid adapter declaration for ${requestedId}`);
  }
}

function validateEvent(
  event: AdapterEvent,
  input: AdapterInput,
  line: number,
): void {
  const supported = new Set([
    "member",
    "context",
    "statistics",
    "run-end",
    "error",
  ]);
  if (
    event.protocolVersion !== 0 ||
    event.runId !== input.runId ||
    !supported.has(event.type)
  ) {
    throw new Error(`invalid adapter event on stdout line ${line}`);
  }
  if (event.type === "member" && (!event.id || !event.dataset)) {
    throw new Error(`member event on stdout line ${line} lacks id or dataset`);
  }
}
