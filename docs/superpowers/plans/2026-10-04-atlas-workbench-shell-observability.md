# Atlas Workbench Shell and Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Atlas a local-first, live desktop workspace with fallback Workspace behavior, deterministic Device identity, constrained permanent sidebars, a retained Operations dock, and Notify-backed cross-system visibility.

**Architecture:** Keep Dockview as the layout engine but place explicit shell rules around it: Workspace is a hidden center fallback; Devices/Device Details are retained on the left; Filesystem/Inspector are retained on the right; Operations remains center-bottom. A local event adapter renders immediately and persists a bounded outbox/cache; the optional Notify bridge publishes and streams the same safe, correlated events when configured.

**Tech Stack:** TypeScript, Svelte 5, Fastify, Dockview, Vitest, Playwright, IndexedDB/localStorage, Axis Notify HTTP/SSE, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-03-workbench-shell-and-device-identity-design.md`

## Global Constraints

- Preserve user terminal continuity; never expose Atlas-internal terminal output or history.
- Keep Atlas fully functional without Notify; Notify failure is visible but never blocks local work.
- Sidebars default to 20% of available width and are constrained to 240–420px.
- Device Details and Inspector begin at one-third sidebar height, may not exceed one-half, and may collapse only to their integrated header.
- Permanent regions use custom Workspace-style headers, no ordinary Dockview tab strips, and no close/minimize-to-tray controls.
- Device color is supplemental visual ownership only; default label is one UUID-derived word and local rename never mutates FNGK.
- Never put Notify admin credentials, producer HMAC secrets, terminal input, or private internal-terminal output in browser persistence or UI events.

## Review Focus

- A startup with no configured Notify endpoint must still show local pending/success/error activity; Task 3 tests it.
- A malformed saved layout, event cache, label override, or offline Notify response must reset only its own local state; Tasks 1, 3, and 4 test it.
- Closing the final center work tab must reveal Workspace without destroying sidebars, Operations, a terminal, or an open file buffer; Task 4 tests it.
- A resize attempt beyond 240–420px or the one-third-to-one-half lower-panel range must clamp predictably; Task 5 tests it.
- A Device rename and a Device color accent must never change FNGK’s authoritative name, UUID, or selection state; Tasks 1 and 6 test it.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/web/lib/device-identity.ts` | Stable UUID hash, one-word label/avatar/color generation, safe local label overrides. |
| `src/web/lib/atlas-events.ts` | Local event cache/outbox, lifecycle updates, persistence, and subscriptions. |
| `src/web/lib/notify-bridge.ts` | Optional signed publish, retry/outbox flush, scoped notification stream, and merge rules. |
| `src/web/components/WorkspaceHeader.svelte` | Shared permanent-region header and accessible action contract. |
| `src/web/components/DevicesPanel.svelte` | Device list, identity card, selection, rename, and context actions. |
| `src/web/components/DeviceDetailsPanel.svelte` | Selected Device details/lifecycle summary for the left lower panel. |
| `src/web/components/ObservabilityPanel.svelte` | Bottom-dock activity, connections, logs, details, filter and cache controls. |
| `src/web/components/NotificationStack.svelte` | Toast projection of event/Notify records. |
| `src/web/components/Workbench.svelte` | Dockview seeding, retained-region rules, fallback Workspace, constrained dimensions, and shell controls. |
| `src/web/components/{ActivityRail,FilesystemTree,DetailsPanel,OutputPanel}.svelte` | Adopt permanent-shell events and contextual data. |
| `src/web/lib/workspace-persistence.ts` | Versioned shell geometry and internal-panel state. |
| `compose.notify.yaml`, `scripts/notify-local.mjs` | Local Notify service/worker lifecycle and verified Atlas development onboarding. |

### Task 1: Deterministic Device identity and local label preferences

**Files:**
- Create: `src/web/lib/device-identity.ts`
- Modify: `src/web/lib/device-appearance.ts`
- Test: `test/web/device-identity.test.ts`
- Test: `test/web/device-appearance.test.ts`

**Interfaces:**
- Produces `resolveDeviceIdentity(deviceId: string): AtlasDeviceIdentity`.
- Produces `DeviceLabelStore` methods `getLabel(deviceId)`, `setLabel(deviceId, label)`, `clearLabel(deviceId)`, and `subscribe(listener)`.
- `AtlasDeviceIdentity` has `{ deviceId, label, glyph, color, version }`.

- [ ] **Step 1: Write failing identity tests**

Assert canonical UUID normalization, stable one-word labels/glyphs/colors, invalid UUID fallback, append-only vocabulary version behavior, label override persistence, clearing, malformed storage recovery, and no FNGK API call.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- --run test/web/device-identity.test.ts test/web/device-appearance.test.ts`  
Expected: FAIL because the identity resolver and label store do not exist.

- [ ] **Step 3: Implement resolver and label store**

Use a documented stable hash and fixed ordered vocabulary. Keep colors from the existing contrast-tested palette. Store only `{version, labels}` in a dedicated local key; never put labels in connection/profile state.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `npm test -- --run test/web/device-identity.test.ts test/web/device-appearance.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/lib/device-identity.ts src/web/lib/device-appearance.ts test/web/device-identity.test.ts test/web/device-appearance.test.ts
git commit -m "feat(atlas): add deterministic Device identity"
```

### Task 2: Local-first event model and notification projection

**Files:**
- Create: `src/web/lib/atlas-events.ts`
- Modify: `src/web/lib/notifications.ts`
- Modify: `src/web/components/NotificationStack.svelte`
- Test: `test/web/atlas-events.test.ts`
- Test: `test/web/notification-stack.test.ts`

**Interfaces:**
- Produces `AtlasEventStore` with `begin`, `resolve`, `fail`, `cancel`, `upsertRemote`, `pin`, `removeLocal`, `clearUnpinned`, and `subscribe`.
- Event IDs are stable across `pending` → outcome updates and carry optional `contextId`, `panelId`, `diagnosticId`, and correlation ID.

- [ ] **Step 1: Write failing event-store tests**

Assert lifecycle replacement by ID, 500-unpinned-entry cap, pinned-entry retention, safe JSON recovery, no secrets in persisted record, local-only clear behavior, and toast policy for pending/success/warning/error states.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- --run test/web/atlas-events.test.ts test/web/notification-stack.test.ts`  
Expected: FAIL because the local event model is absent.

- [ ] **Step 3: Implement the store and adapt notifications**

Retain the existing `atlas:notice` compatibility event as an adapter into the store. Toast dismissal changes only presentation; it never deletes local history or remote data. Use a safe local persistence adapter so renderer startup remains offline-safe.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `npm test -- --run test/web/atlas-events.test.ts test/web/notification-stack.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/lib/atlas-events.ts src/web/lib/notifications.ts src/web/components/NotificationStack.svelte test/web/atlas-events.test.ts test/web/notification-stack.test.ts
git commit -m "feat(atlas): add local operation event history"
```

### Task 3: Local Notify profile and optional bridge proof

**Files:**
- Create: `compose.notify.yaml`
- Create: `scripts/notify-local.mjs`
- Create: `scripts/notify-atlas-probe.mjs`
- Create: `src/web/lib/notify-bridge.ts`
- Modify: `.env.example`, `package.json`
- Test: `test/web/notify-bridge.test.ts`
- Test: `test/integration/notify-atlas-probe.test.ts`

**Interfaces:**
- `NotifyBridge` accepts local event-store events, optional endpoint/config, and exposes `start()`, `stop()`, `flush()`, and `connectionState()`.
- `npm run notify:local` starts the Notify API and worker using `NOTIFY_SOURCE` as build context; `npm run notify:probe` onboards an `atlas-dev` producer, publishes one registered event, performs scoped read-back, and observes one SSE notification.

- [ ] **Step 1: Write failing bridge/probe tests**

Assert absent configuration is a working local-only state; retryable publish failure leaves a visible outbox event; an unregistered event is rejected; events use idempotency/correlation keys; no admin/producer secret enters web persistence; and probe fails when scoped read-back or SSE is absent.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- --run test/web/notify-bridge.test.ts test/integration/notify-atlas-probe.test.ts`  
Expected: FAIL because the bridge/profile/probe do not exist.

- [ ] **Step 3: Add the local service profile and onboarding probe**

Follow the Notify consumer contract: registered schemas, per-tenant installation, scoped operator reads, HMAC producer credential, and a separate worker. `NOTIFY_SOURCE` is required for the Compose build context; do not vendor or copy Notify into Atlas. Keep secrets in process environment only.

- [ ] **Step 4: Implement `NotifyBridge`**

Publish only allow-listed Atlas event schemas, batch/retry non-blockingly, preserve the local event when offline, and use recipient-scoped SSE/REST reads. Remote frames merge into `AtlasEventStore` by remote ID/correlation ID.

- [ ] **Step 5: Run focused tests and local probe**

Run: `npm test -- --run test/web/notify-bridge.test.ts test/integration/notify-atlas-probe.test.ts`  
Expected: PASS.

Run: `NOTIFY_SOURCE=/absolute/path/to/notify npm run notify:local && npm run notify:probe`  
Expected: registered Atlas event publishes, scoped read-back returns only Atlas development scope, and notification SSE receives one frame.

- [ ] **Step 6: Commit**

```bash
git add compose.notify.yaml scripts/notify-local.mjs scripts/notify-atlas-probe.mjs src/web/lib/notify-bridge.ts .env.example package.json test/web/notify-bridge.test.ts test/integration/notify-atlas-probe.test.ts
git commit -m "feat(atlas): add local-first Notify bridge"
```

### Task 4: Workspace fallback and permanent shell headers

**Files:**
- Create: `src/web/components/WorkspaceHeader.svelte`
- Modify: `src/web/components/Workbench.svelte`
- Modify: `src/web/lib/workspace-persistence.ts`
- Modify: `src/web/enhancements.css`
- Test: `test/web/workbench-model.test.ts`
- Test: `test/web/workbench-tabs.test.ts`
- Test: `test/web/workspace-persistence.test.ts`

**Interfaces:**
- Produces header props `{ title, contextLabel?, status?, actions, collapsed? }`.
- Persists shell version 8 with left/right widths, lower-panel heights, collapsed flags, and active internal modes.

- [ ] **Step 1: Write failing shell tests**

Assert Workspace is hidden while any ordinary center panel is open, appears/activates after the final ordinary center panel closes, and cannot be closed/minimized/floated. Assert permanent headers have no close/tab-strip affordance and layout version migration safely resets malformed shell geometry.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- --run test/web/workbench-model.test.ts test/web/workbench-tabs.test.ts test/web/workspace-persistence.test.ts`  
Expected: FAIL because Workspace remains a visible normal anchor and geometry version 8 is absent.

- [ ] **Step 3: Implement `WorkspaceHeader` and fallback behavior**

Replace title-string parsing with panel metadata. Keep Workspace mounted as Dockview’s recovery anchor but suppress its visible tab whenever a normal center work panel exists. Preserve panel renderers/buffers through fallback transitions.

- [ ] **Step 4: Add permanent header controls**

Wire explicit Devices, Filesystem/Inspector, and Operations visibility toggles with `aria-pressed`, title, keyboard command, persisted collapsed state, and no component unmount.

- [ ] **Step 5: Run focused tests to verify they pass**

Run: `npm test -- --run test/web/workbench-model.test.ts test/web/workbench-tabs.test.ts test/web/workspace-persistence.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/components/WorkspaceHeader.svelte src/web/components/Workbench.svelte src/web/lib/workspace-persistence.ts src/web/enhancements.css test/web/workbench-model.test.ts test/web/workbench-tabs.test.ts test/web/workspace-persistence.test.ts
git commit -m "feat(atlas): establish permanent workbench shell"
```

### Task 5: Constrained retained Dockview regions

**Files:**
- Modify: `src/web/components/Workbench.svelte`
- Modify: `src/web/lib/workspace-splitters.ts`
- Modify: `src/web/enhancements.css`
- Test: `test/web/workbench-layout.test.ts`

**Interfaces:**
- Produces `clampSidebarWidth(width, availableWidth): number` and `clampLowerPanelHeight(height, sidebarHeight): number`.
- Permanent panel IDs are `atlas.devices`, `atlas.device-details`, `atlas.filesystem`, `atlas.inspector`, and `atlas.operations`.

- [ ] **Step 1: Write failing geometry tests**

Assert 20% startup width clamps to 240–420px; panel resizing persists only clamped values; lower panels start at one-third, clamp at one-half, and collapse only to header height; narrow mode preserves rather than deregisters permanent panels.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run test/web/workbench-layout.test.ts`  
Expected: FAIL because current layout uses unconstrained 320/332px sidebars.

- [ ] **Step 3: Seed and retain the five permanent panels**

Use Dockview positions to form left and right vertical stacks and a bottom Operations group. Hide built-in headers for permanent groups and render integrated `WorkspaceHeader` components. Prevent removal/float/drop paths from violating permanent placement.

- [ ] **Step 4: Implement resize clamping and collapse**

Apply constraints after Dockview layout/resize events, avoid feedback loops, and persist only final clamped geometry. Collapse retains renderer/session state and exposes a header-strip restore action.

- [ ] **Step 5: Run focused test to verify it passes**

Run: `npm test -- --run test/web/workbench-layout.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/components/Workbench.svelte src/web/lib/workspace-splitters.ts src/web/enhancements.css test/web/workbench-layout.test.ts
git commit -m "feat(atlas): constrain permanent workspace regions"
```

### Task 6: Devices sidebar, Device Details, and scoped tab identity

**Files:**
- Create: `src/web/components/DevicesPanel.svelte`
- Create: `src/web/components/DeviceDetailsPanel.svelte`
- Modify: `src/web/components/ActivityRail.svelte`
- Modify: `src/web/components/PanelHost.svelte`
- Modify: `src/web/components/Workbench.svelte`
- Modify: `src/web/enhancements.css`
- Test: `test/web/devices-panel.test.ts`
- Test: `test/web/workbench-tabs.test.ts`

**Interfaces:**
- Devices panel consumes context catalog plus `resolveDeviceIdentity` and emits `atlas:context`, `atlas:open-terminal`, `atlas:open-root`, and selected-device events.
- Device Details consumes selected-device state and displays lifecycle/capability data without mutating FNGK on rename.

- [ ] **Step 1: Write failing Devices/ownership tests**

Assert no Device list exists in ActivityRail; Device rows expose one-word label, authoritative name, UUID, status, avatar, keyboard profile card, and safe context menu. Assert rename remains local and device-scoped file/terminal/deployment/live-project tabs receive only the correct color token.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- --run test/web/devices-panel.test.ts test/web/activity-rail.test.ts test/web/workbench-tabs.test.ts`  
Expected: FAIL because the rail owns Device list and no retained Devices panel exists.

- [ ] **Step 3: Implement Devices and Details panels**

Use the existing context catalog and lifecycle service; do not create shell command actions. Add hover/focus profile card, existing context-menu semantics, local rename dialog, and selected-device event propagation.

- [ ] **Step 4: Move Device selection out of the rail and apply ownership accents**

Keep only global icons in `ActivityRail`. Resolve tab appearance from explicit `contextId`/terminal target and refresh existing tabs when an identity label/color update occurs.

- [ ] **Step 5: Run focused tests to verify they pass**

Run: `npm test -- --run test/web/devices-panel.test.ts test/web/activity-rail.test.ts test/web/workbench-tabs.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/components/DevicesPanel.svelte src/web/components/DeviceDetailsPanel.svelte src/web/components/ActivityRail.svelte src/web/components/PanelHost.svelte src/web/components/Workbench.svelte src/web/enhancements.css test/web/devices-panel.test.ts test/web/activity-rail.test.ts test/web/workbench-tabs.test.ts
git commit -m "feat(atlas): add retained Devices workspace"
```

### Task 7: Right Filesystem/Inspector stack and bottom Observability

**Files:**
- Create: `src/web/components/ObservabilityPanel.svelte`
- Modify: `src/web/components/FilesystemTree.svelte`
- Modify: `src/web/components/DetailsPanel.svelte`
- Modify: `src/web/components/OutputPanel.svelte`
- Modify: `src/web/components/LogsPanel.svelte`
- Modify: `src/web/components/PanelHost.svelte`
- Test: `test/web/filesystem-tree.test.ts`
- Test: `test/web/observability-panel.test.ts`

**Interfaces:**
- Filesystem/Inspector publish selection and operation lifecycle through `AtlasEventStore`.
- Observability consumes event-store and bridge connection state, filters by source/state/Device, and opens referenced panel/log/detail through existing `atlas:*` events.

- [ ] **Step 1: Write failing filesystem/observability tests**

Assert root/folder/file failures emit visible error events rather than empty states; slow work evolves pending → success/error; cancelled superseded work is non-noisy; Observability filters, pins, opens details/logs, clears only local cache, and does not reveal internal terminals.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- --run test/web/filesystem-tree.test.ts test/web/observability-panel.test.ts`  
Expected: FAIL because operations are panel-local and observability is not the event-store viewer.

- [ ] **Step 3: Publish filesystem/inspector lifecycle events**

Preserve request generation/cancellation semantics. Emit safe event metadata only; distinguish no request, pending, empty result, error, and cancellation in both immediate surface and event history.

- [ ] **Step 4: Implement Observability panel and bottom-dock integration**

Reuse Operations docking; add activity, connections, logs, and details modes as retained views. Route existing logs/output panels into this surface without duplicating terminal history.

- [ ] **Step 5: Run focused tests to verify they pass**

Run: `npm test -- --run test/web/filesystem-tree.test.ts test/web/observability-panel.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/components/ObservabilityPanel.svelte src/web/components/FilesystemTree.svelte src/web/components/DetailsPanel.svelte src/web/components/OutputPanel.svelte src/web/components/LogsPanel.svelte src/web/components/PanelHost.svelte test/web/filesystem-tree.test.ts test/web/observability-panel.test.ts
git commit -m "feat(atlas): unify filesystem and observability activity"
```

### Task 8: Adopt event lifecycle across remaining tools and document the system

**Files:**
- Modify: `src/web/components/{FilePanel,TerminalPanel,UnifiedSearch,DatabasePanel,DeploymentPanel,LiveProjectPanel,PortSharingPanel,AgentChatPanel}.svelte`
- Modify: `docs/atlas-frontend-architecture.md`
- Create: `docs/observability-and-notify.md`
- Test: `test/web/tool-event-lifecycle.test.ts`

**Interfaces:**
- All listed panels emit safe event-store lifecycles with source constants and context/panel correlation.

- [ ] **Step 1: Write failing lifecycle contract tests**

Assert file open/save, terminal connect/reconnect, search, database actions, deployment, live project, port sharing, and agent chat publish pending/outcome events; assert no terminal input, secret, or internal-session output is included.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run test/web/tool-event-lifecycle.test.ts`  
Expected: FAIL because panel lifecycle publication is incomplete.

- [ ] **Step 3: Adopt the shared adapter across panels**

Add event lifecycle calls at existing async boundaries without changing ownership, request cancellation, or connection lifecycles. Use source-specific titles and safe messages.

- [ ] **Step 4: Document operation and Notify boundaries**

Explain local-first operation, local Notify setup/probe, event retention, recipient dismiss/read semantics, credential boundary, observability filtering, and user-vs-internal terminal protections.

- [ ] **Step 5: Run focused test to verify it passes**

Run: `npm test -- --run test/web/tool-event-lifecycle.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/components src/web/lib docs/atlas-frontend-architecture.md docs/observability-and-notify.md test/web/tool-event-lifecycle.test.ts
git commit -m "feat(atlas): publish tool lifecycle observability"
```

### Task 9: End-to-end validation and desktop acceptance

**Files:**
- Modify: `test/e2e/workbench-shell.spec.ts`
- Modify: `test/e2e/notify-observability.spec.ts`
- Modify: `docs/known-issues.md`

**Interfaces:**
- Requires Tasks 1–8 complete and local Notify probe operational.

- [ ] **Step 1: Add end-to-end workspace continuity scenarios**

Cover Workspace fallback, permanent-region collapse/restore, width/height clamps, Device selection/rename, scoped tab accents, Filesystem pending/error, terminal continuity, and bottom Observability actions.

- [ ] **Step 2: Add Notify-connected and Notify-offline scenarios**

Assert Atlas works locally with no endpoint; then assert local Notify publish/read/SSE merge works and a simulated failure leaves a visible retryable local event.

- [ ] **Step 3: Run end-to-end suite**

Run: `npm run test:e2e -- --project=desktop`  
Expected: PASS, with no leaked internal terminals or blocked local operation when Notify is unavailable.

- [ ] **Step 4: Run full verification**

Run: `npm test -- --run && npm run check:web && npm run build && npm run desktop:build`  
Expected: all tests and checks pass; desktop build succeeds after exact-head FNGK artifacts are built.

- [ ] **Step 5: Perform manual desktop pass**

Open several Devices, files, and terminals; resize/collapse all permanent regions; close/recover final center tab; run local Notify probe; simulate Notify outage; verify event stream, toast behavior, and terminal continuity.

- [ ] **Step 6: Commit**

```bash
git add test/e2e docs/known-issues.md
git commit -m "test(atlas): verify shell and Notify integration"
```

## Plan self-review

- **Spec coverage:** Tasks 1–9 cover Device identity/rename, all permanent region placement/geometry, Workspace fallback, local-first Notify, notifications, Observability, loading/error visibility, persistence, accessibility, terminal safety, and desktop verification.
- **Dependencies:** Task 1 feeds Device UI; Task 2 supplies local events; Task 3 adds optional Notify; Task 4 establishes shell contract; Task 5 enforces geometry; Tasks 6–8 consume these contracts; Task 9 validates the complete system.
- **Risk containment:** Notify is proven locally before any hosted configuration. FNGK remote mutations stay behind existing lifecycle APIs. Terminal session ownership is only observed, never relaxed.
- **Scope:** No replacement dock library, no remote Device rename, and no required cloud service were introduced.
