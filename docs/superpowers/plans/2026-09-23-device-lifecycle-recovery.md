# Device lifecycle and recovery implementation plan

> **Execution note:** Implement this plan on Atlas `main` and the corresponding
> Signal branch. Do not push either repository without explicit authorization.

**Goal:** Make Atlas the safe operator surface for FNGK profile discovery,
readiness, pairing, update/recovery, connection cleanup, retirement, and
permanent Device deletion; repair rail visibility and notification behavior.

**Architecture:** Signal owns all identity, authorization, Device commands,
artifact verification, and destructive lifecycle mutations. FNGK exposes a
credential-free profile/readiness protocol locally and through the Device
agent. Atlas consumes those bounded APIs through one lifecycle service and
presents an explicit profile selector whenever automatic selection is unsafe.
An agent heartbeat matching the expected identity/version/digest is the only
successful-update proof.

**Tech stack:** Go (FNGK CLI/daemon), TypeScript/Fastify/Postgres (Signal),
TypeScript/Svelte/Vitest (Atlas).

---

## Phase 1 — Signal/FNGK lifecycle protocol

### Task 1: Define safe, versioned profile/readiness wire types

**Files:**
- Create `signal/cli/lifecycle.go`
- Modify `signal/cli/fngk_entry.go`
- Modify `signal/cli/main.go`
- Create `signal/cli/lifecycle_test.go`

1. Write unit tests for `fngk profiles --json` covering zero, one, and multiple
   profiles; assert that JSON never contains credential/token values or config
   locations.
2. Add `fngk.profiles.v1` response structs: profile name, current flag, mode,
   pairing state, operator authorization state, daemon state, discovered
   executable candidate, and agent version/digest only.
3. Implement a `profiles` subcommand and a callable lifecycle inspection
   function. It must report a stable non-zero error code for unreadable config
   while returning no sensitive fallback content.
4. Apply a bounded JSON encoder and tests for the maximum diagnostics/output
   size.
5. Run `go test ./cli -run 'Lifecycle|Profiles'` and record the output.

### Task 2: Add Device-control lifecycle commands independent of a terminal

**Files:**
- Modify `signal/src/device-agent.ts`
- Create `signal/src/device-lifecycle.ts`
- Modify `signal/src/server.ts`
- Create `signal/tests/integration/device-lifecycle.test.ts`

1. Write integration tests for agent messages `lifecycle_inspect`,
   `lifecycle_authorize`, `lifecycle_pair`, `lifecycle_update`, and
   `lifecycle_recover`; verify authorization, offline, and timeout responses.
2. Define a `fngk.device-lifecycle.v1` command envelope with correlation IDs,
   strict schemas, bounded message payloads/chunks, and explicit result codes.
3. Extend Device-agent dispatch with lifecycle capability negotiation; map the
   existing 32 KiB terminal failure to `terminal: frame-limit`, not a generic
   availability failure.
4. Add `deviceLifecycleRoutes` under `/api/operator/devices/:id/lifecycle/*`.
   Authenticate with the existing bearer operator mechanism and use the same
   scope checks as other `/api/operator/devices` actions.
5. Make Signal wait for a matching Device identity and expected
   version/digest heartbeat after update/restart. Return `needs-update` or
   `legacy-recovery` on any mismatch or timeout.
6. Register routes in `src/server.ts`; run the new integration suite and the
   full Signal integration command.

### Task 3: Implement safe remote update/install/recovery semantics

**Files:**
- Modify `signal/cli/daemon.go`
- Modify `signal/cli/daemon_migration.go`
- Modify `signal/cli/lifecycle.go`
- Modify `signal/src/device-agent.ts`
- Extend `signal/tests/integration/device-lifecycle.test.ts`

1. Write failing tests for a selected-profile update: absolute executable
   resolution, architecture/digest rejection, rollback retention, daemon
   restart, and old-heartbeat rejection.
2. Reuse existing artifact checksum/architecture validation; never accept an
   Atlas-provided unchecked binary.
3. Install only through a discovered absolute executable path and a selected
   profile. Preserve the preceding executable for rollback until the new
   heartbeat verifies.
4. Restart/converge the matching machine daemon, not whichever profile happens
   to be current. Ensure failures preserve the previous service configuration.
5. For agents that lack the lifecycle capability, return a structured
   `legacy-recovery` result with the minimal truthful bootstrap requirement;
   do not fabricate a remote update route.
6. Run focused Go tests and Signal integration tests.

## Phase 2 — Signal device governance and cleanup

### Task 4: Add lifecycle impact, retire, delete, and stale-connection APIs

**Files:**
- Create `signal/src/device-lifecycle-governance.ts`
- Modify `signal/src/server.ts`
- Create `signal/tests/integration/device-lifecycle-governance.test.ts`
- Create `signal/migrations/0xx_device_lifecycle_audit.sql` only if existing
  audit tables cannot represent the actions without schema change

1. Write integration tests for access control and impact counts (sessions,
   connection targets/routes, managed processes, adopted resources, and stale
   connections).
2. Add `GET /api/operator/devices/:id/lifecycle/impact`, returning bounded
   counts and only safe identifiers/names necessary to render confirmation.
3. Add a stale-connection release action that disables/removes the selected
   Device target without deleting the Device or unrelated targets.
4. Add `POST .../retire`, requiring an exact `RETIRE` acknowledgement. In one
   transaction revoke credentials, mark `devices.revoked_at`, stop/reconcile
   live sessions/routes, and append a security audit event. Do not delete
   historic data.
5. Add `POST .../delete`, requiring exact device-name confirmation and
   `DELETE`. Compute impact first, revoke credentials, release only
   Device-owned/removable relations, retain legally required audit events, and
   delete only after foreign-key-safe cleanup.
6. Assert retries are idempotent and that one Device cannot remove another
   Device's route/connection target. Run migration tests and integration tests.

### Task 5: Keep namespace/context payloads bounded after lifecycle actions

**Files:**
- Modify `signal/src/signal-namespace.ts`
- Modify `signal/tests/integration/app.test.ts`

1. Add regression coverage ensuring retired Devices do not appear as usable
   contexts and namespace responses remain bounded regardless of resource
   table size.
2. Surface lifecycle-relevant Device metadata (online, safe version, agent
   mode, last seen) but never resource inventories or lifecycle secrets.
3. Re-run `bash tests/run-integration.sh`, `npm run check`, and `npm run build`.

## Phase 3 — Atlas lifecycle data and server layer

### Task 6: Add Atlas lifecycle types and a profile-aware service

**Files:**
- Create `fngk-atlas/src/lifecycle/types.ts`
- Create `fngk-atlas/src/lifecycle/service.ts`
- Modify `fngk-atlas/src/fngk/process-client.ts`
- Create `fngk-atlas/test/lifecycle/service.test.ts`

1. Write tests for automatic selection with exactly one ready profile, explicit
   selection with multiple profiles, no profile, missing login, missing daemon,
   offline Device, old agent, and frame-limit terminal classification.
2. Add `FngkProfileSummary` and `DeviceReadiness` types from the approved spec.
   Store only selected profile names and bounded diagnostic evidence.
3. Teach the local process client to invoke `fngk profiles --json` and parse
   the versioned response strictly. Reject malformed/oversized output with a
   useful lifecycle state.
4. Add remote Signal lifecycle API calls and map returned protocol states to
   Atlas readiness; never inspect remote FNGK config files.
5. Replace hardcoded remote `local` profile defaults with the service's
   selection policy. Persist a user selection only per Device context.
6. Run `npx vitest run test/lifecycle/service.test.ts`.

### Task 7: Expose lifecycle operations through Atlas APIs and harden handoff

**Files:**
- Modify `fngk-atlas/src/server/app.ts`
- Modify `fngk-atlas/src/fngk-head/handoff-service.ts`
- Modify `fngk-atlas/src/fngk-head/install-command.ts`
- Modify `fngk-atlas/src/ports/service.ts`
- Modify `fngk-atlas/src/live-projects/service.ts`
- Create `fngk-atlas/test/lifecycle/routes.test.ts`

1. Write route tests for inspect/select-profile/login/pair/update/recover,
   stale connection release, retire, and delete; test CSRF/auth and exact
   confirmation failures.
2. Add narrow Atlas endpoints that delegate lifecycle changes to Signal/FNGK;
   do not put credentials in browser responses or logs.
3. Change handoff success to require post-update Device readiness evidence,
   not an install marker. Show pending/failed heartbeat result distinctly.
4. Replace `fngk publish` and other remote terminal invocations with the
   discovered absolute executable and selected profile where terminal execution
   remains applicable. Prefer the control API for lifecycle/recovery commands.
5. Preserve the existing persistent terminal session behavior and test that a
   probe/publish failure does not terminate it.
6. Run focused route/service tests and the existing port/live-project test
   suites.

## Phase 4 — Atlas lifecycle workbench and rail

### Task 8: Add the Device lifecycle rail entry and accessible panel

**Files:**
- Modify `fngk-atlas/src/web/components/ActivityRail.svelte`
- Create `fngk-atlas/src/web/components/DeviceLifecyclePanel.svelte`
- Modify the Atlas shell/component that owns rail panel selection
- Modify `fngk-atlas/src/web/enhancements.css`
- Create `fngk-atlas/test/web/device-lifecycle-panel.test.ts`

1. Write component tests for an icon immediately above Device contexts,
   keyboard labels/focus, all contexts remaining reachable by scroll, and panel
   opening without changing the current Device context.
2. Add the new lifecycle icon above `.rail-contexts`; make the contexts region
   flex to remaining height, use `min-height: 0`, and expose an accessible
   visible scrollbar/scroll affordance rather than silently clipping devices.
3. Implement profile selector behavior: auto-select a sole ready profile;
   require selection when multiple; clearly explain blocked states.
4. Render readiness timeline, agent/version evidence, normal update, recovery,
   browser-mediated login/pair cards, stale connection cleanup, and separate
   retire/delete confirmation dialogs.
5. Require the visible device name plus `RETIRE` or `DELETE` before firing the
   respective server action; present server impact before confirmation.
6. Run component tests and a manual keyboard/scroll smoke test in the desktop
   shell.

### Task 9: Replace persistent readiness card with bottom-right toast UX

**Files:**
- Create `fngk-atlas/src/web/lib/notifications.ts`
- Create `fngk-atlas/src/web/components/ToastStack.svelte`
- Modify `fngk-atlas/src/web/components/DesktopOnboarding.svelte`
- Modify the application shell to mount the toast stack
- Create `fngk-atlas/test/web/notifications.test.ts`

1. Write tests: readiness does not leave a persistent toast; success
   auto-dismisses; errors remain until dismissed; duplicate notices collapse;
   stack is bottom-right and keyboard-dismissible.
2. Implement a small notification store with bounded queue, dedupe keys,
   severity, timeout, and explicit close action.
3. Convert onboarding "FNGK ready" to application state, not a visible
   persistent alert. Route meaningful recovery/update failures to actionable
   error notifications and lifecycle panel links.
4. Add `aria-live` semantics and ensure dialogs/toasts do not trap focus
   incorrectly.
5. Run the component suite and desktop smoke test.

## Phase 5 — end-to-end verification and release safety

### Task 10: Verify compatibility, recovery, and destructive boundaries

**Files:**
- Add/update `fngk-atlas/test/e2e/device-lifecycle.*` if the existing harness
  supports desktop/browser E2E
- Update operator and recovery documentation in both repositories

1. Build an end-to-end fixture containing a ready modern Device, a Device with
   multiple profiles, an offline Device, a legacy/frame-limit Device, and a
   stale connection target.
2. Prove: profile selection is correct; normal update waits for heartbeat;
   legacy recovery never reports false success; pairing requires approval;
   stale target release is isolated; retire retains audit; permanent delete
   requires both confirmations and removes only selected-device state.
3. Run all Atlas unit/component tests, `npm run check`, `npm run build`, and
   the Signal integration/check/build suite.
4. Inspect `git diff`, `git status`, migrations, and generated output rules;
   never commit `desktop/src-tauri/gen/` or `desktop/src-tauri/target/`.
5. Produce a release checklist that keeps route-gateway stopped until the
   32-port range and lifecycle health checks are separately confirmed.

## Final review checklist

- No API, UI, diagnostic, audit, or test fixture leaks profile credentials,
  authorization codes, or config paths.
- Atlas no longer assumes `local` remotely or trusts a copied binary as an
  update.
- Device lifecycle actions use authorization and exact confirmation semantics.
- A terminal frame-limit error is recoverable/explainable and never silently
  interpreted as a healthy Device.
- The Device rail is fully scrollable and the lifecycle icon is directly above
  it.
- Notifications are bottom-right and dismissible; readiness is not sticky.
