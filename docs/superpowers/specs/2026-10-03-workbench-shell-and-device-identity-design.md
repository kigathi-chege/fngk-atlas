# Atlas workbench shell, Devices explorer, and observability design

**Status:** proposed; awaiting maintainer review before implementation planning  
**Date:** 2026-10-03  
**Owners:** FNGK Atlas maintainers

## Purpose

Atlas must behave as one live desktop workspace, not a collection of independently styled pages. A person must always be able to identify a Device, understand which Device owns a tab, inspect active work and failures, and recover their workspace without losing terminal or remote-session continuity.

This design makes the Workspace panel a fallback surface, replaces the device-heavy activity rail with a dedicated Devices explorer, keeps observability permanently available on the right, and gives every asynchronous operation an inspectable lifecycle.

The filesystem loading failure is a separate correctness incident. This shell work must not hide errors or redefine request ownership; it consumes the corrected filesystem behavior once that incident is resolved.

## Goals

1. Workspace is the active fallback only when no ordinary center work tabs remain.
2. Permanent regions use Workspace-style headers, not Dockview tab strips or close controls.
3. The left permanent region is a Devices explorer; Devices are removed from the rail.
4. Every Device has a stable, deterministic Atlas identity: avatar, compact pseudonym, and color derived from its immutable Device ID.
5. Device-scoped tabs and panels receive a restrained, accessible ownership accent.
6. The right permanent region is the existing Observability surface, expanded into the durable record of Atlas activity.
7. Every meaningful pending operation reports loading, success, error, cancellation, or reconnect state through one event model.
8. Notifications are dismissible presentation of that model, not the sole record of work.
9. Device selection, terminal continuity, background-device sessions, and external FNGK state remain independent of layout, minimization, and visibility changes.

## Non-goals

- Do not replace Dockview, Fastify, FNGK, or the existing terminal transport.
- Do not expose Atlas-internal device-session terminals or their terminal output as user-created terminals.
- Do not remotely rename a Device when changing its Atlas pseudonym or avatar presentation.
- Do not use color as the only indication of Device ownership, connectivity, or status.
- Do not turn notifications into remote audit-log deletion: clearing Atlas history is local-only.

## Shell model

### Center workspace and fallback Workspace surface

`WorkspacePanel` is not a normal work tab. It is the center-region fallback:

- When one or more ordinary center panels exist, Workspace remains mounted only as a hidden anchor/fallback. It has no visible Dockview tab in that group.
- Closing the final ordinary center panel activates Workspace and presents it as the sole visible center surface.
- Workspace cannot be closed, minimized, floated, or moved into a side region.
- A workspace restore that lacks a valid center surface recreates Workspace before restoring dependent panels.
- Workspace header controls remain the visual standard for permanent regions: concise title/context, no ordinary close button, explicit action buttons only.

The center’s ordinary work panels retain normal Dockview behavior: closable tabs, preview behavior for files, panel restoration, drag/drop rules, and device ownership accents.

### Permanent regions and visibility controls

There are three persistent workspace regions:

| Region | Content | Visibility behavior |
| --- | --- | --- |
| Left | **Devices explorer** | Cannot be dismissed. A top-bar/rail icon toggles its width between its persisted width and collapsed state. |
| Center | Workspace fallback and ordinary work tabs | Always present. Workspace appears only as fallback. |
| Right | **Observability** | Cannot be dismissed. A top-bar/rail icon toggles its width between its persisted width and collapsed state. |

The activity rail is narrowed to global navigation and commands. It contains no device collection. It is a rail: compact, icon-led, stable in order, and not a secondary dashboard.

The existing quick actions near Search, Filesystem, Terminal, Command palette, and Refresh become explicit visibility/action controls. Add two dedicated controls:

- Toggle Devices explorer.
- Toggle Observability inspector.

Each control exposes `aria-pressed`, a tooltip, and a keyboard command. Collapse does not unmount the permanent panel; it preserves its state and remote subscriptions.

### Left Devices explorer

The left sidebar is renamed **Devices**. It contains two non-dismissable internal surfaces:

1. **Devices** — the profile list and device-oriented actions.
2. **Inspector** — context-sensitive details for the selected Device, selected resource, or selected operation.

These are internal sidebar modes, not Dockview tabs. Their header uses the permanent-panel header grammar and switches mode via explicit icon buttons.

Inspector is attached to the Devices sidebar beneath the list. It cannot be closed. It may collapse vertically until only its header remains; its header has expand/collapse control and matching keyboard shortcut. Its height is persisted. A collapsed Inspector continues receiving the selected-context data needed to render immediately on expansion but does not run unnecessary heavy queries.

### Right Observability inspector

The right permanent sidebar reuses and upgrades the existing Observability/operations capability instead of introducing a competing activity view. It has internal modes controlled by header icons:

- **Activity** — chronological operation/event stream.
- **Connections** — FNGK profile status, selected-device status, session/reconnect state, and transport diagnostics.
- **Logs** — safe application and operation logs with links to source panel or diagnostic.
- **Details** — selected event, selected operation, or selected resource metadata.

The right inspector cannot be dismissed. It may be horizontally collapsed through its visibility control, while retaining its event history and subscriptions.

## Deterministic Device identity

### Identity contract

Each FNGK Device receives an Atlas presentation identity derived entirely from its stable Device UUID.

```ts
type AtlasDeviceIdentity = {
  deviceId: string;
  pseudonym: string;
  avatar: { glyph: string; background: AtlasDeviceColor };
  color: AtlasDeviceColor;
};
```

The identity is deterministic across installations, profiles, app restarts, and workspace restores. It cannot be locally overridden in this release.

The generator hashes the canonical UUID with a documented stable algorithm, then selects values from versioned fixed vocabularies:

- a short adjective/character pseudonym, for example `Amber Kestrel`;
- a compact avatar glyph/monogram;
- one named contrast-tested color from the Atlas spectrum palette.

Names and palette vocabularies are part of the compatibility contract: append-only changes are allowed, but reordering or replacing existing values requires a new identity-version migration so existing Device identities do not silently change.

The remote Device display name, hostname, real ID, platform, and capabilities remain authoritative and are always available in the UI. The pseudonym is Atlas navigation identity, never an FNGK rename.

### Device list interaction

Each Device row shows, at minimum:

- deterministic avatar/color;
- pseudonym and authoritative display name;
- online/offline/reconnecting state, not represented by color alone;
- platform and concise capability/session summary;
- selected-context state.

Hover/focus opens a lightweight profile card with full Device ID, profile/team/project scope, last seen time, authoritative names, connection state, capabilities summary, and current Atlas identity.

Click selects the Device context and refreshes context-bound surfaces without closing a user terminal or clearing work tabs. Keyboard activation performs the same action.

Right-click opens the existing accessible context-menu pattern, with actions determined by advertised capability and state: select, open terminal, open files, inspect sessions, open lifecycle/recovery, copy ID, and device-safe lifecycle actions. Destructive actions use their existing confirmation path; the menu never synthesizes shell commands.

### Device ownership accents

Every tab or panel whose explicit parameters carry a Device context or terminal target resolves that Device identity. It receives:

- thin title/header outline or edge;
- subtle focus/active shadow;
- the avatar/color in any tab-context menu or panel header where space permits.

Global, profile-only, and unscoped panels have no device accent. Color is never used as the sole state signal. Preview state, dirty state, keyboard focus, online state, and error state retain independent visual semantics.

## Operation, loading, and notification model

### Event store

Atlas adds a typed local operation/event store. It is the sole persistent source for user-visible asynchronous work; panel-local state remains responsible for rendering its own data but publishes lifecycle events to this store.

```ts
type AtlasEventState = 'pending' | 'success' | 'error' | 'cancelled' | 'reconnecting';
type AtlasEvent = {
  id: string;
  timestamp: number;
  source: string;
  title: string;
  message?: string;
  state: AtlasEventState;
  severity: 'info' | 'success' | 'warning' | 'error';
  contextId?: string;
  panelId?: string;
  diagnosticId?: string;
  action?: { label: string; event: string; detail?: Record<string, unknown> };
  pinned?: boolean;
};
```

Events update by stable `id`, so a folder read or terminal reconnect evolves in place from pending to outcome. Each event can link to its owning panel, Device context, or logs/diagnostic.

History keeps the most recent 500 unpinned local events. Pinned events remain until the user unpins or deletes them. This bounded local history prevents unbounded renderer memory while preserving enough operational context. It contains no secrets, terminal keystrokes, or private Atlas-internal terminal output.

### Loading standards

All meaningful asynchronous operations publish a pending event and use the shared rotating loader component in their immediate surface. On completion they publish success, error, cancellation, or reconnect state. Empty data remains distinct from an unstarted request, a pending request, and a failed request.

Initial adoption includes filesystem root/folder/content reads, file writes, terminal connect/reconnect, panel lazy imports, context catalog refresh, device lifecycle mutations, agent chat stream state, search, deployments, live projects, database actions, and port-sharing actions.

Cancellation is observable as `cancelled` only when relevant to the user; superseded typeahead and intentional context transitions do not create noisy error toasts. A request that never began is not reported as a successful empty result.

### Notifications and retention

Notifications are a view over event-store entries:

- Pending events may show compact progress toast only for operations expected to exceed a short threshold.
- Success/info toasts auto-dismiss after five seconds but their event remains in Observability history.
- Warning/error toasts persist until dismissed. Dismiss hides only the toast; it does not delete the event.
- Toast controls: dismiss, open details/logs, and pin where applicable.
- Observability controls: filter, search, pin/unpin, delete one local event, clear unpinned local history, and clear all local history after confirmation.

Deletion and clearing never alter remote FNGK state, remote logs, Device records, terminal sessions, or server audit records. Remote diagnostic retention follows its own service contract.

## Header and tab presentation

Permanent surfaces use a shared `WorkspaceHeader`-style component or contract:

- title, selected context/profile indicator, optional status summary;
- explicit header icon actions with accessible names/tooltips;
- no ordinary close affordance;
- no Dockview tab strip;
- consistent height, spacing, focus treatment, borders, and action button geometry.

Normal center tabs have a minimum width and overflow behavior that maintains usable close/preview/ownership indication. Preview tabs use italic title text only; they never display the word `preview`. Workspace, Devices, and Observability are excluded from normal closable tab-bar rules.

## State persistence and recovery

Persist locally and version the following:

- center panel layout and normal panel metadata;
- permanent sidebar widths/collapsed state;
- Inspector height/collapsed state and active internal mode;
- Devices/Observability selected internal mode;
- bounded event history and pinned events, with safe schema validation;
- Device identity generator version, not mutable per-device overrides.

Malformed persistence is isolated: invalid layout resets the affected layout area; invalid event data resets the event store; invalid Device identity data is regenerated from the UUID. No malformed entry may block startup or remove a remote Device.

When the final center work panel closes, recovery chooses Workspace. When an external/unknown terminal session exists, it is not adopted into Atlas user terminal history. When a Device goes offline, its existing scoped tabs stay visible with offline state; user-created terminals reconnect under their normal policy rather than being destroyed by a Device-list refresh.

## Accessibility and performance

- All sidebar icon controls have labels, keyboard shortcuts, visible focus, and pressed/expanded semantics.
- Hover cards have equivalent focus/keyboard access and never trap focus.
- Context menus remain navigable by keyboard and use existing dismissal behavior.
- Avatar/color includes textual pseudonym and status labels; it is not the sole conveyance of meaning.
- Loader animations honor `prefers-reduced-motion`.
- Devices list and Observability stream virtualize once list sizes exceed the current inexpensive DOM threshold; do not eagerly mount heavyweight panel content for collapsed modes.
- Event writes are batched/debounced where necessary so high-frequency terminal/device telemetry does not cause a render per raw transport event.

## Acceptance criteria

1. With a normal work tab open, Workspace has no visible normal tab; closing the last work tab restores and activates Workspace.
2. Devices and Observability show permanent Workspace-style headers and cannot be closed through UI, keyboard, context menu, layout restore, or narrow-layout transition.
3. Devices leave the activity rail entirely. The left Devices explorer is selectable/collapsible through explicit controls and retains state while collapsed.
4. The same Device UUID renders the same pseudonym/avatar/color in a fresh Atlas installation and after restart.
5. Device hover/focus cards and context menus show the correct authoritative ID/details and safe actions.
6. Device-scoped file, terminal, deployment, and live-project panels have the correct restrained ownership accent; global panels do not.
7. Inspector collapses to its header, restores by button/shortcut, and does not discard selected-context state.
8. A slow filesystem/file/terminal operation visibly transitions pending → outcome in both its local panel and Observability; an actual error is visible and actionable.
9. Toast dismissal does not erase event history. Local clear/delete never affects remote data.
10. Existing user terminals remain reconnectable and listed only as user-owned terminal sessions; internal transport sessions remain hidden.

## Delivery boundaries

Implementation must proceed in coherent, independently testable increments:

1. Deterministic Device identity and data model.
2. Event store, notification integration, and shared headers/loading state.
3. Workbench fallback Workspace and permanent-region docking model.
4. Devices explorer and Inspector interactions.
5. Observability adoption, panel operation publishing, persistence, and desktop acceptance pass.

No increment may claim completion without focused tests, full web/type checks, production web build, and manual desktop verification of terminal continuity and panel restoration.
