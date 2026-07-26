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
  order: Array<string | number>;
  finalizesTransaction: boolean;
}

export async function runReferenceClient(input: AdapterInput): Promise<AdapterEvent[]> {
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
        throw new Error("The entry point returned 304 before root discovery could be refreshed");
      }
      discovery = discoverRoot(initial, input.entrypoint);
      rootPage =
        discovery.rootNode === initial.url
          ? initial
          : await fetchPage(discovery.rootNode, state.nodes[discovery.rootNode]?.etag);
      if (rootPage.status === 304) {
        throw new Error("The root node returned 304 without a reusable root context");
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
      await new Promise((resolve) => setTimeout(resolve, Math.min(5 * 2 ** attempt, 50)));
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
  const values = (predicate: string): string[] =>
    uniqueTerms(objects(quads, namedNode(eventStream), predicate)).map((term) => term.value).sort();
  const rootValues = (predicate: string): string[] =>
    uniqueTerms(objects(quads, namedNode(rootNode), predicate)).map((term) => term.value).sort();
  const scalar = (predicate: string): string | undefined => values(predicate)[0];
  const polling = scalar(`${LDES}pollingInterval`);
  return {
    shapes: values(`${TREE}shape`),
    viewDescriptions: rootValues(`${TREE}viewDescription`),
    retentionPolicies: [
      ...rootValues(`${LDES}retentionPolicy`),
      ...rootValues(`${TREE}viewDescription`).flatMap((view) =>
        objects(quads, namedNode(view), `${LDES}retentionPolicy`).map((term) => term.value)
      ),
    ].filter((value, index, all) => all.indexOf(value) === index).sort(),
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
  if (inverse?.termType === "NamedNode") {
    return subjects(quads, inverse.value, focus);
  }

  const sequence = rdfList(quads, pathTerm);
  if (!sequence.length) return [];
  let current: Term[] = [focus];
  for (const step of sequence) {
    current = current.flatMap((term) => evaluatePath(quads, term, step));
  }
  return current;
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
    runId,
    id: member.id,
    dataset: member.dataset,
    mediaType: "application/n-quads",
  };
}

function compareMembers(left: PendingMember, right: PendingMember): number {
  const length = Math.max(left.order.length, right.order.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.order[index] ?? "";
    const b = right.order[index] ?? "";
    const comparison = typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a) < String(b)
      ? -1
      : String(a) > String(b)
      ? 1
      : 0;
    if (comparison) return comparison;
  }
  if (left.finalizesTransaction !== right.finalizesTransaction) {
    return left.finalizesTransaction ? 1 : -1;
  }
  return left.id.localeCompare(right.id);
}

function comparable(term: Term): string | number {
  if (term.termType === "Literal") {
    if (NUMERIC_DATATYPES.has(term.datatype.value)) {
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
