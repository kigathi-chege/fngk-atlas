# Atlas workbench shell — remaining implementation plan

This document is the maintained follow-on ledger for work intentionally not represented as complete by the initial shell implementation. It is ordered by dependency and must be kept current as each item lands.

## Audit record — 2026-10-04 completion loop

- `npm test` passes: 116 test files and 393 assertions. `npm run check:web`, `npm run typecheck`, and `npm run build` pass.
- Focused desktop checks pass for retained-sidebar collapse/restore across reload, exact sidebar-width restoration, Workspace fallback geometry, live-terminal minimization without socket closure, and Device lifecycle selection.
- The all-in-one Playwright process is not a valid final signal in this constrained runner: Chromium is killed after several independent pages because only about 0.5 GiB RAM and 47 MiB swap were free. Run the same focused desktop cases in a normal desktop/CI runner before release; do not reinterpret the kills as successful product checks.
- The retained panel headers now own their controls. Dockview tabs are hidden only while their group contains no ordinary tab, so non-disposable panels no longer leak a duplicate tab strip.
- Shared controls have been extended through the title command palette, Observability filter, and device-label editing. Remaining raw form controls should be migrated by workflow, with interaction tests, rather than by a broad mechanical replacement.

## 1. Complete permanent shell behavior

- [x] Suppress the Workspace recovery tab whenever ordinary center panels exist and reactivate it after the final ordinary panel closes. Bottom-dock panels no longer hide it.
- [x] Add a shared permanent-panel header and replace the Workspace, Devices, Device Details, Filesystem, and Inspector tab-strip presentation with integrated headers and explicit actions. Observability remains a separate follow-up because its filter is header content rather than a panel action.
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

- [x] Adopt `AtlasEventStore` in file editor, filesystem search, deployment, live project, database, port, device, recovery, Calculator connection, agent-grant, and exact-head handoff workflows. Filesystem and terminal lifecycles preserve pending, success, error, and cancellation outcomes; remote cancellation is an actionable error, client cancellation remains visibly cancelled, and unfamiliar producer states are retained as warnings. Event tests prohibit credentials, file bodies, search terms, and published URLs from event metadata.
- [x] Add a visible rail action for Observability, with filtering, pinning, persisted local event browsing, inspectable safe details, per-event local deletion, and clear-all confirmation. Connection-state correlation remains pending.
- Make notification dismissal presentation-only and project event outcomes without replaying old history as new toasts.

## 5. Complete Notify extension

- Obtain an actual Notify source checkout path, then add the Compose profile, local start script, onboarding script, scoped probe, and integration tests.
- Wire the renderer bridge to a trusted Atlas server publisher; do not send producer credentials to the renderer.
- Add opt-in connection UI and prove offline, retry, scoped read-back, and SSE merge behavior.

## 6. Validate and release

- [x] Emit filesystem loading lifecycle events.
- [ ] Diagnose real filesystem routes against a live FNGK device, including the observed empty-tree regression. The request-abort race is covered: abandoning a browser waiter does not interrupt the shared persistent Device Session command, and an immediate refresh joins it. The UI records safe route/session/cache correlation in Observability; a real-device reproduction plus route/session correlation evidence is still required before closing the historical `route_unavailable` incident.
- [ ] Add desktop E2E coverage for panel persistence, terminal continuity, collapse/restore, device identity, filesystem events, and Notify-offline operation.
- Run full web/server/desktop builds and manual desktop acceptance before merge.
