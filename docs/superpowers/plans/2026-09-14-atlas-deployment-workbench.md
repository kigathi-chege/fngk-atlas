# Atlas Deployment Workbench Implementation Plan

**Goal:** Turn Atlas into the context-driven deployment and observability workbench over Signal/FNGK while preserving the semantic world foundation in `2f6aae6`.

**Architecture:** Signal remains authoritative for Devices, managed processes, routes, domains, artifacts, credentials, authorization, audit, and retained operational logs. FNGK executes and observes on the Device. Atlas interprets those facts, renders task-oriented workbenches, and never becomes a competing control plane.

**Bases:** Atlas `2f6aae6`; Signal `57cd569`.

## Global Constraints

- Preserve `atlas.interpreter.v1`, `atlas.device-adapter.v1`, semantic IDs/provenance, declarative Inspector views, Calculator read-only authority, and protected Operations grouping.
- `atlas.device-adapter.v1` remains an explicit bounded metadata observation protocol; never use it for persistent workloads.
- Persistent workloads use Signal Managed Processes through a versioned machine protocol. Terminals remain interactive or finite-command surfaces.
- Signal/FNGK owns canonical deployment state. Atlas stores only bounded presentation/session state and semantic projections.
- Database credentials remain Device-side and database result rows are bounded transient responses.
- Generated Signal hostnames always remain a fallback. Custom domains require Signal ownership verification and entitlement.
- Production deploys use immutable commits and versioned release directories; never clean or mutate the user's active checkout.
- Use TDD for each behavior change. Preserve exact-head compatibility gates and actionable protocol errors.

## Task 1: Stabilize viewport, Dockview hitboxes, and empty workspace

- Add a browser regression proving the title bar never intercepts tabs or tab context menus.
- Correct shell grid/positioning and render useful empty workspace actions from the protected center anchor.
- Preserve 100dvh ownership, no body scroll, 6px gutters, hidden tab dividers, sidebar widths, schema-v4 reset, and protected Operations grouping.
- Audit desktop/narrow/restored/empty states and commit the slice.

## Task 2: Add one contextual action registry

- Add typed targets/actions with placement, icon, group/order, risk, availability, disabled reason, confirmation, and handler.
- Feed the registry into right-click menus, command palette, overflow controls, graph/Inspector entities, and empty states.
- Cover project, repository, semantic entity, workload, Device, file, panel, process, deployment, route/domain, database, artifact, terminal, and log targets.
- Preserve native menus in CodeMirror, xterm, form inputs/selections, and embedded browser content.
- Add keyboard/focus/viewport/accessibility browser tests and commit.

## Task 3: Add Signal/FNGK managed-process machine protocol

- Add `fngk.process.v1` create/list/inspect/start/stop/restart/logs/events over the existing Managed Process service.
- Add the required authenticated operator APIs and CLI JSON contracts without weakening Device/project authorization.
- Add bounded cursor-based logs, explicit lifecycle/health fields, compatibility help/probe output, and Go/Node contract tests.
- Commit Signal independently.

## Task 4: Migrate Live Project to Managed Processes

- Replace the persistent queue-terminal command with `fngk.process.v1`.
- Retain command/cwd/Device/PID/restart/lifecycle/health/stdout/stderr and related diagnostic identifiers.
- Show managed runs in Sessions and the protected Operations group; preserve failed startup evidence.
- Gate running on process acknowledgement plus configured port/HTTP readiness.
- Regress the healthy `python3 -m http.server 8080` timeout and genuine startup failures; commit Atlas.

## Task 5: Add project manifest, interpretation, and deployment protocol

- Add `.fngk/project.json` v1 for non-secret install/build/start, port/health, artifacts, restart policy, environments, routes, and secret references.
- Extend the existing semantic system with generic and Node project interpretation; recognize common Vite, SvelteKit, Next, Nuxt, Express, and Nest evidence without executing interpreters.
- Add `fngk.deployment.v1` plan/execute/observe/stop/rollback/health/release/artifact/route association.
- Implement Dev Run from the current checkout and production deploy from an immutable commit in a versioned Device release directory.
- Production performs commit verification, install/build, artifact inventory, managed start, health gate, route switch, drain, and rollback registration.
- Commit Signal and Atlas independently with cross-repository fixtures.

## Task 6: Build deployment observability, domains, and artifacts

- Add Overview, Plan, Runs, Logs, Browser, Route & Domains, Artifacts, and History panels.
- Correlate project, commit, deployment, release, process/run, route/domain, artifact, and diagnostic IDs in the semantic world.
- Stream bounded build/process/health/routing/browser/rollback events into Operations.
- Add browser console/page/network capture, navigation/reload, optional screenshots, and one-confirmation-per-session audited JS evaluation.
- Render generated, vanity, and verified custom-domain lifecycle through existing Signal APIs.
- Consume Signal artifact registry contracts shared with HKMN; do not couple to HKMN UI.
- Commit the slice.

## Task 7: Remove DbGate and add native PostgreSQL workbench

- Delete DbGate dependencies, supervisors, proxy/iframe code, configuration, tests, and documentation.
- Use the PostgreSQL semantic interpreter only for classification and `signal.postgres` for operations.
- Implement Device-side encrypted profiles, database discovery/selection, catalog/schema/table data, bounded SQL/results/history, saved queries, CSV, reviewed edits, activity/monitors, schema compare, backup, and restore.
- Surface every invocation in Operations with redacted diagnostics.
- Add native component/server/live tests and commit.

## Task 8: Whole-system acceptance and delivery readiness

- Run Atlas unit, TypeScript, Svelte, build, audit, Playwright, visual, secret, and cleanup checks.
- Run Signal unit/integration/Go/build/migration/protocol checks.
- Run disposable live acceptance for persistent server lifecycle, failure logs, commit deployment, health route switch, rollback, domain fixture, browser observation/evaluation, artifact correlation, and PostgreSQL operations.
- Request broad cross-repository review and address all blocking findings.
- Document Signal-first rollout, feature flag, exact-head FNGK requirement, and rollback paths.
