# Atlas workbench shell — remaining implementation plan

This document is the maintained follow-on ledger for work intentionally not represented as complete by the initial shell implementation. It is ordered by dependency and must be kept current as each item lands.

## 1. Complete permanent shell behavior

- [x] Suppress the Workspace recovery tab whenever ordinary center panels exist and reactivate it after the final ordinary panel closes.
- Add `WorkspaceHeader` and replace permanent-region Dockview tab strips with integrated headers and explicit show/collapse controls.
- Persist version-8 side widths, lower heights, collapsed states, and active internal modes; migrate or safely discard version-7 layouts.

## 2. Complete retained regions

- Enforce lower-panel one-third start, one-half maximum, and header-only collapse for Device Details and Inspector.
- Add a real Inspector lower panel beside Filesystem, with device/file context and no dismissal semantics.
- Keep sidebars mounted when collapsed rather than minimizing/removing them.

## 3. Complete Devices experience

- Replace the legacy Navigator content with a dedicated `DevicesPanel` and move repository/search controls to their relevant tool panels.
- Add context menus and lifecycle actions: disconnect, remove device, remove stale connection, and explicit remove-device choice flow.
- Finish deterministic device identity profile editing, tooltip/context card, scoped-tab accenting, and local preference tests.

## 4. Complete observability and notifications

- Adopt `AtlasEventStore` in terminal, file editor, search, deployment, live project, database, port, device, and recovery workflows.
- [x] Add a visible rail action for Observability, with filtering, pinning, and persisted local event browsing. Details and connection state remain pending.
- Make notification dismissal presentation-only and project event outcomes without replaying old history as new toasts.

## 5. Complete Notify extension

- Obtain an actual Notify source checkout path, then add the Compose profile, local start script, onboarding script, scoped probe, and integration tests.
- Wire the renderer bridge to a trusted Atlas server publisher; do not send producer credentials to the renderer.
- Add opt-in connection UI and prove offline, retry, scoped read-back, and SSE merge behavior.

## 6. Validate and release

- [x] Emit filesystem loading lifecycle events; diagnose real filesystem routes against a live FNGK device, including the observed empty-tree regression.
- Add desktop E2E coverage for panel persistence, terminal continuity, collapse/restore, device identity, filesystem events, and Notify-offline operation.
- Run full web/server/desktop builds and manual desktop acceptance before merge.
