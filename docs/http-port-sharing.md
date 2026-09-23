# HTTP port sharing and exact-head handoff

Atlas can discover HTTP servers already listening on the selected context and explicitly publish one through the existing FNGK/Signal/HKMN route lifecycle. Discovery never creates a public route.

## Use it

Select a machine in the left rail, then choose **Ports** in its Device actions. **Scan** reads the Device's listening TCP sockets, correlates available process evidence, and probes at most 32 listeners locally on that Device. Each probe is bounded to two seconds and 16 KiB; redirects and external requests are disabled.

Only rows marked as verified HTTP can be published. Publishing opens a confirmation dialog and executes the versioned `fngk.publish.v1` command through the selected context. HTTP Ports opens in the main workspace; terminal output and diagnostic logs remain in Operations. Stopping disables that Device/port target without killing the source process or deleting the reusable Signal Connection. Time-limited shares call the same unpublish operation when they expire.

The equivalent CLI acceptance path is:

```bash
fngk publish 8000 --json --profile local | jq .
fngk unpublish 8000 --json --profile local | jq .
```

Both responses must use `protocolVersion: "fngk.publish.v1"`. Human-readable output means the installed CLI is older than the Atlas automation contract.

Development URLs such as `http://c-….tunnel.localhost:4173` are reachable only in the local Signal environment. With production `APP_ORIGIN=https://signal.nipate.africa` and `TUNNEL_BASE_DOMAIN=hkmn.uk`, Signal supplies the production HTTPS hostname; Atlas does not synthesize or replace that route.

## Install the current head on a remote Device

Build verified artifacts first:

```bash
npm run build:fngk-head
jq . output/fngk-head/manifest.json
sha256sum -c output/fngk-head/SHA256SUMS
```

Select the remote Device and choose **FNGK**. Atlas validates the matching OS/architecture archive, checksum, and current Signal commit; serves only the archive and manifest from a loopback listener; explicitly publishes that listener; and then downloads and installs it through the existing remote terminal. User-scope installation is the default. System scope requires a separate choice and `sudo` on the Device.

The workflow backs up an existing binary before replacement, verifies the installed digest, converges the selected daemon profile, checks `fngk status --json`, and retains a rollback command in its diagnostic session. Stop the temporary artifact route after installation. Atlas never stores profile credentials, terminal bodies, artifact bytes, or route tokens in its port database.

## Failure meanings

- `candidate_stale`: the listener changed between scan and confirmation; rescan.
- `port_not_http`: the listener accepted TCP but did not produce an HTTP response.
- `fngk_incompatible`: install/converge exact head, then restart Atlas.
- `publish_protocol_invalid`: FNGK returned malformed, unsafe, or credential-bearing route metadata.
- `route_unavailable`: the selected Device no longer has a usable native or terminal route.

Logs are available in the Operations dock and contain bounded, redacted diagnostics. A failed share never kills the listener. A failed handoff leaves the previous binary available as `fngk.atlas-backup`.
