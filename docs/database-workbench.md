# Database workbench

Atlas treats a database as a Device-scoped capability. Discovery is terminal-first because the selected shell shows the operator exactly what Atlas can reach; native FNGK adapter resources are merged as structured evidence and remain available as a fallback. Discovery records endpoints and provenance only. It does not scrape credentials.

Remote database traffic follows this path:

```text
DbGate (unprivileged sidecar)
  -> loopback-only Atlas relay
  -> fngk tcp <Device> <port> --stdio-json
  -> authenticated Signal/FNGK connection
  -> Device-local database listener
```

No database port is published through Signal or HKMN. FNGK owns the authenticated relay and its profile credential; Atlas receives only its loopback address and versioned readiness metadata.

## Runtime options

The recommended runtime is the isolated container sidecar:

```bash
DBGATE_RUNTIME=container npm run start:host
```

Atlas pins `dbgate/dbgate:7.2.6` by default and rejects floating tags or versions older than 7.1.9. Override the exact patched image with `DBGATE_IMAGE`. The container runs as UID/GID 65532, read-only, with all capabilities dropped, `no-new-privileges`, PID/memory limits, a temporary filesystem, and no Docker socket, SSH material, FNGK credentials, or Signal credentials. It is reachable only through the authenticated Atlas reverse proxy and is destroyed when the short-lived session stops or expires.

An externally managed process can instead be configured with `DBGATE_COMMAND`, `DBGATE_VERSION`, and—when Atlas itself runs as root—an explicit non-root `DBGATE_UID`. This is useful when Docker is unavailable. Atlas refuses to launch an unpatched or root process.

Database credentials are supplied explicitly for one session, passed only to the disposable sidecar, and never returned by the API or written to Atlas SQLite. Docker administrators can inspect container configuration and are already equivalent to root; the container is removed at session end.

DbGate is GPL-3.0 software and remains a separate process/image behind an HTTP boundary. Atlas does not copy or compile DbGate source into its application bundle. Keep the pinned image and its notices available wherever the sidecar is distributed.

## Compatibility

Remote sessions require an exact-head FNGK CLI supporting `fngk.tcp.v1`. `fngk status --json` must identify the active profile, and the selected Device must be online and authorize TCP. Local-context sessions connect directly to loopback without creating an FNGK relay.

