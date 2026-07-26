# Adapter Contract

The adapter contract lets the same tests drive a CLI, an embedded library, or
a service. This document is the proposed v0 contract; schemas in `schemas/`
are authoritative once implementation begins.

## Operations

Every adapter must provide:

- `probe`: report client identity, version, supported modes, and observable
  capabilities without starting a test;
- `run`: perform one synchronization run against the supplied entry-point IRI,
  or a bounded follow-mode window when requested;
- `reset`: remove only the adapter-owned state for the current test.

The runner invokes the declared command directly with an argument array and
appends the operation name (`probe`, `run`, or `reset`). The working
directory, environment allow-list, timeout, and container configuration belong
to the adapter declaration.

## Run input

`run` receives a JSON document on standard input:

```json
{
  "protocolVersion": 0,
  "runId": "run-2",
  "entrypoint": "http://127.0.0.1:49152/entry",
  "mode": "unordered",
  "stateDirectory": "/tmp/ldes-ct/case/state",
  "phase": "updated",
  "concurrency": 10,
  "followForMs": 1500,
  "deadline": "2026-07-25T10:05:00Z"
}
```

The entry point is the only required client argument. Mode and state options
configure how a declared client feature is exposed; they are not additional
inputs to the LDES algorithm. The optional `concurrency` field is a harness
hint: adapters should apply it when the client exposes a fetch-concurrency
setting, and may ignore it when the client is inherently sequential.
The optional `followForMs` field asks an adapter that declares the `polling`
capability to keep the client in autonomous follow mode for that bounded
duration. The adapter must stop the client cleanly and still emit exactly one
terminal event.

## Event output

Standard output is UTF-8 NDJSON, one event per line. Logs go to standard error.
Every event contains `protocolVersion`, `type`, and `runId`.

Member:

```json
{"protocolVersion":0,"type":"member","runId":"run-2","id":"https://raw.githubusercontent.com/pietercolpaert/ldes-client-conformance-test-suite/main/tests/1.0/discovery/root-entrypoint/responses/root.ttl#member/1","dataset":"<https://raw.githubusercontent.com/pietercolpaert/ldes-client-conformance-test-suite/main/tests/1.0/discovery/root-entrypoint/responses/root.ttl#member/1> <https://raw.githubusercontent.com/pietercolpaert/ldes-client-conformance-test-suite/main/tests/1.0/discovery/root-entrypoint/responses/root.ttl#vocab/value> \"one\" .\n","mediaType":"application/n-quads"}
```

Context:

```json
{"protocolVersion":0,"type":"context","runId":"run-2","eventStream":"https://raw.githubusercontent.com/pietercolpaert/ldes-client-conformance-test-suite/main/tests/1.0/discovery/root-entrypoint/responses/root.ttl#stream","rootNode":"http://127.0.0.1:49152/root","dataset":"...","mediaType":"application/n-quads"}
```

Statistics:

```json
{"protocolVersion":0,"type":"statistics","runId":"run-2","membersEmitted":1,"lastRun":"2026-07-25T10:04:30Z"}
```

Completion:

```json
{"protocolVersion":0,"type":"run-end","runId":"run-2","status":"completed"}
```

Client error:

```json
{"protocolVersion":0,"type":"error","runId":"run-2","kind":"client","message":"Multiple tree:view matches"}
```

The runner adds sequence numbers and receipt timestamps. Adapters must preserve
native member emission order and emit exactly one terminal `run-end` or
`error`. Unknown event fields are allowed for forward compatibility; unknown
event types are a protocol error.

## Failure attribution

- A valid `error` event caused by the fixture is observable client behavior and
  may satisfy or fail an oracle.
- A crash, timeout inside the adapter, invalid NDJSON, missing terminal event,
  or adapter setup failure produces `earl:cantTell`.
- A client process crash that the adapter reliably attributes to the client is
  a client error and includes captured exit metadata.
- Adapter logs and secrets must not appear in EARL; sanitized evidence may be
  linked separately.

## State and restart

The runner owns the state directory and reuses it only for phases of the same
test. The adapter must map it to the client's supported persistence mechanism.
If a client cannot persist state, the adapter declares that limitation and the
relevant resume tests still run or are marked according to the conformance
rules; the adapter must not emulate client state to make the client pass.

## Adapter declarations

An adapter declaration must pin:

- adapter ID and revision;
- client name, source/artifact URI, and exact revision or digest;
- operation commands;
- supported modes;
- observable context/statistics capabilities;
- autonomous polling capability;
- runtime requirements;
- cleanup guarantees.

Contract tests will use a fake client to ensure the adapter does not reorder
members, hide errors, synthesize context, or retain state across test cases.
