# Atlas frontend architecture

## Rail, panel, form, and loading conventions

Atlas has one minimization lifecycle. `Workbench.svelte` retains a minimized panel descriptor and `PinnedRootsRail.svelte` displays every minimized panel through `MinimizedTray.svelte`. The right rail shows seven direct type-specific restore icons; extra panels belong in its typed overflow menu. There is no terminal-only dock or terminal-only minimized history. Minimizing a terminal changes presentation only and does not disconnect its stream.

`ActivityRail.svelte` has fixed top and bottom regions. Its device list is the sole scrollable middle region, using `RailScrollViewport.svelte`; native scrolling remains available while the browser scrollbar is hidden and chevrons signal more devices.

New user-facing controls use `src/web/components/ui/`: `AtlasInput`, `AtlasTextarea`, `AtlasSelect`, and `AtlasCombobox`. They own tokenized presentation, focus rings, disabled behavior, and accessibility; the enclosing panel owns validation, network work, errors, and busy state. `form-controls.css` supplies the same baseline to legacy native controls during migration, so do not create a new bespoke input/select style.

Use `LoadingSpinner.svelte` for a local action and `LoadingState.svelte` when pending work replaces panel content. Cancellation is normal control flow: `FilesystemTree.svelte` owns one `AbortController` per normalized path. Expanding one folder cannot cancel another; root/context changes and teardown cancel all pending requests. `FileService` must rethrow cancellation rather than turn it into a route-unavailable error.

Atlas is a Svelte 5 + Vite renderer in [`src/web`](../src/web), served by the local TypeScript process in [`src/server/index.ts`](../src/server/index.ts) and packaged through Tauri in [`desktop`](../desktop). It is a desktop workspace: presentation state belongs in the renderer; authentication, profile storage, terminal ownership, and Device authority remain in FNGK.

## Startup and boundaries

[`App.svelte`](../src/web/App.svelte) creates one `WorkbenchState`, discovers the active FNGK context, and mounts permanent chrome: title/menu, activity rail, Dockview workbench, shared right minimization rail, notifications, recovery and context menu. [`api.ts`](../src/web/lib/api.ts) is the renderer's only HTTP/WebSocket boundary. Do not add shell execution to a component.

```
App → Workbench → PanelHost (lazy panel) → API/WebSocket → server → FNGK
                  ↘ PanelRegistry / persisted layout
```

## Workbench and component catalog

[`Workbench.svelte`](../src/web/components/Workbench.svelte) owns Dockview. It converts `atlas:*` browser events into focus-or-create panels, persists only safe parameters, and retains minimized renderers. [`PanelHost.svelte`](../src/web/components/PanelHost.svelte) is the lazy-load map; add a panel there before registering an opening event.

| Surface | Owner | Purpose |
| --- | --- | --- |
| workspace / navigator / filesystem | `WorkspacePanel`, `Navigator`, `FilesystemTree` | permanent workspace and Device file navigation |
| terminals | `TerminalPanel` | one retained remote session renderer per Dockview terminal panel |
| databases, live projects, deployments | their matching `*Panel` | capability-scoped operational workflows |
| observability | `SemanticAtlas`, `MachineObservatory`, `LogsPanel`, `MetricsPanel` | current evidence, diagnostics, and activity |
| documentation | `DocumentationPanel` | bundled help, actions, and internal topic links |

The left rail opens durable workspace surfaces; the bottom dock restores minimized terminals. Closing a terminal panel detaches its renderer; it does not terminate the Device session. Explicit terminal actions perform termination or archival.

## Terminal lifecycle

`atlas:open-terminal` reaches `Workbench.openTerminal`, which creates or focuses `atlas.terminal` and passes a target/session request to [`TerminalPanel.svelte`](../src/web/components/TerminalPanel.svelte). The panel calls the `/api/fngk/terminals` WebSocket through `api.ts`; the server uses FNGK's JSONL protocol and its `TerminalSession` ownership. A ready message updates the safe session ID in the panel registry. Minimize retains the renderer and socket; restore reuses it. Disposal closes only the renderer socket. Never persist output, tokens, or credentials.

## Presentation and CSS

Base tokens and shell layout live in [`src/web/workspace.css`](../src/web/workspace.css). Components own scoped presentation; complex panels may have a sibling stylesheet (for example [`DocumentationPanel.css`](../src/web/components/DocumentationPanel.css)). Preserve the compact, keyboard-accessible desktop density. Use existing actions/header areas; do not introduce page navigation for a tool panel.

## Documentation system

[`documentation.ts`](../src/web/lib/documentation.ts) is the single source of truth: stable topic IDs, metadata, safe actions, and dynamic local Markdown imports. [`DocumentationPanel.svelte`](../src/web/components/DocumentationPanel.svelte) renders only headings, paragraphs, lists, fenced code, inline code, and `atlas-doc:` links—never raw HTML. [`DocumentationHelp.svelte`](../src/web/components/DocumentationHelp.svelte) emits the common open event. Validate topics and actions in Workbench before dispatching an Atlas event.

## Recovery, security, and verification

The lifecycle and handoff surfaces explain readiness and update paths; they do not synthesize destructive Device operations. Keep profile selection in FNGK and pass profile/context only through typed API requests. Before merging UI work run:

```bash
npm run typecheck
npm run check:web
npx vitest run test/web/documentation.test.ts
npm run test:e2e -- --grep "documentation|terminal"
```

| Change | Start with | Verify with |
| --- | --- | --- |
| panel lifecycle/layout | `Workbench.svelte`, `panel-registry.ts` | `e2e/workbench.spec.ts` |
| terminal behavior | `TerminalPanel.svelte`, `api.ts` | terminal e2e tests |
| docs/help | `documentation.ts`, `DocumentationPanel.svelte` | `test/web/documentation.test.ts` |
| visual shell | `workspace.css`, target component | `npm run check:web` |

## Manual acceptance checklist

- Open Documentation from the rail and with `Ctrl/Cmd+Shift+P`; verify the guide is readable with no network connection.
- Open contextual Help from Terminal, Filesystem, Database, Live Project, Deployment, Ports, Lifecycle, Logs, and Observatory; verify the matching topic opens.
- Dispatch an unknown topic only in development tools; verify the reader shows its recoverable unavailable state rather than throwing.
- Follow a related-tool action and verify it focuses or creates the intended standard workspace panel, never Operations unless that tool normally belongs there.
- With a live terminal open, open terminal documentation, minimize and restore the guide, then minimize and restore the terminal. The original session must remain live and no profile-switch confirmation should appear.
