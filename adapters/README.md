# Client Adapters

Adapters translate a client's native interface into the suite's event protocol.
They do not contain test expectations or compensate for missing client
behavior.

Implemented packages:

```text
adapters/
├── rdf-connect/
├── openldes-ldi/
└── europeana/
```

Each directory contains a machine-readable declaration and executable process
adapter. The rdf-connect adapter loads the library build directly and
maps bounded `followForMs` input to its native polling stream.
OpenLDES and Europeana include shaded Java host projects and build scripts.

Build the clients (latest default-branch head; the adapter reports the
checkout's git revision in its probe) and adapters with Node.js, Maven, and JDK 21:

```sh
npm --prefix .clients/rdf-connect ci
npm --prefix .clients/rdf-connect run build
adapters/openldes-ldi/build.sh
adapters/europeana/build.sh
```

The Europeana host compiles the upstream traversal sources directly and excludes
unrelated demo packages. This avoids the upstream POM's unavailable private
snapshot dependency while preserving the client algorithm under test.
OpenLDES is adapted from its continuous polling API to one controlled
synchronization run: each node is fetched once per runner phase and native
next-visit sleeps are bypassed because the fixture phase is advanced
explicitly by the runner.

Environment variables:

- `LDES_CT_RDF_CONNECT_ROOT`: built rdf-connect checkout containing
  `dist/lib/client.js`;
- `LDES_CT_OPENLDES_ROOT`: OpenLDES checkout used by `build.sh`;
- `LDES_CT_OPENLDES_ADAPTER_JAR`: optional prebuilt host JAR override;
- `LDES_CT_EUROPEANA_ROOT`: Europeana checkout used by `build.sh`;
- `LDES_CT_EUROPEANA_ADAPTER_JAR`: optional prebuilt host JAR override;
- `LDES_CT_MAVEN_REPO`: writable Maven repository path (defaults to
  `.cache/maven` in the suite checkout);

Every adapter sends protocol events only to stdout and redirects client logs to
stderr. Bounded stderr diagnostics are retained with an error event. Missing
runtimes are reported by `probe` and become `earl:cantTell`.
See `docs/adapter-contract.md`.
