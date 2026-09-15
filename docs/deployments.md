# Deployment workbench

Atlas deploys through Signal/FNGK; it is not a second deployment control plane. A production run verifies a full commit SHA, archives that commit into a new `.fngk/releases/<number>-<sha>` directory on the selected Device, installs and builds there, starts a managed process, waits for Device-local health, inventories declared artifacts, and only then publishes the port. The active checkout is never cleaned or mutated.

Overview, Plan, Route & Domains, and Artifacts are workflow tabs in the central workspace. Runs, build/process Logs, Browser diagnostics, and History are observability tabs in the protected Operations group. Intelligence stays beside Files in the right sidebar.

The Browser tab reloads the public URL in Playwright and returns bounded console, response, and failed-request evidence. JavaScript evaluation is explicit and audited. Route & Domains retains the generated hostname as fallback while Signal enforces vanity/custom-domain entitlements and DNS ownership.

Rollback starts the retained release as a new managed process, health-checks it, switches the public route, records the result, and only then stops the prior process. A failed health check leaves traffic on the prior healthy release and retains logs/events for diagnosis.

## Rollout

Deploy Signal first, run all migrations, and install the exact same head of FNGK on the Atlas host and Device daemon. Verify `fngk processes`, `fngk deployments`, `fngk resources`, and `fngk connections` JSON protocols before starting Atlas. Set `ATLAS_DEPLOYMENTS_ENABLED=0` to hide mutation endpoints during emergency rollback; existing Signal deployments and processes remain intact. Roll back Atlas before Signal/FNGK so an older UI cannot emit commands against a newer partial contract.
