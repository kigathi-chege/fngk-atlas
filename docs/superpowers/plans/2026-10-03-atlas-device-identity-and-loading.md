# Atlas Device Identity and Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Atlas device ownership, device lifecycle controls, navigation, previews, terminal history, and asynchronous loading understandable and safe in the native workspace.

**Architecture:** Add small presentation primitives for device appearance, rail scrolling, and loading; keep Dockview and browser event boundaries intact. Extend lifecycle and terminal server routes only through explicit service capability/ownership contracts, then render those contracts in existing Svelte panels.

**Tech Stack:** TypeScript, Svelte 5, Fastify, Dockview, Vitest, Playwright, CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-10-03-atlas-device-identity-and-loading-design.md`

## Global Constraints

- Do not replace Dockview or introduce a docking dependency.
- Device colors are local Atlas presentation metadata and never mutate a remote FNGK Device.
- No lifecycle action may fall back to a shell command; all mutations require a verified control-plane capability.
- Never expose `atlas-internal` terminal output or history through a user terminal list, dock, or session action route.
- Loading is distinct from empty and error state; use reduced-motion-safe shared components.
- Preserve terminal continuity when a panel moves, minimizes, restores, or changes visual identity.

## Review Focus

- Malformed or unavailable local storage must reset only device appearance preferences; Task 1 tests this.
- A rail that fits without overflow must show no inactive chevrons; Task 2 tests top, middle, bottom, resize, and no-overflow states.
- A stale response from Device A must not change Device B’s lifecycle panel; Task 5 tests request sequencing.
- Preview replacement, pinning, dirtying, and saving must not leave an italic title or `preview` text; Task 4 tests each transition.
- Legacy/unknown FNGK sessions must not accidentally become user terminal history; Task 6 tests server-side filtering and denial.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/web/lib/device-appearance.ts` | Validated, versioned local Device color preferences and subscription events. |
| `src/web/components/RailScrollViewport.svelte` | Scroll metric measurement and accessible directional rail controls. |
| `src/web/components/LoadingSpinner.svelte` / `LoadingState.svelte` | Shared reduced-motion-safe loading presentation. |
| `src/web/components/ActivityRail.svelte` | Ordered activity actions, Device context list, appearance accent resolution. |
| `src/web/components/DeviceLifecyclePanel.svelte` | Device lifecycle capability display, confirmation flows, appearance selector. |
| `src/lifecycle/service.ts` / `src/server/app.ts` | Explicit lifecycle capability contract and capability-gated operations. |
| `src/web/components/Workbench.svelte` | Tab metadata, preview state, and device accent rendering. |
| `src/fngk/terminal-session.ts`, `src/device-sessions/*`, `src/server/app.ts` | Immutable terminal ownership classification and server-side user/history filtering. |
| `src/web/components/{FilesystemTree,FilePanel,PanelHost,UnifiedSearch}.svelte` | Loading-state adoption. |

### Task 1: Device appearance store and shared loading primitives

**Files:**
- Create: `src/web/lib/device-appearance.ts`
- Create: `src/web/components/LoadingSpinner.svelte`
- Create: `src/web/components/LoadingState.svelte`
- Test: `test/web/device-appearance.test.ts`
- Test: `test/web/loading-state.test.ts`

**Interfaces:**
- Produces `AtlasDeviceColor`, `DeviceAppearanceStore`, `createDeviceAppearanceStore(storage, eventTarget)`, and `deviceAppearanceStore`.
- Produces `LoadingSpinner` props `{ size?: 'small' | 'medium'; label?: string; decorative?: boolean }` and `LoadingState` props `{ message: string; compact?: boolean }`.

- [ ] **Step 1: Write failing store and loading component tests**

Assert named-palette validation, per-device get/set/clear, malformed JSON recovery, change notification, accessible status text, and reduced-motion CSS.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- --run test/web/device-appearance.test.ts test/web/loading-state.test.ts`  
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the store and the two presentational components**

Use a versioned `atlas.device-appearance.v1` record keyed by stable Device ID. Restrict colors to a named contrast-tested palette. Dispatch `atlas:device-appearance-changed` after a successful update; never store credentials or context payloads.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `npm test -- --run test/web/device-appearance.test.ts test/web/loading-state.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/lib/device-appearance.ts src/web/components/LoadingSpinner.svelte src/web/components/LoadingState.svelte test/web/device-appearance.test.ts test/web/loading-state.test.ts
git commit -m "feat(atlas): add device appearance and loading primitives"
```

### Task 2: Accessible rail navigation and hidden scrollbar affordances

**Files:**
- Create: `src/web/components/RailScrollViewport.svelte`
- Modify: `src/web/components/ActivityRail.svelte`
- Modify: `src/web/enhancements.css`
- Test: `test/web/activity-rail.test.ts`
- Test: `test/web/rail-scroll-viewport.test.ts`

**Interfaces:**
- Consumes `DeviceAppearanceStore` from Task 1.
- Produces `RailScrollViewport` slot API for a normal scrollable context list and `scrollToStart`/`scrollToEnd` control behavior.

- [ ] **Step 1: Write failing rail tests**

Assert global activity ordering before the context viewport, hidden native scrollbar rules, semantic up/down controls only when overflow exists, endpoint behavior, and colored context icon CSS variables.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- --run test/web/activity-rail.test.ts test/web/rail-scroll-viewport.test.ts`  
Expected: FAIL because chevron controls and appearance integration are absent.

- [ ] **Step 3: Implement `RailScrollViewport` and rebuild `ActivityRail` around it**

Use `ResizeObserver`, scroll events, and cleanup on destroy. Keep wheel/touch/keyboard scrolling native. Add stable activity actions for Devices, Device Sessions, Agent Chat, App Connections, Services, Deployments, Documentation, then existing utilities; dispatch existing `atlas:*` events only.

- [ ] **Step 4: Consolidate rail CSS**

Remove conflicting scrollbar declarations, reserve overlay space for chevrons, preserve keyboard focus, and use the device accent only as supplemental visual identity.

- [ ] **Step 5: Run focused tests to verify they pass**

Run: `npm test -- --run test/web/activity-rail.test.ts test/web/rail-scroll-viewport.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/components/RailScrollViewport.svelte src/web/components/ActivityRail.svelte src/web/enhancements.css test/web/activity-rail.test.ts test/web/rail-scroll-viewport.test.ts
git commit -m "feat(atlas): improve activity rail navigation"
```

### Task 3: Device tab identity and preview tab metadata

**Files:**
- Modify: `src/web/components/Workbench.svelte`
- Modify: guarded-file tab component or the local `AtlasTab` renderer in `Workbench.svelte`
- Modify: `src/web/enhancements.css`
- Test: `test/web/workbench-tabs.test.ts`

**Interfaces:**
- Consumes `deviceAppearanceStore` from Task 1.
- Requires panel parameters `{ contextId?: string; target?: string; preview?: boolean }`.
- Produces a device-tinted tab class/CSS variable only for explicitly device-scoped panels.

- [ ] **Step 1: Write failing tab-contract tests**

Assert preview tab titles contain only the basename, preview metadata is true on create and replacement, titles become ordinary after pin/dirty/save, and tab accents resolve only from `device:<id>` contexts or terminal targets.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run test/web/workbench-tabs.test.ts`  
Expected: FAIL because the current implementation writes ` · preview` into titles.

- [ ] **Step 3: Pass explicit preview metadata through `openFile`, save, and dirty transitions**

Keep Dockview titles as plain basenames. Update parameters rather than parsing title strings. Subscribe tabs to device-appearance changes and remove accent state for unscoped panels.

- [ ] **Step 4: Add restrained tab and panel accent CSS**

Use a header edge/outline and subtle focus shadow driven by a controlled CSS variable; retain ordinary selection, online/offline, and focus indicators.

- [ ] **Step 5: Run focused tests to verify they pass**

Run: `npm test -- --run test/web/workbench-tabs.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/components/Workbench.svelte src/web/enhancements.css test/web/workbench-tabs.test.ts
git commit -m "feat(atlas): identify device-scoped tabs"
```

### Task 4: Adopt consistent loading states in the workspace

**Files:**
- Modify: `src/web/components/PanelHost.svelte`
- Modify: `src/web/components/FilesystemTree.svelte`
- Modify: `src/web/components/FilePanel.svelte`
- Modify: `src/web/components/UnifiedSearch.svelte`
- Test: `test/web/filesystem-tree.test.ts`
- Test: `test/web/file-panel.test.ts`
- Test: `test/web/panel-host.test.ts`

**Interfaces:**
- Consumes `LoadingSpinner` and `LoadingState` from Task 1.

- [ ] **Step 1: Write failing loading-state tests**

Assert folder expansion marks only the pending folder/action, file opening renders `Opening file…`, lazy panel imports use a status component, search retains distinct empty/error output, and a context switch cannot leave a stale spinner.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- --run test/web/filesystem-tree.test.ts test/web/file-panel.test.ts test/web/panel-host.test.ts`  
Expected: FAIL because loading remains text-only or absent.

- [ ] **Step 3: Adopt the shared components without changing request ownership**

Preserve existing generation counters, abort controllers, and error handling. Track expanded-directory pending paths independently of global search loading.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `npm test -- --run test/web/filesystem-tree.test.ts test/web/file-panel.test.ts test/web/panel-host.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/components/PanelHost.svelte src/web/components/FilesystemTree.svelte src/web/components/FilePanel.svelte src/web/components/UnifiedSearch.svelte test/web/filesystem-tree.test.ts test/web/file-panel.test.ts test/web/panel-host.test.ts
git commit -m "feat(atlas): standardize workspace loading states"
```

### Task 5: Capability-gated Devices control center

**Files:**
- Modify: `src/lifecycle/service.ts`
- Modify: `src/server/app.ts`
- Modify: `src/web/components/DeviceLifecyclePanel.svelte`
- Modify: `src/web/lib/documentation.ts`
- Test: `test/lifecycle/service.test.ts`
- Test: `test/server/app.test.ts`
- Test: `test/web/device-lifecycle-panel.test.ts`

**Interfaces:**
- Produces `DeviceLifecycleCapabilities` on `DeviceReadiness` with `disconnect`, `retire`, and `delete` availability/reason fields.
- Produces explicit routes: `POST /api/device-lifecycle/disconnect`, `POST /api/device-lifecycle/retire`, and `DELETE /api/device-lifecycle/device`, each requiring `contextId` and appropriate confirmation.

- [ ] **Step 1: Audit FNGK control-plane operations and write failing capability tests**

Add fixtures for available, unavailable, offline, unauthorized, and stale-selection cases. Assert route handlers reject absent capability and delete confirmation; assert no route invokes `TerminalSession.sendCommand` or a command executor.

- [ ] **Step 2: Run focused lifecycle tests to verify they fail**

Run: `npm test -- --run test/lifecycle/service.test.ts test/server/app.test.ts test/web/device-lifecycle-panel.test.ts`  
Expected: FAIL because the lifecycle result has no mutation capabilities or UI confirmation flow.

- [ ] **Step 3: Implement only verified control-plane adapters and route contracts**

If an operation is not exposed by FNGK, return `{ available:false, reason:'…' }`; do not manufacture a shell workaround. Reuse existing `contexts.release` only for its documented reversible local disconnect semantics, and invalidate evidence only after a successful release.

- [ ] **Step 4: Implement the Devices panel controls and local appearance picker**

Use a two-option removal dialog. Permanent delete requires an exact name-and-ID confirmation. Show disabled reason text for unavailable actions, keep request sequence guards, and refresh the selected Device after success.

- [ ] **Step 5: Run focused tests to verify they pass**

Run: `npm test -- --run test/lifecycle/service.test.ts test/server/app.test.ts test/web/device-lifecycle-panel.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lifecycle/service.ts src/server/app.ts src/web/components/DeviceLifecyclePanel.svelte src/web/lib/documentation.ts test/lifecycle/service.test.ts test/server/app.test.ts test/web/device-lifecycle-panel.test.ts
git commit -m "feat(atlas): manage device lifecycle safely"
```

### Task 6: Enforce terminal ownership and user-history isolation

**Files:**
- Modify: `src/fngk/terminal-session.ts`
- Modify: `src/device-sessions/types.ts`
- Modify: `src/device-sessions/manager.ts`
- Modify: `src/server/app.ts`
- Modify: `src/web/components/TerminalPanel.svelte`
- Modify: `src/web/components/DeviceSessionsPanel.svelte`
- Test: `test/fngk/terminal-session.test.ts`
- Test: `test/device-sessions/manager.test.ts`
- Test: `test/server/app.test.ts`
- Test: `test/web/device-sessions.test.ts`

**Interfaces:**
- Produces immutable `TerminalOwner = 'atlas-user' | 'atlas-internal'` and `TerminalPurpose` metadata on Atlas-created terminal sessions.
- Produces server predicates `isUserTerminal(session)` and `isInternalTerminal(session)` used by every user-facing list/action route.

- [ ] **Step 1: Write failing terminal ownership tests**

Assert an internal Device Session terminal cannot be returned by `/api/fngk/sessions`, cannot receive rename/archive/stop actions through that route, and can only be summarized by `/api/device-sessions`. Assert user interactive terminals remain visible and restorable.

- [ ] **Step 2: Run focused terminal tests to verify they fail**

Run: `npm test -- --run test/fngk/terminal-session.test.ts test/device-sessions/manager.test.ts test/server/app.test.ts test/web/device-sessions.test.ts`  
Expected: FAIL because current session aggregation does not have immutable ownership metadata.

- [ ] **Step 3: Classify session creation at the source**

Give `TerminalSession` constructor options immutable owner/purpose metadata. DeviceSessionManager creates `atlas-internal/device-session`; interactive `TerminalPanel` creation creates `atlas-user/interactive`. Unknown FNGK namespace sessions remain external and are excluded from Atlas-owned user history.

- [ ] **Step 4: Enforce filtering and route authorization server-side**

Filter `/api/fngk/sessions` and reject actions for internal/unknown sessions before forwarding to FNGK. Ensure Device Sessions returns only safe telemetry; never include terminal scrollback or command output.

- [ ] **Step 5: Update terminal and Device Sessions UI**

Label user terminals as interactive only when useful, remove any internal-session fallback path, and keep the Device Sessions panel’s reconnect/revoke/cache controls as telemetry lifecycle actions rather than terminal-history controls.

- [ ] **Step 6: Run focused tests to verify they pass**

Run: `npm test -- --run test/fngk/terminal-session.test.ts test/device-sessions/manager.test.ts test/server/app.test.ts test/web/device-sessions.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/fngk/terminal-session.ts src/device-sessions src/server/app.ts src/web/components/TerminalPanel.svelte src/web/components/DeviceSessionsPanel.svelte test/fngk/terminal-session.test.ts test/device-sessions/manager.test.ts test/server/app.test.ts test/web/device-sessions.test.ts
git commit -m "feat(atlas): isolate internal terminal sessions"
```

### Task 7: Full verification and desktop acceptance

**Files:**
- Modify: focused documentation pages only if actual UI labels/routes changed.
- Test: existing `e2e/device-sessions.spec.ts`, `e2e/agent-workspace-recovery.spec.ts`, and new focused UI flows where gaps remain.

- [ ] **Step 1: Add the minimum end-to-end coverage for device color, preview transition, and internal terminal invisibility**

Use fixture Devices and no production deletion action. Include rail scroll behavior at a narrow desktop viewport.

- [ ] **Step 2: Run quality gates**

Run: `npm run check:web && npm test && npm run build && npm run test:e2e`  
Expected: PASS; production build should not regress configured bundle checks.

- [ ] **Step 3: Run manual desktop pass from the current checkout**

Validate device coloring, rail keyboard controls, spinner states, preview typography, device lifecycle safety, minimized terminal continuity, and internal-terminal invisibility.

- [ ] **Step 4: Commit final verification/doc adjustments**

```bash
git add docs src test e2e
git commit -m "test(atlas): verify device workspace identity"
```

## Plan self-review

- **Spec coverage:** Tasks 1–4 cover appearance, rails, preview tabs, and loaders; Task 5 covers lifecycle safety; Task 6 covers the added terminal ownership boundary; Task 7 covers cross-surface regression and desktop acceptance.
- **Type consistency:** The appearance store, lifecycle capabilities, and terminal owner/purpose types are defined before their consumers.
- **Scope:** Backend destructive operations are deliberately conditional on audited FNGK capability. The plan cannot silently widen authority.
- **Ambiguity:** “Disconnect” is local context release; retirement and permanent deletion require explicit FNGK capability and confirmations.
