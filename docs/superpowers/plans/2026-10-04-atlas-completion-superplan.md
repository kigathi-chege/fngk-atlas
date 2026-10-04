# Atlas Completion Superplan

> **For agentic workers:** Use `superpowers:executing-plans` task-by-task. This is the living index for implementation plans; historical plans are evidence, not an unchecked backlog.

**Goal:** Bring FNGK Atlas to a demonstrably reliable, native-feeling, local-first workspace by closing only verified gaps in the current implementation.

**Architecture:** Preserve Fastify, FNGK transports, Dockview, the persistent DeviceSessionManager, and local Atlas event store. Treat the retained workspace shell, device lifecycle, filesystem routes, and operations dock as separate testable boundaries. Convert historical intent into present contracts only after auditing current code and tests.

**Tech stack:** TypeScript, Fastify, Svelte, Dockview, Vitest, Node test runner, Playwright/Tauri where available.

**Authoritative inputs:** `docs/superpowers/specs/2026-10-03-workbench-shell-and-device-identity-design.md`, `docs/superpowers/specs/2026-10-03-atlas-rail-form-system-design.md`, `docs/superpowers/specs/2026-09-29-atlas-calculator-agent-workspace-design.md`, and `docs/superpowers/plans/2026-10-04-atlas-workbench-shell-remaining.md`.

## Audit rules

- Historical unchecked plans are not proof of missing functionality. Verify source, tests, and a representative workflow first.
- A feature is complete only with a focused regression test, whole-suite verification, and (for user-visible desktop behavior) an E2E or manual desktop evidence record.
- A live-device defect may not be papered over with an empty state, retry loop, or changed error copy.
- Atlas-internal sessions must never appear as user terminal history or expose internal command/output data.
- Do not put remote Notify or Calculator producer secrets in the renderer.

## Current baseline (2026-10-04)

- 364 automated tests, web typecheck, and production build pass.
- Retained Devices/Device Details and Filesystem/Inspector regions exist; Workspace fallback, panel collapse, local device colors, local event history, and terminal/filesystem lifecycle events exist.
- The request-abort path that could cancel a shared terminal command is fixed and covered. A live-device verification of the original empty-tree incident remains required before declaring the remote filesystem path fully closed.
- Known integration gap: Notify bridge is an abstraction only; no local Notify checkout/profile or trusted publisher is present.

## Workstreams and execution order

### 1. Filesystem correctness and persistent-session observability (blocking)

1. Add server integration coverage that reproduces request abort, lease reuse, terminal closure, and route fallback against a controlled FNGK terminal fixture.
2. Attach safe per-request/session correlation IDs to filesystem route failures and expose them in Atlas Observability/Device Sessions; never retain command content.
3. Reproduce the real device failure with those identifiers, fix the discovered server-side ownership/cancellation root cause, and add the smallest regression test.
4. Add desktop E2E: root list, nested folder, file open, intentional context change cancellation, and visible error details for genuine route failure.

### 2. Retained shell fidelity

1. Extract a shared `WorkspaceHeader` for Workspace, Devices, Device Details, Filesystem, Inspector, and Operations; replace permanent Dockview tabs with integrated controls.
2. Persist lower-panel expanded heights, active operations mode, and sidebar collapsed state; collapse must retain mounted content and subscriptions.
3. Add Dockview/desktop E2E for Workspace fallback, permanent-panel recovery, resize limits, collapse/restore, and user terminal continuity.

### 3. Devices and ownership clarity

1. Add a keyboard-accessible Device profile card/context menu containing deterministic identity, local label/color, remote metadata, capability summary, and lifecycle-safe actions.
2. Test local preference persistence and ensure device-scoped panels consistently render non-color ownership indicators plus the color accent.
3. Verify lifecycle controls against advertised capabilities and preserve disconnect/retire/delete distinctions.

### 4. Unified forms, loading, and observability

1. Finish migration to `AtlasInput`, `AtlasSelect`, `AtlasTextarea`, and `AtlasCombobox`; introduce a searchable combobox only for dynamic/high-cardinality choices.
2. Expand operation events across file editor, search, deployment, live projects, database, ports, recovery, and Agent Chat, using stable IDs and visible, classified cancellation outcomes.
3. Improve Observability with details links, connection/session diagnostics, one-item deletion, and clear-all confirmation.

### 5. Optional hosted extension and agent workflows

1. Locate or explicitly provision Notify source/configuration; add opt-in local profile, scoped trusted publishing, offline behavior, and SSE merge tests.
2. Audit Calculator/agent connection, token issuance, grants, and tool contracts against the current Atlas/server implementation; complete missing tests before UI expansion.

### 6. Release-quality audit

1. Run complete unit/server/web suite, typecheck, production build, desktop build, and E2E where environment supports it.
2. Perform a live desktop pass with a paired device, including filesystem, terminals, collapse/restore, device management, and observability.
3. Update the remaining plan with evidence, unresolved external blockers, and no aspirational completion marks.

## Audit cadence

After every workstream: inspect the diff, run focused regression + whole suite, update `2026-10-04-atlas-workbench-shell-remaining.md`, then derive the next smallest plan. If an expected behavior cannot be reproduced locally, add instrumentation and a fixture before attempting a product fix.
