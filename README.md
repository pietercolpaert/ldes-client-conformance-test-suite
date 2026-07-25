# LDES 1.0 Client Conformance Test Suite

This repository is the home of a black-box conformance test suite for clients of
the [Linked Data Event Streams (LDES) 1.0 specification][ldes-1.0]. It turns the
consumer requirements in the specification into reproducible HTTP scenarios,
observable client outcomes, and machine-readable
[EARL 1.0][earl] reports.

The project is currently in its design and scaffolding phase. It does **not**
yet make conformance claims about any client.

## Goals

- Trace every test to an exact normative statement in LDES 1.0.
- Test externally observable behavior rather than implementation details.
- Exercise any client through a small, language-neutral adapter contract.
- Cover the LDES 1.0 algorithms as separately reportable compliance groups:
  unordered traversal, ordered traversal, member extraction, and context
  information.
- Distinguish required behavior, recommended behavior, optional capabilities,
  and requirements that only apply to a supported mode.
- Produce one EARL assertion per test case and test subject.
- Make failures reproducible from fixtures, request logs, client events, and
  pinned client versions.

Non-goals for the first release are server conformance, performance
benchmarking, and testing client extensions that are not needed by LDES 1.0.
Extension tests may be added later, but will never affect an LDES 1.0
conformance claim.

## Compliance groups

LDES 1.0 is easier to test as a set of algorithm claims rather than one large
pass/fail label. The suite therefore reports these groups independently:

| Group | Scope | Dependency |
| --- | --- | --- |
| Unordered traversal | Entry-point discovery, synchronization runs, state, deduplication, HTTP behavior, retry/error handling, unordered relation traversal, rebalancing resilience, immutable node handling, cache headers, ETags, and polling interval behavior | None |
| Ordered traversal | Ordered ascending traversal, SHACL property path evaluation, ordering prerequisites, relation-bound interpretation, queue prioritization, and transaction-finalizing members | Must also pass unordered traversal |
| Member extraction | The LDES member extraction algorithm, including default-graph subject stars, named graphs whose graph IRI is the member IRI, recursive blank nodes, cycle protection, and TREE profile extraction support | Independent algorithm claim |
| Context information | Extraction and communication of event stream, root node, and `tree:viewDescription` context; optional interpretation of retention policies and consumer-oriented context semantics | Independent algorithm claim |

The ordered traversal group is a superset claim: an ordered client must pass the
unordered traversal group and the ordered-specific tests. A client that only
declares unordered traversal is not penalized for ordered-specific tests; those
assertions are `earl:inapplicable`.

`MUST` failures affect the relevant group. `SHOULD` failures are reported as
advisory assertions. Optional capabilities, such as specialized TREE profile
processing or deeper retention-policy interpretation, produce named subclaims
instead of silently changing the baseline score.

An unsupported mode is `earl:inapplicable`, an unimplemented test is
`earl:untested`, and an inconclusive execution is `earl:cantTell`. None of
these is silently converted into a pass.

## How the suite works

```text
test manifest ─┬─> deterministic HTTP fixture server ─> client under test
               │                                      │
               └─> oracle <─ request log + events <─ adapter
                              │
                              └─> JSON summary + EARL report
```

Each atomic test directory contains:

- `manifest.ttl`: stable test identity, specification citation, requirement
  level, compliance group, and expected outcome;
- `scenario.yaml`: HTTP resources and response changes across synchronization
  runs;
- `responses/`: RDF representations and other response bodies;
- `expected/`: expected member data, event ordering, requests, errors, or
  context.

The runner starts a local scenario server and gives its entry-point IRI to an
adapter. The adapter invokes the real client and emits newline-delimited JSON
events. The oracle can inspect:

- emitted member identifiers and RDF datasets;
- order and duplicate emission;
- run completion, errors, context, and statistics;
- HTTP request headers, redirects, retries, timing, and node visits;
- behavior after a controlled restart with the same state directory.

The server, runner, and oracle must use virtual or bounded time for polling and
back-off tests. Tests must not depend on public LDES instances or wall-clock
delays.

See [the architecture](docs/architecture.md), [requirement inventory](docs/requirements.md),
[adapter contract](docs/adapter-contract.md), [client landscape](docs/client-landscape.md),
and [test authoring guide](tests/README.md).

## Planned client adapters

The clients below informed the neutral contract. This is an integration plan,
not a current capability or conformance matrix.

| Client | Native integration surface | Initial adapter approach |
| --- | --- | --- |
| [OpenLDES Linked Data Interactions][openldes-client] | Java modules used in a larger LDI pipeline | Small Java harness around its member supplier and state repositories |
| [rdf-connect/ldes-client][rdf-connect-client] | TypeScript library and `ldes-client` CLI | Direct process wrapper; capture member output and saved state |
| [lblod/ldes-client][lblod-client] | TypeScript service that writes through a SPARQL/Virtuoso workflow | Container adapter with disposable stores; translate target/status graphs and stream-end hook |
| [europeana/rd-ldes-client][europeana-client] | Experimental Java library with traversal callbacks | Java harness around `TreeTraversal`/`ActivityHandler` |

Adapters live outside the normative test definitions. A defect in an adapter
must result in `earl:cantTell`, not `earl:failed`.

## Repository layout

```text
.
├── adapters/                  client integration packages
├── docs/
│   ├── adapter-contract.md    process and event protocol
│   ├── architecture.md        components and design decisions
│   ├── client-landscape.md    reviewed client integration surfaces
│   └── requirements.md        specification-to-test inventory
├── examples/
│   └── earl-report.ttl        illustrative report
├── schemas/                   machine-readable scenario and event contracts
├── tests/
│   ├── manifest.ttl           suite manifest
│   └── discovery/             first illustrative atomic test
└── vocab/
    └── ldes-ct.ttl            suite metadata terms
```

`PLAN.md` contains the implementation sequence and definition of done.

## Design principles

1. **Specification first.** Test IDs are assigned to clauses, not inherited
   from one client's feature names.
2. **One reason to fail.** Atomic tests isolate a behavior where practical.
3. **Protocol realism.** Fixtures are valid HTTP and RDF; malformed inputs are
   only used when a requirement defines error behavior.
4. **Representation independence.** RDF datasets are compared semantically
   with blank-node-aware dataset isomorphism, not as text.
5. **Observable evidence.** Every assertion retains enough evidence to explain
   the outcome without client source access.
6. **Versioned claims.** Reports identify the client build, adapter, suite
   revision, mode, platform, and execution time.
7. **No implementation favoritism.** Test fixtures are not copied unchanged
   from one candidate client's own tests.

## Status and next steps

The immediate work is to review and freeze the normative requirement inventory,
validate the adapter contract with one CLI client and one embedded-library
client, then implement the first vertical slice:

1. entry-point discovery;
2. RDF media types and basic HTTP handling;
3. unordered traversal, including retry/error behavior;
4. member extraction;
5. stateful second-run behavior and EARL generation.

See [PLAN.md](PLAN.md) for milestones, open decisions, and acceptance criteria.

[ldes-1.0]: https://w3id.org/ldes/specification
[earl]: https://www.w3.org/TR/EARL10-Schema/
[openldes-client]: https://github.com/OpenLDES/Linked-Data-Interactions/tree/main/ldi-core/ldes-client
[rdf-connect-client]: https://github.com/rdf-connect/ldes-client
[lblod-client]: https://github.com/lblod/ldes-client
[europeana-client]: https://github.com/europeana/rd-ldes-client
