# FNGK-Native Atlas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Atlas workbench that inherits the installed FNGK context, explores every effectively reachable host, edits and operates live resources, and connects runtime/code/coverage evidence in readable semantic graphs.

**Architecture:** Signal gains two generic, versioned CLI automation contracts: secret-free namespace JSON and JSONL terminal transport. Atlas invokes that CLI, resolves direct/adapter/terminal routes into one evidence model, persists derived metadata in SQLite, and presents it through a Svelte/Dockview workbench.

**Tech Stack:** Go CLI, Node.js 22+, TypeScript, Fastify, Svelte 5, Vite, Dockview, CodeMirror 6, Cytoscape with deterministic layered layout, PTY emulator, SQLite, Vitest/node:test, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-12-fngk-native-atlas-design.md`

## Global Constraints

- Atlas is its own repository; Signal changes are generic FNGK capabilities, never Atlas-specific endpoints or credential bridges.
- Atlas never reads or persists FNGK credentials and removes the cookie/base-URL/team-ID connection flow.
- Effective terminal authority may exceed adapter bindings; Atlas must use it and label route, Device, identity, privilege, freshness, and errors.
- Discovery creates no remote helper files and persists no raw secret values or full host-file mirror.
- Existing interactive FNGK behavior remains compatible.
- New behavior follows strict red-green-refactor TDD and each task ends with its focused and regression suites green.

---

### Task 1: Versioned FNGK namespace JSON

**Files:**
- Modify: `/workspace/signal-atlas-fngk/cli/main.go`
- Modify: `/workspace/signal-atlas-fngk/cli/fngk_entry.go`
- Modify: `/workspace/signal-atlas-fngk/cli/main_test.go`
- Create: `/workspace/signal-atlas-fngk/cli/automation.go`
- Create: `/workspace/signal-atlas-fngk/cli/automation_test.go`

**Interfaces:**
- Produces: `fngk status --json [--profile NAME]` JSON object `{protocolVersion:"fngk.namespace.v1", generatedAt, profile:{name}, devices, connections, sessions}`.
- Guarantees: no credential, ticket, cookie, authorization header, or config path appears in output; human `status` output is unchanged without `--json`.

- [ ] Write table-driven Go tests with literal namespace fixtures for JSON shape, target/filter behavior, empty namespace, operator-login errors, and secret-field absence.
- [ ] Run `go test ./...` in the CLI module and confirm failures are caused by the missing JSON mode.
- [ ] Extract namespace retrieval from presentation, add typed automation views and a single JSON encoder path, and route `--json` without altering default text presentation.
- [ ] Run focused tests, the complete CLI Go suite, and existing Signal unit tests.
- [ ] Commit the Signal task.

### Task 2: Generic FNGK stdio JSON terminal

**Files:**
- Modify: `/workspace/signal-atlas-fngk/cli/main.go`
- Modify: `/workspace/signal-atlas-fngk/cli/fngk_entry.go`
- Modify: `/workspace/signal-atlas-fngk/cli/automation.go`
- Modify: `/workspace/signal-atlas-fngk/cli/automation_test.go`
- Modify: `/workspace/signal-atlas-fngk/tests/integration/app.test.ts`

**Interfaces:**
- Produces: `fngk <target> [--new] [--session ID] --stdio-json` using JSONL protocol `fngk.terminal.v1`.
- Browser/backend input messages: `input`, `command`, `resize`, `interrupt`, `mode`, `control_request`, `control_resolve`, `nested_approval_resolve`, `detach`, and `stop` with request IDs where applicable.
- Output messages: `ready`, `replay`, `output`, `input_ack`, `command_state`, `collaboration`, `approval`, `error`, `exit`, and `detached`; binary terminal bytes remain base64.

- [ ] Write Go protocol tests against an in-process WebSocket fixture for framing, malformed input, ordered output, exact command completion/exit code, raw Ctrl+C, resize, detach, and nested approval.
- [ ] Run focused tests and confirm the missing stdio mode produces the expected failures.
- [ ] Refactor terminal socket handling behind a transport-neutral session, implement JSONL stdin/stdout transport, map command messages to the existing queue/completion protocol, and keep stderr free of secrets.
- [ ] Add an integration test proving the existing server terminal socket accepts the automation sequence and produces bounded command output evidence.
- [ ] Run CLI Go, Signal unit, and targeted integration tests; verify ordinary interactive help and terminal flags remain unchanged.
- [ ] Commit the Signal task.

### Task 3: Atlas TypeScript service foundation and FNGK client

**Files:**
- Replace the current JavaScript server modules under `src/` with focused TypeScript modules under `src/server/` and `src/domain/`.
- Create: `src/fngk/process-client.ts`, `src/fngk/namespace.ts`, `src/fngk/terminal-session.ts`, `src/fngk/protocol.ts`.
- Create: corresponding tests under `test/fngk/` and `test/server/`.
- Modify: `package.json`, `tsconfig.json`, Vite/Vitest configuration, Docker/Compose launch files.

**Interfaces:**
- `FngkProcessClient.probe(): Promise<FngkContextState>` reports binary/version/protocol/profile/daemon/login states without reading config.
- `namespace(): Promise<NamespaceSnapshot>` consumes `fngk.namespace.v1`.
- `openTerminal(target, options): TerminalSession` consumes `fngk.terminal.v1`, exposing typed events and `sendInput`, `sendCommand`, `resize`, `interrupt`, `approve`, `detach`, and `stop`.
- Atlas browser APIs expose context/namespace state and a WebSocket terminal relay without credentials.

- [ ] Write failing Vitest tests using executable fixture scripts that behave like real CLI processes; assert argv, JSON parsing, streaming/backpressure, cancellation, timeout, restart, redaction, and unsupported protocol/version states.
- [ ] Run focused tests and confirm failures reflect the absent TypeScript client.
- [ ] Introduce the TypeScript build/test foundation and implement the minimal process client, state service, Fastify routes, and terminal relay.
- [ ] Remove the old ephemeral-cookie `FngkConnections` flow and manual root/deployment endpoints after compatibility tests cover their replacement.
- [ ] Add a confirmed guided-update operation that runs `fngk update`, streams output, re-probes, and never auto-updates.
- [ ] Run focused tests, all Atlas unit tests, typecheck, and production build.
- [ ] Commit the Atlas task.

### Task 4: Effective-host discovery, filesystem, and evidence store

**Files:**
- Create focused modules under `src/discovery/`, `src/transports/`, `src/files/`, and `src/store/`.
- Create OS/shell fixtures and tests under `test/discovery/`, `test/transports/`, and `test/files/`.
- Replace the v1 single-root store schema with migrations for Devices, contexts, entities, relationships, observations, scans, file fingerprints, and operations.

**Interfaces:**
- `AccessRoute` identifies `direct`, `adapter`, or `terminal` and carries Device/context/effective-identity evidence.
- `OperationResolver.resolve(target, operation): ResolvedRoute[]` orders viable routes without treating adapter grants as a global ceiling.
- `HostDiscovery.scan(context, signal): AsyncIterable<DiscoveryBatch>` yields bounded machine/repository/runtime facts and partial failures.
- `FileService.list/stat/read/write` provides one paged logical filesystem, on-demand content, and atomic fingerprint-checked saves.

- [ ] Write failing tests for route preference/fallback, Linux/macOS shell quoting, framed parsing, cancellation/rate limits, virtual-tree avoidance, secret redaction, paging, binary/large-file behavior, symlinks, permission errors, atomic save cleanup, and stale conflicts.
- [ ] Run focused tests and confirm the missing services fail for the intended reasons.
- [ ] Implement direct-local and terminal command transports with no discovery helper artifacts; add adapter evidence ingestion without making bindings authoritative over other routes.
- [ ] Implement staged census and lazy repository discovery, provenance/freshness tracking, incremental invalidation, and SQLite migrations.
- [ ] Implement file APIs and WebSocket scan progress; ensure file bodies remain outside persistent storage.
- [ ] Run focused tests, all Atlas tests, typecheck, and build.
- [ ] Commit the Atlas task.

### Task 5: Code, coverage, CRAP, and runtime correlation

**Files:**
- Refactor analyzers into typed modules under `src/analysis/` while preserving stable symbol identifiers.
- Create coverage readers under `src/coverage/` and correlation services under `src/correlation/`.
- Create fixtures/tests under `test/analysis/`, `test/coverage/`, and `test/correlation/`.

**Interfaces:**
- `analyzeRepository(repository, fileSource, signal): AsyncIterable<AnalysisBatch>` emits packages, modules, functions, imports, calls, tests, and complexity.
- `CoverageEvidence` normalizes LCOV, Cobertura, coverage.py, and Go artifacts with revision/path provenance.
- `crap(complexity, coverageFraction)` returns `complexity ** 2 * (1 - coverageFraction) ** 3 + complexity`; unmatched coverage returns no CRAP value.
- Correlation links processes/containers/services/executables/cwds/open files/ports to repositories/modules/functions with confidence and evidence.

- [ ] Write failing literal-fixture tests for every existing language analyzer, stable IDs, coverage formats/path remapping, stale revision detection, hand-calculated CRAP values, and runtime-to-code evidence.
- [ ] Run focused tests and verify the new normalized contracts are absent.
- [ ] Port and split the existing analyzer, add coverage normalization and CRAP, and implement evidence-based runtime correlation without unsupported semantic claims.
- [ ] Add explicit terminal-backed coverage refresh operations using detected project commands and streamed logs.
- [ ] Run focused tests, mutation-check CRAP/coverage expectations, all Atlas tests, typecheck, and build.
- [ ] Commit the Atlas task.

### Task 6: Svelte Dockview Atlas workbench

**Files:**
- Replace `public/` application logic with a Vite/Svelte app under `src/web/`.
- Create focused workbench, navigator, filesystem, editor, terminal, graph-lens, metrics, activity, and state modules/components.
- Reuse/adapt the Signal Dockview, CodeMirror, file-transfer, and terminal interaction patterns without importing Signal runtime code.
- Add component and browser tests under `test/web/` and `e2e/`.

**Interfaces:**
- Default layout: left Atlas navigator, central Dockview, right effective-filesystem explorer, bottom activity/status.
- Panels: graph, file editor, terminal, process/log, function metrics, coverage, diff, and operation output.
- Graph API accepts lens/root/layers/expansion/focus and returns deterministic bounded nodes, aggregate expansion nodes, SCC groups, edges, breadcrumbs, and counts.

- [ ] Write failing component tests for persisted Dockview descriptors, shared selection, dirty editors, save/conflict flows, file paging, terminal controls, graph node budgets/layers/SCC aggregation, and source-span navigation.
- [ ] Run component tests and confirm failures come from the absent Svelte workbench.
- [ ] Implement the Svelte shell and Dockview model, then CodeMirror editors and the always-present right filesystem tree.
- [ ] Implement the Atlas-themed PTY panel with ANSI, resize, raw input, Ctrl+C, command lifecycle, replay, approvals, attach/detach, stop/restart, and context metadata.
- [ ] Implement World, Machine, Code, Function, and Execution graph lenses with deterministic layered layout, minimap, breadcrumbs/history, focus, expansion, saved positions, and switchable edge layers.
- [ ] Add Playwright tests for default/responsive layout, graph readability budgets, linked selection, multi-file edits, terminal streaming/interrupt, reconnect/stale states, and zero console errors.
- [ ] Run unit/component tests, typecheck, production build, and browser suite.
- [ ] Commit the Atlas task.

### Task 7: Disposable live integration, packaging, and host update handoff

**Files:**
- Create a disposable integration harness under `test/integration/` and `scripts/` in Atlas.
- Update Atlas Docker/Compose files and README/operator documentation.
- Modify Signal release/install documentation or scripts only where the generic new CLI protocol requires it.

**Interfaces:**
- One command builds exact-head FNGK, starts the terminal-enabled Signal test stack, pairs/logs in a disposable Device, starts daemon/adapters, launches Atlas, runs acceptance probes, and tears down its own named resources.
- Host handoff documents build/install, daemon convergence, `fngk update`, verification, rollback, and Atlas launch without performing host/production mutation automatically.

- [ ] Write a failing end-to-end acceptance test that asserts namespace discovery, root-terminal discovery beyond Files, no helper artifacts, editor conflict-safe save, process-to-code link, terminal run/interrupt, coverage/CRAP, and disconnect/reconnect.
- [ ] Run it and confirm failure at the first missing integration boundary.
- [ ] Implement the isolated Compose/harness fixtures, exact-head CLI artifact flow, deterministic seed/pair/login setup, readiness checks, teardown traps, and captured evidence bundle.
- [ ] Add package/install/upgrade/rollback documentation and guided compatibility messaging.
- [ ] Run the complete Signal CLI/unit/targeted integration suites, Atlas unit/type/build/browser suites, live acceptance, npm audit report, and secret/artifact scan.
- [ ] Commit both repositories and request a final cross-repository code review before branch handoff.
