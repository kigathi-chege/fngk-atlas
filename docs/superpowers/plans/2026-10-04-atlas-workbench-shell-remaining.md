# Atlas workbench shell — remaining implementation plan

This document is the maintained follow-on ledger for work intentionally not represented as complete by the initial shell implementation. It is ordered by dependency and must be kept current as each item lands.

## 1. Complete permanent shell behavior

- [x] Suppress the Workspace recovery tab whenever ordinary center panels exist and reactivate it after the final ordinary panel closes. Bottom-dock panels no longer hide it.
- [ ] Add `WorkspaceHeader` and replace permanent-region Dockview tab strips with integrated headers and explicit show/collapse controls.
- [x] Persist version-9 side widths and lower-panel collapsed states; safely discard prior layouts that cannot represent the retained shell. Persist explicit lower heights and active internal modes next.

## 2. Complete retained regions

- [x] Enforce lower-panel one-third start, one-half maximum, and header-only collapse for Device Details and Inspector. Collapsed panels are exempt from the resize clamp.
- [x] Keep the existing semantic Inspector mounted below Filesystem with no close affordance.
- [x] Keep retained sidebars mounted when collapsed: their group contracts to a header-width rail, restores the prior width on focus, and preserves its mounted subscriptions across responsive changes.

## 3. Complete Devices experience

- [x] Replace the retained left region with a dedicated `DevicesPanel`; global search/tool entry points remain outside it.
- [x] Add Devices contextual actions for terminal, files, and the existing lifecycle flow. The lifecycle flow provides disconnect, retire stale connection, and delete-device choices.
- [x] Finish deterministic device identity profile editing, profile/context card, scoped-tab accenting, and local color/label preference tests. The Devices menu now exposes a deterministic glyph, local label, authoritative metadata, lifecycle-safe actions, and palette without storing credentials.

## 4. Complete observability and notifications

- [ ] Adopt `AtlasEventStore` in file editor, search, deployment, live project, database, port, device, and recovery workflows. Filesystem and terminal lifecycles are complete.
- [x] Add a visible rail action for Observability, with filtering, pinning, and persisted local event browsing. Details and connection state remain pending.
- Make notification dismissal presentation-only and project event outcomes without replaying old history as new toasts.

## 5. Complete Notify extension

- Obtain an actual Notify source checkout path, then add the Compose profile, local start script, onboarding script, scoped probe, and integration tests.
- Wire the renderer bridge to a trusted Atlas server publisher; do not send producer credentials to the renderer.
- Add opt-in connection UI and prove offline, retry, scoped read-back, and SSE merge behavior.

## 6. Validate and release

- [x] Emit filesystem loading lifecycle events.
- [ ] Diagnose real filesystem routes against a live FNGK device, including the observed empty-tree regression. Cache cancellation/retry isolation is now covered, and malformed terminal directory output is rejected instead of silently appearing as an empty tree. A real-device reproduction plus route/session correlation evidence is still required before closing the historical `route_unavailable` incident.
- [ ] Add desktop E2E coverage for panel persistence, terminal continuity, collapse/restore, device identity, filesystem events, and Notify-offline operation.
- Run full web/server/desktop builds and manual desktop acceptance before merge.
