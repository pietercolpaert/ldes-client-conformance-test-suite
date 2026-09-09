import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { DataFactory, Parser } from "rdf-parser-ts";
import type { TestCase } from "./types.js";
import type { Quad, Term } from "@rdfjs/types";

const { namedNode } = DataFactory;
const DCT = "http://purl.org/dc/terms/";
const CT = "https://w3id.org/ldes/conformance/vocab#";
const EARL = "http://www.w3.org/ns/earl#";

export async function discoverTests(root: string): Promise<TestCase[]> {
  const tests: TestCase[] = [];
  await walk(root, tests);
  return tests.sort((left, right) => left.id.localeCompare(right.id));
}

async function walk(directory: string, tests: TestCase[]): Promise<void> {
  for (const entry of await readdir(directory)) {
    const child = path.join(directory, entry);
    const childStat = await stat(child);
    if (childStat.isDirectory()) {
      await walk(child, tests);
    }
  }

  const scenarioPath = path.join(directory, "scenario.yaml");
  const manifestPath = path.join(directory, "manifest.ttl");
  const expectedPath = path.join(directory, "expected", "events.ndjson");
  try {
    await stat(scenarioPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  // Once a scenario exists, missing or malformed artifacts are authoring errors.
  await stat(manifestPath);
  await stat(expectedPath);
  const metadata = await readManifest(manifestPath);
  tests.push({
    id: path.relative(process.cwd(), directory).replaceAll(path.sep, "/"),
    directory, manifestPath, scenarioPath, expectedPath, ...metadata,
  });
}

async function readManifest(manifestPath: string): Promise<Pick<
  TestCase,
  "iri" | "title" | "description" | "requirement" | "requirements" | "requirementLevel" | "group"
  | "requiredCapabilities"
>> {
  const source = await readFile(manifestPath, "utf8");
  const baseIRI = new URL(`file://${path.resolve(manifestPath)}`).toString();
  const quads = [...(new Parser({ baseIRI }).parse(source) ?? [])] as Quad[];
  const subjects = quads
    .filter((quad) =>
      quad.predicate.equals(namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")) &&
      quad.object.equals(namedNode(`${EARL}TestCase`))
    )
    .map((quad) => quad.subject);
  if (subjects.length !== 1 || subjects[0].termType !== "NamedNode") {
    throw new Error(`${manifestPath}: expected exactly one named earl:TestCase`);
  }
  const test = subjects[0];
  const value = (predicate: string): string | undefined =>
    objects(quads, test, predicate)[0]?.value;
  const localName = (iri?: string): string | undefined =>
    iri?.slice(Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/")) + 1);
  const requirements = objects(quads, test, `${DCT}isPartOf`)
    .map((term) => localName(term.value))
    .filter((value): value is string => Boolean(value));
  const requiredCapabilities = objects(quads, test, `${CT}requiresCapability`)
    .map((term) => localName(term.value) ?? term.value)
    .filter((value): value is string => Boolean(value));

  return {
    iri: test.value,
    title: value(`${DCT}title`) ?? path.basename(path.dirname(manifestPath)),
    description: value(`${DCT}description`),
    requirement: requirements[0],
    requirements,
    requirementLevel: localName(value(`${CT}requirementLevel`)) as TestCase["requirementLevel"],
    group: localName(value(`${CT}group`)),
    requiredCapabilities,
  };
}

function objects(quads: Quad[], subject: Term, predicate: string): Term[] {
  return quads
    .filter((quad) => quad.subject.equals(subject) && quad.predicate.equals(namedNode(predicate)))
    .map((quad) => quad.object);
}
