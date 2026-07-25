import { Readable } from "node:stream";
import { DataFactory, Parser, quadToString } from "rdf-parser-ts";
import { rdfParser } from "rdf-parse";
import type { Quad, Term } from "@rdfjs/types";

const { namedNode, defaultGraph } = DataFactory;

export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const TREE = "https://w3id.org/tree#";

export async function parseRdf(source: string, contentType: string, baseIRI: string): Promise<Quad[]> {
  const normalized = contentType.split(";")[0].trim().toLowerCase();
  if (normalized !== "application/ld+json") {
    return parseWithRdfParserTs(source, normalized || "text/turtle", baseIRI);
  }
  const quadStream = rdfParser.parse(Readable.from([source]), {
    contentType: normalized || "text/turtle",
    baseIRI,
  });
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
      const namedGraphPayload = focus.termType === "NamedNode" && quad.graph.equals(focus);
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
  const leftQuads = parseNQuads(left);
  const rightQuads = parseNQuads(right);
  if (leftQuads.length !== rightQuads.length) return false;
  const leftBlankNodes = blankNodeIds(leftQuads);
  const rightBlankNodes = blankNodeIds(rightQuads);
  if (leftBlankNodes.length !== rightBlankNodes.length) return false;
  if (!leftBlankNodes.length) {
    return JSON.stringify(leftQuads.map(quadKey).sort()) ===
      JSON.stringify(rightQuads.map(quadKey).sort());
  }
  if (leftBlankNodes.length > 8) {
    throw new Error("dataset isomorphism oracle supports at most eight blank nodes");
  }
  const wanted = JSON.stringify(rightQuads.map(quadKey).sort());
  return permutations(rightBlankNodes).some((candidate) => {
    const mapping = new Map(leftBlankNodes.map((id, index) => [id, candidate[index]]));
    const mapped = leftQuads.map((quad) => mappedQuadKey(quad, mapping)).sort();
    return JSON.stringify(mapped) === wanted;
  });
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

function permutations<T>(values: T[]): T[][] {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)])
      .map((tail) => [value, ...tail])
  );
}
