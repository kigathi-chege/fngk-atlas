# FNGK Atlas

FNGK Atlas is a local, interactive program observatory. It maps repositories, packages, modules, functions, calls, dependency manifests, local processes, and live FNGK resources without editing the inspected project.

## Run

```bash
cd /workspace/fngk-atlas
npm install
npm start
```

Open <http://127.0.0.1:4317>. Set `ATLAS_PORT`, `ATLAS_HOST`, or `ATLAS_DB` to override the port, bind address, or metadata database. The normal non-container launch stays loopback-only; the included container image sets `DOCKER_CONTAINER=1` and listens on `0.0.0.0` inside the container.

From Docker, publish the service port to the host:

```bash
docker build -t fngk-atlas .
docker run --rm -p 127.0.0.1:4317:4317 -v "$PWD/.atlas:/app/.atlas" fngk-atlas
```

Or use `docker compose up --build`, then open <http://localhost:4317> on the host browser. Publishing a port is required; binding inside the container alone does not expose it to the host.

## Analysis model

- TypeScript/JavaScript/Svelte use the TypeScript compiler AST.
- Python uses its standard AST in an external parser process.
- Go and PHP currently receive structural function analysis; their analyzer boundary is ready for compiler-grade enrichers.
- npm, Composer, Go module, and Python manifests become package/dependency nodes.
- `/proc` observations associate visible local processes with an indexed repository and record the evidence source separately from static facts.

Double-click a module to add or remove its functions from the dependency map. The Functions tab retains the complete loaded inventory and sorts complexity hotspots first.

## FNGK connection

The Connect dialog accepts the value of a valid `__Host-signal_session` cookie. It is held only in the Node process and is not stored in SQLite, browser storage, logs, or deployment metadata. The local service requests FNGK summary and cursor-paged graph data, then adds deployments, devices, adapters, and resources to the map.

## Execution boundary

Eligible exported JavaScript functions run through an external harness using Node's permission model. The indexed tree is read-only, writes are limited to a temporary directory, and network and child-process access are denied. Every run requires explicit consent. Python and other runtime execution remains unavailable until a disposable container provider is configured; Atlas never silently falls back to an unsandboxed run.

Atlas labels process association, sampled/observed evidence, and Atlas-initiated runs as different facts. A running process is never presented as proof that every contained function is executing.
