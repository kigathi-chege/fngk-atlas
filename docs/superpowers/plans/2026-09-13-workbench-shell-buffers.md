# Atlas Workbench Shell and Buffers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a presentation-ready Atlas shell with persistent rails, bounded terminal-session ownership, panel minimize/float controls, real commands, and VS Code-style unsaved file buffers.

**Architecture:** Persistent application chrome surrounds a central Dockview and calls a typed command registry. Remote terminal sessions, WebSocket attachments, Dockview panels, file buffers, and filesystem resources have separate identities. Reconstructable UI descriptors may persist, while editor bodies, terminal output, credentials, and tokens remain memory-only.

**Tech Stack:** Svelte 5, TypeScript, Dockview 8.3.1, CodeMirror 6, xterm.js, Fastify, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-workbench-shell-buffers-design.md`

## Global Constraints

- Preserve the uncommitted Task 10 DbGate files; do not include them in commits for this plan.
- Generic terminal open reuses an existing session and the single `atlas.terminal` panel; only explicit New Session creates one.
- Both application rails live outside Dockview and remain usable when Dockview is empty.
- Never persist editor bodies, terminal output, credentials, tokens, screenshots, or diagnostic streams.
- First file save and Save As are exclusive creates and never overwrite an existing resource.
- Docked panels remain the default; floating and minimizing are explicit actions.
- Each task uses red-green-refactor TDD and ends with a focused commit.

---

### Task 1: Typed command and safe panel registries

**Files:**
- Create: `src/web/lib/command-registry.ts`
- Create: `src/web/lib/panel-registry.ts`
- Test: `test/web/command-registry.test.ts`
- Test: `test/web/panel-registry.test.ts`

**Interfaces:**
- Produces `AtlasCommandRegistry.register(command)`, `execute(id)`, `search(query)`, and `subscribe(listener)`.
- Produces `PanelRegistry.remember(descriptor)`, `minimize(id)`, `restore(id)`, `forget(id)`, and `persistable()`.
- `PanelDescriptor` contains `id`, `kind`, `title`, optional safe `params`, placement, and minimized state; volatile keys are rejected.

- [ ] Write failing tests proving canonical command execution/search, duplicate rejection, panel minimize/restore, and exclusion of content, output, credentials, and tokens.
- [ ] Run `npx vitest run test/web/command-registry.test.ts test/web/panel-registry.test.ts` and verify missing-module failures.
- [ ] Implement the two focused registries with deterministic ordering, safe parameter projection, and subscription cleanup.
- [ ] Run focused tests and `npm run typecheck`.
- [ ] Commit Task 1 files as `feat(web): add Atlas command and panel registries`.

### Task 2: Single terminal surface and controlled session creation

**Files:**
- Modify: `src/web/components/Workbench.svelte`
- Modify: `src/web/components/TerminalPanel.svelte`
- Modify: `src/server/app.ts`
- Test: `test/server/app.test.ts`
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- Consumes the Task 1 registries.
- Produces one `atlas.terminal` panel and an in-panel `selectSession(sessionId)` transition.
- Generic `atlas:open-terminal` carries `{contextId?,sessionId?,create?:false}`; explicit `atlas:new-terminal-session` carries `{contextId,create:true}`.

- [ ] Add failing server tests for Device-filtered session lists and active/live/detached counts.
- [ ] Add failing browser tests proving two generic opens produce one terminal panel and no explicit session-create request, while plus produces exactly one.
- [ ] Run focused tests and verify the current random-panel/new-session behavior fails them.
- [ ] Change Workbench terminal opening to reuse `atlas.terminal` and update parameters rather than creating random panel IDs.
- [ ] Change TerminalPanel session clicks to switch socket generation in place, filter by Device, clear reconnect state, and create only from plus.
- [ ] Add session counts and a creation warning threshold defaulting to 5 active sessions per Device.
- [ ] Run focused server/browser tests, Svelte check, and typecheck.
- [ ] Commit Task 2 files as `fix(terminal): reuse one controlled Atlas terminal surface`.

### Task 3: Persistent rails and context-bound roots

**Files:**
- Create: `src/web/lib/workspace-roots.ts`
- Create: `src/web/components/ActivityRail.svelte`
- Create: `src/web/components/PinnedRootsRail.svelte`
- Modify: `src/web/App.svelte`
- Modify: `src/web/components/Workbench.svelte`
- Modify: `src/web/components/Navigator.svelte`
- Test: `test/web/workspace-roots.test.ts`
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- Produces `WorkspaceRootsStore.pin`, `unpin`, `addWorkspace`, `removeWorkspace`, `forContext`, and `persistable`.
- Produces right-rail `atlas:open-root` events containing immutable `{contextId,path}`.

- [ ] Add failing tests proving pin/workspace distinction, context isolation, deduplication, and safe persistence.
- [ ] Add a failing browser test proving both rails remain after all Dockview groups close and can restore Explorer.
- [ ] Implement the roots store and mount both rails as App siblings of Workbench, never as Dockview panels.
- [ ] Keep contextual details/search reconstructable while moving primary destinations and context identity into the permanent left rail.
- [ ] Wire right-rail entries to restore FilesystemTree at the captured context and path.
- [ ] Run focused tests, Svelte check, typecheck, and browser tests.
- [ ] Commit Task 3 files as `feat(web): add persistent Atlas workspace rails`.

### Task 4: Context menus, minimize tray, and floating panels

**Files:**
- Create: `src/web/components/WorkbenchContextMenu.svelte`
- Create: `src/web/components/MinimizedTray.svelte`
- Modify: `src/web/components/AtlasContextMenu.svelte`
- Modify: `src/web/components/FilesystemTree.svelte`
- Modify: `src/web/components/Workbench.svelte`
- Test: `test/web/panel-registry.test.ts`
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- Produces commands `panel.minimize`, `panel.restore`, `panel.float`, and `panel.dock`.
- Uses `dock.addFloatingGroup(panel)` for opt-in floating and safe descriptors for minimization.

- [ ] Add failing browser tests for file-row, filesystem-background, tab, and minimized-entry context menus plus Escape/outside dismissal.
- [ ] Add failing registry tests proving minimized dirty-buffer descriptors remain reconstructable.
- [ ] Implement filesystem background actions: New File, New Folder, Refresh, Pin Current Folder, and Add Workspace Root.
- [ ] Implement tab minimize/restore and native float/dock actions; keep close semantically distinct.
- [ ] Refit CodeMirror and xterm after Dockview size/location changes.
- [ ] Run focused unit/browser tests, Svelte check, and typecheck.
- [ ] Commit Task 4 files as `feat(web): add panel lifecycle and context menus`.

### Task 5: Memory-only buffers and exclusive first save

**Files:**
- Create: `src/web/lib/buffer-store.ts`
- Modify: `src/web/components/FilePanel.svelte`
- Modify: `src/web/components/PanelHost.svelte`
- Modify: `src/web/components/Workbench.svelte`
- Modify: `src/server/app.ts`
- Test: `test/web/buffer-store.test.ts`
- Test: `test/server/app.test.ts`

**Interfaces:**
- Produces `BufferStore.create`, `update`, `bindResource`, `remove`, `get`, `subscribe`, and `hasDirty`.
- Produces `POST /api/files/content` with `{contextId,path,contentBase64,createOnly:true}` returning `{path,fingerprint,route,operation}`.
- Produces events `atlas:new-buffer`, `atlas:save-buffer`, and `atlas:buffer-saved`.

- [ ] Add failing buffer tests for unique Untitled names, memory-only bodies, dirty transitions, resource binding, and close protection.
- [ ] Add failing server tests proving exclusive first save succeeds once and a second create returns 409 without overwriting.
- [ ] Implement BufferStore without localStorage or Dockview serialization.
- [ ] Implement exclusive content creation through existing FileService route selection and operation evidence.
- [ ] Make FilePanel initialize from a resource or buffer ID and transition to fingerprint-backed mode after first save.
- [ ] Register New File, Save, and Save As keyboard commands through the command registry.
- [ ] Run focused tests, Svelte check, and typecheck.
- [ ] Commit Task 5 files as `feat(files): add memory-only editor buffers`.

### Task 6: Inline creation and Save As

**Files:**
- Create: `src/web/components/SaveAsDialog.svelte`
- Modify: `src/web/components/FilesystemTree.svelte`
- Modify: `src/web/components/FilePanel.svelte`
- Modify: `src/web/components/Workbench.svelte`
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- Consumes BufferStore, WorkspaceRootsStore, and exclusive file creation.
- Explorer New File produces `{contextId,suggestedDirectory,proposedPath}` without host mutation.

- [ ] Add failing Playwright coverage for `Ctrl/Cmd+N`, Untitled editing, inline filename Enter/Escape, Save As, conflict retention, and filesystem reveal.
- [ ] Implement inline filename rows with validation, focus, Enter, and Escape behavior.
- [ ] Implement SaveAsDialog with immutable buffer context, pinned/workspace root selection, directory, filename, validation, and cancellation.
- [ ] Wire first save and Save As to exclusive creation, preserve buffers after errors, and reveal successful files.
- [ ] Run browser tests, Svelte check, typecheck, and focused server tests.
- [ ] Commit Task 6 files as `feat(files): add inline creation and Save As`.

### Task 7: Presentation-quality visual system

**Files:**
- Create: `src/web/theme.css`
- Modify: `src/web/styles.css`
- Modify: `src/web/enhancements.css`
- Modify: new shell components only where semantic classes are required
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- Produces tokens for surfaces, borders, spacing, typography, status, focus, elevation, and motion.

- [ ] Add browser assertions for desktop and 620px layouts, visible focus, no horizontal overflow, reachable commands, and zero console errors.
- [ ] Define and import the theme tokens before component styles.
- [ ] Consolidate conflicting shell, rail, search, tree, menu, dialog, and tab rules; remove superseded declarations.
- [ ] Style provenance, loading/empty/error states, metadata, session counts, roots, minimized tray, palette, Save As, and floating groups.
- [ ] Add reduced-motion behavior and validate focus contrast.
- [ ] Capture and inspect screenshots for default, search, inline creation, terminal sessions, minimized panel, floating panel, palette, and Save As at desktop and narrow sizes.
- [ ] Run browser tests and commit Task 7 files as `feat(web): finish Atlas presentation system`.

### Task 8: Whole-slice verification and DbGate boundary

**Files:**
- Modify: `README.md`
- Modify: `.superpowers/sdd/2026-09-13-context-database-live-project/progress.md`
- Test: all Atlas tests

**Interfaces:**
- Produces the stable shell contract consumed by the existing DatabasePanel and its command.

- [ ] Run `npm test`, `npm run check:web`, `npm run typecheck`, and `npm run build`.
- [ ] Run `npm run test:e2e` and inspect final desktop/narrow screenshots.
- [ ] Run `git diff --check`, dependency audit reporting, and scans proving volatile bodies and secrets were not persisted.
- [ ] Review every requirement in the approved spec and correct gaps with focused regression tests.
- [ ] Update documentation and the execution ledger with exact evidence.
- [ ] Commit documentation and request final code review before resuming DbGate.
