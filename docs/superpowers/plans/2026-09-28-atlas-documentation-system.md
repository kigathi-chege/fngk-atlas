# Atlas Documentation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship local, contextual Atlas documentation for operators and a durable frontend architecture guide for human maintainers.

**Architecture:** Keep operator documentation as bundled, typed Markdown topics in the Svelte web bundle. A single registry maps stable topic IDs to Markdown loaders, related Atlas panel IDs, and typed panel-opening actions; the Documentation panel, contextual help controls, activity rail, and command palette all use this registry. Maintain the source-of-truth architecture guide separately in `docs/` with repository-relative source/test links.

**Tech Stack:** Svelte 5, TypeScript, Vite dynamic imports/raw Markdown, Dockview, lucide-svelte, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-atlas-documentation-system-design.md`

## Global Constraints

- Documentation is bundled locally; it must not fetch remote Markdown or external knowledge-base content.
- User-facing content must not expose credentials, desktop capability tokens, raw local configuration, or developer-only filesystem paths.
- Documentation opens in a lazy Dockview panel and must preserve terminals, profile selection, context, and workspace layout.
- All contextual help uses one `atlas:open-documentation` event carrying a validated stable topic ID.
- Guide-to-tool links must dispatch existing panel-opening events; no raw DOM selector or page-navigation coupling.
- Maintainer-document source/test references are repository-relative links without volatile line numbers.

## Review Focus

- Unknown or malformed topic IDs show an in-panel unavailable state; they never throw or navigate away.
- A minimized live terminal keeps the same socket and xterm renderer when the guide opens, minimizes, restores, or closes.
- Documentation content containing Markdown-like HTML or unsafe links is rendered as text or rejected; it never injects executable HTML.
- Opening a related tool focuses an existing panel before creating another one.
- A missing local Markdown module or panel mapping gives a clear recoverable error and leaves the rest of Atlas usable.

---

### Task 1: Define the local documentation domain and bundled content

**Files:**
- Create: `src/web/lib/documentation.ts`
- Create: `src/web/docs/workspace.md`
- Create: `src/web/docs/devices.md`
- Create: `src/web/docs/terminals.md`
- Create: `src/web/docs/files.md`
- Create: `src/web/docs/databases.md`
- Create: `src/web/docs/live-projects.md`
- Create: `src/web/docs/deployments.md`
- Create: `src/web/docs/observability.md`
- Create: `src/web/docs/recovery.md`
- Test: `test/web/documentation.test.ts`

**Interfaces:**
- Produces: `AtlasDocumentationTopic`, `AtlasDocumentationAction`, `atlasDocumentation`, `findDocumentationTopic(id)`, `loadDocumentationTopic(id)`, and `documentationTopicIds`.
- Consumes: stable existing panel IDs and event names from `src/web/components/Workbench.svelte`.

- [ ] **Step 1: Write failing registry tests**

Add tests that assert the registry has unique IDs, all topics have title/category/summary/loader, every loader returns non-empty local Markdown, and an unknown ID returns `undefined` rather than throwing.

- [ ] **Step 2: Run registry tests to verify failure**

Run: `npx vitest run test/web/documentation.test.ts`

Expected: FAIL because the documentation module does not exist.

- [ ] **Step 3: Implement the typed documentation registry**

In `src/web/lib/documentation.ts`, define a closed `DocumentationTopicId` union from the registry, use Vite raw imports through lazy module functions, and expose a pure lookup/load API. Action values must use an event name plus optional immutable detail, not a callback or selector.

- [ ] **Step 4: Write the initial local Markdown topics**

Each topic must state purpose, prerequisites, normal workflow, visible states, recovery guidance, and links to related local topic IDs. The terminal topic must explain retained sessions, reconnect, archive/restore, nested approvals, and the distinction between minimizing a panel and terminating a remote session.

- [ ] **Step 5: Run registry tests to verify success**

Run: `npx vitest run test/web/documentation.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/lib/documentation.ts src/web/docs test/web/documentation.test.ts
git commit -m "feat(atlas): add bundled documentation registry"
```

### Task 2: Add the lazy Documentation panel and safe Markdown renderer

**Files:**
- Create: `src/web/components/DocumentationPanel.svelte`
- Create: `src/web/components/DocumentationPanel.css`
- Modify: `src/web/components/PanelHost.svelte`
- Modify: `src/web/workspace.css`
- Test: `test/web/documentation.test.ts`

**Interfaces:**
- Consumes: `findDocumentationTopic`, `loadDocumentationTopic`, and `AtlasDocumentationAction` from Task 1.
- Produces: a `documentation` PanelHost kind accepting `{ topicId?: DocumentationTopicId }` and dispatching `atlas:open-documentation-action` for valid article actions.

- [ ] **Step 1: Extend tests for panel loading and unavailable topics**

Test that the panel loader exposes `documentation`, that a valid topic renders its title/content, and that a missing topic displays a recoverable “Documentation unavailable” state.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npx vitest run test/web/documentation.test.ts`

Expected: FAIL because the panel is unavailable.

- [ ] **Step 3: Implement `DocumentationPanel.svelte`**

Render an accessible article list/search control and selected article. Parse only the documented Markdown subset (headings, paragraphs, lists, fenced code, inline code, registry topic links); render all unsupported markup as text. Use the topic loader only after the panel mounts and after selection changes.

- [ ] **Step 4: Register the lazy panel**

Add a dynamic `documentation` loader to `PanelHost.svelte`; pass parameters and `WorkbenchState` using the same pattern as non-terminal informational panels. Add compact panel CSS in its own component stylesheet and only shared layout selectors to `workspace.css`.

- [ ] **Step 5: Verify the focused tests**

Run: `npx vitest run test/web/documentation.test.ts && npm run check:web`

Expected: PASS with zero Svelte diagnostics.

- [ ] **Step 6: Commit**

```bash
git add src/web/components/DocumentationPanel.svelte src/web/components/DocumentationPanel.css src/web/components/PanelHost.svelte src/web/workspace.css test/web/documentation.test.ts
git commit -m "feat(atlas): add local documentation panel"
```

### Task 3: Integrate guide navigation with the workbench, rail, and commands

**Files:**
- Modify: `src/web/components/Workbench.svelte`
- Modify: `src/web/components/ActivityRail.svelte`
- Modify: `src/web/lib/command-registry.ts`
- Modify: `src/web/components/UnifiedSearch.svelte`
- Test: `test/web/command-registry.test.ts`
- Test: `test/web/documentation.test.ts`
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- Consumes: `documentation` PanelHost kind and topic registry from Tasks 1–2.
- Produces: `atlas:open-documentation` handling, `atlas:open-documentation-action` handling, an accessible “Open documentation” rail control, and command-palette commands prefixed `Documentation:`.

- [ ] **Step 1: Write failing workbench and command tests**

Cover event validation, focus-or-create behavior for `atlas.documentation`, action dispatch to an existing Atlas panel event, and keyword search returning the documentation command.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npx vitest run test/web/command-registry.test.ts test/web/documentation.test.ts`

Expected: FAIL because no documentation command or workbench event exists.

- [ ] **Step 3: Add workbench documentation event handlers**

Implement `openDocumentation(topicId?)` in `Workbench.svelte`. Validate IDs through the registry; focus the existing panel and update its parameters or add one adjacent to the workspace. Implement guide action dispatch by emitting only the registry-approved existing Atlas event. Documentation must be non-operational: it belongs in the standard workspace, not the Operations dock.

- [ ] **Step 4: Add rail and command-palette entry points**

Add a labelled documentation control to `ActivityRail.svelte`. Register “Documentation: Open guide” plus one command per topic in the existing command registration flow used by `UnifiedSearch.svelte`; commands dispatch `atlas:open-documentation` rather than manipulating Dockview directly.

- [ ] **Step 5: Add browser workflow tests**

In `e2e/workbench.spec.ts`, assert the rail opens the Documentation panel, a guide action opens/focuses its related tool, and opening/closing documentation leaves an already-open terminal socket and terminal count unchanged.

- [ ] **Step 6: Run verification**

Run: `npx vitest run test/web/command-registry.test.ts test/web/documentation.test.ts && npm run check:web && npm run test:e2e -- --grep "documentation|terminal"`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/components/Workbench.svelte src/web/components/ActivityRail.svelte src/web/lib/command-registry.ts src/web/components/UnifiedSearch.svelte test/web/command-registry.test.ts test/web/documentation.test.ts e2e/workbench.spec.ts
git commit -m "feat(atlas): connect documentation to workspace navigation"
```

### Task 4: Add contextual help to supported Atlas surfaces

**Files:**
- Create: `src/web/components/DocumentationHelp.svelte`
- Modify: `src/web/components/TerminalPanel.svelte`
- Modify: `src/web/components/FilesystemTree.svelte`
- Modify: `src/web/components/DatabasePanel.svelte`
- Modify: `src/web/components/LiveProjectPanel.svelte`
- Modify: `src/web/components/DeploymentPanel.svelte`
- Modify: `src/web/components/PortSharingPanel.svelte`
- Modify: `src/web/components/DeviceLifecyclePanel.svelte`
- Modify: `src/web/components/LogsPanel.svelte`
- Modify: `src/web/components/MachineObservatory.svelte`
- Test: `test/web/documentation.test.ts`
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- Consumes: stable `DocumentationTopicId` from Task 1.
- Produces: `DocumentationHelp` with required `topicId` and accessible label; it dispatches `atlas:open-documentation` once per activation.

- [ ] **Step 1: Write failing help-control tests**

Assert that each supported surface declares a valid topic ID and that activating a help control emits the shared event with that ID. Include an explicit registry exemption list for backing/internal surfaces that have no direct user task.

- [ ] **Step 2: Run focused test to verify failure**

Run: `npx vitest run test/web/documentation.test.ts`

Expected: FAIL because contextual help controls are absent.

- [ ] **Step 3: Implement `DocumentationHelp.svelte`**

The component takes `{ topicId, label? }`, uses a lucide help icon, provides a visible tooltip and `aria-label`, and dispatches `atlas:open-documentation` with the topic ID. It must not import Dockview or manipulate panel state.

- [ ] **Step 4: Add panel-header help controls**

Place the shared component in the existing header/action area of each named user-facing panel. Reuse the existing title/action styling rather than adding panel-specific help designs.

- [ ] **Step 5: Add browser coverage**

Verify Terminal help opens the terminal article and leaves its live socket open; verify a non-terminal panel help control opens its matching article.

- [ ] **Step 6: Run verification**

Run: `npx vitest run test/web/documentation.test.ts && npm run check:web && npm run test:e2e -- --grep "documentation|terminal"`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/components/DocumentationHelp.svelte src/web/components/TerminalPanel.svelte src/web/components/FilesystemTree.svelte src/web/components/DatabasePanel.svelte src/web/components/LiveProjectPanel.svelte src/web/components/DeploymentPanel.svelte src/web/components/PortSharingPanel.svelte src/web/components/DeviceLifecyclePanel.svelte src/web/components/LogsPanel.svelte src/web/components/MachineObservatory.svelte test/web/documentation.test.ts e2e/workbench.spec.ts
git commit -m "feat(atlas): add contextual documentation help"
```

### Task 5: Write and validate the maintainer frontend architecture guide

**Files:**
- Create: `docs/atlas-frontend-architecture.md`
- Create: `test/docs/atlas-frontend-architecture.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: actual paths and behavior established in Tasks 1–4.
- Produces: the canonical maintainer guide linked from the README and a path-reference validity test.

- [ ] **Step 1: Write the failing document-validation test**

Test for required sections: stack/boundaries, startup, workbench, component catalog, terminal lifecycle, presentation/CSS, API/desktop bridge, recovery/security, and verification. Extract repository-relative Markdown links and assert each local target exists.

- [ ] **Step 2: Run the document test to verify failure**

Run: `npx vitest run test/docs/atlas-frontend-architecture.test.ts`

Expected: FAIL because the guide does not exist.

- [ ] **Step 3: Write `docs/atlas-frontend-architecture.md` from the source tree**

Use concise prose, Mermaid or ASCII flow diagrams where they clarify lifecycle, and tables for component ownership. Link all named source and test files. Explain the terminal path from Workbench open event through `TerminalPanel`, the Atlas WebSocket/API boundary, server-side `TerminalSession`, FNGK JSONL protocol, and cleanup/retention semantics. Include a change matrix naming the first files/tests a maintainer should inspect for each concern.

- [ ] **Step 4: Link it from the README**

Add a short “Atlas frontend architecture” link near the existing feature guides; do not duplicate the guide in the README.

- [ ] **Step 5: Run document and full project verification**

Run: `npx vitest run test/docs/atlas-frontend-architecture.test.ts && npm test && npm run typecheck && npm run check:web && npm run build && npm run test:e2e`

Expected: all commands PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/atlas-frontend-architecture.md test/docs/atlas-frontend-architecture.test.ts README.md
git commit -m "docs(atlas): add frontend maintainer guide"
```

### Task 6: Perform an integrated documentation and desktop regression review

**Files:**
- Modify: `e2e/workbench.spec.ts`
- Modify: `docs/atlas-frontend-architecture.md`

**Interfaces:**
- Consumes: complete local guide, workbench integration, and maintainer documentation from Tasks 1–5.
- Produces: documented manual acceptance steps and end-to-end proof for the no-session-loss guarantee.

- [ ] **Step 1: Add the final end-to-end regression case**

Exercise: open a terminal; create or select a live session; open its contextual documentation; follow an article action; minimize and restore the guide; then confirm the original terminal panel/socket/session remains live and no profile-switch confirmation appears.

- [ ] **Step 2: Run the focused regression test**

Run: `npm run test:e2e -- --grep "documentation preserves terminal"`

Expected: PASS.

- [ ] **Step 3: Add a maintainer acceptance checklist**

Append a concise checklist to the architecture guide covering keyboard-only guide access, offline content, contextual help mapping, unknown-topic recovery, related-tool focus behavior, and terminal continuity.

- [ ] **Step 4: Run final verification**

Run: `npm test && npm run typecheck && npm run check:web && npm run build && npm run test:e2e`

Expected: all commands PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/workbench.spec.ts docs/atlas-frontend-architecture.md
git commit -m "test(atlas): verify documentation workspace continuity"
```
