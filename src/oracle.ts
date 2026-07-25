import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AdapterEvent,
  ExpectedEvent,
  ExpectedRequest,
  TestCase,
  TestResult,
  RequestLogEntry,
} from "./types.js";
import { datasetEquals } from "./rdf.js";

export async function evaluate(
  test: TestCase,
  events: AdapterEvent[],
  requests: RequestLogEntry[],
): Promise<TestResult> {
  const expected = await loadExpectedEvents(test.expectedPath);
  const diagnostics: string[] = [];
  const expectedTypes = new Set(expected.flatMap(expectedEventTypes));
  const observedTypes = new Set([
    "member",
    "run-end",
    "error",
    ...expectedTypes,
  ]);
  const observed = events.filter((event) => observedTypes.has(event.type));

  if (observed.length !== expected.length) {
    diagnostics.push(`expected ${expected.length} observable events, got ${observed.length}`);
  }

  for (let index = 0; index < Math.min(observed.length, expected.length); index += 1) {
    const actual = observed[index];
    const wanted = expected[index];
    diagnostics.push(...await compareExpectedEvent(test, index, actual, wanted));
  }

  await evaluateRequests(test, requests, diagnostics);

  return {
    test,
    outcome: diagnostics.length ? "failed" : "passed",
    events,
    requests,
    diagnostics,
  };
}

async function compareExpectedEvent(
  test: TestCase,
  index: number,
  actual: AdapterEvent,
  wanted: ExpectedEvent,
): Promise<string[]> {
  if (wanted.oneOf?.length) {
    const attempts = await Promise.all(
      wanted.oneOf.map((candidate) => compareSingleExpectedEvent(test, index, actual, candidate)),
    );
    if (attempts.some((messages) => messages.length === 0)) return [];
    return [
      `event ${index}: matched none of ${wanted.oneOf.length} allowed alternatives: ${
        attempts.map((messages) => messages.join("; ")).join(" | ")
      }`,
    ];
  }
  return await compareSingleExpectedEvent(test, index, actual, wanted);
}

async function compareSingleExpectedEvent(
  test: TestCase,
  index: number,
  actual: AdapterEvent,
  wanted: ExpectedEvent,
): Promise<string[]> {
  const diagnostics: string[] = [];
  if (wanted.type && actual.type !== wanted.type) {
    diagnostics.push(`expected type ${wanted.type}, got ${actual.type}`);
    return diagnostics.map((message) => `event ${index}: ${message}`);
  }
  if (wanted.runId && actual.runId !== wanted.runId) {
    diagnostics.push(`expected runId ${wanted.runId}, got ${actual.runId}`);
  }
  if (wanted.id && actual.id !== wanted.id) {
    diagnostics.push(`expected member ${wanted.id}, got ${actual.id ?? "<none>"}`);
  }
  if (wanted.status && actual.status !== wanted.status) {
    diagnostics.push(`expected status ${wanted.status}, got ${actual.status ?? "<none>"}`);
  }
  if (wanted.kind && actual.kind !== wanted.kind) {
    diagnostics.push(`expected error kind ${wanted.kind}, got ${actual.kind ?? "<none>"}`);
  }
  for (const [key, value] of Object.entries(wanted)) {
    if (["type", "id", "runId", "status", "kind", "datasetFile", "oneOf"].includes(key)) {
      continue;
    }
    if (!deepEqual(actual[key], value)) {
      diagnostics.push(
        `expected ${key}=${JSON.stringify(value)}, got ${JSON.stringify(actual[key])}`,
      );
    }
  }
  if (wanted.datasetFile) {
    const expectedDataset = await readFile(path.join(path.dirname(test.expectedPath), wanted.datasetFile), "utf8");
    if (!actual.dataset) {
      diagnostics.push(`expected dataset, got none`);
    } else if (!datasetEquals(
      normalizeFixtureOrigin(actual.dataset),
      normalizeFixtureOrigin(expectedDataset),
    )) {
      diagnostics.push(`member dataset did not match ${wanted.datasetFile}`);
    }
  }
  return diagnostics.map((message) => `event ${index}: ${message}`);
}

function expectedEventTypes(event: ExpectedEvent): Array<Required<ExpectedEvent>["type"]> {
  return event.oneOf?.flatMap(expectedEventTypes) ?? (event.type ? [event.type] : []);
}

function normalizeFixtureOrigin(value: string): string {
  return value
    .replaceAll("{{origin}}", "https://fixture.test")
    .replaceAll(/http:\/\/127\.0\.0\.1:\d+/gu, "https://fixture.test");
}

async function evaluateRequests(
  test: TestCase,
  requests: RequestLogEntry[],
  diagnostics: string[],
): Promise<void> {
  const filePath = path.join(path.dirname(test.expectedPath), "requests.json");
  let expected: ExpectedRequest[];
  try {
    expected = JSON.parse(await readFile(filePath, "utf8")) as ExpectedRequest[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const wanted of expected) {
    const matching = requests.filter(
      (request) =>
        request.path === wanted.path &&
        (!wanted.phase || request.phase === wanted.phase) &&
        (wanted.status === undefined || request.status === wanted.status),
    );
    const minimum = wanted.count ?? wanted.minCount ?? 1;
    const maximum = wanted.count ?? wanted.maxCount ?? Number.POSITIVE_INFINITY;
    if (matching.length < minimum || matching.length > maximum) {
      diagnostics.push(
        `request ${wanted.phase ? `${wanted.phase}:` : ""}${wanted.path}: expected count ${range(minimum, maximum)}, got ${matching.length}`,
      );
    }
    for (const request of matching) {
      const headers = lowerCaseHeaders(request.headers);
      for (const [name, value] of Object.entries(wanted.headers ?? {})) {
        if (headers[name.toLowerCase()] !== value) {
          diagnostics.push(
            `request ${request.phase}:${request.path}: expected ${name}: ${value}, got ${headers[name.toLowerCase()] ?? "<absent>"}`,
          );
        }
      }
      for (const [name, value] of Object.entries(wanted.headerIncludes ?? {})) {
        if (!headers[name.toLowerCase()]?.includes(value)) {
          diagnostics.push(
            `request ${request.phase}:${request.path}: expected ${name} to include ${value}`,
          );
        }
      }
      for (const name of wanted.absentHeaders ?? []) {
        if (headers[name.toLowerCase()] !== undefined) {
          diagnostics.push(`request ${request.phase}:${request.path}: expected ${name} to be absent`);
        }
      }
    }
  }
}

async function loadExpectedEvents(filePath: string): Promise<ExpectedEvent[]> {
  const lines = (await readFile(filePath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => JSON.parse(line) as ExpectedEvent);
}

function lowerCaseHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? value.join(", ") : value,
    ]),
  );
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function range(minimum: number, maximum: number): string {
  if (minimum === maximum) return String(minimum);
  if (!Number.isFinite(maximum)) return `at least ${minimum}`;
  return `${minimum}..${maximum}`;
}
