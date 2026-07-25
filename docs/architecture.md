# Architecture

## Boundary

The system under test is an LDES client plus only the minimum client-specific
adapter needed to observe it. The suite owns the HTTP origin, test data,
execution lifecycle, oracle, and reports.

The test is black-box with respect to the client: assertions may use network
traffic, emitted data, documented output callbacks, process results, and state
survival, but not private classes or internal database tables. An adapter may
use a public library API when the client has no CLI.

## Components

### Requirement catalog

The catalog maps normative clauses to stable requirement IRIs and compliance
groups. It drives coverage reporting and prevents test names from becoming an
accidental second specification.

### Test manifest

The RDF manifest gives an atomic test a stable identity and links it to its
requirement, scenario, oracle, level, and compliance group. RDF is canonical
metadata; YAML is used only for concise scenario scripting.

### Scenario server

The server binds to loopback on an ephemeral port. A scenario describes routes
as sequences of responses so one resource can change across retries or
synchronization runs. The server records every request before responding.

### Adapter

The adapter starts a native CLI, embeds a library, or controls a container. It
normalizes observable behavior into events but does not decide whether the
client passed. Its protocol is specified in `adapter-contract.md`.

### Oracle

The oracle combines adapter events with the server request log. RDF content is
compared as datasets; other assertions use typed matchers for event order,
headers, request counts, errors, completion, and elapsed virtual time.

### Reporter

The reporter converts oracle results to EARL and links bounded evidence. A
human summary is derived from the same results.

## Execution lifecycle

1. Validate suite, test manifest, scenario, and adapter declaration.
2. Allocate isolated temporary state and evidence directories.
3. Start the scenario server and resolve URI templates.
4. Probe the adapter and determine applicable groups and subclaims.
5. Run one or more scripted synchronization phases.
6. Collect events, requests, exit status, stderr, and state metadata.
7. Stop all processes before evaluating the result.
8. Run the oracle and classify infrastructure uncertainty as `cantTell`.
9. Write evidence and one EARL assertion.
10. Remove transient resources unless evidence retention was requested.

## Important separations

- A scenario describes server behavior; an oracle describes what the client
  must do.
- An adapter reports facts; it never emits pass/fail.
- Requirement coverage and client result coverage are different reports.
- A `SHOULD` failure is visible but is not a `MUST` failure.
- Capability discovery selects applicable groups and subclaims; it does not
  award a pass.
- Ordered traversal is a superset claim. It cannot pass unless unordered
  traversal also passes.
- Member extraction is kept separate from traversal so clients can expose
  parser/extractor defects distinctly from queue or HTTP defects.
- Retention-policy interpretation is kept separate from context extraction
  until the requirement inventory review confirms which consumer clauses apply
  to every client.
- Client extensions may have their own manifests but cannot alter normative
  fixtures or baseline scoring.

## Determinism and security

Fixtures must not make outbound network calls. The server listens on loopback,
rejects unexpected host/path combinations, caps requests and body sizes, and
uses deadlines. Adapter commands are configured as argument arrays rather than
shell strings. Each test gets its own state directory and, for container
adapters, isolated storage and networking.
