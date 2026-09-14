# Live projects and public routes

Atlas Live Project starts code on the selected FNGK Device and keeps the execution, route, diagnostics, and code evidence connected. It does not run a remote project through the Atlas host shell.

## Required path

The selected profile must expose an online Device with terminal support, and both Signal and the installed FNGK CLI must include `fngk.publish.v1`. Atlas opens a dedicated terminal, changes to the absolute repository path, starts the confirmed command, and asks the Device's own daemon to publish the selected port. Signal returns the effective URL, including the development port when applicable.

The normal path is:

```text
Atlas -> fngk terminal -> Device project process on :8000
Atlas -> fngk publish 8000 --json -> Signal Connection/HKMN URL
browser -> Signal authenticated/public proxy -> Device forwarding stream -> :8000
```

The Device daemon must be running from the same compatible FNGK build and profile as Atlas. For source checkouts, build the exact-head artifact and install it using the rollback procedure in [host-handoff.md](host-handoff.md); Atlas never replaces the host binary automatically.

## Lifecycle and diagnostics

Starting, interrupting, restarting, and stopping are explicit actions. Restart releases the old Connection target before starting a new terminal-backed process. Stop terminates the dedicated terminal and runs `fngk unpublish`, which disables only that Device/port target and preserves the reusable Signal Connection record.

Output is kept in a bounded in-memory ring and streamed into the Live Project panel. Session output and screenshots are not written to Atlas storage. Playwright diagnostics are opt-in and report reachability, status, title, application console errors, failed requests, and timing. Local HTTP-only security-policy notices are reported separately as environment warnings; they are not silently classified as application errors.

## Operational acceptance

`npm run test:live` creates its own PostgreSQL and Redis services, builds exact-head Signal/FNGK, pairs and authorizes a disposable root Device, launches a fixture project, publishes its port, renders it with Playwright, opens an isolated DbGate workbench, verifies coverage/CRAP and runtime correlation, checks disconnect/reconnect, scans for leaked credentials/helper files, and removes its resources. Set `ATLAS_LIVE_KEEP_FAILED=1` only while diagnosing a failed run; retained workspaces contain disposable credentials and must be handled accordingly.
