import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DataFactory } from "rdf-parser-ts";
import type { Quad, Term } from "@rdfjs/types";
import type { AdapterEvent, AdapterInput, ParsedPage } from "./types.js";
import {
  extractMemberDataset,
  objects,
  parseNQuads,
  parseRdf,
  RDF,
  serializeNQuads,
  subjects,
  TREE,
} from "./rdf.js";

const { namedNode } = DataFactory;
const LDES = "https://w3id.org/ldes#";
const SH = "http://www.w3.org/ns/shacl#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const XSD_BOOLEAN = "http://www.w3.org/2001/XMLSchema#boolean";
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const NUMERIC_DATATYPES = new Set([
  `${XSD}decimal`,
  `${XSD}double`,
  `${XSD}float`,
  `${XSD}integer`,
  `${XSD}long`,
  `${XSD}int`,
  `${XSD}short`,
  `${XSD}byte`,
  `${XSD}nonNegativeInteger`,
  `${XSD}positiveInteger`,
  `${XSD}unsignedLong`,
  `${XSD}unsignedInt`,
  `${XSD}unsignedShort`,
  `${XSD}unsignedByte`,
  `${XSD}nonPositiveInteger`,
  `${XSD}negativeInteger`,
]);

interface NodeState {
  etag?: string;
  immutable?: boolean;
  frontier?: string[];
}

interface ReferenceState {
  emitted: string[];
  nodes: Record<string, NodeState>;
  root?: {
    entrypoint: string;
    eventStream: string;
    rootNode: string;
    dataset: string;
  };
}

interface PendingMember {
  id: string;
  dataset: string;
  quads: Quad[];
  order: Array<string | number | { coefficient: bigint; scale: number }>;
  finalizesTransaction: boolean;
}

export async function runReferenceClient(input: AdapterInput): Promise<AdapterEvent[]> {
  if (input.followForMs) {
    return runReferencePolling(input);
  }
  return runReferenceOnce(input);
}

async function runReferencePolling(input: AdapterInput): Promise<AdapterEvent[]> {
  const output: AdapterEvent[] = [];
  const started = Date.now();
  const followForMs = input.followForMs!;
  let pollingIntervalMs: number | undefined;
  let first = true;
  do {
    const round = await runReferenceOnce({ ...input, followForMs: undefined });
    const context = round.find((event) => event.type === "context");
    if (typeof context?.pollingInterval === "number") {
      pollingIntervalMs = context.pollingInterval * 1000;
    }
    output.push(...round.filter((event) =>
      event.type !== "run-end" &&
      event.type !== "statistics" &&
      (first || event.type !== "context")
    ));
    first = false;
    if (
      pollingIntervalMs === undefined ||
      Date.now() + pollingIntervalMs > started + followForMs
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs));
  } while (true);

  output.push({
    protocolVersion: 0,
    type: "statistics",
    runId: input.runId,
    membersEmitted: output.filter((event) => event.type === "member").length,
  });
  output.push({
    protocolVersion: 0,
    type: "run-end",
    runId: input.runId,
    status: "completed",
  });
  return output;
}

async function runReferenceOnce(input: AdapterInput): Promise<AdapterEvent[]> {
  const state = await loadState(input.stateDirectory);
  const emitted = new Set(state.emitted);
  const events: AdapterEvent[] = [];
  const visitedThisRun = new Set<string>();
  const pending: PendingMember[] = [];

  try {
    let initial: ParsedPage;
    let discovery: { eventStream: string; rootNode: string };
    let rootPage: ParsedPage;
    const savedRoot = state.root;
    const canReuseRoot = savedRoot?.entrypoint === input.entrypoint &&
      state.nodes[savedRoot.rootNode]?.immutable === true;
    if (savedRoot && canReuseRoot) {
      rootPage = {
        url: savedRoot.rootNode,
        quads: parseNQuads(savedRoot.dataset),
        status: 200,
        headers: new Headers(),
      };
      initial = rootPage;
      discovery = {
        eventStream: savedRoot.eventStream,
        rootNode: savedRoot.rootNode,
      };
    } else {
      initial = await fetchPage(input.entrypoint, state.nodes[input.entrypoint]?.etag);
      if (initial.status === 304) {
        if (!savedRoot) throw new Error("304 without saved root context");
        initial = { ...initial, quads: parseNQuads(savedRoot.dataset), url: savedRoot.rootNode };
      }
      discovery = discoverRoot(initial, input.entrypoint);
      rootPage =
        discovery.rootNode === initial.url
          ? initial
          : await fetchPage(discovery.rootNode, state.nodes[discovery.rootNode]?.etag);
      if (rootPage.status === 304) {
        if (!savedRoot || savedRoot.rootNode !== discovery.rootNode) throw new Error("304 without saved root context");
        rootPage = { ...rootPage, quads: parseNQuads(savedRoot.dataset) };
      }
    }
    const context = extractContext(rootPage.quads, discovery.eventStream, discovery.rootNode);
    const contextDataset = await serializeNQuads(rootPage.quads);
    state.root = {
      entrypoint: input.entrypoint,
      eventStream: discovery.eventStream,
      rootNode: discovery.rootNode,
      dataset: contextDataset,
    };
    events.push({
      protocolVersion: 0,
      type: "context",
      runId: input.runId,
      eventStream: discovery.eventStream,
      rootNode: discovery.rootNode,
      dataset: contextDataset,
      mediaType: "application/n-quads",
      phase: input.phase,
      ...context,
    });

    const timestampPath = firstObject(
      rootPage.quads,
      discovery.eventStream,
      `${LDES}timestampPath`,
    );
    const sequencePath = firstObject(
      rootPage.quads,
      discovery.eventStream,
      `${LDES}sequencePath`,
    );
    if (input.mode === "ordered" && !timestampPath && !sequencePath) {
      throw new Error("Ordered traversal requires ldes:timestampPath or ldes:sequencePath");
    }
    const transactionFinalizedPath = firstObject(
      rootPage.quads,
      discovery.eventStream,
      `${LDES}transactionFinalizedPath`,
    );
    const transactionFinalizedObject =
      firstObject(rootPage.quads, discovery.eventStream, `${LDES}transactionFinalizedObject`) ??
      DataFactory.literal("true", namedNode(XSD_BOOLEAN));

    const queue: string[] = [discovery.rootNode];
    const cached = new Map<string, ParsedPage>([
      [initial.url, initial],
      [discovery.rootNode, rootPage],
    ]);

    while (queue.length) {
      const node = queue.shift()!;
      if (visitedThisRun.has(node)) continue;
      visitedThisRun.add(node);

      const saved = state.nodes[node] ?? {};
      if (saved.immutable && !cached.has(node)) {
        queue.push(...(saved.frontier ?? []));
        continue;
      }

      const page = cached.get(node) ?? await fetchPage(node, saved.etag);
      if (page.status === 304) {
        queue.push(...(saved.frontier ?? []));
        continue;
      }
      if (page.status === 410) continue;
      if (page.status >= 400) {
        throw new Error(`HTTP ${page.status} while fetching ${node}`);
      }

      const memberTerms = uniqueTerms(
        objects(page.quads, namedNode(discovery.eventStream), `${TREE}member`),
      );
      for (const member of memberTerms) {
        if (member.termType !== "NamedNode" || emitted.has(member.value)) continue;
        const memberQuads = extractMemberDataset(page.quads, member);
        const dataset = await serializeNQuads(memberQuads);
        const candidate: PendingMember = {
          id: member.value,
          dataset,
          quads: page.quads,
          order: input.mode === "ordered"
            ? [
                ...evaluatePath(page.quads, member, timestampPath),
                ...evaluatePath(page.quads, member, sequencePath),
              ].map(comparable)
            : [],
          finalizesTransaction: Boolean(
            transactionFinalizedPath &&
            evaluatePath(page.quads, member, transactionFinalizedPath)
              .some((term) => term.equals(transactionFinalizedObject)),
          ),
        };
        if (input.mode === "ordered") {
          pending.push(candidate);
        } else {
          events.push(memberEvent(input.runId, candidate));
        }
        emitted.add(member.value);
      }

      const frontier: string[] = [];
      for (const relation of objects(page.quads, namedNode(page.url), `${TREE}relation`)) {
        for (const target of objects(page.quads, relation, `${TREE}node`)) {
          if (target.termType === "NamedNode" && !frontier.includes(target.value)) {
            frontier.push(target.value);
            queue.push(target.value);
          }
        }
      }
      const rdfImmutable = objects(page.quads, namedNode(page.url), `${LDES}immutable`)
        .some(isTrue);
      const cacheImmutable = !rdfImmutable &&
        (page.headers.get("cache-control") ?? "").toLowerCase().includes("immutable");
      state.nodes[node] = {
        ...(page.headers.get("etag") ? { etag: page.headers.get("etag")! } : {}),
        immutable: rdfImmutable || cacheImmutable,
        frontier,
      };
    }

    if (input.mode === "ordered") {
      pending.sort(compareMembers);
      events.push(...pending.map((member) => memberEvent(input.runId, member)));
    }
    await saveState(input.stateDirectory, {
      emitted: [...emitted].sort(),
      nodes: state.nodes,
      root: state.root,
    });
    events.push({
      protocolVersion: 0,
      type: "statistics",
      runId: input.runId,
      lastRun: new Date().toISOString(),
      membersEmitted: events.filter(
        (event) => event.type === "member" && event.runId === input.runId,
      ).length,
    });
    events.push({ protocolVersion: 0, type: "run-end", runId: input.runId, status: "completed" });
  } catch (error) {
    events.push({
      protocolVersion: 0,
      type: "error",
      runId: input.runId,
      kind: "client",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return events;
}

async function fetchPage(url: string, etag?: string): Promise<ParsedPage> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        accept: [
          "application/n-quads",
          "application/n-triples",
          "application/trig",
          "text/turtle",
          "application/ld+json",
        ].join(", "),
        ...(etag ? { "if-none-match": etag } : {}),
      },
      redirect: "follow",
    });
    if (RETRYABLE.has(response.status) && attempt < 7) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, Math.min(25 * 2 ** attempt, 200)));
      continue;
    }
    if (response.status === 304 || response.status === 410) {
      return { url: response.url || url, quads: [], status: response.status, headers: response.headers };
    }
    const body = await response.text();
    if (!response.ok) {
      return { url: response.url || url, quads: [], status: response.status, headers: response.headers };
    }
    const contentType = response.headers.get("content-type") ?? "text/turtle";
    return {
      url: response.url,
      quads: await parseRdf(body, contentType, response.url),
      status: response.status,
      headers: response.headers,
    };
  }
}

function discoverRoot(page: ParsedPage, entrypoint: string): { eventStream: string; rootNode: string } {
  const root = namedNode(page.url);
  const currentPageMatches = uniqueTerms(subjects(page.quads, `${TREE}view`, root));
  if (currentPageMatches.length === 1 && currentPageMatches[0].termType === "NamedNode") {
    return { eventStream: currentPageMatches[0].value, rootNode: page.url };
  }
  if (currentPageMatches.length > 1) {
    throw new Error("Multiple current-page tree:view matches");
  }

  const fallbackMatches = uniqueTerms(objects(page.quads, namedNode(entrypoint), `${TREE}view`));
  if (fallbackMatches.length === 1 && fallbackMatches[0].termType === "NamedNode") {
    return { eventStream: entrypoint, rootNode: fallbackMatches[0].value };
  }
  throw new Error("Could not discover exactly one LDES root node");
}

function extractContext(
  quads: Quad[],
  eventStream: string,
  rootNode: string,
): Record<string, unknown> {
  // Metadata nodes may be blank nodes, so keep RDF terms while walking and only
  // project to strings at the end. Rebuilding a subject as namedNode(term.value)
  // silently loses every blank-node-described shape, view or policy.
  const terms = (subject: Term, predicate: string): Term[] =>
    uniqueTerms(objects(quads, subject, predicate));
  const streamTerm = namedNode(eventStream);
  const rootTerm = namedNode(rootNode);
  const project = (list: Term[]): string[] => list.map((term) => term.value).sort();
  const scalar = (predicate: string): string | undefined => project(terms(streamTerm, predicate))[0];
  const polling = scalar(`${LDES}pollingInterval`);
  const viewDescriptionTerms = terms(rootTerm, `${TREE}viewDescription`);
  const retentionTerms = uniqueTerms([
    ...terms(rootTerm, `${LDES}retentionPolicy`),
    ...viewDescriptionTerms.flatMap((view) => terms(view, `${LDES}retentionPolicy`)),
  ]);
  return {
    shapes: project(terms(streamTerm, `${TREE}shape`)),
    viewDescriptions: project(viewDescriptionTerms),
    emptyRetentionPolicies: project(
      retentionTerms.filter((term) => !quads.some((quad) => quad.subject.equals(term))),
    ),
    retentionPolicies: project(retentionTerms),
    ...(scalar(`${LDES}timestampPath`) ? { timestampPath: scalar(`${LDES}timestampPath`) } : {}),
    ...(scalar(`${LDES}sequencePath`) ? { sequencePath: scalar(`${LDES}sequencePath`) } : {}),
    ...(scalar(`${LDES}versionTimestampPath`)
      ? { versionTimestampPath: scalar(`${LDES}versionTimestampPath`) }
      : {}),
    ...(scalar(`${LDES}versionSequencePath`)
      ? { versionSequencePath: scalar(`${LDES}versionSequencePath`) }
      : {}),
    ...(polling ? { pollingInterval: Number(polling) } : {}),
  };
}

function firstObject(quads: Quad[], subject: string, predicate: string): Term | undefined {
  return objects(quads, namedNode(subject), predicate)[0];
}

function evaluatePath(quads: Quad[], focus: Term, pathTerm?: Term): Term[] {
  if (!pathTerm) return [];
  if (pathTerm.termType === "NamedNode") {
    return objects(quads, focus, pathTerm.value);
  }
  if (pathTerm.termType !== "BlankNode") return [];

  const alternative = objects(quads, pathTerm, `${SH}alternativePath`)[0];
  if (alternative) {
    return rdfList(quads, alternative)
      .flatMap((candidate) => evaluatePath(quads, focus, candidate));
  }

  const inverse = objects(quads, pathTerm, `${SH}inversePath`)[0];
  if (inverse) {
    const candidates = uniqueTerms(quads.flatMap((quad) => [quad.subject, quad.object]));
    return candidates.filter((candidate) =>
      evaluatePath(quads, candidate, inverse).some((value) => value.equals(focus))
    );
  }

  const zeroOrMore = objects(quads, pathTerm, `${SH}zeroOrMorePath`)[0];
  if (zeroOrMore) {
    return transitivePath(quads, focus, zeroOrMore, true);
  }

  const oneOrMore = objects(quads, pathTerm, `${SH}oneOrMorePath`)[0];
  if (oneOrMore) {
    return transitivePath(quads, focus, oneOrMore, false);
  }

  const zeroOrOne = objects(quads, pathTerm, `${SH}zeroOrOnePath`)[0];
  if (zeroOrOne) {
    return uniqueTerms([focus, ...evaluatePath(quads, focus, zeroOrOne)]);
  }

  const sequence = rdfList(quads, pathTerm);
  if (!sequence.length) return [];
  let current: Term[] = [focus];
  for (const step of sequence) {
    current = current.flatMap((term) => evaluatePath(quads, term, step));
  }
  return current;
}

function transitivePath(
  quads: Quad[],
  focus: Term,
  pathTerm: Term,
  includeFocus: boolean,
): Term[] {
  const result: Term[] = includeFocus ? [focus] : [];
  const visited = new Set<string>(includeFocus ? [`${focus.termType}:${focus.value}`] : []);
  const queue = [...evaluatePath(quads, focus, pathTerm)];
  while (queue.length) {
    const current = queue.shift()!;
    const key = `${current.termType}:${current.value}`;
    if (visited.has(key)) continue;
    visited.add(key);
    result.push(current);
    queue.push(...evaluatePath(quads, current, pathTerm));
  }
  return result;
}

function rdfList(quads: Quad[], head: Term): Term[] {
  const result: Term[] = [];
  const seen = new Set<string>();
  let current: Term | undefined = head;
  while (current && current.value !== `${RDF}nil` && !seen.has(`${current.termType}:${current.value}`)) {
    seen.add(`${current.termType}:${current.value}`);
    const first = objects(quads, current, `${RDF}first`)[0];
    if (!first) return [];
    result.push(first);
    current = objects(quads, current, `${RDF}rest`)[0];
  }
  return result;
}

function memberEvent(runId: string, member: PendingMember): AdapterEvent {
  return {
    protocolVersion: 0,
    type: "member",
    receivedAt: new Date().toISOString(),
    runId,
    id: member.id,
    dataset: member.dataset,
    mediaType: "application/n-quads",
  };
}

function compareMembers(left: PendingMember, right: PendingMember): number {
  const length = Math.max(left.order.length, right.order.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = compareOrderValues(left.order[index] ?? "", right.order[index] ?? "");
    if (comparison) return comparison;
  }
  if (left.finalizesTransaction !== right.finalizesTransaction) {
    return left.finalizesTransaction ? 1 : -1;
  }
  return left.id.localeCompare(right.id);
}

type OrderValue = PendingMember["order"][number];

// A single ordering path can mix datatypes across members. Numerics are always
// compared exactly, and values of different kinds get a stable kind order
// rather than an accidental string comparison of their representations.
function compareOrderValues(a: OrderValue, b: OrderValue): number {
  const left = typeof a === "number" ? exactNumber(a) : a;
  const right = typeof b === "number" ? exactNumber(b) : b;
  if (typeof left === "object" && typeof right === "object") {
    const scaled = left.coefficient * 10n ** BigInt(right.scale);
    const other = right.coefficient * 10n ** BigInt(left.scale);
    return scaled < other ? -1 : scaled > other ? 1 : 0;
  }
  if (typeof left === "string" && typeof right === "string") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return typeof left === "object" ? -1 : 1;
}

function exactNumber(value: number): OrderValue {
  if (!Number.isFinite(value)) return String(value);
  const [mantissa, exponent = "0"] = value.toString().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const scale = fraction.length - Number(exponent);
  return scale < 0
    ? { coefficient: BigInt(whole + fraction) * 10n ** BigInt(-scale), scale: 0 }
    : { coefficient: BigInt(whole + fraction), scale };
}

function comparable(term: Term): PendingMember["order"][number] {
  if (term.termType === "Literal") {
    if (NUMERIC_DATATYPES.has(term.datatype.value)) {
      if (![`${XSD}float`, `${XSD}double`].includes(term.datatype.value) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(term.value)) {
        const [whole, fraction = ""] = term.value.split(".");
        return { coefficient: BigInt(whole + fraction), scale: fraction.length };
      }
      const number = Number(term.value);
      if (Number.isFinite(number) && term.value.trim() !== "") return number;
    }
    if (term.datatype.value === `${XSD}dateTime`) {
      const timestamp = Date.parse(term.value);
      if (Number.isFinite(timestamp)) return timestamp;
    }
  }
  return term.value;
}

function isTrue(term: Term): boolean {
  return term.termType === "Literal" &&
    (term.value === "true" || term.value === "1");
}

function uniqueTerms(terms: Term[]): Term[] {
  return terms.filter(
    (term, index, all) =>
      all.findIndex((candidate) => candidate.termType === term.termType && candidate.value === term.value) === index,
  );
}

async function loadState(stateDirectory: string): Promise<ReferenceState> {
  try {
    const source = await readFile(path.join(stateDirectory, "reference-state.json"), "utf8");
    const parsed = JSON.parse(source) as Partial<ReferenceState>;
    return { emitted: parsed.emitted ?? [], nodes: parsed.nodes ?? {}, root: parsed.root };
  } catch {
    return { emitted: [], nodes: {} };
  }
}

async function saveState(stateDirectory: string, state: ReferenceState): Promise<void> {
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(path.join(stateDirectory, "reference-state.json"), `${JSON.stringify(state, null, 2)}\n`);
}
