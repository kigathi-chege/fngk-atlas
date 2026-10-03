# Atlas device identity, rail navigation, and loading-state design

**Status:** approved for specification; awaiting human review before implementation planning  
**Date:** 2026-10-03  
**Owners:** FNGK Atlas maintainers

## Purpose

Atlas is a desktop workspace, not a collection of pages. A person working across several FNGK Devices must be able to tell which Device owns a tab at a glance, reach device administration without a shell, and understand when Atlas is waiting for a remote operation.

This change makes the activity rail legible at high device counts, promotes the existing lifecycle surface into a practical Devices control center, and introduces a single accessible loading language. It preserves terminal and connection lifetimes: changing layout, scrolling a rail, assigning a color, and opening or replacing a preview must never create, disconnect, or destroy a device session.

## Goals and success criteria

1. The left rail hides native scrollbars while retaining wheel, touchpad, keyboard, and programmatic scrolling. It visibly and accessibly indicates scrollable content above and below.
2. The rail exposes the primary workspace activities in a stable order, with Device contexts separately scrollable from global actions.
3. The Devices page gives a user safe, explicit lifecycle actions: disconnect, retire/unpair, and permanently delete when the connected FNGK control plane advertises that capability.
4. A user can choose a persistent presentation color for a Device. The color is visible on its rail icon and device-scoped tabs without altering the remote Device or its FNGK record.
5. Preview file tabs have italic titles instead of a literal `preview` suffix. Pinning, editing, or saving restores ordinary tab typography.
6. Every meaningful asynchronous wait has a consistent rotating progress indicator, including folder expansion, file opening, lazy-panel loading, and search.
7. Existing remote session continuity, keyboard navigation, documentation links, and screen-reader feedback remain intact.

## Non-goals

- This does not introduce a new generic docking library or replace Dockview.
- Device colors are not synchronised to Signal, FNGK, another Atlas installation, or other users in this release.
- Atlas will not synthesize destructive remote shell commands. Lifecycle actions are only enabled through an explicit, verified control-plane capability.
- This is not a broad visual redesign of unrelated panels.

## Current implementation context

`ActivityRail.svelte` currently presents two global actions, a scrollable list of contexts, and utility actions. Its context list has competing scrollbar rules in `enhancements.css`; current styling may expose a native scrollbar. `DeviceLifecyclePanel.svelte` reports readiness and recovery paths, but intentionally has no verified deletion operation. `Workbench.svelte` still decorates file tab titles with ` · preview`. `FilesystemTree.svelte`, `FilePanel.svelte`, `UnifiedSearch.svelte`, and lazy panel loading all represent waits independently, mostly as text.

The implementation must reuse the existing event boundary (`atlas:*` browser events), `WorkbenchState`, panel registry, API client, and Dockview tab components. It must not route lifecycle changes through a terminal.

## Proposed user experience

### Activity rail

The rail remains narrow and icon-led. It is organized into three deliberate regions:

```text
Brand
Workspace: Devices · Sessions · Agent Chat · Connections · Services · Deployments · Documentation
────────────────────────────────────────────────────────────────────────────────────────────
Device contexts
  ↑  only when content exists above the visible viewport
  [colored device icons, current context marker, online state]
  ↓  only when content exists below the visible viewport
────────────────────────────────────────────────────────────────────────────────────────────
Utilities: Search · Files · Terminal · Command palette · Refresh
```

The context viewport uses a reusable `RailScrollViewport` component. It renders invisible scrollbar styling for supported engines and an explicit top/bottom chevron control only when the corresponding direction is scrollable. Controls scroll by a sensible viewport fraction, are focusable, use `aria-label` values such as “Show earlier Devices”, and disappear at the endpoint. The underlying viewport remains normally scrollable with wheel, keyboard, trackpad, touch, and assistive technology.

Workspace actions dispatch existing `atlas:*` events where available. Missing destinations are registered as first-class workbench panels rather than navigation pages. The context list never becomes a hidden global navigation menu.

### Devices control center

The existing lifecycle panel becomes the Devices page/panel, retaining readiness and recovery information and adding an `Administration` section for the selected Device.

- **Disconnect** ends/releases the current active device connection through the verified control-plane API. It is reversible and preserves the Device record, pairing, terminal history, and Atlas appearance preference.
- **Remove Device** opens a two-option decision dialog:
  - **Retire / unpair** removes it from active use while retaining a recoverable record according to FNGK capability semantics.
  - **Delete permanently** is destructive. It shows the exact Device name and identifier, requires explicit confirmation, and is unavailable when FNGK does not advertise permanent deletion.
- Buttons state the capability and failure reason rather than falling back to a shell command. A refresh obtains the current state after every successful operation.
- **Appearance** provides a labelled, keyboard-operable fixed color palette plus “No color”. It also shows a compact preview of the rail icon and tab accent.

Lifecycle API contracts are extended only after the backend capability audit. The UI consumes an explicit shape such as:

```ts
type DeviceLifecycleCapabilities = {
  disconnect: { available: boolean; reason?: string };
  retire: { available: boolean; reason?: string };
  delete: { available: boolean; reason?: string; confirmation: 'device-name-and-id' };
};
```

The specific API route names and request schemas follow the existing lifecycle service conventions; the implementation plan must name them after inspecting the backend. Mutating calls require the selected `contextId`, profile scope where applicable, and the explicit confirmation payload. No action is inferred from a color update or a panel close.

### Device appearance data

Device identity color is Atlas-local presentation state, keyed by stable FNGK Device ID and optionally the selected Atlas profile namespace. It uses a versioned local preference store, for example:

```ts
type DeviceAppearance = { color?: AtlasDeviceColor };
type DeviceAppearanceMap = Record<string, DeviceAppearance>;
```

`AtlasDeviceColor` is one of a small, named, contrast-tested palette; arbitrary CSS values are not accepted. The store exposes `get`, `set`, `clear`, and subscription/event support. It tolerates malformed browser storage by resetting only its own entry. It contains no tokens, credentials, connection details, or remote device mutations.

`ActivityRail` resolves a context’s Device ID into an appearance color. `Workbench` resolves the same color for a panel only when its parameters explicitly contain a Device `contextId` or terminal target. That color becomes a constrained CSS custom property on the tab and associated panel surface. Global, profile-only, and unscoped panels receive no device tint.

The accent is deliberately restrained: a header edge/outline and a subtle focus shadow, never a full-color panel background. Online/offline status remains independently visible and does not rely on color alone.

### File previews and tabs

`Workbench` passes an explicit `preview: true` parameter to a new preview file panel and to preview replacement. Tab titles are always the file name. The guarded file-tab renderer applies a preview class to the title based on that parameter. The title uses italics while preview is true.

When a preview becomes pinned, dirty, or saved, `Workbench` updates panel parameters to `preview: false`; the tab becomes ordinary text. The existing dirty marker remains, but no title parser may depend on or strip the string ` · preview` after this migration. Panel serialization/restoration preserves the preview flag correctly.

### Shared loading language

Atlas gains two reusable presentational components:

- `LoadingSpinner.svelte`: a small rotating ring, configurable size and accessible label; decorative instances use `aria-hidden`, status instances expose a concise live label.
- `LoadingState.svelte`: spinner, supplied message, optional compact mode, and `role=status` semantics.

Both use design tokens and `prefers-reduced-motion` to reduce or stop rotation. They are neither network logic nor error handling; callers continue to own cancellation, stale-response protection, and retry behavior.

Initial adoption points:

| Surface | Loading trigger | Presentation |
| --- | --- | --- |
| `FilesystemTree` | root read, folder expansion, refresh, content search | inline spinner beside the affected folder/action; compact state in the result region |
| `FilePanel` | file read or buffer load | spinner and “Opening file…” in editor surface until content is ready |
| lazy `PanelHost` / workbench panel import | dynamic component import | centered compact loading state |
| `UnifiedSearch` | provider collection | spinner in result status row |
| `DeviceLifecyclePanel` | readiness and lifecycle mutation | action-local spinner; status section remains readable |

Other existing textual waits are migrated only when they represent an actual pending operation. Empty states and error states remain distinct from loading.

## Component and data-flow boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `RailScrollViewport` | measure overflow, expose scroll controls, preserve native scrolling | DOM scroll metrics and `ResizeObserver` |
| `ActivityRail` | activity commands, context selection, device color resolution | context catalog, workbench state, appearance store |
| `DeviceAppearanceStore` | validate and persist local color preferences | `localStorage`, named palette |
| Devices lifecycle panel | readiness, capability display, confirmation flows, color picker | lifecycle API, workbench state, appearance store |
| lifecycle service/routes | expose verified device lifecycle capabilities and execute authorized actions | FNGK control plane only |
| `Workbench` / guarded tabs | carry context and preview metadata into Dockview tab rendering | panel registry, appearance store |
| `LoadingSpinner` / `LoadingState` | consistent visual/accessibility treatment for pending work | CSS tokens only |

Flow for a color assignment:

```text
Devices panel → appearance store persists { deviceId, color }
              → store event updates rail + already-rendered device tabs
              → future panels resolve color from their explicit contextId
```

Flow for a destructive lifecycle action:

```text
user selects delete → confirmation dialog → lifecycle API capability check
  → authorized control-plane request → refresh readiness/context catalog → visible result/error
```

## Error handling and accessibility

- All lifecycle errors are shown in the Devices panel with the server-provided safe message. The selected Device remains selected.
- A stale response cannot overwrite state for a newly selected Device; existing request sequence/cancellation patterns are retained.
- Loading controls expose status without trapping focus. Disabled mutations remain explainable through adjacent text or a labelled disabled-state reason.
- Color labels use names as well as swatches; selected color is communicated with `aria-pressed` or a native radio group.
- Rails and tabs retain focus outlines. Device color is supplemental rather than the sole channel for ownership, selection, status, or destructive meaning.
- Delete confirmation names the exact target and cannot be submitted by an incidental Enter key before the confirmation value matches.

## Terminal ownership and history boundary

Atlas uses persistent FNGK terminals internally for device-session transport, filesystem work, discovery, deployment, and other background operations. These are infrastructure sessions, not user terminal sessions. They must never appear in the terminal picker, bottom dock, session history, or user-facing logs.

Every terminal session created by Atlas therefore carries an immutable ownership classification at creation time:

```ts
type TerminalOwner = 'atlas-user' | 'atlas-internal';
type TerminalPurpose = 'interactive' | 'device-session' | 'filesystem' | 'discovery' | 'deployment' | 'diagnostic';
```

Only `atlas-user` sessions with the `interactive` purpose may be listed, restored, renamed, archived, stopped, or displayed as user terminal history. `atlas-internal` sessions are addressable only by their owning service and summarized through safe telemetry (state, stream count, reconnection count, and failure reason) in Device Sessions. Their terminal output/history is never exposed to the Atlas user interface or persisted as a user buffer.

The server enforces this boundary on every list/action route; the web client does not merely hide rows. Existing FNGK sessions with no Atlas ownership metadata are treated as external/unknown and remain outside the Atlas-owned user-terminal history unless explicitly adopted through a future, confirmed workflow.

## Verification and acceptance tests

### Automated

1. Unit-test appearance-store validation, persistence, clearing, malformed storage recovery, and change notification.
2. Component-test rail indicators at top, middle, bottom, resize, and no-overflow states; assert controls are absent/inert at endpoints.
3. Component-test preview tab metadata: no literal preview title, italic preview class, ordinary title after pin/dirty/save.
4. Component-test loaders for file tree and file panel pending/error/empty transitions.
5. API tests verify lifecycle capability gating, disconnect request shape, retirement selection, and delete confirmation rejection/acceptance. No test may accept a shell fallback.
6. Existing typecheck, unit, web check, build, and focused end-to-end workspace continuity tests remain green.

### Manual desktop pass

1. Connect at least three devices, give each a color, and confirm rail icons and every context-scoped terminal/file tab are distinguishable.
2. Scroll a long rail list with mouse wheel, keyboard, and chevron buttons; ensure the scrollbar is not visible and indicators accurately change at endpoints.
3. Open a file as preview, replace it with another preview, edit it, save it, and pin it; confirm title and styling transitions without losing editor state.
4. Expand slow folders and open a remote file; confirm a spinner appears promptly, clears on success/error, and no stale loading state survives context change.
5. Disconnect, retire, and attempt permanent deletion using a non-production test device; confirm the right confirmation and post-action state.
6. Minimize/restore terminals and rearrange panels while all changes above are performed; confirm no terminal disconnect is caused by presentation changes.

## Delivery sequence

1. Add shared appearance and loading primitives with focused tests.
2. Rebuild rail structure and scroll affordance, preserving existing context selection and command events.
3. Update workbench tab metadata/rendering and device accent propagation.
4. Extend the Devices lifecycle surface and audited backend capability routes.
5. Adopt loaders in the listed surfaces and run accessibility/desktop regression passes.

Each increment is independently testable. Backend lifecycle mutation work must not ship ahead of explicit capability checks; front-end color and loading work can ship without it.
