# Initial Client Landscape

This snapshot records why the adapter boundary exists. It was prepared on
2026-07-25 from shallow checkouts of the default branches at the revisions
below. It is not a conformance assessment.

| Client | Reviewed revision | Relevant observable surface |
| --- | --- | --- |
| [OpenLDES Linked Data Interactions][openldes] | `52b1feb8ac8f0da77e9e353d4b1dac664857d612` | Java modules for starting-node discovery, node fetching, relation discovery, member supply, filtering, and in-memory/SQL state |
| [rdf-connect/ldes-client][rdf-connect] | `00b062d3c4e4c31d99ff38ce985df44c389e2952` | npm library, RDF-Connect processor, and `ldes-client` CLI; saved state and explicit replicate/follow/ordering options |
| [lblod/ldes-client][lblod] | `dc4caff693066cd0122adf964bf9df0d9f029fc7` | Scheduled TypeScript service using working, batch, target, and status graphs; completion hook and persistent JSON state |
| [europeana/rd-ldes-client][europeana] | `878578e732f5c289facc74f90339ca09ad8f3f9e` | Experimental Java library with `TreeTraversal`, timestamp-ordered traversal, `ActivityHandler` callbacks, and crawl reports |

## Adapter implications

- A process-only protocol is not sufficient: OpenLDES and Europeana need small
  Java hosts around public library APIs.
- Member output is not always a stream on stdout: lblod's observable result is
  primarily RDF store state.
- Completion has native representations worth preserving: an RDF-Connect
  stream end, lblod's stream-end hook, Europeana's `crawlEnd`, or the LDI
  pipeline lifecycle.
- State must remain client-owned. The adapter can mount or configure a state
  location, but must not add its own deduplication or bookmark algorithm.
- Advanced functionality exposed by one client does not define the test
  catalog. Tests continue to originate from the specification.

Before implementing an adapter, repeat this review against a released artifact
or newly pinned revision and record build/runtime prerequisites in the adapter
declaration.

[openldes]: https://github.com/OpenLDES/Linked-Data-Interactions/tree/main/ldi-core/ldes-client
[rdf-connect]: https://github.com/rdf-connect/ldes-client
[lblod]: https://github.com/lblod/ldes-client
[europeana]: https://github.com/europeana/rd-ldes-client
