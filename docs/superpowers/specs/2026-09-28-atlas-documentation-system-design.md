# Atlas documentation system design

## Purpose

Atlas needs two connected documentation surfaces that remain useful after the
original implementation team has moved on:

1. a maintainer guide that explains the actual frontend architecture and its
   operational boundaries; and
2. a local, in-product guide that lets an Atlas user understand the feature in
   front of them without leaving the desktop application.

The documentation is part of the product. It must remain available offline,
match the installed Atlas version, preserve the active workspace, and never
turn a help action into a terminal disconnect or profile switch.

## Audience and non-goals

The maintainer guide is for a human developer changing, debugging, replacing,
or extending Atlas. It explains intent, ownership, data flow, failure modes,
and safe change points. It is not generated API reference and must not pretend
that every internal implementation detail is a public contract.

The in-product guide is for operators using Atlas. It describes actions,
requirements, expected states, recovery paths, and relationships between Atlas
and FNGK. It must not display credentials, desktop capability tokens, raw local
configuration, or developer-only filesystem details.

This work does not create a remote documentation service, an account-backed
knowledge base, or a new server API. The guide is bundled local content.

## Current architecture to document

Atlas is a Svelte 5 web workbench bundled by Vite and served by its Fastify
host. The optional native shell is Tauri. Browser-to-host calls pass through
the Atlas HTTP/WebSocket API; native-only operations pass through the typed
desktop bridge. FNGK remains the authority for profiles, Device work, and
terminal sessions.

`src/web/App.svelte` owns startup state, profile selection, context discovery,
and top-level persistence. `Workbench.svelte` owns the permanent Dockview
workspace chrome, panel placement, minimize/restore behavior, layout
persistence, and retained renderers. `PanelHost.svelte` is the lazy panel
boundary. `workbench-state.ts`, `panel-registry.ts`, `buffer-store.ts`,
`workspace-persistence.ts`, and `command-registry.ts` hold the frontend's
long-lived state and interaction contracts.

Terminal presentation lives in `TerminalPanel.svelte`. It renders xterm,
lists retained sessions, opens the terminal WebSocket, forwards input and
resize events, handles server protocol events, requests nested approvals, and
offers reconnect, stop, archive, restore, and rename actions. The Fastify-side
`TerminalSession` client starts the FNGK JSONL process, validates protocol
version, redacts process errors, owns the child process, and exposes typed
commands. Panel minimization retains the mounted renderer for terminals, so
hiding or moving a terminal does not terminate the remote FNGK session.

The documentation must explain these facts with direct source and test links,
not duplicate them vaguely.

## Documentation content model

Create a typed registry in the web layer. A guide topic has a stable ID,
human title, category, bundled Markdown source, short summary, related panel
kinds, and zero or more actions that open a corresponding Atlas tool. The
registry is the sole mapping between UI surfaces and user documentation.

Bundled Markdown source is imported at build time and rendered locally. The
renderer supports headings, paragraphs, lists, code blocks, internal topic
links, and action links. It does not render arbitrary HTML. Internal links are
resolved through the registry; unknown IDs render a clear unavailable state
instead of navigating to a broken URL.

The initial guide catalog covers:

- Workspace and panels;
- profiles, contexts, and Devices;
- terminals and session recovery;
- files and editors;
- databases;
- Live Projects and port sharing;
- deployments;
- observability and logs;
- onboarding, installation, and recovery.

Topics may reference FNGK capabilities or API concepts in plain language, but
only a developer guide describes implementation-facing endpoints in detail.

## In-product interaction design

Add a lazy `DocumentationPanel` to `PanelHost` and register it as a normal
Dockview panel. It has a searchable topic list, a selected article, breadcrumb
context, and actions to open associated Atlas panels. Opening documentation
uses the existing workbench event and panel mechanisms; it does not use page
navigation.

The left activity rail receives one documentation entry. The command registry
receives a command for opening the guide and commands for opening individual
topics. Relevant feature panels receive a compact, labelled help button in the
panel header. It emits one standard `atlas:open-documentation` event containing
the stable topic ID. A single workbench handler opens or focuses the
Documentation panel and sets the selected topic.

The guide links back to Atlas tools through typed actions, not raw DOM selectors
or route strings. An action maps to an existing panel-opening event. The
workbench focuses an existing panel where possible and opens one otherwise.
This preserves workspace continuity and avoids duplicate tools.

## Maintainer guide structure

Create `docs/atlas-frontend-architecture.md` as the canonical human
maintainer document. It includes:

1. orientation, supported execution modes, and ownership boundaries;
2. startup, profile/context selection, and persistence;
3. a workbench anatomy diagram and layout/minimize/restore rules;
4. a component catalog grouped by responsibility, with direct source and test
   links;
5. frontend data and event flow, including API, WebSocket, and desktop bridge
   boundaries;
6. terminal session lifecycle from user intent to FNGK child process and back;
7. presentation architecture: theme tokens, global styles, workspace styles,
   and component CSS ownership;
8. error, recovery, and security behavior;
9. a practical change guide and verification matrix.

It must use repository-relative links so it works on GitHub and in local
editors. It must name source files precisely, but avoid line numbers that will
immediately become stale.

## Accessibility, performance, and safety

All help controls have visible labels or accessible names. The Documentation
panel is keyboard reachable through the rail and command palette. It is loaded
only when opened. Markdown is static, local, and sanitized by construction;
external network content is not fetched. Documentation interactions never
send terminal input, alter a FNGK profile, or change a remote session.

The documentation registry must not make all Markdown pages part of the
initial workbench chunk. Panel lazy loading and topic-module lazy loading are
preserved where Vite supports them.

## Verification

Unit tests cover registry validity, all panel topic references, safe local
content loading, unknown topic handling, and action-to-panel mappings. Browser
tests cover opening the guide from the rail, opening contextual help from a
panel, following a guide action to a related tool, keyboard access, and the
fact that documentation activity does not destroy an existing terminal panel.

The maintainer guide is reviewed against the actual source tree and links are
checked by a lightweight test that ensures referenced local paths exist.

## Acceptance criteria

- A future maintainer can trace terminal initialization, rendering, retention,
  reconnect, and cleanup from one local Markdown document.
- Every supported Atlas panel has either a contextual help topic or an explicit
  documented exemption because it is an internal supporting surface.
- A user can open the offline guide from the activity rail or command palette,
  then open an associated Atlas tool from the relevant article.
- Documentation does not replace or disconnect a terminal, change profile, or
  issue a remote command.
- The maintained documentation and the UI registry are validated by automated
  tests.
