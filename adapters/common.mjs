import { execFileSync } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";

export async function readInput() {
  let source = "";
  for await (const chunk of process.stdin) source += chunk;
  return source.trim() ? JSON.parse(source) : {};
}

export function protocolWriter() {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr);
  return (value) => write(`${JSON.stringify(value)}\n`);
}

export async function writeDocument(value) {
  await new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(value)}\n`, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

export async function resetState(input) {
  const directory = path.resolve(input.stateDirectory ?? "");
  if (
    !path.isAbsolute(input.stateDirectory ?? "") ||
    directory === path.parse(directory).root ||
    directory.length < 8
  ) {
    throw new Error(
      `refusing to reset an unsafe state directory: ${JSON.stringify(input.stateDirectory)}`,
    );
  }
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}

export async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function quadsToNQuads(quads) {
  return quads
    .map((quad) => {
      const graph =
        quad.graph?.termType && quad.graph.termType !== "DefaultGraph"
          ? ` ${termToNQuad(quad.graph)}`
          : "";
      return `${termToNQuad(quad.subject)} ${termToNQuad(quad.predicate)} ${termToNQuad(quad.object)}${graph} .`;
    })
    .join("\n")
    .concat(quads.length ? "\n" : "");
}

function termToNQuad(term) {
  switch (term.termType) {
    case "NamedNode":
      return `<${term.value.replaceAll(">", "%3E")}>`;
    case "BlankNode":
      return `_:${term.value}`;
    case "Literal": {
      const lexical = term.value
        .replaceAll("\\", "\\\\")
        .replaceAll('"', '\\"')
        .replaceAll("\n", "\\n")
        .replaceAll("\r", "\\r");
      if (term.language) return `"${lexical}"@${term.language}`;
      const datatype = term.datatype?.value;
      return datatype
        ? `"${lexical}"^^<${datatype}>`
        : `"${lexical}"`;
    }
    default:
      throw new Error(`cannot serialize RDF/JS term type ${term.termType}`);
  }
}

// Revision of the checked-out client; clients are tracked at their default
// branch head rather than pinned, so the revision is read from the checkout.
export function gitRevision(root) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}
