# LDES 1.0 conformance suite plan

This is the implementation and release plan for the dated LDES 1.0 client
conformance suite. It is intentionally a completion ledger: implemented
baseline work is checked, while optional profiles, external review, and hosted
release work remain visible without weakening current claims.

## Conformance model

The suite reports four independent algorithm groups:

| Group | Baseline claim | Dependency |
| --- | --- | --- |
| Unordered traversal | Discovery, synchronization lifecycle, state, deduplication, HTTP/RDF handling, relation traversal, errors, caching, and rebalancing | None |
| Ordered traversal | Ordered ascending emission, ordering prerequisites, SHACL paths, relation semantics, equal values, and transaction finalization | Every mandatory unordered test must also pass |
| Member extraction | Generic member focus, default subject star, member-named graph, recursive blank nodes, cycle protection, plus advisory TREE Profile extraction | Independent; TREE Profile extraction is a `SHOULD` subclaim |
| Context information | Root, event-stream, publishing-service, shape, version, and retention-policy context extraction and communication | Independent; retention interpretation beyond extraction is a named consumer extension |

Only applicable `MUST` tests determine a baseline group pass. `SHOULD` tests
remain visible advisory evidence and do not fail the main group in the same
way as `MUST` failures. Unsupported capabilities are
`earl:inapplicable`; infrastructure uncertainty is `earl:cantTell`; neither is
a pass. Ordered traversal is a superset claim and is downgraded unless unordered
traversal passes.

## Completed baseline

- [x] Freeze the dated LDES 1.0 release URL and review all visible normative
      statements.
- [x] Split compound statements into 100 stable requirement IDs in
      `docs/requirements.md`.
- [x] Classify each row by level, subject, group, and testability.
- [x] Generate coverage from RDF test manifests and fail the run when an
      applicable client `MUST` or `SHOULD` has neither tests nor rationale.
- [x] Record explicit rationales for optional, consumer-boundary, manual, and
      genuinely deferred rows.
- [x] Implement the Node.js/TypeScript runner, loopback scenario server,
      process adapter protocol, deadlines, isolated persistent state, and
      complete request logs.
- [x] Implement event and request oracles, including request counts, statuses,
      required/partial headers, event order, error/completion outcomes, and
      blank-node-aware RDF dataset isomorphism.
- [x] Implement deterministic phases for mutation, caching, retry sequences,
      redirects, rebalancing, and `410 Gone`.
- [x] Implement a reference client that exercises unordered and ordered
      traversal, generic extraction, context events, state, ETags, immutable
      nodes, retries, SHACL sequence/inverse paths, and transaction finalizing
      members.
- [x] Emit evidence JSON, coverage JSON/Markdown, EARL Turtle, group summaries,
      and an LDES-styled HTML report.
- [x] Implement capability-aware `inapplicable` results and the mandatory
      ordered-to-unordered group dependency.
- [x] Implement and pin adapters for rdf-connect, OpenLDES LDI, and Europeana.
- [x] Add a three-client GitHub Actions matrix and GitHub Pages publication.

Current verified reference result: 44/44 scenarios pass. The coverage report
maps 79/100 reviewed rows to executable tests and gives explicit rationales for
the remaining 21, with zero unmapped applicable client `MUST`/`SHOULD` rows.
This figure is requirement traceability, not a claim that one bundled scenario
proves every implementation technique mentioned by the specification.

## Executable scenario catalog

### 1. Unordered traversal

Implemented tests:

| Test IRI suffix | Level | What it proves | Main oracle |
| --- | --- | --- | --- |
| `discovery/root-entrypoint` | MUST | A client can start from an LDES root, discover the configured view, process the root metadata, follow the first page, and emit all reachable members once. | Expected member datasets, context event, request log, completion event |
| `discovery/overview-entrypoint` | MUST | A client can start from an overview resource, follow `ldes:eventStream`, discover the root/view, and traverse from there. | Expected members and required discovery requests; extra root fetches are advisory evidence, not a MUST failure |
| `discovery/missing-view` | SHOULD | A client handles an entry point that has no usable view without silently producing incomplete output. | Error or clean non-completion diagnostic |
| `discovery/ambiguous-view` | SHOULD | A client reports or deterministically handles multiple available views. Selecting the first view is acceptable fallback evidence; the test must not require failure. | Completed traversal or explicit diagnostic, with selected view evidence |
| `http/serializations` | MUST | The client can parse supported RDF serializations used by LDES fragments. | Members from N-Quads, N-Triples, TriG, Turtle, and JSON-LD responses; `Accept` request evidence |
| `http/retryable-statuses` | MUST | Transient statuses are retried instead of treated as terminal data loss. | Request sequence for `408`, `425`, `429`, `500`, `502`, `503`, and `504`; eventual member output |
| `http/terminal-error` | MUST | Non-special terminal 4xx errors stop the affected traversal path and are surfaced. | Error event and no fabricated members |
| `http/gone-node` | MUST | `410 Gone` is handled as a gone fragment during traversal/rebalancing. | Request log and successful completion without duplicate/lost members |
| `unordered/mutable-sync` | MUST | A second synchronization run continues from persisted state, emits newly reachable mutable members, and avoids duplicates. | Two-run state, expected members per run, no duplicate identifiers |
| `unordered/rebalancing` | MUST | A server can rebalance by redirecting/changing pages and later marking old pages gone without causing member loss or duplication. | Phased fixture timeline, request log, expected final member set |
| `unordered/cache-state` | SHOULD | HTTP cache validators are persisted and reused across runs. | ETag storage, `If-None-Match`, and `304 Not Modified` request evidence |
| `unordered/rdf-immutable` | SHOULD | RDF `ldes:immutable` and `Cache-Control: immutable` are used to avoid unnecessary revalidation. | Advisory request evidence that immutable fragments are not refetched/revalidated |

Remaining detailed tests:

- [ ] `unordered/polling-interval-follow` (`SHOULD`): run a follow-mode adapter
      operation with an injectable virtual clock; assert that the next poll is
      scheduled no earlier than `ldes:pollingInterval`, and that a later update
      is discovered without a manual second run.
- [ ] `unordered/polling-interval-header-update` (`SHOULD`): expose the same
      fragment with a changed `Cache-Control` and changed `ldes:pollingInterval`
      across phases; assert the client updates its polling/caching behavior
      from the latest fetched representation.
- [ ] `unordered/immediate-emission` (`MUST`, if the adapter exposes event
      timestamps): verify that unordered clients emit members as soon as their
      containing fragment is processed, without waiting for unrelated frontier
      traversal.
- [ ] `unordered/jsonld-context-cache` (`SHOULD`): serve an external JSON-LD
      context from the loopback fixture and assert context reuse/revalidation
      without public network access.
- [x] `unordered/request-budget` (`SHOULD` harness quality gate): the scenario
      format supports `requestBudget`, and the oracle fails a run when the
      budget is exceeded. Per-scenario budgets should be added conservatively
      after client review so they remain performance diagnostics and not hidden
      normative exact-request requirements.

### 2. Ordered traversal

Implemented tests:

| Test IRI suffix | Level | What it proves | Main oracle |
| --- | --- | --- | --- |
| `ordered/missing-path` | MUST | Ordered traversal is not applicable unless the client can determine a timestamp path or `ldes:sequencePath`. | Explicit error/inapplicable diagnostic rather than arbitrary ordering |
| `ordered/global-order` | MUST | Members are emitted in global ascending order even when fragments are fetched in adversarial order. | Exact output order and complete member set |
| `ordered/shacl-path` | MUST | Ordered traversal can evaluate a sequence path expressed as a SHACL property path. | Exact output order through path evaluation |
| `ordered/relation-less-than` | MUST | `tree:LessThanRelation` targets are traversed and earlier members are emitted before later members. | Exact output order and complete member set |
| `ordered/relation-less-than-or-equal` | MUST | Inclusive upper-bound relations preserve equal ordering values. | Exact output order for equal values |
| `ordered/relation-greater-than` | MUST | `tree:GreaterThanRelation` targets are traversed without premature later-member emission. | Exact output order and complete member set |
| `ordered/relation-greater-than-or-equal` | MUST | Inclusive lower-bound relations preserve equal ordering values. | Exact output order for equal values |
| `ordered/mismatched-relation-path` | MUST | Relation paths that differ from the selected ordering path are handled conservatively. | No reachable member loss; exact output order |
| `ordered/multiple-relations-and` | MUST | Multiple relation constraints from one page do not cause reachable member loss. | Complete member set and exact output order |
| `ordered/equal-values-finalizer` | MUST | A transaction-finalizing member is emitted last among members with equal ordering values. | Exact output order |
| `ordered/restart-bookmark` | SHOULD | Persisted ordered state prevents duplicates across runs while allowing later members. | Two-run output and no duplicate member IDs |
| `ordered/unsupported-relation` | SHOULD | Unknown TREE relation types are handled conservatively or with a clear diagnostic. | Advisory output/error evidence |

The ordered group remains a superset of unordered traversal: a client cannot
claim ordered conformance unless all applicable unordered `MUST` tests also
pass.

Remaining detailed ordered tests: none currently planned for the baseline.

### 3. Member extraction

Implemented tests:

| Test IRI suffix | Level | What it proves | Main oracle |
| --- | --- | --- | --- |
| `extraction/generic-dataset` | MUST | LDES Member extraction selects members from the discovered stream only, emits default-graph subject-star data, includes quads from a graph named by the member IRI, recursively follows blank nodes, terminates on blank-node cycles, and ignores unrelated page data and other streams. | Blank-node-label-independent RDF dataset isomorphism |
| `extraction/default-graph-star-minimal` | MUST | Default-graph subject-star extraction works in isolation. | Dataset isomorphism |
| `extraction/named-graph-only` | MUST | Payload quads in the graph named by the member IRI are emitted even without default-graph member data. | Dataset isomorphism including graph name |
| `extraction/default-plus-named-graph-merge` | MUST | Default-graph and member-named graph payloads are emitted as one member dataset. | Dataset isomorphism |
| `extraction/blank-node-chain` | MUST | Recursive blank-node inclusion works across multiple levels. | Blank-node-label-independent dataset isomorphism |
| `extraction/blank-node-cycle` | MUST | Blank-node cycles terminate and still emit finite complete data. | Blank-node-label-independent dataset isomorphism |
| `extraction/multiple-streams` | MUST | Member focus nodes are scoped to the discovered event stream. | Only selected stream member emitted |
| `extraction/tree-profile-basic` | SHOULD | TREE Profile extraction basic case for clients declaring `TreeProfileExtraction`. | Advisory dataset isomorphism or `inapplicable` |
| `extraction/tree-profile-shape-targets` | SHOULD | TREE Profile extraction with shape metadata. | Advisory dataset isomorphism or `inapplicable` |
| `extraction/tree-profile-mixed-page` | SHOULD | TREE Profile extraction on a mixed page avoids unrelated resource emission. | Advisory dataset isomorphism or `inapplicable` |

Remaining detailed member-extraction tests: none currently planned for the baseline.

### 4. Context information

Implemented tests:

| Test IRI suffix | Level | What it proves | Main oracle |
| --- | --- | --- | --- |
| `context/root-context` | MUST | The client communicates event-stream/root context, shapes, timestamp path, version-of path, polling interval, publishing-service metadata, and basic run statistics. | Context events and extracted RDF dataset |
| `context/empty-retention` | MUST | An empty retention-policy IRI is preserved as the specification’s no-members signal instead of being dropped as malformed data. | Context event and retained policy IRI evidence |
| `context/root-and-eventstream-iri` | MUST | Root node IRI and event stream IRI are communicated. | Context event scalar fields |
| `context/shape-multiple` | MUST | All advertised shapes are communicated. | Context event shape list |
| `context/timestamp-version-paths` | MUST | Timestamp and version path metadata is extracted and communicated. | Context event scalar fields |
| `context/polling-interval` | SHOULD | `ldes:pollingInterval` is exposed as advisory context. | Context event scalar field |
| `context/publishing-service-direct` | MUST | Publishing-service context present on the current page remains available. | Context dataset isomorphism |
| `context/publishing-service-view-description` | MUST | Publishing-service context linked through `tree:viewDescription` is communicated. | Context event and dataset isomorphism |
| `context/retention-policy-direct` | MUST | Direct retention-policy links are discovered and reported without interpretation. | Context event retention-policy list |
| `context/retention-policy-view-description` | MUST | Retention-policy links through `tree:viewDescription` are discovered and reported without interpretation. | Context event retention-policy list |

Remaining detailed retention-aware consumer profile tests:
- [ ] `context/retention-policy-duration` (`SHOULD`, retention-aware consumer
      profile): interpret duration-based retention only after a separate
      profile is defined.
- [ ] `context/retention-policy-amount` (`SHOULD`, retention-aware consumer
      profile): interpret amount-based retention only after a separate profile
      is defined.
- [ ] `context/retention-policy-deletion-duration` (`SHOULD`,
      retention-aware consumer profile): interpret deletion-duration semantics
      only after clock-safety and historical-policy boundaries are reviewed.

Consumer-only chronological ordering, SHACL validation, version selection,
prior-payload recovery, clock-skew handling, and historical retention-policy
semantics remain outside the baseline LDES client score unless a separate
consumer profile is explicitly enabled.

## Fixture and report quality gates

- [x] Version all tests under `tests/1.0/`.
- [x] Parse every hosted RDF response and every expected N-Quads dataset during
      fixture validation.
- [x] Resolve fixture IRIs from a loopback origin template.
- [x] Keep response phases deterministic and runner-controlled.
- [x] Retain request/event evidence for every assertion.
- [x] Produce one standard EARL assertion for every selected test, including
      failed, `cantTell`, `inapplicable`, and `untested` outcomes.
- [x] Identify the suite, adapter, client revision, test, date, and evidence in
      reports.
- [x] Publish human and machine-readable artifacts from the same result source.
- [x] Support optional per-scenario request budgets to turn accidental request
      loops into immediate harness failures when a scenario declares a budget.
- [ ] Execute JSON Schema validation rather than relying only on the stricter
      TypeScript runtime validators.
- [ ] SHACL-validate EARL structure and parse generated EARL with a second RDF
      implementation in CI.
- [ ] Add reviewed request-budget declarations per scenario where the budget is
      advisory/performance-oriented and not stricter than the LDES 1.0 spec.

## Candidate and release completion

- [x] rdf-connect native Node/RDFJS adapter.
- [x] OpenLDES LDI Java host and SQLite state bridge.
- [x] Europeana Java host and native crawl-state bridge.
- [x] Matrix artifacts, report aggregation, and GitHub Pages deployment job.
- [x] Build and execute the pinned rdf-connect, OpenLDES, and Europeana
      adapters locally; retain actual failed/inapplicable outcomes.
- [ ] Push the workflow, enable GitHub Actions as the Pages source, and confirm
      the first hosted deployment.
- [ ] Confirm both Java hosts against their pinned upstream builds on the
      hosted runner.
- [ ] Choose the permanent namespace/ownership for requirement, test, and
      report IRIs before a stable 1.0 suite release.
- [ ] Obtain specification-editor review for boundary classifications and the
      combined ordered-relation mappings.
- [ ] Require two reviewers for normative mappings and changed expected
      outcomes through repository branch protection/CODEOWNERS.
- [ ] Review term-level constraints in the LDES vocabulary before advertising
      a retention-aware consumer profile.
- [ ] Tag the first stable release only after the hosted matrix, Pages report,
      namespace decision, and normative mapping review complete.

## Definition of done

The executable baseline is done when `npm test` passes, all 100 reviewed rows
have a test mapping or explicit rationale, the four group claims are present,
and every assertion has reproducible evidence. A stable public release adds the
hosted-matrix, namespace, and external-review items above. Deferred optional
profiles are versioned additions; they do not silently expand an already
published claim.
