# LDES 1.0 Normative Requirement Review

This is the reviewed requirement inventory for the dated LDES 1.0 main
specification release:

- Spec: [Linked Data Event Streams, 9 May 2026][spec]
- Local source inspected: `/tmp/ldes-1.0-index.html`
- Review date: 2026-07-25
- Scope: visible `MUST`, `SHOULD`, and `MAY` statements in the main
  consumer-oriented LDES 1.0 specification.

The table uses paraphrased obligations rather than copying the full
specification text. Each row links to the source section that contains the
normative statement. Some rows split one compound statement into separately
testable obligations.

## Review Outcome

- Normative keyword occurrences found in the main specification HTML: 73.
- Reviewed catalog rows after splitting compound statements: 100.
- Keyworded obligation rows: 95 (`MUST`: 69, `SHOULD`: 18, `MAY`: 8).
- Additional algorithm details captured for test design: 5.
- The vocabulary document contains additional term-level constraints. Those are
  not mixed into this main-spec count and should be reviewed separately before
  retention and vocabulary validation tests are finalized.
- The server primer rebalancing case is outside the main-spec count. It remains
  a derived interoperability scenario grounded in main-spec behavior for
  redirects, `410 Gone`, state, immutability, and deduplication.

## Requirement Catalog

| ID | Source | Level | Subject | Group | Testability | Reviewed obligation |
| --- | --- | --- | --- | --- | --- | --- |
| LDES10-UNORD-001 | [3][sync] | MAY | Client | Unordered traversal | Capability metadata | A client can expose more than one operating mode. |
| LDES10-UNORD-002 | [3][sync] | MUST | Client | Unordered traversal | Automatic via probe | A client has at least unordered traversal or ordered ascending traversal. |
| LDES10-UNORD-003 | [3][sync] | MAY | Client | Unordered traversal | Informational | A client can expose modes beyond the two modes defined by LDES 1.0. |
| LDES10-ORD-001 | [3][sync] | Algorithm detail | Client | Ordered traversal | Applicability check | Ordered traversal only applies when `ldes:timestampPath`, `ldes:sequencePath`, or both are present. |
| LDES10-UNORD-004 | [3][sync] | SHOULD | Client | Unordered traversal | Automatic with virtual time | A client checks for `ldes:pollingInterval` on the LDES. |
| LDES10-UNORD-005 | [3][sync] | SHOULD | Client | Unordered traversal | Automatic with virtual time | If `ldes:pollingInterval` is present, the client uses that integer as the interval between synchronization runs. |
| LDES10-UNORD-006 | [3][sync] | MUST | Client | Unordered traversal | Partially automatic | A client exposes a signal that a synchronization run has finished. |
| LDES10-PIPE-001 | [3][sync] | SHOULD | Consumer pipeline | Context information | Manual or harness-level | A non-ordered pipeline waits for the run-finalization signal before committing emitted members. |
| LDES10-UNORD-007 | [3][sync] | MUST | Client | Unordered traversal | Automatic | The only required input argument is an IRI. |
| LDES10-UNORD-008 | [3][sync] | Algorithm detail | Client | Unordered traversal | Automatic | The supplied IRI can identify an event stream, a root node, a redirect to the root, or an overview page with one `tree:view`. |
| LDES10-UNORD-009 | [3][sync] | MUST | Client | Unordered traversal | Automatic | Without previous state, the client performs an initialization run. |
| LDES10-UNORD-010 | [3.1][init] | MUST | Client | Unordered traversal | Automatic from request log | The client dereferences the supplied IRI. |
| LDES10-UNORD-011 | [3.1][init] | MUST | Client | Unordered traversal | Automatic | After dereferencing, the client first checks for exactly one current-page `tree:view` pattern using the post-redirect base IRI. |
| LDES10-UNORD-012 | [3.1][init] | SHOULD | Client | Unordered traversal | Automatic advisory case | Multiple matches of the current-page `tree:view` pattern are ambiguous; reporting an error is acceptable, but a deterministic fallback such as selecting the first encountered view is also considered workable. |
| LDES10-UNORD-013 | [3.1][init] | MUST | Client | Unordered traversal | Automatic | If the current-page pattern is absent, the client checks whether the supplied IRI has exactly one `tree:view` target. |
| LDES10-UNORD-014 | [3.1][init] | MUST | Client | Unordered traversal | Automatic from request log | When the supplied IRI has one `tree:view` target, the client dereferences that root node. |
| LDES10-UNORD-015 | [3.1][init] | SHOULD | Client | Unordered traversal | Automatic negative case | If the fallback `tree:view` pattern has zero or multiple matches, the client reports an error. |
| LDES10-UNORD-016 | [3.1][init] | MAY | Client | Unordered traversal | Informational | IRI dereferencing can be extended with source selection. |
| LDES10-CTX-001 | [3.1][init] | MUST | Client | Context information | Partially automatic | After processing the root node, the client initializes state with root context information. |
| LDES10-UNORD-017 | [3.1][init] | MUST | Client | Unordered traversal | Automatic | The root node is processed like any other node, including members, relations, and state management. |
| LDES10-UNORD-018 | [3.1][init] | MUST | Client | Unordered traversal | Automatic multi-run | Every later synchronization run consults state and continues from it. |
| LDES10-UNORD-019 | [3.2][state] | MUST | Client | Unordered traversal | Automatic | A member is emitted no more than once. |
| LDES10-UNORD-020 | [3.2][state] | SHOULD | Client | Unordered traversal | Automatic via requests | A client checks whether a node is immutable. |
| LDES10-UNORD-021 | [3.2][state] | SHOULD | Client | Unordered traversal | Automatic via requests | The first immutability check is the RDF statement `ldes:immutable true` on the current node. |
| LDES10-UNORD-022 | [3.2][state] | SHOULD | Client | Unordered traversal | Automatic via requests | If RDF immutability is absent, the client checks whether `Cache-Control` indicates immutability. |
| LDES10-ORD-002 | [3.2][state] | MAY | Client | Ordered traversal | Automatic with ordered fixture | A client can infer immutability from an incoming relation upper bound earlier than the latest processed member. |
| LDES10-UNORD-023 | [3.2][state] | SHOULD | Client | Unordered traversal | Automatic multi-run | Immutable nodes are not fetched more than once. |
| LDES10-UNORD-024 | [3.2][state] | MUST | Client | Unordered traversal | Automatic restart | A client can resume from a previous run. |
| LDES10-UNORD-025 | [3.2][state] | SHOULD | Client | Unordered traversal | Automatic restart | Resume is supported by keeping a frontier of nodes that are not yet immutable. |
| LDES10-ORD-003 | [3.2][state] | MAY | Client | Ordered traversal | Automatic restart | Ordered mode can use the last emitted timestamp and/or sequence value as a bookmark. |
| LDES10-CTX-002 | [3.2][state] | MUST | Client | Context information | Partially automatic | The client keeps context information such as event stream, root node, shape, and retention policy. |
| LDES10-UNORD-026 | [3.2][state] | SHOULD | Client | Unordered traversal | Partially automatic | The client keeps statistics such as member count and last-run time. |
| LDES10-CTX-003 | [3.2][state] | MUST | Client | Context information | Partially automatic | The client can communicate context information and statistics to downstream processors. |
| LDES10-UNORD-027 | [3.2][state] | SHOULD | Client | Unordered traversal | Automatic via requests | For mutable nodes, the client stores an available `ETag`. |
| LDES10-UNORD-028 | [3.3][http] | MUST | Client | Unordered traversal | Automatic | The client supports N-Quads responses. |
| LDES10-UNORD-029 | [3.3][http] | MUST | Client | Unordered traversal | Automatic | The client supports N-Triples responses. |
| LDES10-UNORD-030 | [3.3][http] | MUST | Client | Unordered traversal | Automatic | The client supports TriG responses. |
| LDES10-UNORD-031 | [3.3][http] | MUST | Client | Unordered traversal | Automatic | The client supports Turtle responses. |
| LDES10-UNORD-032 | [3.3][http] | MUST | Client | Unordered traversal | Automatic | The client supports JSON-LD responses. |
| LDES10-UNORD-033 | [3.3][http] | SHOULD | Client | Unordered traversal | Automatic via requests | For external JSON-LD contexts, the client implements HTTP caching. |
| LDES10-UNORD-034 | [3.3][http] | MUST | Client | Unordered traversal | Automatic via requests | Requests include an `Accept` header. |
| LDES10-UNORD-035 | [3.3][http] | SHOULD | Client | Unordered traversal | Automatic via requests | The client inspects `Cache-Control` for `immutable`. |
| LDES10-UNORD-036 | [3.3][http] | MUST | Client | Unordered traversal | Automatic via requests | The client follows redirects. |
| LDES10-UNORD-037 | [3.3][http] | SHOULD | Client | Unordered traversal | Automatic via requests | The client supports `If-None-Match` using stored ETags and handles `304 Not Modified`. |
| LDES10-UNORD-038 | [3.3][http] | MUST | Client | Unordered traversal | Automatic with virtual time | The client retries `408 Request Timeout` with back-off. |
| LDES10-UNORD-039 | [3.3][http] | MUST | Client | Unordered traversal | Automatic with virtual time | The client retries `425 Too Early` with back-off. |
| LDES10-UNORD-040 | [3.3][http] | MUST | Client | Unordered traversal | Automatic with virtual time | The client retries `429 Too Many Requests` with back-off. |
| LDES10-UNORD-041 | [3.3][http] | MUST | Client | Unordered traversal | Automatic with virtual time | The client retries `500 Internal Server Error` with back-off. |
| LDES10-UNORD-042 | [3.3][http] | MUST | Client | Unordered traversal | Automatic with virtual time | The client retries `502 Bad Gateway` with back-off. |
| LDES10-UNORD-043 | [3.3][http] | MUST | Client | Unordered traversal | Automatic with virtual time | The client retries `503 Service Unavailable` with back-off. |
| LDES10-UNORD-044 | [3.3][http] | MUST | Client | Unordered traversal | Automatic with virtual time | The client retries `504 Gateway Timeout` with back-off. |
| LDES10-UNORD-045 | [3.3][http] | MAY | Client | Unordered traversal | Informational | The client can implement authorization handling for `401`. |
| LDES10-UNORD-046 | [3.3][http] | MUST | Client | Unordered traversal | Automatic | The client treats `410 Gone` as a node with no members and no relations. |
| LDES10-UNORD-047 | [3.3][http] | MUST | Client | Unordered traversal | Automatic negative case | The client aborts and reports an error on other 4xx or 5xx statuses. |
| LDES10-UNORD-048 | [3.4][members] | SHOULD | Client | Unordered traversal | Automatic event timing | In unordered mode, members are emitted as soon as they are extracted. |
| LDES10-ORD-004 | [3.4][members] | MUST | Client | Ordered traversal | Automatic ordering oracle | In ordered mode, the client does not emit a member while another earlier member can still be discovered. |
| LDES10-ORD-005 | [3.4][members] | MUST | Client | Ordered traversal | Automatic ordering oracle | Ordered mode checks all extra ordered traversal conditions before emitting. |
| LDES10-EXTRACT-001 | [3.4][members] | MAY | Client | Member extraction | Optional subclaim | The client can support specialized content types or profiles such as the TREE profile. |
| LDES10-EXTRACT-002 | [3.4][members] | MUST | Client | Member extraction | Automatic | Without a specialized profile or content type, the client uses the generic LDES member extraction algorithm. |
| LDES10-EXTRACT-003 | [3.4][members] | MUST | Client | Member extraction | Automatic | Generic extraction starts after the whole `tree:Node` has been parsed. |
| LDES10-EXTRACT-004 | [3.4][members] | MUST | Client | Member extraction | Automatic | The client identifies focus nodes from `<ES> tree:member ?m` using the LDES event stream IRI. |
| LDES10-EXTRACT-005 | [3.4][members] | MUST | Client | Member extraction | Automatic | For each focus node, the client includes matching default-graph subject triples. |
| LDES10-EXTRACT-006 | [3.4][members] | MUST | Client | Member extraction | Automatic | For each focus node, the client includes all quads in the named graph whose graph IRI is the focus node. |
| LDES10-EXTRACT-007 | [3.4][members] | Algorithm detail | Client | Member extraction | Automatic | When an extracted object is a blank node, extraction recurses with that blank node as a new focus node. |
| LDES10-EXTRACT-008 | [3.4][members] | MUST | Client | Member extraction | Automatic | The client prevents duplicate processing of the same blank node. |
| LDES10-ORD-006 | [3.4][members] | MUST | Client | Ordered traversal | Automatic ordering oracle | In ordered mode without a specialized profile/content type, members in a node are ordered by timestamp path, sequence path, or both. |
| LDES10-UNORD-049 | [3.5.1][unordered] | MUST | Client | Unordered traversal | Automatic via requests | The client discovers relations on the current page using the current-page `tree:relation` pattern. |
| LDES10-UNORD-050 | [3.5.1][unordered] | MUST | Client | Unordered traversal | Automatic via requests | For every discovered relation, the client matches its `tree:node` target. |
| LDES10-UNORD-051 | [3.5.1][unordered] | MUST | Client | Unordered traversal | Automatic via requests | Every distinct relation target is dereferenced and processed. |
| LDES10-ORD-007 | [3.5.2][ordered] | MUST | Client | Ordered traversal | Automatic ordering oracle | Ordered mode can evaluate SHACL property paths. |
| LDES10-ORD-008 | [3.5.2][ordered] | MUST | Client | Ordered traversal | Automatic negative case | During initialization, ordered mode checks for `ldes:timestampPath` and/or `ldes:sequencePath`. |
| LDES10-ORD-009 | [3.5.2][ordered] | MUST | Client | Ordered traversal | Automatic negative case | Ordered mode errors when neither ordering path is present. |
| LDES10-ORD-010 | [3.5.2][ordered] | SHOULD | Client | Ordered traversal | Automatic ordering oracle | Ordered mode uses a priority queue for next links based on time-relation semantics. |
| LDES10-ORD-011 | [3.5.2][ordered] | SHOULD | Client | Ordered traversal | Automatic ordering oracle | The priority queue interprets greater-than and greater-than-or-equal relations as later-time bounds. |
| LDES10-ORD-012 | [3.5.2][ordered] | SHOULD | Client | Ordered traversal | Automatic ordering oracle | The priority queue interprets less-than and less-than-or-equal relations as earlier-time bounds. |
| LDES10-ORD-013 | [3.5.2][ordered] | MUST | Client | Ordered traversal | Automatic ordering oracle | Multiple relations to the same node are combined using logical AND. |
| LDES10-ORD-014 | [3.5.2][ordered] | MUST | Client | Ordered traversal | Automatic ordering oracle | Ordered mode checks whether a relation path matches the timestamp path or sequence path. |
| LDES10-ORD-015 | [3.5.2][ordered] | Algorithm detail | Client | Ordered traversal | Automatic ordering oracle | Only relations whose path matches an ordering path are used for ordering priority. |
| LDES10-ORD-016 | [3.5.2][ordered] | MUST | Client | Ordered traversal | Automatic ordering oracle | Among members with equal ordering values, a transaction-finalizing member is emitted last. |
| LDES10-CTX-004 | [4][context] | MUST | Client | Context information | Partially automatic | The client extracts root-node context information. |
| LDES10-CTX-005 | [4][context] | MUST | Client | Context information | Partially automatic | The client can communicate extracted context to downstream processors. |
| LDES10-CTX-006 | [4][context] | MUST | Client | Context information | Partially automatic | The client extracts context about the LDES entity. |
| LDES10-CTX-007 | [4][context] | MUST | Client | Context information | Partially automatic | The client extracts context about the publishing service. |
| LDES10-CTX-008 | [4][context] | MUST | Client | Context information | Partially automatic | Publishing-service context can be found on the current page. |
| LDES10-CTX-009 | [4][context] | MUST | Client | Context information | Partially automatic | Publishing-service context can be found on entities linked with `tree:viewDescription`. |
| LDES10-CTX-010 | [4.1][chrono] | MUST | Consumer or chronological client | Context information | Boundary review | Chronological order is derived from `ldes:timestampPath` and/or `ldes:sequencePath` when they are set. |
| LDES10-CTX-011 | [4.2][shape] | MUST | Processor | Context information | Boundary review | A SHACL-validating processor passes each member IRI as the target for the referenced node shape. |
| LDES10-CTX-012 | [4.2][shape] | MUST | Consumer or processor | Context information | Boundary review | Multiple `tree:shape` statements are interpreted as logical AND. |
| LDES10-CTX-013 | [4.3][versions] | MUST | Consumer | Context information | Boundary review | A consumer selecting latest versions from out-of-order version streams uses `ldes:versionTimestampPath`. |
| LDES10-CTX-014 | [4.3][versions] | MUST | Consumer | Context information | Boundary review | A consumer selecting latest versions from out-of-order version streams uses `ldes:versionSequencePath`. |
| LDES10-EXTRACT-009 | [4.3][versions] | MAY | Consumer | Member extraction | Optional subclaim | If a member IRI is also used as a named graph, the consumer can treat that graph as the upsert payload. |
| LDES10-CTX-015 | [4.3][versions] | MUST | Consumer | Context information | Boundary review | For updates and deletions, the consumer can locate the prior named-graph payload group again. |
| LDES10-RET-001 | [4.4][retention] | MUST | Consumer | Retention interpretation | Boundary review | Without a retention policy on the root node, the consumer assumes complete event-stream history is available from that root. |
| LDES10-RET-002 | [4.4][retention] | MUST | Consumer | Retention interpretation | Boundary review | With a retention policy, the consumer assumes members outside that policy cannot be found. |
| LDES10-RET-003 | [4.4][retention] | MUST | Client | Retention interpretation | Partially automatic | While processing the root node, the client checks for a direct root-node retention policy. |
| LDES10-RET-004 | [4.4][retention] | MUST | Client | Retention interpretation | Partially automatic | While processing the root node, the client checks for a retention policy via `tree:viewDescription`. |
| LDES10-RET-005 | [4.4][retention] | MUST | Client | Retention interpretation | Partially automatic | If the retention-policy IRI has no statements in the current page, the client assumes the view retains no members. |
| LDES10-RET-006 | [4.4][retention] | MUST | Consumer | Retention interpretation | Boundary review | Time-based retention calculations include a safe clock-skew buffer. |
| LDES10-RET-007 | [4.4][retention] | Algorithm detail | Consumer | Retention interpretation | Boundary review | When `ldes:versionTimestampPath` is set, version durations are evaluated against that timestamp. |
| LDES10-RET-008 | [4.4][retention] | MUST | Consumer | Retention interpretation | Boundary review | Historical retention policy types remain supported. |

## Boundary Review Items

The following rows are deliberately not baseline traversal requirements until
the project decides how far a conformance claim for "LDES client" extends into
the broader consumer pipeline:

- `LDES10-PIPE-001`: downstream commit behavior.
- `LDES10-CTX-010` through `LDES10-CTX-015`: chronological interpretation,
  SHACL validation, version selection, and update/delete payload recovery.
- `LDES10-RET-001` through `LDES10-RET-008`: retention interpretation.

## Derived Test Scenarios Outside The Main-Spec Count

These scenarios should be implemented because they exercise main-spec
requirements under realistic publication changes, but their motivating text is
outside the dated main specification.

| Scenario | Source | Main-spec obligations exercised |
| --- | --- | --- |
| Rebalanced immutable pages redirect to a merged page | [Server Primer 5.2][server-rebalance] | Redirect following, deduplication, resume, immutable-node behavior |
| Old rebalanced pages become `410 Gone` | [Server Primer 5.2][server-rebalance] | `410 Gone`, frontier handling, completion signaling |
| Immutable RDF metadata and `Cache-Control: immutable` disagree | [3.2][state], [3.3][http] | Immutability check order, request evidence, advisory scoring |

## Testability Rules

- `Automatic`: a scenario server, request log, adapter event stream, and oracle
  can decide the result.
- `Partially automatic`: an adapter-exposed callback, declared capability, or
  context/statistics event is required.
- `Boundary review`: the statement appears in the main spec, but the subject is
  a consumer, processor, or downstream pipeline rather than the traversal
  client alone.
- `Informational`: the statement defines optional extension space or capability
  metadata and should not affect baseline scoring.

## Proposed Stable ID Families

| Prefix | Area |
| --- | --- |
| `LDES10-UNORD` | unordered traversal, lifecycle, state, HTTP, and synchronization |
| `LDES10-EXTRACT` | member discovery and RDF dataset extraction |
| `LDES10-ORD` | ordered ascending traversal |
| `LDES10-CTX` | context extraction and communication |
| `LDES10-RET` | retention-policy interpretation subclaim |
| `LDES10-PIPE` | downstream consumer pipeline behavior |

[spec]: https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/
[sync]: https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/#synchronization-algorithm
[init]: https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/#initialization
[state]: https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/#state-management
[http]: https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/#http-requests-responses
[members]: https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/#members
[unordered]: https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/#unordered-traversal
[ordered]: https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/#ordered-traversal
[context]: https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/#context-information
[chrono]: https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/#chronological-order
[shape]: https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/#shape
[versions]: https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/#versions-transactions
[retention]: https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/#retention
[server-rebalance]: https://semiceu.github.io/LinkedDataEventStreams/releases/1.0.0/server-primer.html#rebalancing
