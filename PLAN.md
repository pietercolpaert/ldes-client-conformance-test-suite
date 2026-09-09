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
| Ordered traversal | Ordered ascending emission, ordering prerequisites, SHACL paths, relation semantics, equal values, and transaction finalization | Independent mode claim; shared obligations are exercised by an ordered-mode fixture |
| Member extraction | Generic member focus, default subject star, member-named graph, recursive blank nodes, cycle protection, plus optional TREE Profile extraction | Independent; TREE Profile extraction is a `MAY` subclaim (`LDES10-EXTRACT-001`) |
| Context information | Root, event-stream, publishing-service, shape, version, and retention-policy context extraction and communication | Independent; retention interpretation beyond extraction is a named consumer extension |

Only applicable `MUST` tests determine a baseline group pass. `SHOULD` tests
remain visible advisory evidence and do not fail the main group in the same
way as `MUST` failures. Unsupported capabilities are
`earl:inapplicable`; infrastructure uncertainty is `earl:cantTell`; neither is
a pass. Ordered and unordered traversal are independent mode claims: LDES 1.0
permits an ordered-only client, so neither group is downgraded because of the
other.

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

Current verified reference result: 62/62 scenarios pass. The coverage report
maps 81/100 reviewed rows to executable tests and gives explicit rationales for
the remaining 19, with zero unmapped applicable client `MUST`/`SHOULD` rows.
This figure is requirement traceability, not a claim that one bundled scenario
proves every implementation technique mentioned by the specification.

## Executable scenario catalog

### 1. Unordered traversal

Implemented tests:

| Test IRI suffix | Level | What it proves | Main oracle |
| --- | --- | --- | --- |
| `discovery/root-entrypoint` | MUST | A client can start from an LDES root, discover the configured view, process the root metadata, follow the first page, and emit all reachable members once. | Expected member datasets, context event, request log, completion event |
| `discovery/overview-entrypoint` | MUST | A client can start from an overview resource, follow its `tree:view` link to the root/view, and traverse from there. | Expected members and required discovery requests; `Accept` header presence; extra root fetches are advisory evidence, not a MUST failure |
| `discovery/missing-view` | SHOULD | A client handles an entry point that has no usable view without silently producing incomplete output. | Error or clean non-completion diagnostic |
| `discovery/ambiguous-view` | MUST | A client reports an error when the *current-page* `tree:view` pattern matches more than once (`LDES10-UNORD-012`). Selecting one of them is not acceptable here. | Client-kind error event |
| `discovery/ambiguous-overview` | SHOULD | Ambiguity in the *fallback* `tree:view` lookup is reported (`LDES10-UNORD-015`). This is advisory where current-page ambiguity is mandatory. | Client-kind error event |
| `http/serializations` | MUST | The client can parse supported RDF serializations used by LDES fragments. | Members from N-Quads, N-Triples, TriG, Turtle, and JSON-LD responses; `Accept` request evidence |
| `http/retryable-statuses` | MUST | Transient statuses are retried instead of treated as terminal data loss. | Request sequence for `408`, `425`, `429`, `500`, `502`, `503`, and `504`; eventual member output |
| `http/terminal-error` | MUST | Non-special terminal 4xx errors stop the affected traversal path and are surfaced. | Error event and no fabricated members |
| `http/gone-node` | MUST | `410 Gone` is handled as a gone fragment during traversal/rebalancing. | Request log and successful completion without duplicate/lost members |
| `unordered/mutable-sync` | MUST | A second synchronization run continues from persisted state, emits newly reachable mutable members, and avoids duplicates. | Two-run state, expected members per run, no duplicate identifiers |
| `unordered/rebalancing` | MUST | A server can rebalance by redirecting/changing pages and later marking old pages gone without causing member loss or duplication. | Phased fixture timeline, request log, expected final member set |
| `unordered/cache-state` | SHOULD | HTTP cache validators are persisted and reused across runs. | ETag storage, `If-None-Match`, and `304 Not Modified` request evidence |
| `unordered/rdf-immutable` | SHOULD | RDF `ldes:immutable` and `Cache-Control: immutable` are used to avoid unnecessary revalidation. | Advisory request evidence that immutable fragments are not refetched/revalidated |

Remaining detailed tests:

- [x] `unordered/polling-interval-scheduling` (`SHOULD`): run a bounded
      follow-mode adapter operation and assert that the next poll is scheduled
      according to `ldes:pollingInterval`, rather than an implementation
      default.
- [x] `unordered/polling-interval-update` (`SHOULD`): serve the same view over
      two equal follow windows advertising `ldes:pollingInterval` 1 and then 2,
      and assert per-phase request counts and minimum gaps with tolerance, so a
      client polling on a hard-coded interval fails whichever value it hard-codes.
- [x] `unordered/etag-update` (`SHOULD`): the root's `ETag` changes on a
      revalidated response and a later run receives `304` only for the updated
      validator, so replaying a stale `ETag` is visible in the request log. In
      the same run an intermediate node answers `304` and its saved frontier
      must still be followed to a member added on its child.
- [x] `unordered/immediate-emission` (`SHOULD`, per `LDES10-UNORD-048`, if the
      adapter exposes event timestamps): verify that unordered clients emit
      members as soon as their containing fragment is processed, without waiting
      for unrelated frontier traversal.
- [x] `unordered/jsonld-context-cache` (`SHOULD`): serve an external JSON-LD
      context from the loopback fixture and assert context reuse/revalidation
      without public network access. The default document loader refuses any
      non-loopback context and the cache is cleared per scenario, so the suite
      never reaches the public network while parsing a fixture.
- [x] `discovery/current-page-precedence` (`MUST`): after a redirect, a page
      carrying both a current-page `tree:view` pattern and distracting fallback
      metadata must be resolved against the post-redirect base, select the
      current-page match, and never dereference the decoy root.
- [x] `context/blank-node-metadata` (`MUST`): shapes and view descriptions
      described entirely by blank nodes with nested structure are extracted and
      communicated, including the retention policy reached *through* a
      blank-node view description. Compared by dataset isomorphism, never by
      parser-local blank-node labels or list order.
- [x] `ordered/typed-mixed-datatypes` and `ordered/typed-timestamp-timezones`
      (`MUST`): one ordering path carrying several numeric datatypes is compared
      by value, and `xsd:dateTime` values are compared as instants across UTC
      offsets, with equal instants declared as an ordering tie.
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
| `ordered/restart-bookmark` | MUST | Persisted ordered state prevents duplicates across runs while allowing later members. Mapped to `LDES10-UNORD-019/024` for mandatory resume and deduplication output; it does not assert a bookmark implementation (`LDES10-ORD-003` is a `MAY`). | Two-run output and no duplicate member IDs |
| `ordered/unsupported-relation` | MUST | An unknown TREE relation type must not cause member loss: the client still traverses the relation and emits every member. Completeness is mandatory (`LDES10-ORD-004`, `LDES10-UNORD-051`) and is not waived because the relation type is unfamiliar. | Exact member output and single terminal event |

The ordered group is independent of unordered traversal. Obligations shared by
both modes are exercised by an ordered-mode fixture as well as an unordered one,
so an ordered-only client can demonstrate them without an unordered claim.

Remaining ordered work:

- [ ] Distinguish actual relation-bound conjunction from a correct but
      conservative complete traversal. `ordered/multiple-relations-and` fixes
      the input shape for `LDES10-ORD-013` by pointing two compatible bounds at
      one target, but final output alone cannot separate the two strategies, so
      `LDES10-ORD-010/011/012` stay rationalized as `manual`. Add reversed
      relation order and differing ordering paths on the same target, and
      separate advisory traversal observations, without inventing a mandatory
      queue implementation or an exact fetch order.
- [ ] Review the SHACL and XPath definitions before freezing expected values for
      missing, multivalued or incomparable ordering paths.

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
| `extraction/tree-profile-basic` | MAY | TREE Profile extraction basic case for clients declaring `TreeProfileExtraction`. | Optional dataset isomorphism or `inapplicable` |
| `extraction/tree-profile-shape-targets` | MAY | TREE Profile extraction with shape metadata. | Optional dataset isomorphism or `inapplicable` |
| `extraction/tree-profile-mixed-page` | MAY | TREE Profile extraction on a mixed page avoids unrelated resource emission. | Optional dataset isomorphism or `inapplicable` |

These three fixtures currently serve ordinary Turtle and are satisfied by the
generic extractor, so they do not yet prove content-type negotiation or
profile-specific framing. They report an optional profile claim only.

Remaining member-extraction work:

- [ ] Make the TREE Profile claim observable: negotiate a profile content type
      and assert framing that the generic extractor cannot satisfy, keeping the
      generic fallback fixtures separate. Add profile-specific requirement rows
      only after reviewing the TREE Profile specification itself.
- [ ] Add an ordered-mode counterpart for the mandatory extraction fixtures so
      an ordered-only client can demonstrate `LDES10-EXTRACT-004/006/007/008`.

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
- [x] Validate every expected artifact, including datasets nested inside
      `oneOf` alternatives, and run the harness regression tests in CI.
- [ ] Execute JSON Schema validation rather than relying only on the stricter
      TypeScript runtime validators.
- [ ] SHACL-validate EARL structure and parse generated EARL with a second RDF
      implementation in CI.
- [ ] Add reviewed request-budget declarations per scenario where the budget is
      advisory/performance-oriented and not stricter than the LDES 1.0 spec.
- [x] Report observation strength separately from mapping. `coverage.json`
      distinguishes behaviorally verified from merely mapped, flags rows whose
      only evidence comes from a weaker-level fixture, and counts rationales per
      classification without ever adding them to coverage.
- [x] Preserve failure evidence: keep events parsed before a failure, stop
      consuming adapter output after a protocol error, and carry stderr, the
      stdout line count and timeout detail into the diagnostic.
- [x] Keep the suite offline and deterministic: the JSON-LD document loader
      refuses non-loopback contexts and its cache is cleared per scenario.
- [ ] Split the compliance-group taxonomy so shared obligations stop reporting
      under a mode-named group. The requirement inventory files all of section 3
      - HTTP, discovery, state, deduplication - under "Unordered traversal",
      even though both modes share it, so the ordered-mode fixtures for those
      obligations currently report under `OrderedTraversal`. Mode-neutral groups
      already work correctly: `ordered/common-generic-extraction` and
      `ordered/common-root-context` report under `MemberExtraction` and
      `ContextInformation`. Introducing a `CommonTraversal` group means
      re-classifying inventory rows, so it needs the specification-editor review
      already listed below. Until then the per-requirement coverage report, not
      the group claim, is the axis that says what a client demonstrated.
- [ ] Refine failure attribution beyond `earl:cantTell`. Adapter crashes,
      timeouts and protocol errors now carry detailed diagnostics but still
      share one outcome, so a client defect and a harness defect are not
      distinguishable from the outcome alone.
- [ ] Regenerate the production-client reports and the README table against the
      current suite. The published per-client numbers are a stale checkpoint
      from the 18-scenario era and are marked as such until then.

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
