# Reusing The Suite In Client CI

Client repositories can run the same LDES 1.0 conformance tests without copying
fixtures. The recommended shape is:

1. check out the client repository;
2. check out this conformance suite at a pinned ref;
3. build the client;
4. run one adapter against the suite's `tests/` directory;
5. upload the generated `summary.json`, `earl.ttl`, `coverage.*`, and evidence.

## Reusable Workflow

A client repository can call the reusable workflow in this repository. For
`rdf-connect/ldes-client`, start with non-blocking publication of the report:

```yaml
name: LDES conformance

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  ldes-conformance:
    uses: pietercolpaert/ldes-client-conformance-test-suite/.github/workflows/reusable-client-conformance.yml@main
    with:
      adapter: rdf-connect
      suite-repository: pietercolpaert/ldes-client-conformance-test-suite
      suite-ref: main
      client-build-command: |
        npm ci
        npm run build
      fail-on-non-pass: false
```

`fail-on-non-pass: false` is useful while adopting the suite because the job
still uploads EARL and JSON evidence. Once the client has a known acceptable
baseline, set it to `true` to make regressions fail CI.

The built-in `rdf-connect` adapter expects the client checkout through
`LDES_CT_RDF_CONNECT_ROOT`. The reusable workflow sets that to the checked-out
client path automatically.

## Custom Adapters

A client can keep its own adapter outside this suite. Create an adapter root in
the client repository:

```text
.ldes-conformance/
└── adapters/
    └── my-client/
        ├── adapter.json
        └── adapter.mjs
```

Then run the suite with an external adapter declaration root:

```sh
node dist/cli.js run \
  --adapter my-client \
  --adapters "$GITHUB_WORKSPACE/client/.ldes-conformance/adapters" \
  --tests tests \
  --out "$GITHUB_WORKSPACE/ldes-conformance-report"
```

The adapter contract is intentionally language-neutral. The process implements
`probe`, `reset`, and `run`, emits NDJSON events on stdout, and leaves all
client logs on stderr. See [adapter-contract.md](adapter-contract.md).

## Pinning

Client CI should pin `suite-ref` to a tag or commit for required checks. Using
`main` is useful for early feedback, but it can change the active conformance
surface as new tests are added. The EARL report records the suite version and
the client revision so published results remain auditable.
