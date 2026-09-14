# Atlas interpreters and Device adapters

Atlas separates facts from meaning. Existing repository indexes, terminal discovery, native FNGK resources, database discovery, processes, ports, files, and run evidence remain factual inputs. Interpreters add evidence-backed semantic entities and assertions without replacing those inputs.

## Extension tiers

### Data-only interpreter

An `atlas.interpreter.v1` manifest is declarative JSON. It can match bounded input records, emit entities and assertions, assign confidence and classification, and declare Inspector views. It cannot execute code or commands.

Use the included example:

```bash
npm run interpreter:validate -- examples/interpreters/postgresql/interpreter.json
npm run interpreter:test -- examples/interpreters/postgresql/interpreter.json examples/interpreters/postgresql/fixture.json
npm run interpreter:explain -- examples/interpreters/postgresql/interpreter.json
```

Set `ATLAS_INTERPRETER_DEV_DIR` to a directory of manifests while developing. Development packages are disabled when `NODE_ENV=production` and appear as untrusted in the registry.

For production, `ATLAS_INTERPRETER_DIR` must contain signed envelopes:

```json
{ "manifest": { "protocolVersion": "atlas.interpreter.v1" }, "signature": "BASE64_ED25519_SIGNATURE" }
```

`ATLAS_INTERPRETER_TRUST` is a JSON map from publisher name to a base64 DER/SPKI Ed25519 public key. Atlas verifies the signature over the recursively key-sorted JSON manifest. Invalid packages are visible through `GET /api/atlas/interpreters` but never run.

### Executable Device adapter

An `atlas.device-adapter.v1` package is for evidence that requires a Device command. Its command must write one JSON object per line:

```json
{"kind":"process","label":"postgres","sourceId":"pid:42","attributes":{"engine":"postgres"}}
```

Adapters are never run during page load, graph navigation, or search. The user must explicitly invoke `POST /api/atlas/device-adapters/:id/run` with `{"contextId":"device:…","confirm":true}`. Atlas uses the selected context's command route, which is terminal-first for remote Devices, applies a 30-second/4-MiB/5,000-record hard ceiling, validates every JSONL record, and then passes the safe records to the embedded data-only interpreter. Adapter output is metadata; commands must not emit credentials or file bodies.

Development packages use `ATLAS_DEVICE_ADAPTER_DEV_DIR`. Signed production packages use `ATLAS_DEVICE_ADAPTER_DIR` and the same publisher trust map. Registry state is available at `GET /api/atlas/device-adapters`.

## Declarative detail views

`views` let an interpreter specialize the Inspector without shipping Svelte code. A view identifies applicable entity kinds and ordered sections:

- `properties` and `metrics`: selected attribute fields
- `relationships`: optionally filtered by predicate
- `hierarchy`: parent/workload context
- `timeline`: retained changes
- `evidence`: provenance, classification, confidence, and explanation
- `documentation`: safe metadata references

Atlas retains a generic Inspector when no specialized view applies. Views cannot add scripts, HTML, network requests, or privileged actions.

## Canonical guarantees

- Stable IDs derive from context, namespace, kind, and source key.
- Assertions retain interpreter ID/version, evidence references, time, classification, confidence, and staleness.
- Conflicting assertions coexist; an interpreter cannot silently overwrite another publisher's conclusion.
- Changes and observations are locally bounded to seven days and 25,000 change records per context.
- Calculator receives bounded safe graph context and has explanation-only authority. It cannot write canonical graph facts.
- Recomputing the same inputs is idempotent. Removed conclusions are recorded as withdrawn.

The core ontology is intentionally small: Device, environment, workload, capability, runtime unit, interface, data, identity, software/code, resource, and event. Specialized vocabulary belongs in namespaced interpreter output, while shared relationships should reuse predicates such as `contains`, `realizes`, `provides-capability`, `consumes-capability`, `depends-on`, `listens-on`, `reads`, `writes`, and `controlled-by`.
