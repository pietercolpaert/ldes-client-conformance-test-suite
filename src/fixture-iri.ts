import path from "node:path";

const DEFAULT_RAW_REPOSITORY_ROOT =
  "https://raw.githubusercontent.com/pietercolpaert/ldes-client-conformance-test-suite/main/";

export function rawFixtureBase(scenarioPath: string): string {
  const repositoryRoot = process.env.LDES_CT_RAW_REPOSITORY_ROOT ??
    DEFAULT_RAW_REPOSITORY_ROOT;
  const directory = path.dirname(path.relative(process.cwd(), scenarioPath))
    .split(path.sep)
    .join("/");
  return new URL(`${directory}/`, ensureTrailingSlash(repositoryRoot)).toString();
}

export function expandFixturePlaceholders(
  value: string,
  scenarioPath: string,
  origin?: string,
): string {
  return value
    .replaceAll("{{raw}}", rawFixtureBase(scenarioPath))
    .replaceAll("{{origin}}", origin ?? "http://127.0.0.1:49152");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
