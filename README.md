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

For a real installed FNGK context, follow [the host handoff](docs/host-handoff.md) and use `npm run start:host`. The launcher refuses to start when `fngk status --json` is unavailable or incompatible, preventing a container-local filesystem from being mistaken for an authenticated FNGK Device.

The database workbench uses the selected Device's native, capability-scoped Surface. Atlas never opens a TCP relay or launches a database sidecar: schema, query, export, backup, and restore operations execute through the adopted database resource and remain in Signal's operation audit. See [the database workbench guide](docs/database-workbench.md).

Live Project runs a chosen repository command in a dedicated, visible FNGK terminal, publishes its selected port through Signal's existing Connection/HKMN path, embeds the result, and offers opt-in Playwright diagnostics. It requires the exact-head `fngk.publish.v1` CLI protocol described in [the live project guide](docs/live-projects.md).

The [deployment workbench](docs/deployments.md) builds immutable Device releases, gates publication on health, retains logs/artifacts/history, governs vanity and verified custom domains, and performs health-safe rollback through Signal's canonical managed-process and deployment protocols.

From Docker, publish the service port to the host:

```bash
docker build -t fngk-atlas .
docker run --rm -p 127.0.0.1:4317:4317 -v "$PWD/.atlas:/app/.atlas" fngk-atlas
```

Or use `docker compose up --build`, then open <http://localhost:4317> on the host browser. Publishing a port is required; binding inside the container alone does not expose it to the host. This generic container does **not** inherit a host FNGK login; the executable, profile, and network route must be mounted/configured explicitly if this non-canonical path is used.

## Analysis model

- TypeScript/JavaScript/Svelte use the TypeScript compiler AST.
- Python uses its standard AST in an external parser process.
- Go and PHP currently receive structural function analysis; their analyzer boundary is ready for compiler-grade enrichers.
- npm, Composer, Go module, and Python manifests become package/dependency nodes.
- `/proc` observations associate visible local processes with an indexed repository and record the evidence source separately from static facts.

The Svelte workbench uses one persisted Dockview layout inside permanent application chrome. The context/activity rail, title search, and pinned/workspace-root rail remain usable even when every Dockview panel has been closed. Navigator and Filesystem open at matching sidebar widths around a wider architecture/editor area; narrow screens transiently collapse those expanded sidebars without overwriting the desktop layout. Tabs have distinct minimize and close actions, minimized panels remain reconstructable, and Dockview's native floating/drop targets remain available from tab context menus.

The title field searches one ranked collection of Atlas evidence, live files, contexts, terminal sessions, and commands. Search defaults to the selected context and preserves provenance on every result. The terminal is created only when requested, reuses one `atlas.terminal` panel, reattaches an existing Device session when possible, and creates a remote session only from the explicit plus action or when none can be reused. Its independently scrollable session list exposes lifecycle state and cleanup actions without opening more tabs.

New files begin as memory-only CodeMirror buffers through New File or `Ctrl/Cmd+N`. Explorer creation inserts an inline filename editor but does not touch the host until the first save. First save and Save As use exclusive creation, so an existing destination produces a conflict without overwriting it. Cancelling Save As removes only its temporary copy buffer; genuine Untitled buffers remain available until saved or deliberately closed. Buffer bodies, terminal output, credentials, and tokens are excluded from persisted layout state. Existing-file saves remain fingerprint-checked and surface host conflicts.

World, Machine, Code, Function, and Execution lenses apply deterministic node budgets and collapse import cycles. Code overview starts at repository/package/module level; double-click drills into a node, while source-backed selections open exact spans. Switchable layers cover containment, package dependencies, imports, calls, inferred HTTP/events/SQL, declared flows, runtime/process links, ports, and coverage. Optional `.atlas/flows.json` nodes and edges supplement conservative inference. The Evidence group exposes function size/complexity, verified coverage, CRAP, problems, and recorded runs without inventing values for missing or stale reports.

## FNGK process context

Atlas discovers the executable from `FNGK_BIN` or `PATH`, calls the versioned secret-free namespace command, and starts normal FNGK terminals through the JSONL mode. Authentication, terminal tickets, and profile storage remain inside FNGK. If the installed CLI is incompatible, Atlas exposes a confirmed, streamed update operation and probes again after installation.

## Execution boundary

Eligible exported JavaScript functions run locally through an external harness using Node's permission model, or on a remote indexed Device through its existing FNGK terminal context. Remote execution creates no helper files and records context, route, revision, output, exit status, and duration. Every run requires explicit consent. Python and other runtime execution remains unavailable until a disposable container provider is configured; Atlas never silently falls back to an unsandboxed run.

Atlas labels process association, sampled/observed evidence, and Atlas-initiated runs as different facts. A running process is never presented as proof that every contained function is executing.

## Verify

```bash
npm test
npm run typecheck
npm run check:web
npm run build
npm run test:e2e
```

The browser suite builds the web assets, launches a disposable fixture server and FNGK process, and checks empty-workspace recovery, persistent rails, minimize/restore/float behavior, unified search, memory-only buffers, exclusive saves, responsive layout, filesystem menus, bounded terminal-session ownership, JSONL terminal input, and console errors.


## UPDATING FNGK

Run this on the host, from the Atlas checkout:

```bash
  cd ~/Projects/signal/fngk-atlas

  npm run build:fngk-head

  mkdir -p /tmp/fngk-atlas-update
  tar -xzf output/fngk-head/fngk_linux_amd64.tar.gz \
    -C /tmp/fngk-atlas-update fngk

  (cd output/fngk-head && sha256sum -c SHA256SUMS)

  /tmp/fngk-atlas-update/fngk version
  type -a fngk
  ```

  Install it into the executable your shell actually uses. Since your ~/.local/bin likely comes first:

```bash
  cp ~/.local/bin/fngk ~/.local/bin/fngk.atlas-backup 2>/dev/null || true
  install -m 0755 /tmp/fngk-atlas-update/fngk ~/.local/bin/fngk
  hash -r
```

  Then converge the user daemon:

```bash
  fngk version
  fngk install --profile local
  fngk status --json --profile local | jq '{profile,devices,connections}'
```

  You should see the updated version and the local Device online. If Atlas is already running, restart it afterward:

```bash
  npm run start:host
```

  Do not run fngk update; that targets released artifacts. The exact-head artifact is the one built by npm run build:fngk-head.

  If type -a fngk shows /usr/local/bin/fngk is the active first entry instead, install there with:

```bash
  sudo cp /usr/local/bin/fngk /usr/local/bin/fngk.atlas-backup
  sudo install -m 0755 /tmp/fngk-atlas-update/fngk /usr/local/bin/fngk
