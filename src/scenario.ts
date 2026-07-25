import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { Scenario, ScenarioPhase, ScenarioRun } from "./types.js";

export async function loadScenario(filePath: string): Promise<Scenario> {
  const source = await readFile(filePath, "utf8");
  const parsed = YAML.parse(source) as Scenario;
  validateScenario(parsed, filePath);
  return parsed;
}

export function scenarioBaseDir(filePath: string): string {
  return path.dirname(filePath);
}

export function getScenarioPhases(scenario: Scenario): ScenarioPhase[] {
  if (scenario.phases?.length) {
    return scenario.phases;
  }
  if (!scenario.routes?.length) {
    throw new Error("scenario must define either routes or phases");
  }
  return [{ id: "default", routes: scenario.routes }];
}

export function getScenarioRuns(scenario: Scenario): ScenarioRun[] {
  if (scenario.runs?.length) {
    return scenario.runs;
  }
  const firstPhase = getScenarioPhases(scenario)[0];
  return [{ id: "run-1", phase: firstPhase.id, mode: "unordered" }];
}

export function resolveBodyPath(scenarioPath: string, bodyPath: string): string {
  return path.resolve(path.dirname(scenarioPath), bodyPath);
}

function validateScenario(scenario: Scenario, filePath: string): void {
  if (!scenario || scenario.version !== 0) {
    throw new Error(`${filePath}: scenario version must be 0`);
  }
  if (!scenario.entrypoint?.startsWith("/")) {
    throw new Error(`${filePath}: entrypoint must be an absolute path`);
  }
  if (
    scenario.requestBudget !== undefined &&
    (!Number.isInteger(scenario.requestBudget) || scenario.requestBudget < 1)
  ) {
    throw new Error(`${filePath}: requestBudget must be a positive integer`);
  }
  for (const phase of getScenarioPhases(scenario)) {
    if (!phase.id) {
      throw new Error(`${filePath}: every phase needs an id`);
    }
    for (const route of phase.routes) {
      if (!route.path.startsWith("/")) {
        throw new Error(`${filePath}: route path must be absolute: ${route.path}`);
      }
      if (!route.requests?.length) {
        throw new Error(`${filePath}: route ${route.path} needs at least one response`);
      }
      for (const request of route.requests) {
        const status = request.response?.status;
        if (!Number.isInteger(status) || status < 100 || status > 599) {
          throw new Error(`${filePath}: invalid HTTP status for ${route.path}`);
        }
      }
    }
  }
}
