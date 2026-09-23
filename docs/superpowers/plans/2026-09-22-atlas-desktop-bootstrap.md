# Atlas Desktop Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a signed desktop Atlas companion that starts the local Atlas server, installs or detects FNGK without terminal interaction, guides browser login, and opens the existing Observatory and remote Device workflows.

**Architecture:** Add a thin Tauri 2 host around the existing Atlas web application. Keep Atlas's Fastify server and Svelte workbench as the renderer/backend sidecar, bundle platform-specific FNGK artifacts, and expose only a typed onboarding IPC bridge. FNGK remains the sole owner of profiles, credentials, pairing, daemon lifecycle, and remote operations.

**Tech Stack:** Tauri 2, Rust host, existing Node.js/TypeScript Atlas server, Svelte 5/Vite, bundled FNGK CLI sidecars, SQLite, Vitest, Playwright, platform signing/notarization tooling.

**Spec:** `docs/superpowers/specs/2026-09-22-atlas-desktop-bootstrap-design.md`

## Global Constraints

- Support Linux and macOS first; Windows follows the same contracts after the first signed release.
- The renderer has no arbitrary process, filesystem, network, or credential API.
- FNGK profiles and credentials remain outside Atlas storage.
- Default installation is per-user; system installation requires explicit OS elevation.
- Artifact signatures, checksums, architecture, size, and extraction paths are verified before installation.
- Atlas server binds loopback only and receives a per-launch capability.
- Login and pairing use browser callbacks or a versioned machine-readable FNGK bootstrap contract; no terminal scraping.
- Existing web/host Atlas behavior remains available while the desktop target is introduced.

## Review Focus

- Missing or incompatible FNGK must produce a useful guided state, not a blank window or infinite retry; Task 4 tests every onboarding branch.
- A malicious or corrupt FNGK archive must never overwrite the existing binary; Task 3 tests signatures, checksums, traversal, symlinks, architecture, and rollback.
- A renderer compromise must not become arbitrary local command execution; Task 2 tests IPC allowlists and hostile inputs.
- Login callbacks must reject replay, wrong origin, expired state, and credential-bearing responses; Task 5 tests each condition.
- Closing or updating Atlas must not kill a user-owned FNGK daemon or delete its profile; Task 6 tests lifecycle ownership.

---

### Task 1: Freeze desktop bootstrap contracts

**Files:**
- Create: `desktop/contracts.ts`
- Create: `desktop/contracts.test.ts`
- Create: `src/onboarding/types.ts`
- Create: `test/onboarding/types.test.ts`

**Interfaces:**
- `BootstrapState = 'checking'|'install-choice'|'update-choice'|'daemon-install-choice'|'login-choice'|'ready'|'recoverable-error'`.
- `FngkLocalStatus`, `FngkRemoteStatus`, `BootstrapProgress`, `AuthCallback`, `InstallManifest`, `InstallResult`.
- Every command result includes `protocolVersion`, `state`, bounded `message`, and optional redacted `errorCode`; credentials are not representable in result types.

- [ ] Write failing tests for legal state transitions, bounded messages, missing credential fields, and platform/architecture matching.
- [ ] Run `npx vitest run desktop/contracts.test.ts test/onboarding/types.test.ts` and capture the expected missing-contract failure.
- [ ] Implement the contracts and pure validators with Zod or the repository's existing schema approach.
- [ ] Run focused tests and `npm run typecheck`.
- [ ] Commit `feat(desktop): define FNGK bootstrap contracts`.

### Task 2: Add the Tauri host and restricted IPC bridge

**Files:**
- Create: `desktop/src-tauri/Cargo.toml`
- Create: `desktop/src-tauri/src/main.rs`
- Create: `desktop/src-tauri/tauri.conf.json`
- Create: `desktop/src-tauri/capabilities/default.json`
- Create: `desktop/src/bridge.ts`
- Create: `desktop/src/bridge.test.ts`
- Modify: `package.json` with `desktop:dev`, `desktop:build`, and platform packaging scripts.

**Interfaces:**
- IPC commands: `atlas_get_local_status`, `atlas_install_fngk`, `atlas_converge_daemon`, `atlas_begin_login`, `atlas_cancel_operation`, `atlas_shutdown`.
- The renderer receives events `{operationId,phase,progress,message,errorCode?}` only.

- [ ] Test that unknown commands, extra arguments, paths outside approved directories, and arbitrary executable names are rejected.
- [ ] Verify the bridge tests fail before the Tauri command handlers exist.
- [ ] Configure a loopback-only webview, strict CSP, sidecar permissions, and an allowlisted command bridge. Do not expose a generic shell or filesystem command.
- [ ] Start the existing Atlas server sidecar on a random port and pass the webview capability token through environment/IPC without putting it in URLs or persistent state.
- [ ] Run `npm run typecheck`, `npm run check:web`, and a Tauri debug launch smoke test.
- [ ] Commit `feat(desktop): add restricted Tauri shell`.

### Task 3: Implement signed FNGK artifact discovery and installation

**Files:**
- Create: `src/onboarding/artifacts.ts`
- Create: `src/onboarding/installer.ts`
- Create: `test/onboarding/installer.test.ts`
- Modify: `scripts/build-fngk-head.sh` to emit signed-manifest-compatible metadata without embedding credentials.

**Interfaces:**
- `locateFngk(options): Promise<LocalFngkCandidate[]>`.
- `verifyFngkArtifact(manifest, archive, platform, architecture): Promise<VerifiedArtifact>`.
- `installFngk(artifact, scope:'user'|'system', progress): Promise<InstallResult>`.
- `rollbackFngk(backup): Promise<void>`.

- [ ] Test PATH/bundled/configured executable precedence, incompatible protocol, invalid signature, checksum mismatch, unsupported architecture, archive traversal/symlink, size limit, and failed atomic replacement.
- [ ] Run focused tests and verify the initial tests fail.
- [ ] Implement HTTPS download with timeout/size limits, signature/checksum validation, temporary extraction, executable permissions, backup, atomic replacement, and platform-specific user paths.
- [ ] Require an explicit elevation callback for system scope; never invoke `sudo` or an administrator helper implicitly.
- [ ] Run installer tests and a disposable real archive smoke test.
- [ ] Commit `feat(desktop): securely install and rollback FNGK`.

### Task 4: Implement local FNGK detection and onboarding state machine

**Files:**
- Create: `src/onboarding/service.ts`
- Create: `test/onboarding/service.test.ts`
- Modify: `src/server/app.ts` only if server-side local status is needed by the existing web shell.

**Interfaces:**
- `BootstrapService.check(): Promise<BootstrapSnapshot>`.
- `BootstrapService.install(scope): AsyncIterable<BootstrapProgress>`.
- `BootstrapService.converge(profile): AsyncIterable<BootstrapProgress>`.
- `BootstrapService.repair(): AsyncIterable<BootstrapProgress>`.

- [ ] Test transitions for missing binary, incompatible binary, daemon unavailable, profile absent, authentication required, ready, cancellation, and timeout.
- [ ] Implement strict `version`/`status --json` execution through the sidecar and validate namespace/terminal protocols.
- [ ] Invoke `fngk install --profile PROFILE`, poll status with a bounded deadline, and classify errors without exposing stderr secrets.
- [ ] Keep only non-sensitive progress in local state; allow restart/resume after an interrupted install.
- [ ] Run service tests and typecheck.
- [ ] Commit `feat(desktop): guide FNGK detection and convergence`.

### Task 5: Add browser-based login and pairing handoff

**Files:**
- Create: `src/onboarding/auth-flow.ts`
- Create: `test/onboarding/auth-flow.test.ts`
- Modify: Signal CLI only if the current login flow cannot provide a machine-readable authorization state.
- Modify: `docs/host-handoff.md` with desktop bootstrap behavior.

**Interfaces:**
- `beginLogin(profile): Promise<{authorizationUrl:string;stateId:string;expiresAt:string}>`.
- `completeLogin(callback): Promise<{profile:string;authenticated:true}>`.
- `cancelLogin(stateId): Promise<void>`.

- [ ] Test callback state mismatch, replay, expiry, wrong origin, malformed response, cancellation, and successful browser completion without returning a credential to Atlas.
- [ ] First inspect current FNGK login behavior; if human output is the only interface, add `fngk login --json` or an equivalent additive protocol returning URL/state/expiry only.
- [ ] Open the system browser/deep link, receive a one-time callback, and ask FNGK to persist the resulting credential in its own profile.
- [ ] Test already-paired remote Devices separately from local operator authentication.
- [ ] Run Signal Go tests if its CLI changes, then Atlas focused tests.
- [ ] Commit `feat(desktop): complete browser login without terminal UX`.

### Task 6: Supervise the Atlas sidecar and preserve FNGK ownership

**Files:**
- Modify: `desktop/src-tauri/src/main.rs`
- Create: `desktop/src-tauri/src/process_supervisor.rs`
- Create: `desktop/src-tauri/src/process_supervisor_test.rs`
- Modify: `src/server/index.ts` only for explicit graceful shutdown/readiness endpoints.

**Interfaces:**
- `startAtlasServer(config): Promise<LocalServerHandle>`.
- `stopAtlasServer(handle): Promise<void>`.
- Readiness contract: `GET /api/health` on loopback with a random capability.

- [ ] Test startup timeout, crash/restart limit, graceful app close, stale child process cleanup, and that no FNGK daemon/profile path is deleted or stopped.
- [ ] Implement bounded output capture, readiness polling, clean shutdown, and one controlled restart on crash.
- [ ] Ensure app data uses platform app-data paths and the existing SQLite database; do not use the current working directory implicitly.
- [ ] Run Tauri debug launch and existing Atlas test suites.
- [ ] Commit `feat(desktop): supervise Atlas without owning FNGK lifecycle`.

### Task 7: Build the onboarding UI and desktop-aware status surface

**Files:**
- Create: `src/web/components/DesktopOnboarding.svelte`
- Create: `src/web/components/FngkStatusCard.svelte`
- Modify: `src/web/App.svelte`
- Modify: `src/web/lib/api.ts`
- Create: `test/web/desktop-onboarding.test.ts`

**Interfaces:**
- UI consumes only typed bootstrap IPC/API responses.
- Events: `atlas:bootstrap-ready`, `atlas:open-login`, `atlas:open-repair`.

- [ ] Test every bootstrap state, one primary next action, expandable diagnostics, cancel/retry, and local-vs-remote status distinction.
- [ ] Implement the first-launch screen with no terminal instructions in the happy path; keep advanced/manual diagnostics accessible.
- [ ] Once ready, transition to the existing Machine Observatory without losing context or layout state.
- [ ] Run `npm run check:web` and focused browser tests.
- [ ] Commit `feat(web): add first-run desktop onboarding`.

### Task 8: Package signed Linux/macOS desktop artifacts

**Files:**
- Create: `.github/workflows/desktop.yml` or the repository’s selected CI equivalent.
- Create: `desktop/README.md`
- Modify: `README.md`
- Modify: `docs/host-handoff.md`
- Create: `test/desktop/package-smoke.test.ts`

- [ ] Define platform/architecture artifact names, signing identities, update channels, and manifest schema without checking secrets into Git.
- [ ] Bundle matching Atlas server assets and FNGK sidecars; verify the installed FNGK binary digest is recorded in the build manifest.
- [ ] Add Linux AppImage/deb smoke packaging and macOS app/dmg signing/notarization hooks; fail closed when release signing is unavailable.
- [ ] Test launch, missing-FNGK install path, already-installed path, login state, graceful exit, and update rollback on at least the Linux CI runner.
- [ ] Commit `build(desktop): package signed Atlas companions`.

### Task 9: Add full acceptance and release gates

**Files:**
- Modify: `e2e/workbench.spec.ts` or create `e2e/desktop-onboarding.spec.ts`
- Modify: `scripts/live-acceptance.sh`
- Create: `test/fixtures/fngk-bootstrap/`
- Modify: `docs/host-handoff.md`

- [ ] Add a fake-FNGK acceptance that proves missing binary → install → daemon convergence → browser login callback → ready state without terminal UI.
- [ ] Add exact-head live acceptance that sees an authorized remote Device, opens a terminal, publishes a route, and verifies no credential is persisted.
- [ ] Add update failure/rollback acceptance and verify the old FNGK remains usable.
- [ ] Run `npm test`, `npm run typecheck`, `npm run check:web`, `npm run build`, `npm run test:e2e`, `npm run test:live`, desktop package smoke tests, `npm audit --audit-level=high`, and `git diff --check`.
- [ ] Commit `test(desktop): prove bootstrap and release lifecycle`.

### Task 10: Independent security/release review

- [ ] Scan the renderer for generic command/file/network bridges and reject any unallowlisted capability.
- [ ] Verify signed artifact and updater metadata, archive containment, callback state, deep-link handling, and FNGK profile ownership.
- [ ] Confirm Atlas uninstall/update does not remove FNGK profiles, daemons, or remote resources.
- [ ] Request an independent review focused on privilege boundaries, credential handling, sidecar injection, and platform packaging.
- [ ] Apply review fixes in separate commits and record the final supported platform matrix.
