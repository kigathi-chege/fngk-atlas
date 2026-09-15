# Database workbench

Atlas treats a database as a Device-scoped capability. Discovery is terminal-first because the selected shell shows the operator exactly what Atlas can reach; native FNGK adapter resources are merged as structured evidence. Discovery records endpoints and provenance only. It does not scrape credentials.

Database operations follow this path:

```text
Atlas database panel
  -> fngk resources <resource> bindings/invoke --json
  -> authenticated Signal Surface operation
  -> Device-local PostgreSQL adapter
```

No database port is published through Signal or HKMN and no TCP relay is created. The Device adapter performs each capability-scoped operation locally and returns bounded structured output.

## Profiles and credentials

Create a profile from an adopted PostgreSQL resource. Atlas encrypts a supplied password to the Device's ephemeral public key before it leaves the browser. A remembered credential is stored in the Device vault and referenced by opaque ID; Atlas and Signal do not retain the plaintext. An unremembered credential remains only in the current browser workbench.

Profiles carry an environment classification (`development`, `staging`, or `production`) and least-privilege grants. Read queries run without confirmation. Writes and administrative operations require explicit confirmation; production confirmation must match the profile name.

## Capabilities

The PostgreSQL Surface supports connection testing, database and schema catalogs, table browsing, bounded SQL queries, CSV export, schema snapshots, backup, and restore where the binding grants them. The database selector passes the chosen database to each operation, so one server profile can expose all databases accessible to its account.

## Compatibility

The selected Device must expose an adopted resource whose Surface includes the PostgreSQL capabilities, and the installed CLI must support `fngk.surface.v1`. Atlas deliberately has no compatibility fallback to the removed sidecar/TCP-relay architecture.
