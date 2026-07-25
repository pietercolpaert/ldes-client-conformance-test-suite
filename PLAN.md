# Implementation Plan

This plan takes the project from the current documentation scaffold to a
repeatable LDES 1.0 client conformance suite. The suite is organized around
four compliance groups: unordered traversal, ordered traversal, member
extraction, and context information. Milestones are ordered so each produces a
usable vertical slice.

## Current state

- [x] Establish black-box scope and compliance groups.
- [x] Sketch a language-neutral client adapter protocol.
- [x] Add the initial requirement families and one illustrative test artifact.
- [x] Define the intended EARL assertion shape.
- [x] Review every normative statement in the dated LDES 1.0 release.
- [ ] Resolve boundary-review items with specification editors or project
      maintainers.
- [ ] Design reusable test LDESs and their mutation timelines.
- [ ] Select and bootstrap the runner implementation.

## Milestone 0 - Freeze the conformance basis

1. Save the canonical LDES 1.0 release URL and publication date in suite
   metadata. Do not silently track an editor's draft.
2. Inventory every `MUST`, `SHOULD`, and `MAY`, including compound statements.
3. Give each independently testable obligation a stable ID of the form
   `LDES10-<AREA>-NNN`.
4. Record for each obligation:
   - exact section and stable fragment URL;
   - verbatim normative sentence;
   - requirement level;
   - subject (`client`, `consumer`, or downstream processor);
   - compliance group and applicability;
   - automatic, partially automatic, manual, or untestable classification;
   - test IDs or a rationale for no test.
5. Ask specification editors to review ambiguous cases, especially the
   boundary between client behavior and optional consumer processing.
6. Publish a generated coverage table and fail CI when an applicable
   requirement has neither tests nor an explicit rationale.

Deliverable: a reviewed requirement manifest that is the sole input to test
coverage accounting. The manifest must make ordered traversal depend on
unordered traversal.

## Milestone 1 - Test LDES design and hosting model

Before implementing many atomic tests, design a small set of reusable LDESs
that can be hosted by the fixture server. These are not public benchmark data
sets; they are controlled conformance instruments with known timelines,
headers, redirects, and expected member streams.

1. Define a canonical test LDES manifest format that describes:
   - event stream IRI, root node IRI, and entry-point aliases;
   - pages/nodes, relations, members, named graphs, and context;
   - supported serializations and content negotiation variants;
   - response headers per page and per phase;
   - mutation phases, rebalance phases, and restart checkpoints;
   - expected emitted members, context events, request patterns, and final
     state expectations.
2. Design the first reusable LDES families:
   - `ldes-basic-unordered`: small static tree for entry-point discovery,
     relation traversal, deduplication, and completion signaling;
   - `ldes-http-errors`: retryable statuses, terminal errors, redirects,
     `410 Gone`, and bounded back-off behavior;
   - `ldes-mutable-sync`: mutable frontier pages that add members between
     synchronization runs;
   - `ldes-cache-state`: `ldes:immutable`, `Cache-Control: immutable`,
     `ETag`, `If-None-Match`, `304 Not Modified`, and `ldes:pollingInterval`;
   - `ldes-rebalancing`: old immutable pages redirect to a merged page, then
     selected old pages become `410 Gone`;
   - `ldes-extraction`: default-graph subject stars, named graphs, recursive
     blank nodes, cycle protection, unrelated triples, and multiple RDF
     serializations;
   - `ldes-ordered`: timestamp/sequence paths, SHACL property paths,
     relation windows, unsupported relations, equal ordering values, and
     transaction-finalizing members;
   - `ldes-context-retention`: event stream context, root-node context,
     `tree:viewDescription`, shapes, version metadata, and retention-policy
     variants.
3. For every test LDES, define a phase timeline. A phase is an explicit server
   state, for example:
   - phase 0: initial replication;
   - phase 1: mutable page adds new members;
   - phase 2: page becomes immutable and cache headers change;
   - phase 3: tree is rebalanced and old page IRIs redirect;
   - phase 4: old page IRIs return `410 Gone`.
4. Require every phase transition to be test-controlled. The runner advances
   phases through an internal control API or scenario instruction, not through
   wall-clock waiting.
5. Keep the hosted LDESs deterministic:
   - loopback-only HTTP origin by default;
   - stable IRIs resolved from templates;
   - bounded request counts and deadlines;
   - no outbound network access from fixtures;
   - explicit cache headers and ETags;
   - repeatable virtual time for polling and retry tests.
6. Add validation for the hosted LDESs:
   - RDF syntax parsing for every representation;
   - semantic checks for required `tree:view`, `tree:member`, `tree:relation`,
     and `tree:node` patterns;
   - expected member datasets are RDF-isomorphic to fixture data;
   - phase transitions preserve intentional invariants, such as no member loss
     after rebalance;
   - negative fixtures are marked so they are not reused as valid LDES examples.
7. Document which requirement IDs each reusable LDES supports. Atomic tests can
   then select a phase or slice of a reusable LDES instead of inventing a new
   fixture from scratch.

Acceptance criteria:

- each reusable LDES has a manifest, phase timeline, RDF fixtures, expected
  events, and expected request evidence;
- the fixture server can host at least one static LDES and one mutable phased
  LDES end to end;
- phase transitions are deterministic and observable in evidence artifacts;
- rebalancing tests can prove that redirects or `410 Gone` do not cause member
  loss or duplicate emission;
- the same hosted LDES definition can be reused by multiple atomic tests
  without weakening test isolation.

## Milestone 2 - Runner, fixture server, and EARL

The proposed implementation is a Node.js/TypeScript workspace because it has
good RDF/JS, HTTP, subprocess, JSON Schema, and container tooling and can
directly wrap one candidate client. This is a runner choice, not a constraint
on clients or adapters.

1. Add workspace tooling, formatting, linting, unit tests, and CI.
2. Parse `manifest.ttl` and `scenario.yaml`; validate both before execution.
3. Implement the loopback-only HTTP fixture server needed to host the reusable
   test LDESs with:
   - per-route response sequences;
   - named LDES phases and explicit phase advancement;
   - RDF content negotiation;
   - redirects;
   - ETag/304 and Cache-Control behavior;
   - scripted transient and terminal status codes;
   - a complete timestamped request log;
   - virtual or injectable time for retry and polling.
4. Implement adapter process lifecycle, per-test temporary state, deadlines,
   stdout protocol parsing, and stderr capture.
5. Implement RDF dataset isomorphism and event/request oracles.
6. Model each client build as `earl:Software` and `earl:TestSubject`.
7. Model the suite runner as the assertor and every atomic artifact as
   `earl:TestCase`.
8. Emit `earl:Assertion` with `assertedBy`, `subject`, `test`, and `result`.
9. Use the standard outcomes `passed`, `failed`, `cantTell`, `inapplicable`,
   and `untested`, plus `earl:automatic` or the actual mode.
10. Add PROV-O or Dublin Core metadata for suite revision, adapter revision,
   client version, start/end time, mode, platform, and evidence location.
11. Keep detailed evidence in a JSON artifact and link it from the EARL result;
   do not embed unbounded logs in RDF.
12. SHACL-validate report structure and parse it with at least two RDF parsers.
13. Generate a human-readable summary from EARL rather than maintaining a
   separate source of truth.

Acceptance criteria:

- the same scenario yields deterministic results on two consecutive runs;
- schema or manifest errors fail before a client starts;
- a crashed or malformed adapter is `cantTell`, not a client failure;
- all fixture servers and client processes are cleaned up after failure;
- one assertion exists for every selected test, including non-pass outcomes;
- repeated reports use stable test and subject identifiers;
- a report identifies enough pinned inputs to reproduce the run.

## Milestone 3 - Unordered traversal group

Implement atomic scenarios using the reusable hosted LDESs where practical:

- all four accepted entry-point forms;
- redirected base IRI handling;
- exactly one, zero, and multiple `tree:view` matches;
- root-node processing as a normal node;
- N-Quads, N-Triples, TriG, Turtle, and JSON-LD;
- `Accept`, redirects, retryable statuses with bounded back-off, `410 Gone`,
  and terminal 4xx/5xx behavior;
- distinct relation targets and complete unordered traversal;
- completion signaling;
- exactly-once emission within a run and across controlled synchronization
  runs;
- persisted frontier behavior after a process restart;
- rebalancing resilience: old immutable pages redirect to a rebalanced page,
  old pages can become `410 Gone`, and no member is lost or emitted twice;
- `ldes:immutable true`, `Cache-Control: immutable`, `ETag` persistence,
  `If-None-Match`, and `304 Not Modified`;
- `ldes:pollingInterval` as a recommended behavior using virtual time.

The rebalancing tests should cite the server primer as supporting guidance, but
the client-facing assertions should be grounded in main-spec obligations:
redirect following, `410 Gone`, immutability semantics, state, and
deduplication.

## Milestone 4 - Member extraction group

Implement atomic scenarios using `ldes-extraction` and related reusable hosted
LDESs:

- member discovery from the event stream IRI only;
- default-graph subject stars;
- named graphs whose graph IRI is the member IRI;
- recursive blank-node traversal;
- blank-node cycle protection;
- unrelated page data that must not be emitted as part of a member;
- multiple serialization formats that can carry named graphs;
- TREE profile extraction as a named optional capability.

Use both positive and discriminating negative fixtures. A member fixture must
contain unrelated triples so that "emit the whole page" cannot pass extraction
tests.

## Milestone 5 - Ordered traversal group

1. Declare mode capabilities before selecting tests.
2. Select ordered tests only when the unordered traversal group passes.
3. Test rejection when neither timestamp nor sequence path is available.
4. Cover SHACL property paths used by ordering metadata.
5. Test member ordering within a node and across a tree.
6. Cover the four specified time relation subclasses.
7. Test logical AND for multiple relations targeting one node.
8. Ensure only relations on a matching timestamp/sequence path influence
   priority.
9. Test unsupported relation types as immediately relevant.
10. Test equal timestamp/sequence values and transaction-finalizing member
   placement.
11. Add adversarial trees where fetch order differs from emission order.
12. Test ordered use of TREE profile pages separately from generic extraction.

The oracle must evaluate emitted order, not infer correctness from request
order.

## Milestone 6 - Context information group

Implement separate capability groups for:

- event stream, root node, and `tree:viewDescription` context;
- context communication through adapter events;
- `tree:shape`, including multiple shapes as logical AND;
- version paths, out-of-order version timestamp/sequence metadata, and finding
  prior named-graph payloads for updates/deletions;
- transaction metadata;
- absent, direct, and view-description retention policies;
- empty policy resources;
- `startingFrom`, duration, amount, deletion duration, and clock-safety
  semantics;
- the three legacy retention policy types.

Some clauses address a broader consumer or downstream processor rather than
the traversal client. Keep these tests out of mandatory traversal scoring
unless the requirement inventory review establishes that they apply to every
LDES client.

For the first runner release, context extraction and communication are baseline
tests. Retention-policy interpretation is a separate optional subclaim until
the requirement inventory confirms which clauses apply to every client.

## Milestone 7 - Candidate adapters and release

Build adapters independently; do not encode client-specific behavior in tests.

1. `rdf-connect/ldes-client`: start with its CLI and saved-state folder.
2. OpenLDES LDI client: embed modules in a Java test harness and surface its
   completion/context/state semantics.
3. Europeana client: wrap `TreeTraversal` and `ActivityHandler`; mark missing
   state capabilities as actual test outcomes, not adapter failures.
4. lblod client: use disposable SPARQL/Virtuoso infrastructure and observe
   member effects plus its status graph.

For every adapter:

- pin the tested source revision or released artifact digest;
- document build and invocation;
- implement `probe`, `run`, and `reset`;
- publish declared modes/capabilities;
- pass adapter contract tests with a fake client;
- distinguish client errors from harness errors.

Release criteria:

1. Run all adapters in isolated CI jobs and publish their EARL artifacts.
2. Add a test-review checklist and fixture licensing/provenance metadata.
3. Require two reviewers for changes to normative mappings or expected
   outcomes.
4. Version tests and vocabulary; never reuse a test IRI for changed semantics.
5. Document how specification errata and future LDES versions branch from the
   1.0 suite.
6. Produce a tagged first release only after requirement coverage, runner,
   EARL validation, the unordered traversal group, the member extraction group,
   and at least two materially different adapters are working.

## Open decisions

- Permanent namespace and ownership for test, requirement, and report IRIs.
- Whether test discovery remains RDF-manifest-only or uses a generated index.
- Whether reusable hosted LDES definitions live under `tests/ldes/`, under each
  atomic test area, or are generated from higher-level templates.
- The exact boundary of context/retention requirements that are phrased for
  "consumer" rather than "client".
- How adapters communicate context that a native client retains but does not
  expose.
- Maximum retry/back-off budget and the virtual-time API.

These decisions should be recorded as short architecture decision records under
`docs/decisions/` when implementation starts.
