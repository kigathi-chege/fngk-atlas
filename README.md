# FNGK Atlas

FNGK Atlas is a local, interactive program observatory. It maps repositories, packages, modules, functions, calls, dependency manifests, local processes, and live FNGK resources without editing the inspected project.

Atlas uses the installed `fngk` process and its current profile. It never asks for or stores a Signal session cookie, operator credential, team ID, or deployment URL. This branch requires an FNGK build that supports `fngk status --json` and `fngk <target> --stdio-json`.

## Run

```bash
cd /workspace/fngk-atlas
npm install
npm run build
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

The Svelte workbench uses independent Dockview areas for graph/editor/metrics documents and terminal/activity panels. The right explorer always represents the selected effective filesystem and labels the route, identity, and privilege. Single-click files reuse a preview tab; double-click or the first edit pins it. Saves are fingerprint-checked and surface host conflicts instead of overwriting them.

World, Machine, Code, Function, and Execution lenses apply deterministic node budgets and collapse import cycles. Double-click a source-backed node to open its exact span. The metrics view reports complexity, verified coverage, and CRAP without inventing values for missing or stale reports.

## FNGK process context

Atlas discovers the executable from `FNGK_BIN` or `PATH`, calls the versioned secret-free namespace command, and starts normal FNGK terminals through the JSONL mode. Authentication, terminal tickets, and profile storage remain inside FNGK. If the installed CLI is incompatible, Atlas exposes a confirmed, streamed update operation and probes again after installation.

## Execution boundary

Eligible exported JavaScript functions run through an external harness using Node's permission model. The indexed tree is read-only, writes are limited to a temporary directory, and network and child-process access are denied. Every run requires explicit consent. Python and other runtime execution remains unavailable until a disposable container provider is configured; Atlas never silently falls back to an unsandboxed run.

Atlas labels process association, sampled/observed evidence, and Atlas-initiated runs as different facts. A running process is never presented as proof that every contained function is executing.

## Verify

```bash
npm test
npm run typecheck
npm run check:web
npm run build
npm run test:e2e
```

The browser suite builds the web assets, launches a disposable fixture server and FNGK process, and checks Dockview restoration, responsive layout, safe text/binary editing behavior, JSONL terminal input, and console errors.
