# Atlas Desktop Bootstrap and FNGK Onboarding

## Product intent

Atlas should be installable and usable as a desktop application by a developer who does not want to open a terminal. On first launch, the application must explain whether FNGK is installed, whether it is compatible, whether a profile is authenticated, and whether authorized Devices are reachable. When FNGK is absent or outdated, Atlas must guide installation and convergence through a small, signed, visible workflow. The user may still choose advanced/manual paths, but the happy path must not require typing shell commands.

The desktop application is a companion to the existing hosted/web Atlas, not a replacement for it. The desktop shell owns local lifecycle and onboarding; Atlas's existing Svelte workbench, semantic Observatory, deployments, terminals, and Signal/FNGK operations remain the product surfaces.

## Recommended architecture

Use Tauri 2 as the desktop shell with two bundled sidecars:

```text
Tauri host
  ├─ Atlas server sidecar (Node runtime + dist/server)
  ├─ FNGK CLI sidecar (platform/architecture-specific)
  ├─ local loopback webview and IPC bridge
  └─ OS browser/deep-link integration
```

The first release should support Linux and macOS. Windows is a follow-on once the bootstrap contract and signing pipeline are stable. The existing browser UI is loaded from the loopback Atlas server, never from an arbitrary remote origin. The shell exposes a narrow command bridge for status, install, login, update, and shutdown; the renderer cannot execute arbitrary commands.

Electron remains a viable short-term alternative if Tauri's sidecar packaging blocks release timing. If Electron is selected, `contextIsolation`, sandboxing, a restrictive Content Security Policy, no renderer `nodeIntegration`, and an allowlisted preload API are mandatory. A native rewrite is explicitly out of scope.

## Runtime ownership

Atlas must not reimplement FNGK authentication or store Signal credentials. FNGK remains the authority for:

- profile configuration and protected credentials;
- Device pairing and operator authorization;
- daemon installation and convergence;
- namespace, terminal, process, deployment, and publish protocols.

The desktop shell starts FNGK commands through a bundled or discovered executable and consumes only versioned, secret-free JSON. It may display redacted command diagnostics, but never stores the profile file, operator credential, session cookie, pairing token, terminal ticket, or secret envelope in Atlas state.

The app maintains two separate statuses:

1. **Local FNGK runtime:** executable presence, version, protocol compatibility, daemon reachability, current profile, and operator login.
2. **Remote Device access:** authorized Devices, online state, FNGK version/protocol compatibility, capabilities, and last-observed freshness.

## First-launch state machine

The onboarding coordinator is an explicit state machine persisted only as non-sensitive progress:

```text
checking
  ├─ compatible + authenticated -> ready
  ├─ missing -> install-choice
  ├─ present but incompatible -> update-choice
  ├─ daemon missing -> daemon-install-choice
  ├─ profile absent -> login-choice
  └─ permission/error -> recoverable-error
```

### Detection

The app first checks a bundled FNGK artifact, then a configured executable path, then `PATH`. It runs `fngk version` and `fngk status --json` with a strict timeout and validates the documented namespace/terminal protocol versions. A development label is not treated as proof of exact-head identity; the app compares a recorded artifact digest/commit when available.

### Installation

The default is a per-user installation in the platform-appropriate application data/bin location. The installer downloads a signed manifest and matching archive over HTTPS, verifies publisher signature, SHA-256, OS, architecture, and size, extracts into a temporary directory, atomically installs the executable, and retains the previous executable for rollback. System-wide installation is an advanced action that invokes the OS elevation dialog and clearly states what will change.

No shell script is displayed as the primary UX. The shell performs the bounded operations itself and streams phases such as Downloading, Verifying, Installing, and Rolling back. Failed downloads, mismatched signatures, unsupported architectures, and denied elevation leave the existing installation untouched.

### Daemon convergence

After installation, Atlas invokes `fngk install --profile <profile>` through the sidecar. This is the supported convergence operation for the persistent user daemon. The app then polls `fngk status --json` until the daemon is reachable or a bounded failure state is shown. `sudo` is never silently added.

### Login and pairing

Login is browser-based. Atlas asks FNGK for an authorization URL or invokes a future machine-readable login operation, opens the system browser, and waits for a signed/expiring callback or polls the documented completion endpoint. The UI shows the Signal origin and the authorization code/state without exposing credentials. Pairing a new Device is a separate guided action; an already paired remote server simply appears in the authorized namespace after operator login.

If the current FNGK CLI only exposes human-oriented login output, add a small additive JSON bootstrap contract in FNGK rather than scraping terminal text. The contract must return `{protocolVersion, state, authorizationUrl?, expiresAt?, profile?}` and never return the credential itself.

## Local Atlas lifecycle

The shell starts the compiled Atlas server on a random loopback port, passes `ATLAS_HOST=127.0.0.1`, `ATLAS_PORT`, `ATLAS_DB` under the app data directory, `FNGK_BIN`, and `NODE_ENV=production`, then opens the webview to the authenticated loopback origin. The child process is supervised, has bounded stdout/stderr capture, and is shut down on app exit. The webview cannot navigate to arbitrary origins; public URLs opened from deployment/live-project surfaces use the system browser or an explicitly sandboxed preview window.

Atlas's SQLite database remains local app data and stores layouts, redacted evidence, operations, and semantic state. Uninstall offers a separate “remove local Atlas data” choice; ordinary uninstall does not delete FNGK profiles or remote data.

## Updates and rollback

Atlas desktop updates and FNGK updates are separate signed channels. An Atlas app update must not replace the user’s FNGK binary unless the user approves an FNGK update. FNGK artifact updates use the same backup/converge/verify/rollback contract as the existing host handoff. If an update fails health or daemon verification, restore the previous binary and report the exact failed phase.

## Security requirements

- Renderer-to-host IPC is allowlisted by operation and validates all inputs with schemas.
- No arbitrary shell command API is exposed to the renderer.
- Downloads require HTTPS, signature verification, checksum verification, size limits, and architecture matching.
- Installer extraction rejects traversal, symlinks, unexpected files, and archive paths outside a temporary directory.
- Loopback server binds only to `127.0.0.1` and uses a per-launch random capability/token for the webview.
- Auth callbacks validate state, expiry, origin, and one-time use.
- Credentials remain in FNGK's protected profile; Atlas logs only redacted error codes and bounded phase text.
- Desktop UI clearly distinguishes local FNGK, remote Device, online, stale, unauthenticated, incompatible, and permission-denied states.
- Code signing, notarization/notary-equivalent, and signed update metadata are release gates for each supported OS.

## UI journey

The first window is an onboarding Observatory, not a blank workbench:

1. “Welcome to Atlas” explains that FNGK is the secure machine connection layer.
2. A status card says “FNGK ready”, “Install FNGK”, “Update FNGK”, “Sign in”, or “Repair profile”.
3. A single primary button performs the next safe action; advanced/manual details are expandable.
4. Progress includes phase, elapsed time, cancel behavior, and redacted diagnostics.
5. Once ready, the normal Machine Observatory opens and shows local and remote contexts.

Subsequent launches skip onboarding when the local profile is healthy, but retain a persistent status indicator and a recoverable setup panel.

## Testing and acceptance

The desktop layer requires unit tests for state transitions, artifact verification, path containment, command allowlists, callback validation, rollback, and redaction. Integration tests must run the Atlas sidecar with a fake FNGK executable implementing the JSON contracts. Browser tests must verify first-run and recovery UI. Packaging smoke tests must launch the Linux and macOS artifacts, detect a fake/missing FNGK, and shut down cleanly.

The disposable live test must additionally prove that a desktop-like local Atlas process can use an exact-head FNGK CLI to authenticate, see an authorized Device, open a terminal, and publish/observe a route without persisting credentials.

## Out of scope

- Rewriting Atlas in Rust or another native UI toolkit.
- Replacing Signal/FNGK authentication with Atlas-owned credentials.
- Silent system-wide installation or elevation.
- Automatically pairing arbitrary Devices.
- Embedding unrestricted remote websites in the privileged webview.
- Removing the hosted/web Atlas deployment.

## References

- [Tauri 2 learning and sidecar documentation](https://v2.tauri.app/learn/)
- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron safe storage](https://www.electronjs.org/docs/latest/api/safe-storage)
