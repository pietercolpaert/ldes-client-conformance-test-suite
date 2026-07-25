# Test Authoring

Each leaf directory is one atomic test case:

```text
tests/<area>/<case>/
├── manifest.ttl
├── scenario.yaml
├── responses/
└── expected/
```

## Review checklist

- The test links to one stable requirement ID and an exact specification
  section.
- The scenario isolates one reason to fail.
- All HTTP behavior is explicit, including media type and relevant headers.
- RDF expected values use N-Quads and are compared as datasets.
- Blank-node labels are never treated as stable identifiers.
- The fixture includes enough unrelated or adversarial data to reject a naive
  implementation.
- Multi-run tests state exactly when server state changes and when the client
  is restarted.
- Applicable compliance group, subclaim, and requirement level are explicit.
- The expected result is independent of a particular candidate client.
- Fixture provenance and license are recorded if data is not authored here.

The `discovery/root-entrypoint` directory is illustrative. Its vocabulary and
scenario keys may change when the runner is implemented.
