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
| Member extraction | Generic member focus, default subject star, member-named graph, recursive blank nodes, and cycle protection | Independent |
| Context information | Root, event-stream, publishing-service, shape, version, and retention-policy context extraction and communication | Independent; retention interpretation beyond extraction is a named consumer extension |

Only applicable `MUST` tests determine a baseline group pass. `SHOULD` tests
remain visible advisory evidence. Unsupported capabilities are
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

Current verified reference result: 18/18 scenarios pass. The coverage report
maps 77/100 reviewed rows to executable tests and gives explicit rationales for
the remaining 23, with zero unmapped applicable client `MUST`/`SHOULD` rows.
This figure is requirement traceability, not a claim that one bundled scenario
proves every implementation technique mentioned by the specification.

## Executable scenario catalog

### 1. Unordered traversal

- [x] Root-node and overview entry points, post-redirect current-page
      discovery, exactly-one checks, and negative ambiguous/missing views.
- [x] Root processing, distinct relation targets, complete traversal, and
      completion/error signaling.
- [x] N-Quads, N-Triples, TriG, Turtle, and JSON-LD responses plus `Accept`
      evidence.
- [x] Back-off retries for `408`, `425`, `429`, `500`, `502`, `503`, and `504`.
- [x] Terminal non-special 4xx behavior, redirect following, and `410 Gone`.
- [x] Multi-run state, restart-compatible state directory, no duplicate
      emission, statistics, and mutable frontier continuation.
- [x] RDF `ldes:immutable`, `Cache-Control: immutable`, ETag storage,
      `If-None-Match`, and `304 Not Modified`.
- [x] Rebalance timeline with redirect, changed members, later `410`, and no
      member loss or duplication.
- [x] `ldes:pollingInterval` extraction.
- [ ] Autonomous synchronization at the advertised polling interval. This
      requires a follow-mode adapter operation and injectable virtual clock;
      finite runner-controlled synchronization cannot prove scheduling.
- [ ] External JSON-LD context cache reuse. Add a controlled JSON-LD document
      loader/request route so context cache behavior is observable without
      public network access.
- [ ] Immediate unordered emission timing. Extend process-event evidence with
      receive timestamps so emission can be compared with subsequent requests.

### 2. Ordered traversal

- [x] Applicability and error when neither timestamp nor sequence path exists.
- [x] Global ascending member order across nodes where fetch order is
      adversarial.
- [x] Direct ordering paths and SHACL sequence paths; the reference evaluator
      also supports inverse paths.
- [x] Equal ordering values with the transaction-finalizing member last.
- [x] Fixtures containing time relation bounds, matching paths, competing
      targets, and output-order assertions.
- [x] Group scoring depends on mandatory unordered traversal.
- [ ] Add isolated relation-window cases for all four relation subclasses,
      mismatched paths, unsupported relation types, and multi-relation logical
      AND. The current combined fixture maps these rows through externally
      observable ordering but does not diagnose each queue decision separately.
- [ ] Add an ordered restart/bookmark advisory case. Bookmark technique is
      optional; observable no-duplicate restart behavior already exists.

### 3. Member extraction

- [x] Focus nodes are selected only from the discovered event stream.
- [x] Default-graph subject-star extraction.
- [x] All quads from a graph named by the member IRI.
- [x] Recursive blank-node extraction with a cycle.
- [x] Unrelated page data and another stream that must not be emitted.
- [x] Blank-node-label-independent dataset comparison.
- [ ] Add TREE-profile extraction after the adapter contract gains an explicit
      `treeProfileExtraction` capability. It is an optional named subclaim and
      must not make generic extraction inapplicable.

### 4. Context information

- [x] Communicate the event stream IRI, root node IRI, full root RDF context,
      multiple shapes, timestamp/version paths, polling interval, and
      statistics.
- [x] Communicate publishing-service context present on the root and through
      `tree:viewDescription`.
- [x] Discover direct and view-description retention policies.
- [x] Preserve an empty retention-policy IRI as the specification’s
      no-members signal.
- [x] Keep consumer-only chronological, SHACL validation, version selection,
      prior-payload recovery, clock-skew, and historical-policy semantics out
      of the baseline client score with explicit coverage rationales.
- [ ] Define a separate retention-aware consumer profile before implementing
      duration, amount, deletion-duration, `startingFrom`, clock-safety, and
      legacy-policy interpretation tests.

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
- [ ] Execute JSON Schema validation rather than relying only on the stricter
      TypeScript runtime validators.
- [ ] SHACL-validate EARL structure and parse generated EARL with a second RDF
      implementation in CI.
- [ ] Add request-budget declarations per scenario to turn accidental request
      loops into immediate harness failures.

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
