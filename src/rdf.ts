import { Readable } from "node:stream";
import { DataFactory, Parser, quadToString } from "rdf-parser-ts";
import { JsonLdParser } from "jsonld-streaming-parser";
import type { Quad, Term } from "@rdfjs/types";

const { namedNode, defaultGraph } = DataFactory;

export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const TREE = "https://w3id.org/tree#";

export async function parseRdf(source: string, contentType: string, baseIRI: string, documentLoader = cachedContextLoader): Promise<Quad[]> {
  const normalized = contentType.split(";")[0].trim().toLowerCase();
  if (normalized !== "application/ld+json") {
    return parseWithRdfParserTs(source, normalized || "text/turtle", baseIRI);
  }
  const quadStream = Readable.from([source]).pipe(new JsonLdParser({ baseIRI, documentLoader }));
  const quads: Quad[] = [];
  return await new Promise((resolve, reject) => {
    quadStream.on("data", (quad: Quad) => quads.push(quad));
    quadStream.on("error", reject);
    quadStream.on("end", () => resolve(quads));
  });
}

export function parseNQuads(source: string): Quad[] {
  return parseWithRdfParserTs(source, "application/n-quads");
}

export async function serializeNQuads(quads: Quad[]): Promise<string> {
  return quads.map((quad) => quadToString(quad)).join("");
}

export function objects(quads: Quad[], subject: Term, predicateIri: string): Term[] {
  return quads
    .filter((quad) => quad.subject.equals(subject) && quad.predicate.equals(namedNode(predicateIri)))
    .map((quad) => quad.object);
}

export function subjects(quads: Quad[], predicateIri: string, object: Term): Term[] {
  return quads
    .filter((quad) => quad.predicate.equals(namedNode(predicateIri)) && quad.object.equals(object))
    .map((quad) => quad.subject);
}

export function extractMemberDataset(quads: Quad[], member: Term): Quad[] {
  const output: Quad[] = [];
  const seen = new Set<string>();

  const visit = (focus: Term): void => {
    const focusKey = termKey(focus);
    if (seen.has(focusKey)) {
      return;
    }
    seen.add(focusKey);

    const matching = quads.filter((quad) => {
      const defaultSubjectStar = quad.graph.equals(defaultGraph()) && quad.subject.equals(focus);
      const namedGraphPayload = quad.graph.equals(focus);
      return defaultSubjectStar || namedGraphPayload;
    });

    output.push(...matching);
    for (const quad of matching) {
      if (quad.object.termType === "BlankNode") {
        visit(quad.object);
      }
    }
  };

  visit(member);
  return output;
}

export function canonicalizeNQuads(source: string): string[] {
  return parseNQuads(source)
    .map(quadKey)
    .sort();
}

export function datasetEquals(left: string, right: string): boolean {
  const leftQuads = uniqueQuads(parseNQuads(left));
  const rightQuads = uniqueQuads(parseNQuads(right));
  if (leftQuads.length !== rightQuads.length) return false;
  const leftBlankNodes = blankNodeIds(leftQuads);
  const rightBlankNodes = blankNodeIds(rightQuads);
  if (leftBlankNodes.length !== rightBlankNodes.length) return false;
  if (!leftBlankNodes.length) {
    return JSON.stringify(leftQuads.map(quadKey).sort()) ===
      JSON.stringify(rightQuads.map(quadKey).sort());
  }
  const rightKeys = new Set(rightQuads.map(quadKey));
  const mapping = new Map<string, string>();
  const used = new Set<string>();
  // Backtrack lazily and reject partial assignments as soon as a fully mapped
  // quad cannot occur in the other dataset. No factorial permutation array.
  function search(index: number): boolean {
    if (index === leftBlankNodes.length) return leftQuads.every((quad) => rightKeys.has(mappedQuadKey(quad, mapping)));
    for (const candidate of rightBlankNodes) {
      if (used.has(candidate)) continue;
      mapping.set(leftBlankNodes[index], candidate);
      used.add(candidate);
      const compatible = leftQuads.every((quad) => {
        const terms = [quad.subject, quad.object, quad.graph];
        return terms.some((term) => term.termType === "BlankNode" && !mapping.has(term.value))
          || rightKeys.has(mappedQuadKey(quad, mapping));
      });
      if (compatible && search(index + 1)) return true;
      mapping.delete(leftBlankNodes[index]);
      used.delete(candidate);
    }
    return false;
  }
  return search(0);
}

export function quadKey(quad: Quad): string {
  return [
    termKey(quad.subject),
    termKey(quad.predicate),
    termKey(quad.object),
    termKey(quad.graph),
  ].join(" ");
}

export function termKey(term: Term): string {
  if (term.termType === "Literal") {
    const lang = term.language ? `@${term.language}` : "";
    const datatype = term.datatype?.value ? `^^${term.datatype.value}` : "";
    return `"${term.value}"${lang}${datatype}`;
  }
  if (term.termType === "DefaultGraph") {
    return "";
  }
  return `${term.termType}:${term.value}`;
}

function blankNodeIds(quads: Quad[]): string[] {
  const ids = new Set<string>();
  for (const quad of quads) {
    for (const term of [quad.subject, quad.object, quad.graph]) {
      if (term.termType === "BlankNode") ids.add(term.value);
    }
  }
  return [...ids].sort();
}

function parseWithRdfParserTs(source: string, format: string, baseIRI?: string): Quad[] {
  return [...(new Parser({ format, baseIRI }).parse(source) ?? [])] as Quad[];
}

function mappedQuadKey(quad: Quad, mapping: Map<string, string>): string {
  const mappedTermKey = (term: Term): string =>
    term.termType === "BlankNode"
      ? `BlankNode:${mapping.get(term.value) ?? term.value}`
      : termKey(term);
  return [
    mappedTermKey(quad.subject),
    mappedTermKey(quad.predicate),
    mappedTermKey(quad.object),
    mappedTermKey(quad.graph),
  ].join(" ");
}

function uniqueQuads(quads: Quad[]): Quad[] {
  return [...new Map(quads.map((quad) => [quadKey(quad), quad])).values()];
}

const contexts = new Map<string, { body: any; expires: number; etag?: string }>();

// Each scenario must start with a cold cache, otherwise a reused ephemeral port
// lets one run answer another run's context request and the request-count
// oracle silently observes zero fetches.
export function resetContextCache(): void {
  contexts.clear();
}

const cachedContextLoader = {
  async load(url: string): Promise<any> {
    // The suite is deterministic and offline: a fixture that needs an external
    // context must serve it from the fixture server.
    const origin = new URL(url).hostname;
    if (!["127.0.0.1", "::1", "localhost"].includes(origin)) {
      throw new Error(`refusing to load a non-loopback JSON-LD context: ${url}`);
    }
    const saved = contexts.get(url);
    if (saved && saved.expires > Date.now()) return saved.body;
    const response = await fetch(url, { headers: {
      accept: "application/ld+json, application/json",
      ...(saved?.etag ? { "if-none-match": saved.etag } : {}),
    } });
    if (!response.ok && response.status !== 304) throw new Error(`JSON-LD context HTTP ${response.status}`);
    if (response.status === 304 && !saved) throw new Error("JSON-LD context 304 without cached representation");
    const body = response.status === 304 ? saved!.body : await response.json();
    const control = response.headers.get("cache-control") ?? "";
    const age = Number(/(?:^|,)\s*max-age=(\d+)/iu.exec(control)?.[1] ?? 0);
    if (!/no-store/iu.test(control)) {
      if (contexts.size >= 128 && !contexts.has(url)) contexts.delete(contexts.keys().next().value!);
      contexts.set(url, { body, expires: /no-cache/iu.test(control) ? 0 : Date.now() + age * 1000,
        etag: response.headers.get("etag") ?? saved?.etag });
    } else contexts.delete(url);
    return body;
  },
};
