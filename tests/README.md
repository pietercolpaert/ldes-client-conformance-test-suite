# Test Authoring

Each leaf directory is one atomic test case. Tests are nested below the LDES
release they target so future 2.0 work does not change 1.0 test identities:

```text
tests/<version>/<area>/<case>/
├── manifest.ttl
├── scenario.yaml
├── responses/
└── expected/
```

Every LDES 1.0 manifest uses the public base IRI
`https://www.pieter.pm/ldes-client-conformance-test-suite/1.0#`. The fragment
is derived from `<area>-<case>`, for example
`https://www.pieter.pm/ldes-client-conformance-test-suite/1.0#unordered-cache-state`.
The generated report at `site/1.0/index.html` contains matching HTML anchors,
so those IRIs are dereferenceable once the site is published.

## Review checklist

- The test links to every stable requirement ID it materially discriminates
  and to the exact specification section.
- The scenario isolates one reason to fail.
- All HTTP behavior is explicit, including media type and relevant headers.
- RDF expected values use N-Quads and are compared as datasets.
- Blank-node labels are never treated as stable identifiers.
- The fixture includes enough unrelated or adversarial data to reject a naive
  implementation.
- Multi-run tests state exactly when server state changes and when the client
  is restarted.
- Applicable compliance group, subclaim, and requirement level are explicit.
- The `earl:TestCase` subject is the public versioned hash IRI, not a
  file-local `<#test>` node.
- The expected result is independent of a particular candidate client.
- Fixture provenance and license are recorded if data is not authored here.

The `1.0/discovery/root-entrypoint` case is the smallest executable example.
Changed semantics must receive a new test IRI; a future LDES release belongs
under its own version directory.

Run `npm run validate:fixtures` to parse every RDF response and expected
dataset. A complete reference run also writes `coverage.json` and
`coverage.md`; its coverage gate fails when an applicable client `MUST` or
`SHOULD` has neither an executable mapping nor an explicit rationale in
`docs/coverage-rationales.json`.
