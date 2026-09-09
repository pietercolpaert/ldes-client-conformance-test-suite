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
      treeProfileExtraction: false,
      polling: true,
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
    const events: AdapterEvent[] = [];
    let lineNumber = 0;
    let result: { stdout: string; stderr: string };
    try {
      result = await this.invoke("run", input, (line) => {
        lineNumber += 1;
        if (!line.trim()) return;
        let event: AdapterEvent;
        try { event = JSON.parse(line) as AdapterEvent; }
        catch { throw new Error(`adapter ${this.declaration.id} emitted invalid JSON on stdout line ${lineNumber}`); }
        validateEvent(event, input, lineNumber);
        events.push({ ...event, receivedAt: new Date().toISOString() });
      });
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { events });
    }
    const terminals = events.filter(
      (event) => event.type === "run-end" || event.type === "error",
    );
    if (terminals.length !== 1 || events.at(-1) !== terminals[0]) {
      throw new Error(
        `adapter ${this.declaration.id} emitted ${terminals.length} terminal events; expected exactly one terminal event, last in the trace`,
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
    onLine?: (line: string) => void,
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
      let pendingLine = "";
      let stderr = "";
      let linesSeen = 0;
      let settled = false;
      // A hung or crashing adapter is only diagnosable if its stderr and the
      // partially written stdout line survive into the failure evidence.
      const context = (): string => {
        const trailing = stderr.trim()
          ? `; stderr: ${stderr.trim().split(/\r?\n/u).slice(-20).join(" | ")}`
          : "; stderr was empty";
        const partial = pendingLine.trim()
          ? `; last partial stdout line: ${pendingLine.trim()}`
          : "";
        return `${trailing}${partial}`;
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        rejectOnce(
          new Error(
            `adapter ${this.declaration.id} ${operation} timed out after ${timeoutMs}ms` +
            ` after ${linesSeen} stdout line(s)${context()}`,
          ),
        );
      }, timeoutMs);
      child.stdout!.setEncoding("utf8");
      child.stderr!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        stdout += chunk;
        if (settled) return;
        pendingLine += chunk;
        let newline: number;
        while ((newline = pendingLine.indexOf("\n")) >= 0) {
          const line = pendingLine.slice(0, newline);
          pendingLine = pendingLine.slice(newline + 1);
          linesSeen += 1;
          try { onLine?.(line); }
          catch (error) {
            // Stop consuming after a protocol error. Continuing would parse
            // lines emitted after the failure into the evidence and run the
            // terminal-event checks over a trace we already rejected.
            child.kill("SIGTERM");
            rejectOnce(new Error(`${(error as Error).message}${context()}`));
            return;
          }
        }
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
              `adapter ${this.declaration.id} ${operation} exited with ${code ?? signal}` +
              ` after ${linesSeen} stdout line(s)${context()}`,
            ),
          );
          return;
        }
        try { if (pendingLine.trim()) onLine?.(pendingLine); }
        catch (error) { reject(new Error(`${(error as Error).message}${context()}`)); return; }
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
