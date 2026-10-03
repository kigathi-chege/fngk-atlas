# Atlas Rail, Form, and Loading System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one shared right minimization rail, a three-zone activity rail, correct filesystem cancellation semantics, and a consistent accessible form/loading system across Atlas.

**Architecture:** Keep the existing Svelte component and CSS-token model. `PinnedRootsRail`/`MinimizedTray` become the sole minimized-panel presentation, while `Workbench` always uses the same registry-backed minimization path. Extract presentation-only form primitives under `components/ui`, preserve panel-owned data/actions, and make filesystem loads path-scoped rather than globally aborting. The activity rail is a fixed flex shell whose device viewport is the only scrolling region.

**Tech Stack:** TypeScript, Svelte 5, Fastify, Vitest, Playwright, CSS custom properties, Lucide Svelte.

**Spec:** `docs/superpowers/specs/2026-10-03-atlas-rail-form-system-design.md`

## Global Constraints

- Do not add shadcn-svelte, a form framework, or another UI runtime; use its composition and accessibility conventions as inspiration only.
- Do not replace Dockview, terminal/session lifecycles, or the existing event boundaries.
- A minimized panel appears only in the shared right minimization rail; delete `TerminalDock` and do not add a terminal-specific minimization UI.
- Show at most seven direct minimized icons; all additional entries belong in an icon-bearing contextual overflow menu.
- Operations must call the same `minimizePanel` path as every other panel, including its anchor panel.
- Preserve native wheel, touch, and keyboard scrolling for the device list while hiding only its visual scrollbar.
- Treat request cancellation as expected control flow; it must never become a route-unavailable message or an Atlas error banner.
- Form primitives own presentation/accessibility only; panels own data loading, validation, and mutation behavior.
- Use semantic Atlas tokens for all new styles; support light and dark themes and `prefers-reduced-motion`.
- Delete a legacy control style/component only after import/reference search and build verification show it is unused.

## Review Focus

- Simultaneous expansion of two different folders must load both; Task 3 adds the concurrent-path test.
- Re-expanding the same folder must cancel only its stale request and leave no error banner; Task 3 adds the same-path cancellation test.
- A rail without overflow must not render inactive directional controls, and top/bottom actions must remain visible while the device list scrolls; Task 2 adds this contract.
- Keyboard-only users must be able to navigate and commit/cancel a combobox choice; Task 4 adds this behavior test.
- A busy local form control must not disable sibling controls or replace prior valid content; Tasks 4 and 5 add representative operation-level tests.
- The eighth minimized panel must enter overflow while retaining its own type icon and restore action; Task 1 tests this boundary.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/web/components/ActivityRail.svelte` | Fixed top/device/bottom rail composition and existing Atlas events. |
| `src/web/components/RailScrollViewport.svelte` | Device-list-only overflow measurement and directional controls. |
| `src/web/components/PinnedRootsRail.svelte` | Shared right rail ownership of every minimized descriptor. |
| `src/web/components/MinimizedTray.svelte` | Seven-icon minimization display, type icons, and overflow menu. |
| `src/web/components/TerminalDock.svelte` | Removed; terminals use the shared minimization rail. |
| `src/web/components/Workbench.svelte` | Common minimization/restore lifecycle, including Operations. |
| `src/web/components/FilesystemTree.svelte` | Path-scoped filesystem request registry, loading, and shared controls. |
| `src/files/file-service.ts` | Cancellation-preserving multi-route file behavior. |
| `src/web/components/ui/AtlasField.svelte` | Label/help/error accessibility wiring. |
| `src/web/components/ui/AtlasInput.svelte` | Shared single-line control. |
| `src/web/components/ui/AtlasTextarea.svelte` | Shared multiline control. |
| `src/web/components/ui/AtlasSelect.svelte` | Shared small fixed-option select. |
| `src/web/components/ui/AtlasCombobox.svelte` | Shared searchable/dynamic selector. |
| `src/web/components/ui/forms.css` | Shared token-based control styling. |
| Existing panel components | Consumer migration and operation-local loading states. |
| `src/web/{theme,workspace,enhancements}.css` | Token and obsolete-style consolidation. |

### Task 1: Unify minimized panels in the shared right rail

**Files:**
- Modify: `src/web/App.svelte`
- Delete: `src/web/components/TerminalDock.svelte`
- Modify: `src/web/components/PinnedRootsRail.svelte`
- Modify: `src/web/components/MinimizedTray.svelte`
- Modify: `src/web/components/Workbench.svelte`
- Modify: `src/web/enhancements.css`
- Modify: `test/web/panel-registry.test.ts`
- Create: `test/web/minimized-tray.test.ts`
- Modify: `test/web/workbench-tabs.test.ts`

**Interfaces:**
- `MinimizedTray` consumes `{ items: AtlasPanelDescriptor[]; visibleCount?: number; onrestore(id): void; onforget(id): void }`, defaults `visibleCount` to `7`, and exports no panel-kind exceptions.
- `panelIcon(kind: string): Component` maps stable Atlas panel kinds to Lucide icons with a generic fallback.
- `Workbench.minimizePanel(panel)` is the sole minimization operation; Operations delegates every group panel, including `atlas.operations`, to it.

- [ ] **Step 1: Write failing shared-minimization tests**

Assert `App.svelte` no longer imports/renders `TerminalDock`; `PinnedRootsRail` does not filter terminal or navigator descriptors; `MinimizedTray` defaults to seven, maps panel kinds to distinct icons, and renders an eighth item in an overflow menu with its own icon/title. Assert `Workbench` minimizes the Operations anchor through `minimizePanel` rather than directly removing it.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- --run test/web/minimized-tray.test.ts test/web/panel-registry.test.ts test/web/workbench-tabs.test.ts`
Expected: FAIL because terminals are filtered to `TerminalDock`, direct-item capacity is dynamic/label-based, and Operations bypasses the common path.

- [ ] **Step 3: Implement the shared right minimization model**

Remove `TerminalDock` from `App.svelte` and delete its component. Feed every non-responsive minimized descriptor into `PinnedRootsRail`. Use a fixed direct capacity of seven. Render icon-only direct restore buttons with descriptive labels/tooltips; render excess descriptors in the contextual overflow menu with their type icons and titles.

- [ ] **Step 4: Route Operations through common minimization**

Change `minimizeOperations` to invoke `minimizePanel` for every panel in the Operations group, including its anchor. Preserve retained terminal renderers/session continuity and existing restore behavior.

- [ ] **Step 5: Run focused tests to verify they pass**

Run: `npm test -- --run test/web/minimized-tray.test.ts test/web/panel-registry.test.ts test/web/workbench-tabs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/App.svelte src/web/components/PinnedRootsRail.svelte src/web/components/MinimizedTray.svelte src/web/components/Workbench.svelte src/web/enhancements.css test/web/minimized-tray.test.ts test/web/panel-registry.test.ts test/web/workbench-tabs.test.ts
git rm src/web/components/TerminalDock.svelte
git commit -m "refactor(atlas): unify minimized panel rail"
```

### Task 2: Make the activity rail a three-zone workspace control

**Files:**
- Modify: `src/web/components/ActivityRail.svelte`
- Modify: `src/web/components/RailScrollViewport.svelte`
- Modify: `src/web/enhancements.css`
- Modify: `src/web/workspace.css`
- Modify: `test/web/activity-rail.test.ts`
- Modify: `test/web/rail-scroll-viewport.test.ts`

**Interfaces:**
- `RailScrollViewport` consumes `label?: string` and slots device/context buttons.
- `ActivityRail` produces three semantic regions: `.activity-rail-top`, `.activity-rail-devices`, `.activity-rail-bottom`.

- [ ] **Step 1: Write failing rail structure and overflow tests**

Assert the rail contains the three named regions; only `.activity-rail-devices` mounts `RailScrollViewport`; lifecycle/chat/connection/documentation actions appear in top; search/files/terminal/command/refresh appear in bottom; and the viewport labels its chevrons “Show earlier Devices” / “Show later Devices”.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run test/web/activity-rail.test.ts test/web/rail-scroll-viewport.test.ts`  
Expected: FAIL because the current rail has a single undifferentiated action sequence.

- [ ] **Step 3: Implement the fixed rail regions and viewport contract**

Reorder only existing action buttons and event dispatches. Make the outer rail `overflow:hidden; display:flex; flex-direction:column`; make top/bottom non-growing and devices `flex:1; min-height:0`. Keep device color styles and selection behavior unchanged.

- [ ] **Step 4: Consolidate rail CSS**

Keep native scrolling on `.rail-contexts`, hide its scrollbar cross-browser, and reserve chevron overlay space inside the device viewport. Remove conflicting `rail-spacer` layout behavior and any selector that makes the outer rail scroll.

- [ ] **Step 5: Run the focused test to verify it passes**

Run: `npm test -- --run test/web/activity-rail.test.ts test/web/rail-scroll-viewport.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/components/ActivityRail.svelte src/web/components/RailScrollViewport.svelte src/web/enhancements.css src/web/workspace.css test/web/activity-rail.test.ts test/web/rail-scroll-viewport.test.ts
git commit -m "feat(atlas): separate activity rail regions"
```

### Task 3: Preserve filesystem cancellation semantics and concurrent loading

**Files:**
- Modify: `src/web/components/FilesystemTree.svelte`
- Modify: `src/files/file-service.ts`
- Modify: `test/web/filesystem-tree.test.ts`
- Modify: `test/files/file-service.test.ts`

**Interfaces:**
- `FilesystemTree` produces `requestControllers: Map<string, AbortController>` and `requestGenerations: Map<string, number>` keyed by normalized path.
- `FileService.list(target, { signal })` rethrows cancellation errors without passing them to `#unavailable`.

- [ ] **Step 1: Write failing cancellation tests**

Add a FileService test whose first route throws `{ code: 'cancelled' }` and assert the service rejects with `code === 'cancelled'`, not `route_unavailable`. Update the tree contract to require per-path controller management, cancellation of a prior controller for the same normalized path only, and cleanup that aborts all controllers on context/root change.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- --run test/files/file-service.test.ts test/web/filesystem-tree.test.ts`  
Expected: FAIL because `navigationController` globally aborts unrelated paths and `FileService.list` aggregates cancellation.

- [ ] **Step 3: Implement path-scoped request ownership**

Replace `navigationController` with path-indexed controller/token maps. `load(path)` may abort and replace only the controller at `key(path)`; root/context transition and destroy iterate through the map and abort every active request. Update `children[path]` and remove `pendingPaths[path]` only if the path token is still current.

- [ ] **Step 4: Implement cancellation passthrough in `FileService`**

Add a local cancellation predicate recognizing an aborted signal, `AbortError`, and `code === 'cancelled'`. In list/read/stat and other signal-aware operations, rethrow it immediately rather than adding it to fallback errors.

- [ ] **Step 5: Run focused tests to verify they pass**

Run: `npm test -- --run test/files/file-service.test.ts test/web/filesystem-tree.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/components/FilesystemTree.svelte src/files/file-service.ts test/web/filesystem-tree.test.ts test/files/file-service.test.ts
git commit -m "fix(atlas): isolate filesystem request cancellation"
```

### Task 4: Introduce the Atlas form primitive layer

**Files:**
- Create: `src/web/components/ui/AtlasField.svelte`
- Create: `src/web/components/ui/AtlasInput.svelte`
- Create: `src/web/components/ui/AtlasTextarea.svelte`
- Create: `src/web/components/ui/AtlasSelect.svelte`
- Create: `src/web/components/ui/AtlasCombobox.svelte`
- Create: `src/web/components/ui/forms.css`
- Modify: `src/web/main.ts` or existing global stylesheet entrypoint
- Create: `test/web/form-primitives.test.ts`

**Interfaces:**
- `AtlasField` props: `{ label?: string; description?: string; error?: string; required?: boolean; forId?: string }`.
- `AtlasInput`/`AtlasTextarea` props: `{ id?: string; value?: string; placeholder?: string; disabled?: boolean; invalid?: boolean; busy?: boolean; loadingLabel?: string; ariaLabel?: string }` with bindable `value`.
- `AtlasSelect` props: `{ id?: string; value?: string; options: Array<{ value: string; label: string; disabled?: boolean }>; disabled?: boolean; invalid?: boolean; busy?: boolean; ariaLabel?: string }` with bindable `value`.
- `AtlasCombobox` props: `{ id?: string; value?: string; options: Array<{ value: string; label: string; keywords?: string[]; disabled?: boolean }>; placeholder?: string; disabled?: boolean; busy?: boolean; loadingLabel?: string; emptyLabel?: string; ariaLabel: string }` with bindable `value` and a change event.

- [ ] **Step 1: Write failing primitive behavior tests**

Assert source contracts for label/error/status semantics, `aria-expanded`/listbox relationships, reduced-motion spinner use, and keyboard handlers for ArrowUp, ArrowDown, Home, End, Enter, and Escape. Assert shared CSS defines semantic control variables and a single focus-ring rule.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run test/web/form-primitives.test.ts`  
Expected: FAIL because the UI primitive modules do not exist.

- [ ] **Step 3: Implement the primitives and token stylesheet**

Use native inputs/selects where appropriate; implement the combobox with a real text input and `role="listbox"` result list. Do not fetch data or submit forms. Import `forms.css` once through the web entrypoint.

- [ ] **Step 4: Run focused tests and web type-check**

Run: `npm test -- --run test/web/form-primitives.test.ts && npm run check:web`  
Expected: PASS with no Svelte/TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/web/components/ui src/web/main.ts test/web/form-primitives.test.ts
git commit -m "feat(atlas): add shared form primitives"
```

### Task 5: Migrate controls and operation-local loading states

**Files:**
- Modify: `src/web/components/{AtlasMenu,UnifiedSearch,FilesystemTree,SaveAsDialog,DesktopOnboarding,DeploymentPanel,FngkHeadHandoffPanel,LiveProjectPanel,PortSharingPanel,DeviceLifecyclePanel,AppConnectionsPanel,AgentChatPanel,IntelligencePanel}.svelte`
- Modify: `src/web/components/{FilePanel,PanelHost,FilesystemTree,UnifiedSearch}.svelte`
- Modify: `src/web/{enhancements,workspace,theme}.css`
- Modify: `test/web/{file-panel,panel-host,loading-state,unified-search,device-lifecycle-panel,agent-chat}.test.ts`
- Create: `test/web/form-migration.test.ts`

**Interfaces:**
- Consumes the Task 4 form primitive props, Task 3 cancellation behavior, and the existing loading-state components.
- Produces no new server API; each panel exposes operation-local `busy` state to its primitive controls.

- [ ] **Step 1: Write failing migration and loading tests**

Create a migration test listing approved exceptions and asserting user-facing raw `<select>`, standalone styled `<input>`, and `<textarea>` occurrences are absent from panel files. Extend representative panel tests to assert: profile selection uses `AtlasCombobox`; filesystem sort uses `AtlasSelect`; file opening and lazy panels show `LoadingState`; and a busy chat/deployment action renders a local spinner without disabling unrelated navigation.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- --run test/web/form-migration.test.ts test/web/file-panel.test.ts test/web/panel-host.test.ts test/web/loading-state.test.ts test/web/unified-search.test.ts test/web/device-lifecycle-panel.test.ts test/web/agent-chat.test.ts`  
Expected: FAIL because raw controls and incomplete loading paths remain.

- [ ] **Step 3: Migrate small/fixed controls to shared input/select/textarea primitives**

Replace panel-local visual styling while preserving bindings, submit handlers, validation, and existing labels. Use `AtlasSelect` for static sort/type choices and `AtlasInput`/`AtlasTextarea` for ordinary values and prompts.

- [ ] **Step 4: Migrate dynamic choices to searchable comboboxes**

Use `AtlasCombobox` for FNGK profiles and any dynamic context/device/root selection. Keep the current selected value visible during data reload; show inline retry/error state rather than clearing it.

- [ ] **Step 5: Complete local loading adoption and remove legacy styles**

Add explicit pending state around each async user operation that lacks one. Use `LoadingState` for lazy panels/content replacement and `LoadingSpinner` within triggering controls/rows. Remove superseded direct form selectors only after `rg` proves no live consumer remains.

- [ ] **Step 6: Run focused tests and web type-check**

Run: `npm test -- --run test/web/form-migration.test.ts test/web/file-panel.test.ts test/web/panel-host.test.ts test/web/loading-state.test.ts test/web/unified-search.test.ts test/web/device-lifecycle-panel.test.ts test/web/agent-chat.test.ts && npm run check:web`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/components src/web/enhancements.css src/web/workspace.css src/web/theme.css test/web
git commit -m "refactor(atlas): unify controls and loading states"
```

### Task 6: Validate the complete desktop workflow and remove proven-unused code

**Files:**
- Modify: only files identified by import/reference audit in Task 5
- Modify: `docs/atlas-frontend-architecture.md`
- Modify: `src/web/docs/{workspace,files,profiles}.md`
- Test: existing web, server, and browser suites

**Interfaces:**
- Consumes completed Tasks 1–4; no new runtime interface.
- Produces maintainer and user documentation that identifies the shared form system, device-list rail, and cancellation behavior.

- [ ] **Step 1: Write failing documentation/source-audit tests**

Extend `test/docs/atlas-frontend-architecture.test.ts` to require documentation of the three rail zones, `components/ui` primitive ownership, path-scoped request cancellation, and local loading-state policy. Add assertions that any removed legacy primitive has no import/reference.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- --run test/docs/atlas-frontend-architecture.test.ts`  
Expected: FAIL because the architecture documentation lacks the new system.

- [ ] **Step 3: Update documentation and safely delete obsolete code/styles**

Document how a future maintainer selects `AtlasSelect` versus `AtlasCombobox`, how to add an operation-local loader, and why cancellation is intentionally silent. Use `rg` before deletion; preserve compatibility CSS only when a remaining consumer requires it.

- [ ] **Step 4: Run complete verification**

Run: `npm test && npm run check:web && npm run build && npm run test:e2e`  
Expected: all tests pass, production web build succeeds, and browser workflows pass.

- [ ] **Step 5: Commit**

```bash
git add docs src test
git commit -m "docs(atlas): document unified workspace controls"
```

## Self-Review

- Spec coverage: Task 1 implements all shared minimization requirements; Task 2 implements the three-zone rail and device overflow behavior; Task 3 implements cancellation/recovery semantics; Task 4 creates the reusable form system; Task 5 migrates all consumers and loading states; Task 6 removes proven-unused code and documents the maintained architecture.
- Type consistency: all consumer tasks use the exact component prop names defined in Task 4; request keys use the existing `key(path)` normalization in Task 3.
- Review focus: every listed risk is assigned to Task 1, 2, 3, 4, or 5 with a named test step.
- Proportion: implementation decisions are captured as interfaces and file boundaries; the plan deliberately avoids source-code transcripts.
