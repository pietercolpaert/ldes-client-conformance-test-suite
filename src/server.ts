import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Scenario, RequestLogEntry, ScenarioRoute } from "./types.js";
import { getScenarioPhases, resolveBodyPath } from "./scenario.js";
import { expandFixturePlaceholders } from "./fixture-iri.js";

export class FixtureServer {
  private readonly server: Server;
  private readonly phases: Map<string, Map<string, ScenarioRoute>>;
  private readonly requestCounts = new Map<string, number>();
  private sequence = 0;
  private currentPhase: string;
  readonly requests: RequestLogEntry[] = [];
  origin = "";
  private started = false;

  constructor(
    private readonly scenario: Scenario,
    private readonly scenarioPath: string,
  ) {
    const phases = getScenarioPhases(scenario);
    this.currentPhase = phases[0].id;
    this.phases = new Map(
      phases.map((phase) => [
        phase.id,
        new Map(phase.routes.map((route) => [route.path, route])),
      ]),
    );
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(0, "127.0.0.1");
    });
    const address = this.server.address() as AddressInfo;
    this.origin = `http://127.0.0.1:${address.port}`;
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
    this.started = false;
  }

  setPhase(phase: string): void {
    if (!this.phases.has(phase)) {
      throw new Error(`unknown scenario phase: ${phase}`);
    }
    this.currentPhase = phase;
  }

  entrypointUrl(): string {
    return new URL(this.scenario.entrypoint, this.origin).toString();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.origin);
    const route = this.phases.get(this.currentPhase)?.get(url.pathname);
    if (!route) {
      this.writeLog(request, url.pathname, 404);
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("No fixture route matched\n");
      return;
    }

    const key = `${this.currentPhase}:${url.pathname}`;
    const count = this.requestCounts.get(key) ?? 0;
    this.requestCounts.set(key, count + 1);
    const selected = route.requests[Math.min(count, route.requests.length - 1)].response;
    this.writeLog(request, url.pathname, selected.status);

    const headers = { ...(selected.headers ?? {}) };
    const location = headers.location ?? headers.Location;
    if (location) {
      headers.location = new URL(location, this.origin).toString();
    }

    let body = "";
    if (selected.body) {
      body = await readFile(resolveBodyPath(this.scenarioPath, selected.body), "utf8");
      body = expandFixturePlaceholders(body, this.scenarioPath, this.origin);
    }
    if (selected.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, selected.delayMs));
    }
    response.writeHead(selected.status, headers);
    response.end(body);
  }

  private writeLog(request: IncomingMessage, path: string, status: number): void {
    this.requests.push({
      sequence: ++this.sequence,
      method: request.method ?? "GET",
      path,
      headers: request.headers,
      phase: this.currentPhase,
      status,
      timestamp: new Date().toISOString(),
    });
  }
}
