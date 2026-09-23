# Automatic HTTP Port Sharing and FNGK Head Handoff

## Intent

Atlas should make an already-running HTTP service on a selected host or FNGK Device shareable without requiring the user to know the port or manually assemble tunnel commands. It must discover listening TCP ports, verify which listeners actually speak HTTP, let the operator explicitly publish one through the existing FNGK/Signal Connection path, and retain enough process/route evidence to observe and stop it.

The immediate motivating journey is installing the local exact-head FNGK build on a remote server that already has an older FNGK installation:

```text
build exact-head locally
  -> serve the checked artifact directory from a local HTTP listener
  -> discover and verify that listener
  -> publish it through the local FNGK machine daemon
  -> copy a bounded, checksum-verifying URL/command
  -> run the installer on the remote Device
  -> converge the remote daemon with `fngk install`
  -> verify remote status and route availability
```

This is an extension of Live Project's route lifecycle, not a second tunnel implementation and not an automatic public exposure mechanism.

## Product boundaries

- Discovery is automatic or manually refreshed; public exposure always requires an explicit operator action and confirmation.
- Discovery is available for the local host and selected online FNGK Devices. The remote scan runs through the existing terminal-preferred Device route.
- A listener is a *candidate* until a bounded Device-local HTTP probe succeeds. TCP listeners, database ports, TLS-only listeners, and failed probes remain visible with a reason but cannot be published through this HTTP flow.
- Publishing uses the existing `fngk publish <port> --json` / `fngk.publish.v1` contract. Atlas must not create a parallel Signal route API.
- Generated hostnames are the default. Vanity/custom domains remain existing Connection actions and are not part of automatic sharing.
- No command output, request body, environment file, URL credential, or binary content is persisted in Atlas evidence. Logs are bounded and redacted.
- A route is stopped explicitly, on session expiry, or when the source listener disappears; stopping disables only the Device target and preserves the reusable Signal Connection record.

## Domain model

Atlas adds a transient/retained port-sharing record (SQLite, separate from the semantic world):

```ts
type HttpPortCandidate = {
  id: string; contextId: string; address: string; port: number;
  protocol: 'http'; state: 'listening'; pid?: number;
  processLabel?: string; processCommand?: string; cwd?: string;
  exposure: 'loopback' | 'lan' | 'all-interfaces' | 'unknown';
  probe: 'pending' | 'http' | 'not-http' | 'unreachable' | 'timed-out';
  probeStatus?: number; probeTitle?: string; probePath: string;
  observedAt: string; stale: boolean;
};

type PublishedPort = {
  id: string; candidateId: string; contextId: string; port: number;
  connectionId: string; hostname: string; url: string;
  publishedAt: string; stoppedAt?: string; expiresAt?: string;
  status: 'publishing' | 'published' | 'stopping' | 'stopped' | 'stale' | 'failed';
  diagnosticSessionId?: string; error?: string;
};
```

Candidate identity is stable for `contextId + protocol + normalized address + port + pid when known`; a new process on the same port produces a new observation and does not inherit a stale route silently.

## Discovery and verification

1. `RuntimeDiscovery` keeps its existing `ss -H -lntup` collection and emits bind address, port, protocol, and owning PID when available.
2. A new `HttpPortDiscovery` service receives those listener facts and executes a bounded Device-local probe for each eligible TCP listener. It must use `curl` when available and a shell TCP fallback only to classify reachability; the HTTP result requires an HTTP status line/headers. The probe binds to `127.0.0.1` for local listeners and uses the advertised local address for non-loopback listeners, never a public URL.
3. The probe uses `HEAD` first, falls back to `GET` with a maximum 16 KiB body, a 2-second per-port timeout, a maximum of 32 candidates per scan, and a total scan deadline of 15 seconds. Redirects are disabled. The response title is optional and bounded to 200 characters.
4. Process metadata is correlated from the existing PID/cwd/command maps. Commands are redacted before API responses and persistence. A missing PID is not a failure; it lowers confidence and leaves the candidate publishable only after a successful probe and confirmation.
5. The scan returns candidates and per-port errors independently. One refused or malformed listener must not fail the scan.

The scan is explicit on first use and may refresh on demand. It must not run shell probes on ordinary Atlas page loads.

## Publish lifecycle

`PortSharingService.publish(candidateId, options)` verifies that the candidate is fresh, still listening, and has `probe === 'http'`, then executes the existing FNGK publish operation through the candidate context's route:

- local context: local FNGK profile/machine daemon;
- Device context: terminal-preferred command route on that Device, requiring an exact-head-compatible `fngk publish` command;
- incompatible CLI: return an actionable diagnostic with the Device terminal/session output; do not fall back to a legacy foreground tunnel.

The operation validates `fngk.publish.v1`, stores only connection ID/hostname/URL and bounded status metadata, and emits a route event. `stop` calls `fngk unpublish <port> --json` (or the managed-process operation when the source is a managed process), marks the target stopped, and is idempotent. A periodic reconciliation checks published candidates; a missing listener marks the route stale and offers one-click unpublish, but does not automatically terminate an unrelated process.

Expiry is opt-in per share, bounded to 24 hours, and defaults to the Atlas session policy. The route URL is never placed in command-line logs or semantic evidence.

## FNGK head handoff

Atlas adds a workflow on top of generic sharing, not a special tunnel protocol:

1. `FngkHeadArtifactService` validates `output/fngk-head` contains an architecture-matching archive, `SHA256SUMS`, and a generated manifest containing commit SHA, OS, architecture, size, and checksum. It refuses an unverified directory.
2. It starts a local, bounded static artifact server in a dedicated terminal session, or adopts an already-running verified HTTP candidate. The server exposes only the selected artifact directory and an installer manifest/script; directory traversal and arbitrary file reads are rejected.
3. The service publishes that verified HTTP candidate through the local FNGK profile. The UI displays a copyable remote command that downloads the exact archive, verifies the checksum, installs it to a temporary path, preserves the current binary, installs/converges the remote daemon with `fngk install --profile PROFILE`, and reports rollback commands. The command contains no Atlas credential; the public URL is the only short-lived capability and is revocable by stopping the route.
4. The remote command is run through an attached remote terminal only after explicit confirmation, or copied for an operator to run manually. Atlas captures bounded stdout/stderr in the existing terminal/diagnostic session and never automatically uses `sudo`; system scope remains an explicit operator choice.
5. Completion verifies the remote `fngk version`, namespace/daemon reachability, and checksum/commit identity. If convergence fails, the old binary remains active and the UI exposes the preserved backup and exact rollback command.

The handoff must not claim that the local FNGK binary itself is an HTTP service. It serves a verified artifact bundle through a normal local HTTP listener, then publishes that listener.

## UI

Add one Operations-group `Port sharing` panel and one workflow action `Share FNGK head` when a verified local artifact bundle exists. The port panel shows:

- context/device and last scan time;
- candidates grouped by HTTP, not-HTTP, unreachable, and stale;
- address, port, owning process/cwd, exposure, probe status, and confidence;
- explicit `Publish`, `Stop`, `Refresh`, and `Open terminal/logs` actions;
- published hostname/URL, expiry, route status, and copy button;
- a clear warning that publishing makes the listener public.

The FNGK handoff workflow shows artifact identity, source listener, route status, remote target, install command, verification state, and rollback. It reuses existing terminal/log/diagnostic surfaces; it does not open a tab per port.

## APIs and compatibility

Atlas adds canonical routes:

- `POST /api/ports/scan` `{contextId}` → candidates and bounded errors;
- `GET /api/ports?contextId=...` → latest candidates and published routes;
- `POST /api/ports/:candidateId/publish` `{confirm:true, expiresInMs?}`;
- `POST /api/ports/:candidateId/stop` `{confirm:true}`;
- `POST /api/fngk-head/handoff/prepare` `{contextId, architecture?}`;
- `POST /api/fngk-head/handoff/install` `{handoffId, targetContextId, confirm:true, systemScope?:boolean}`;
- `GET /api/fngk-head/handoff/:id` → artifact, route, terminal/diagnostic IDs, verification and rollback state.

No Signal database migration is required for the first implementation because route creation/release already exists. If Signal/FNGK lacks a required JSON field, extend the existing `fngk.publish.v1` or process operation contract additively and update its command-path documentation and exact-head tests before Atlas consumes it.

## Failure and security behavior

- no compatible FNGK CLI: show the terminal command output and remediation (`install` exact head) without retry loops;
- probe timeout/refusal: retain the candidate with a visible reason;
- publish response malformed: fail closed and retain terminal/diagnostic output;
- listener disappears: mark stale, preserve evidence, and make unpublish explicit;
- artifact checksum/architecture mismatch: refuse handoff;
- remote install failure: preserve old binary and expose rollback;
- public route failure: leave local process untouched and show Signal/FNGK error;
- all shell commands use the existing POSIX quoting helper and bounded command executor;
- route URLs, pairing tokens, credentials, environment values, and artifact contents are excluded from persistent logs and semantic observations.

## Success criteria

- A selected Device scan identifies every listening TCP port up to the configured bound and correctly classifies HTTP listeners without page-load shell execution.
- An operator can publish an existing HTTP listener, see its public URL, open its logs/terminal, and stop it; repeat publish/unpublish is idempotent.
- A local exact-head artifact bundle can be served, published, installed on a remote Device with an older FNGK, verified by checksum/commit, and rolled back without replacing the old binary on failure.
- The feature works for local and remote contexts, respects route capabilities, and produces no secret-bearing persistent evidence.
