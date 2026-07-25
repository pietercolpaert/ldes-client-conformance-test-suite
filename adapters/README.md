# Client Adapters

Adapters translate a client's native interface into the suite's event protocol.
They do not contain test expectations or compensate for missing client
behavior.

Planned packages:

```text
adapters/
├── rdf-connect/
├── openldes-ldi/
├── europeana/
└── lblod/
```

Each package will contain an adapter declaration, reproducible build
instructions, source revision lock, contract tests, and any harness code.
See `docs/adapter-contract.md`.
