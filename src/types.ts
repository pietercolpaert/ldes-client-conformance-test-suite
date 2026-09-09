import type { Quad } from "@rdfjs/types";

export interface ScenarioResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  delayMs?: number;
  chunks?: Array<{ body: string; delayMs?: number }>;
}

export interface ScenarioRequest {
  whenHeaders?: Record<string, string>;
  response: ScenarioResponse;
}

export interface ScenarioRoute {
  path: string;
  requests: ScenarioRequest[];
}

export interface ScenarioPhase {
  id: string;
  routes: ScenarioRoute[];
}

export interface ScenarioRun {
  id: string;
  phase: string;
  mode?: "unordered" | "ordered";
  concurrency?: number;
  followForMs?: number;
}

export interface Scenario {
  version: 0;
  name?: string;
  entrypoint: string;
  requestBudget?: number;
  routes?: ScenarioRoute[];
  phases?: ScenarioPhase[];
  runs?: ScenarioRun[];
}

export interface RequestLogEntry {
  sequence: number;
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  phase: string;
  status: number;
  timestamp: string;
  completedAt?: string;
}

export interface AdapterInput {
  protocolVersion: 0;
  runId: string;
  entrypoint: string;
  mode: "unordered" | "ordered";
  stateDirectory: string;
  phase: string;
  deadline?: string;
  concurrency?: number;
  followForMs?: number;
}

export interface AdapterEvent {
  protocolVersion: 0;
  type: "member" | "context" | "statistics" | "run-end" | "error";
  runId: string;
  id?: string;
  dataset?: string;
  mediaType?: string;
  status?: string;
  kind?: string;
  message?: string;
  [key: string]: unknown;
}

export interface ParsedPage {
  url: string;
  quads: Quad[];
  status: number;
  headers: Headers;
}

export interface ExpectedEvent {
  type?: "member" | "run-end" | "error" | "context" | "statistics";
  id?: string;
  runId?: string;
  status?: string;
  kind?: string;
  datasetFile?: string;
  oneOf?: ExpectedEvent[];
  tieGroup?: string;
  dateTime?: string[];
  [key: string]: unknown;
}

export interface ExpectedRequest {
  phase?: string;
  path: string;
  status?: number;
  count?: number;
  minCount?: number;
  maxCount?: number;
  headers?: Record<string, string>;
  headerIncludes?: Record<string, string>;
  absentHeaders?: string[];
  presentHeaders?: string[];
}

export interface ExpectedTiming {
  phase?: string;
  path: string;
  minSpanMs?: number;
  /**
   * Minimum delay between each consecutive pair of requests to the path. This
   * observes that retries are spaced rather than issued in a tight loop. It
   * deliberately does not prescribe a retry count, a back-off curve, or the
   * suite's own millisecond values: any strategy, including jitter, satisfies
   * it as long as every interval clears the floor.
   */
  minGapMs?: number;
}

export interface TestCase {
  id: string;
  iri: string;
  directory: string;
  manifestPath: string;
  scenarioPath: string;
  expectedPath: string;
  title: string;
  description?: string;
  requirement?: string;
  requirements: string[];
  requirementLevel?: "Must" | "Should" | "May";
  group?: string;
  requiredCapabilities: string[];
}

export interface TestResult {
  test: TestCase;
  outcome: EarlOutcome;
  events: AdapterEvent[];
  requests: RequestLogEntry[];
  diagnostics: string[];
}

export type EarlOutcome =
  | "passed"
  | "failed"
  | "cantTell"
  | "inapplicable"
  | "untested";

export interface ClientIdentity {
  id: string;
  name: string;
  homepage: string;
  version?: string;
  revision: string;
}

export interface AdapterDeclaration {
  protocolVersion: 0;
  id: string;
  name: string;
  revision: string;
  client: ClientIdentity;
  command: string[];
  timeoutMs?: number;
  capabilities: {
    modes: Array<"unordered" | "ordered">;
    memberExtraction: boolean;
    context: boolean;
    persistentState: boolean;
    serviceRuntime?: boolean;
    treeProfileExtraction?: boolean;
    polling?: boolean;
  };
  environment?: Record<string, string>;
}

export interface AdapterProbe {
  protocolVersion: 0;
  available: boolean;
  adapterId: string;
  clientVersion?: string;
  clientRevision?: string;
  capabilities?: AdapterDeclaration["capabilities"];
  reason?: string;
}

export interface ReportMetadata {
  generatedAt: string;
  suiteVersion: string;
  adapter: AdapterDeclaration;
  probe: AdapterProbe;
}

export interface SuiteSummary {
  metadata: ReportMetadata;
  total: number;
  counts: Record<string, number>;
  groupClaims: Array<{
    group: string;
    outcome: EarlOutcome;
    mandatoryTests: number;
    applicableMandatoryTests: number;
    passedMandatoryTests: number;
    dependsOn?: string;
    diagnostics: string[];
  }>;
  coverage: {
    totalRequirements: number;
    requirementsVerified: number;
    requirementsWithTests: number;
    requirementsAdvisoryEvidenceOnly: number;
    requirementsWithRationales: number;
    blockingGaps: number;
    artifact: string;
  };
  tests: Array<{
    id: string;
    iri: string;
    title: string;
    description?: string;
    group?: string;
    requirement?: string;
    requirements: string[];
    requiredCapabilities: string[];
    requirementLevel?: string;
    outcome: EarlOutcome;
    diagnostics: string[];
    evidence: string;
  }>;
}
