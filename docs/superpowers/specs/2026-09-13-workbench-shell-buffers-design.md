# Atlas Workbench Shell and Buffer Design

## Purpose

Make Atlas feel like a coherent systems IDE before extending the database workbench. The application shell must remain operable when every Dockview panel is closed, terminal views must not multiply remote sessions, new files must begin as editable buffers, and all navigation surfaces must share one deliberate visual language.

This work precedes completion of the in-progress DbGate slice. Existing database changes remain preserved but are outside this implementation boundary.

## Product principles

- Signal is the control plane, FNGK owns remote machine sessions, and Atlas owns only presentation and attachment state.
- Persistent application chrome must live outside Dockview and cannot be dismissed.
- Closing a view must not silently terminate or create a remote resource.
- A generic open action reuses an existing view or session. Creation requires an explicit create action.
- Unsaved file bodies remain in browser memory and never enter persisted Dockview layout or Atlas storage.
- Destructive actions remain explicit and confirmed; file creation is exclusive and cannot overwrite an existing path.
- Docked panels are the default. Floating, minimizing, and popout behavior are opt-in.

## Workbench shell

The application shell has four persistent regions:

1. A title and command bar across the top.
2. A permanent activity/context rail on the left.
3. A central Dockview workspace.
4. A permanent pinned-folder/workspace rail on the right.

The title bar and both rails remain available when Dockview contains no panels. An empty Dockview shows a quiet recovery surface, but recovery does not depend on that surface because every persistent rail command can recreate its panel.

The expanded left context/sidebar and right filesystem/sidebar use the same default width and remain visibly secondary to the wider central work area. Their narrow permanent activity strips remain outside Dockview; minimizing either sidebar collapses it into its corresponding strip without offering Close. The terminal stays in the central Dockview column between the two expanded sidebars rather than spanning beneath them.

### Left rail

The left rail contains the FNGK contexts and primary workbench destinations: Explorer, Search, Architecture, Terminal, Databases, Evidence, and Settings. Context identity and reachability remain visible without opening a Dockview panel. Selecting a context scopes newly opened surfaces; already-open resources retain their original context identity.

Each destination uses an idempotent command: activate the existing panel when present, otherwise reconstruct it from a safe descriptor. The rail itself is not represented by a Dockview panel.

### Right rail

The right rail contains context-bound folder shortcuts. Entries show a compact folder icon, name, context badge, reachability state, and tooltip with the full path. Clicking an entry opens or focuses the filesystem at that root.

Two concepts remain distinct:

- **Pin Folder** adds a navigation shortcut only.
- **Add Workspace Root** adds a root to repository search and analysis scope and also pins it.

Every stored entry contains `contextId`, `path`, display name, and kind. A root never silently transfers to another context. Unpinning a folder does not remove it from a workspace; removing a workspace root is a separate action.

## Command system

A central command registry is the single source for title-bar buttons, rails, keyboard shortcuts, context menus, and the command palette. Initial commands include:

- New File (`Ctrl/Cmd+N`)
- Save (`Ctrl/Cmd+S`)
- Save As (`Ctrl/Cmd+Shift+S`)
- Open/Focus Explorer
- Open/Focus Search
- Open/Focus Architecture
- Open/Focus Terminal
- Open/Focus Databases
- Open/Focus Evidence
- Minimize Active Panel
- Float Active Panel
- Dock Active Panel
- Reset Workspace Layout

The command palette is a searchable overlay with keyboard navigation. It is not an alias for contextual search.

## Unified search

The title bar contains one primary search field and one unified result collection. It replaces separate competing search presentations while retaining provider-specific routes internally. The collection combines indexed Atlas entities, live file name/content matches, contexts, terminal sessions, panels, and registered commands; every result carries its type, context, provenance, and actionable target.

Search defaults to the selected context. An explicit All Contexts scope broadens persisted evidence, context, command, and panel results; live filesystem search remains bounded to an individually identified reachable context. Type filters refine the single collection without opening separate search applications. Selecting a result opens or focuses the corresponding file, graph entity, process, terminal session, context, panel, or command.

## Terminal ownership and lifecycle

Atlas separates three identities:

- **FNGK terminal session:** the durable remote shell known by Signal.
- **Attachment:** the current WebSocket connection to a session.
- **Panel:** the single default Dockview terminal surface.

There is one default panel ID, `atlas.terminal`. Generic Open Terminal activates that panel and attaches to the most recently active usable session for the selected Device. It creates a session only when the Device has no reusable session. The explicit plus action always creates a new session.

Selecting a session in the terminal rail replaces the attachment inside the current terminal panel. It does not create another Dockview tab. Switching first invalidates reconnect timers and the old socket generation, then detaches the old socket and attaches the selected session. A late event from an earlier socket is ignored.

Closing the panel detaches the view only. Terminate and archive are separate confirmed operations. The UI uses the lifecycle states Opening, Connecting, Live, Reconnecting, Detached, Stopped, Archived, and Failed.

The session rail:

- shows only sessions relevant to the selected Device by default;
- separates active and archived sessions;
- displays active/live/detached totals;
- assigns deterministic colors by session ID;
- supports select, rename, reconnect, terminate, archive, restore, and explicit new session;
- warns before creating a session when the configurable active-session threshold is reached.
- scrolls independently when sessions exceed the available height;
- shows a readable session name beside its status color and exposes compact quick actions without requiring a new Dockview tab.

Atlas does not automatically terminate user sessions when a panel closes. It may offer explicit cleanup for detached or stopped sessions, but cleanup never runs silently.

## File buffers and creation

### Untitled buffers

New File or `Ctrl/Cmd+N` creates `Untitled-N` in CodeMirror immediately. A buffer has a stable browser-memory ID, context ID, content, dirty state, optional suggested directory, optional proposed filename, and optional persisted resource identity.

Buffer contents are held in a dedicated in-memory buffer store outside Dockview parameters. Persisted layout contains only safe panel descriptors. Reload and window-close guards warn when unsaved buffers exist.

### Explorer creation

New File on a folder inserts an inline placeholder row directly beneath that folder and focuses its filename input. Enter validates the name and opens an unsaved buffer associated with the proposed path. Escape cancels the placeholder. No host file is created at this stage.

New Folder remains an immediate filesystem operation because it has no editable content. Its inline name editor clearly shows the target parent and refreshes the tree after success.

### First save and Save As

First save opens an Atlas-styled path picker when the buffer lacks a complete proposed path. The picker chooses context, pinned/workspace root or directory, and filename. It never falls back silently to `/`.

The first write uses an exclusive create operation and returns the new fingerprint. If the destination exists, Atlas reports a conflict and leaves the buffer intact. After success, the panel becomes a normal tracked file editor and the filesystem reveals the new path.

Save As always creates a distinct file exclusively. Existing-file Save retains fingerprint conflict detection and atomic replacement semantics.

## Context menus

Atlas supplies consistent keyboard-accessible context menus for:

- Files and folders
- Filesystem background and current root
- Pinned/workspace roots
- Dockview tabs
- Minimized panel entries
- Terminal sessions

Filesystem background actions include New File, New Folder, Refresh, Pin Current Folder, and Add Workspace Root. Folder and file menus add relevant open, rename, copy-path, move-to-trash, and permanent-delete actions. Menus close on Escape, outside click, context change, or completed action.

## Minimize, auto-hide, float, and dock

Dockview 8.3.1 supports maximization, edge-group collapse/expand, auto-hide edge groups, floating groups, docking a floated group, and browser popouts. It does not expose conventional per-tab minimization.

Atlas implements panel minimization through a safe panel registry. Minimizing removes the rendered panel from Dockview while retaining only its reconstructable descriptor in an edge tray. Dirty and untitled editor content remains in the in-memory buffer store. Clicking the minimized entry recreates or activates the panel. Closing is distinct from minimizing and still invokes dirty-buffer protection.

Float uses Dockview's native floating-group API. A floated panel may be dragged to a Dockview drop target to dock again. Terminal and editor renderers must refit after location and size changes. Docked remains the default; browser popout is not exposed in this initial slice because it complicates credential, focus, and lifecycle boundaries.

## Visual system

The presentation pass consolidates accumulated CSS overrides into a small set of workbench tokens and component classes:

- surfaces: canvas, rail, panel, raised menu, dialog;
- borders and resize affordances;
- primary, muted, accent, warning, danger, and focus colors;
- compact spacing and control heights;
- typography for labels, code, metadata, and status;
- consistent hover, active, selected, disabled, stale, and focus-visible states.

The rails use restrained iconography, clear active indicators, concise tooltips, and no oversized text controls. Searches share one input/result visual pattern with type icons, context provenance, highlighted matches, empty/loading/error states, and sensible truncation. Filesystem rows align chevrons, file icons, names, size, modification time, permissions, and state indicators. Menus and dialogs use consistent elevation and keyboard focus.

Desktop and narrow layouts retain both rails as compact strips. Expanded rail details may collapse responsively, but the commands remain reachable. Motion is limited to useful panel, menu, and auto-hide transitions and respects reduced-motion preferences.

Dockview groups use rounded framed surfaces separated by canvas-colored empty gutters. Resize sashes keep a generous invisible hit target but render only the gap and a centered three-dot grip, horizontal or vertical according to orientation. Atlas-owned tab chrome provides Minimize and Close buttons; sidebars provide Minimize only. Minimized panels appear as named, icon-bearing entries in the bottom restoration tray. Native floating remains opt-in and can be redocked through Dockview targets.

## State and persistence

Persisted browser state may contain:

- Dockview safe descriptors and layout;
- minimized reconstructable descriptors;
- pinned folders and workspace roots with context IDs;
- last active workbench destination;
- display preferences.

It must not contain editor bodies, terminal output, terminal credentials, database credentials, session tokens, screenshots, or raw diagnostic streams. Invalid or obsolete descriptors are ignored individually rather than invalidating the whole workspace.

## Failure behavior

- Offline contexts remain visible and clearly stale; actions explain why they are unavailable.
- A failed terminal attachment does not create another session automatically.
- A failed first file save preserves the buffer and proposed destination.
- Closing or minimizing one panel cannot strand the workbench.
- Restoring an unavailable panel leaves a recoverable minimized entry with an error state.
- Context changes cancel transient menus, inline creation, and stale searches without reassigning existing buffers or sessions.

## Verification

Tests must prove:

- generic terminal open reuses one panel and does not create repeated sessions;
- explicit plus creates one session and switching replaces the current attachment;
- close detaches while terminate/archive use their explicit APIs;
- session lists are Device-scoped and duplicate sockets are rejected;
- both persistent rails survive an empty Dockview and restore panels;
- pinning and workspace-root semantics remain context-bound across reloads;
- right-click and keyboard context menus work on rows, roots, tabs, and minimized entries;
- minimize/restore and float/dock preserve panel identity and dirty buffers;
- `Ctrl/Cmd+N`, inline creation, Save, and Save As preserve unsaved content and use exclusive creation;
- no buffer or secret content is persisted;
- desktop and narrow layouts have no overflow, clipped controls, dead actions, or console errors;
- visual snapshots cover the default shell, search, filesystem creation, terminal sessions, minimized tray, floating panel, command palette, and dialogs.

The full Atlas unit, Svelte, TypeScript, production-build, and Playwright suites must pass before this slice is committed. The existing DbGate working tree is then rebased conceptually onto these stable shell commands and visual primitives before Task 10 resumes.
