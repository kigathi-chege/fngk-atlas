# Automatic HTTP Port Sharing and FNGK Head Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover Device-local HTTP listeners, publish selected listeners through the existing FNGK/Signal route lifecycle, and provide a verified local exact-head FNGK artifact handoff to an older remote Device.

**Architecture:** Keep `RuntimeDiscovery` as the source of listening-socket facts, add a bounded Device-local HTTP probe and a persisted Atlas port-sharing service, and reuse `fngk.publish.v1` for public routes. Build the FNGK handoff as a verified artifact-server workflow layered on generic port sharing; do not create a second tunnel or Signal route implementation.

**Tech Stack:** TypeScript, Fastify, Svelte, SQLite, existing FNGK process client/terminal sessions, Signal `fngk.publish.v1`, Vitest, Playwright, disposable `npm run test:live` acceptance.

**Spec:** `docs/superpowers/specs/2026-09-22-automatic-http-port-sharing-design.md`

## Global Constraints

- Public exposure requires explicit confirmation; discovery alone never publishes.
- HTTP probes run on the Device loopback/local address only; no external requests or redirects.
- Probe limits are 32 candidates, 2 seconds per port, 16 KiB response body, 15 seconds total.
- FNGK publish output must validate `protocolVersion: "fngk.publish.v1"` and `type: "published"`.
- Artifact handoff requires a matching archive, checksum manifest, OS/architecture, and commit identity.
- Secrets, credentials, environment values, pairing tokens, route tokens, and artifact contents never enter persistent logs/world observations.
- Existing `fngk.publish.v1` and Signal route lifecycle are reused; protocol changes are additive and require exact-head tests.

## Review Focus

- A listener that disappears between scan and publish remains a candidate failure and never publishes a different process; test stale-candidate rejection.
- A TCP/database/TLS listener is not mislabeled HTTP because its port number is common; test positive HTTP, malformed response, refusal, and redirect-disabled probe cases.
- A Device with an older FNGK returns its real terminal output and remediation rather than a generic timeout; test incompatible CLI diagnostics.
- A failed remote artifact install leaves the old binary and daemon untouched; test checksum mismatch, interrupted install, and rollback command generation.
- A published route must not leak URL credentials, environment variables, or terminal output into SQLite; test API responses, logs, and persisted records.

---

### Task 1: Establish shared port-sharing contracts

**Files:**
- Create: `src/ports/types.ts`
- Create: `test/ports/types.test.ts`
- Modify: `src/server/app.ts` only for type imports later; do not add routes yet.

**Interfaces:**
- Produce `HttpPortCandidate`, `PublishedPort`, `PortScanResult`, `PortShareError`, and `PortShareStatus` exactly as defined in the spec.
- Produce `candidateId(contextId,address,port,pid?)` with deterministic SHA-256 identity.

- [ ] Write tests for stable identity, exposure classification (`127.0.0.1` loopback, private LAN, wildcard, unknown), and bounded serialization.
- [ ] Run `npx vitest run test/ports/types.test.ts` and verify the new tests fail before implementation.
- [ ] Implement the types and pure helpers with no database or shell dependencies.
- [ ] Run the focused test and TypeScript check.
- [ ] Commit `feat(ports): define HTTP sharing contracts`.

### Task 2: Add bounded HTTP listener probing

**Files:**
- Create: `src/ports/http-probe.ts`
- Create: `test/ports/http-probe.test.ts`
- Modify: `src/transports/posix.ts` only if an existing quoting helper needs a typed export.

**Interfaces:**
- `probeHttpPort(executor, candidate, options?): Promise<ProbeResult>`.
- `probeHttpPorts(executor, candidates, options?): Promise<{results;errors}>` with the 32/2-second/16-KiB/15-second limits.

- [ ] Test HTTP 200 with a title, HTTP 404 (still HTTP), malformed TCP output, refusal, redirect response, oversized body, and command failure using a fake `CommandExecutor`.
- [ ] Verify tests fail before implementation.
- [ ] Implement safe address/port command construction using `posixQuote`, `curl --max-time`, `--max-redirs 0`, `-D`, and bounded output; use a TCP-only fallback only to return `unreachable`/`not-http`.
- [ ] Implement aggregate deadline and independent per-candidate errors.
- [ ] Run focused probe tests, `npm run typecheck`, and `git diff --check`.
- [ ] Commit `feat(ports): probe Device listeners as HTTP candidates`.

### Task 3: Integrate HTTP candidates into runtime discovery

**Files:**
- Modify: `src/discovery/runtime-discovery.ts`
- Modify: `src/discovery/host-discovery.ts`
- Modify: `src/server/app.ts` discovery wiring
- Test: `test/discovery/runtime-discovery.test.ts`, create `test/ports/discovery.test.ts`

**Interfaces:**
- `RuntimeDiscovery.scan` continues returning raw `DiscoveredEntity[]`; add a separate `scanHttpPorts(contextId, routeId, signal?)` so existing discovery consumers do not change shape.
- `PortDiscoveryService.scan(contextId)` consumes `RuntimeDiscovery` port entities and `HttpPortProbe`.

- [ ] Add fake `ss` and probe transcripts proving all listeners are enumerated, HTTP classification is correct, PIDs/cwds are correlated, and one failure does not abort the scan.
- [ ] Run focused tests and verify the new service is not called by ordinary entity reads.
- [ ] Implement the service with a 32-candidate cap, stable identities, stale marking, and redacted process command data.
- [ ] Run runtime/discovery tests and typecheck.
- [ ] Commit `feat(ports): expose bounded HTTP listener discovery`.

### Task 4: Persist candidates and route lifecycle

**Files:**
- Create: `src/ports/store.ts`
- Create: `test/ports/store.test.ts`
- Modify: `src/store.js` or use a dedicated SQLite file/table migration following existing store conventions.

**Interfaces:**
- `PortShareStore.upsertCandidates`, `candidates(contextId)`, `getCandidate(id)`, `savePublished`, `published(contextId)`, `markStopped`, `markStale`.
- Tables: `atlas_port_candidates` and `atlas_published_ports`; indexes on context/status/port; no body/log columns.

- [ ] Test candidate replacement, idempotent publish records, stop transitions, stale marking, expiry, and reopening SQLite.
- [ ] Verify persisted records contain only bounded metadata and never command output or URL credentials.
- [ ] Implement transactional writes and one-time cleanup for rows whose candidate identity no longer exists.
- [ ] Run focused store tests and migration checks.
- [ ] Commit `feat(ports): persist shareable listener lifecycle`.

### Task 5: Implement `PortSharingService`

**Files:**
- Create: `src/ports/service.ts`
- Create: `test/ports/service.test.ts`
- Modify: `src/fngk/process-client.ts` only if a typed publish wrapper is missing.

**Interfaces:**
- `scan(contextId, signal?)`, `publish(candidateId, {confirm,expiresInMs?})`, `stop(candidateId, {confirm})`, `reconcile(contextId)`.
- Inject `PortShareStore`, `RuntimeDiscovery/HttpPortProbe`, `FngkProcessClient`, context route resolver, and diagnostic registry.

- [ ] Test confirmation-required, probe-required, stale-candidate rejection, valid `fngk.publish.v1`, malformed publish response, idempotent stop, expiry, and incompatible FNGK remediation.
- [ ] Implement local vs Device execution: local profile command for `local`; terminal-preferred remote command for `device:*`; use existing Live Project management helpers where safe but keep this service independent of Live Project sessions.
- [ ] Capture bounded diagnostic session IDs and redacted terminal output; never persist raw route command output.
- [ ] Implement route reconciliation without killing source processes.
- [ ] Run focused service tests and existing Live Project tests.
- [ ] Commit `feat(ports): publish verified HTTP listeners through FNGK`.

### Task 6: Add canonical Atlas port APIs

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/server/context-service.ts` only for capability/error mapping if required.
- Create: `test/server/ports.test.ts`
- Modify: `src/web/lib/api.ts` with typed calls.

**Interfaces:**
- `POST /api/ports/scan`, `GET /api/ports`, `POST /api/ports/:id/publish`, `POST /api/ports/:id/stop` as specified.
- Error codes: `confirmation_required`, `candidate_stale`, `port_not_http`, `fngk_incompatible`, `publish_protocol_invalid`, `route_unavailable`.

- [ ] Test auth/context authorization, API payload bounds, confirmation, successful publish/stop, and error bodies.
- [ ] Wire routes to one `PortSharingService` instance and ensure no scan occurs during `/api/contexts`, world reads, or page load.
- [ ] Run server tests and typecheck.
- [ ] Commit `feat(api): expose HTTP port sharing lifecycle`.

### Task 7: Build the Operations port-sharing panel

**Files:**
- Create: `src/web/components/PortSharingPanel.svelte`
- Modify: `src/web/components/PanelHost.svelte`
- Modify: `src/web/lib/context-actions.ts`
- Modify: `src/web/components/GlobalContextMenu.svelte` only if action registration requires it.
- Create: `test/web/port-sharing.test.ts`

**Interfaces:**
- Panel receives `contextId` and uses only canonical `/api/ports` routes.
- Emits existing `atlas:open-terminal` / diagnostics events; does not create per-port tabs.

- [ ] Test initial empty state, refresh, grouped candidates, publish confirmation, URL copy, stop, stale/error display, and operations-group placement.
- [ ] Implement bounded polling only while panel is visible; render process/address/probe/route state and a clear public-exposure warning.
- [ ] Add context action `share-ports` for online FNGK/host contexts and keep it in the observability/Operations group.
- [ ] Run Svelte check and focused browser test.
- [ ] Commit `feat(web): add explicit HTTP port sharing panel`.

### Task 8: Implement verified FNGK artifact handoff

**Files:**
- Create: `src/fngk-head/artifacts.ts`
- Create: `src/fngk-head/handoff-service.ts`
- Create: `src/fngk-head/install-command.ts`
- Create: `test/fngk-head/handoff.test.ts`
- Modify: `scripts/build-fngk-head.sh` to emit a machine-readable manifest and a safe static installer script.

**Interfaces:**
- `inspectHeadArtifacts(root, platform, architecture): Promise<HeadArtifact>`.
- `prepareHeadHandoff(contextId, artifactRoot): Promise<HandoffSession>`.
- `remoteInstallCommand(handoff, targetProfile, systemScope): string`.
- `verifyRemoteHead(output, expectedDigest, expectedCommit): HeadVerification`.

- [ ] Test missing archive/checksum, checksum mismatch, architecture mismatch, traversal-resistant artifact path, generated command redaction, and successful verification.
- [ ] Implement manifest generation from `git rev-parse HEAD`, archive checksum, OS/architecture, size, and expiry; refuse unverified artifacts.
- [ ] Start/reuse a bounded artifact HTTP server through an existing terminal session and hand its verified port to `PortSharingService`; do not expose arbitrary workspace files.
- [ ] Generate a POSIX remote script that downloads to a temporary directory, verifies SHA-256, preserves the old binary, installs the new binary, runs `fngk install --profile`, validates version/status, and prints rollback. Require explicit `--system` confirmation for system scope; never inject secrets.
- [ ] Run focused handoff tests, including interrupted install preserving the old binary.
- [ ] Commit `feat(fngk): add verified exact-head handoff workflow`.

### Task 9: Add handoff APIs and workflow UI

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/web/components/PanelHost.svelte`
- Create: `src/web/components/FngkHeadHandoffPanel.svelte`
- Modify: `src/web/lib/context-actions.ts`
- Create: `test/server/fngk-head.test.ts`
- Modify: `e2e/workbench.spec.ts`

**Interfaces:**
- `POST /api/fngk-head/handoff/prepare`, `POST /api/fngk-head/handoff/install`, `GET /api/fngk-head/handoff/:id`.
- Workflow consumes the port-sharing route and existing terminal session IDs; it opens in the main workflow area while logs/terminal remain Operations tabs.

- [ ] Test local artifact preparation, remote target selection, confirmation, terminal/diagnostic linkage, verification failure, and rollback copy.
- [ ] Render artifact commit/checksum, published URL, target Device/profile, install command, status timeline, and explicit stop-route/rollback controls.
- [ ] Add the action only when verified artifacts exist and a usable local HTTP route is available; show actionable setup otherwise.
- [ ] Run focused server tests and Playwright workflow coverage.
- [ ] Commit `feat(web): guide exact-head FNGK remote installation`.

### Task 10: Extend Signal/FNGK only if contract gaps are proven

**Files:**
- Modify: `/workspace/signal/cli/*` only when Atlas integration tests demonstrate a missing additive field or command behavior.
- Modify: `/workspace/signal/src/*` only for an additive route/protocol requirement.
- Test: corresponding Go/integration tests and `/workspace/signal/docs/fngk-cli-command-paths.md`.

**Interfaces:**
- Preserve `fngk.publish.v1`; any extension must remain backward-compatible and include exact-head and older-CLI failure tests.

- [ ] Run current Signal Go tests and command-path checks before changing Signal.
- [ ] Add only the smallest missing field/command, update documentation, and test old/new behavior.
- [ ] Do not introduce a second public forwarding route or generic unauthenticated artifact server.
- [ ] Commit Signal changes separately from Atlas.

### Task 11: End-to-end acceptance and operational documentation

**Files:**
- Modify: `scripts/live-acceptance.sh`
- Modify: `docs/live-projects.md`, `docs/host-handoff.md`, create `docs/http-port-sharing.md`
- Modify: `e2e/workbench.spec.ts`

- [ ] Add live acceptance that starts two HTTP fixtures, discovers both, publishes one, verifies the public URL, stops it, and proves the other was untouched.
- [ ] Add the exact-head handoff fixture: build an archive, publish it from local context, install it on a disposable Device with an older stub, verify checksum/commit and daemon convergence, then exercise rollback.
- [ ] Add failure evidence for malformed HTTP, unavailable FNGK, route release, expired share, and leaked-secret scans.
- [ ] Run `npm test`, `npm run typecheck`, `npm run check:web`, `npm run build`, `npm run test:e2e`, `npm run test:live`, `npm audit --audit-level=high`, and `git diff --check`.
- [ ] Commit `test(live): prove automatic port sharing and FNGK handoff`.

### Task 12: Final review and release gating

- [ ] Run source scans for ad-hoc tunnel commands, unbounded shell interpolation, persisted command output, credentials, and route URLs.
- [ ] Verify the active Atlas process was restarted from the final build before browser/live verification; record Atlas, Signal, and FNGK commit identities in acceptance evidence.
- [ ] Confirm old FNGK remains recoverable after a failed handoff and that stopping a share does not delete the Signal Connection.
- [ ] Request independent code review focused on route authorization, shell quoting, public exposure confirmation, artifact containment, and rollback.
- [ ] Commit any review fixes separately, then mark this plan complete.
