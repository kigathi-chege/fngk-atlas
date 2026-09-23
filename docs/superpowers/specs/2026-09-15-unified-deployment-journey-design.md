# Unified Deployment Journey Design Specification

**Status:** Approved implementation specification  
**Date:** 2026-09-15  
**Applies to:** `fngk-atlas`, Signal server, and the FNGK CLI/Device daemon  
**Protocol families:** `atlas.deployment-journey.v1`, `fngk.project.v2`, `fngk.source.v1`, `fngk.environment.v1`, `fngk.deployment.v2`, `fngk.runtime.v1`, `fngk.storage.v1`, `fngk.schedule.v1`

## 1. Purpose

Atlas must provide one understandable journey for taking code from a source, building it, deploying it to a Device, publishing it, and operating it afterward. A first-time user must not need to understand Signal Connections, FNGK terminal mechanics, process managers, deployment releases, or the adapter registry before completing a deployment.

The initial implementation must support:

- Device directory to the same Device;
- Device-to-Device transfer;
- provider-neutral Git sources, with GitHub-enabled triggers;
- uploaded source archives;
- retained artifacts and previous releases;
- Docker, including deployment of the complete Signal Docker project;
- Svelte/Vite and SvelteKit;
- Fastify;
- Laravel;
- Nuxt;
- Next.js;
- PostgreSQL;
- PM2, Supervisor, systemd, Docker restart policies, cron, and systemd timers;
- npm, pnpm, Yarn, Bun, Composer, and Docker/Compose workflows;
- managed environment profiles and Device-local secrets;
- editable, versioned deployment phases;
- durable processes, workers, schedulers, storage, artifacts, logs, health, routes, domains, rollback, and browser diagnostics.

The architecture must remain extensible: a new framework, source, process manager, database, or observer must plug into the same journey without introducing another bespoke workbench.

## 2. Normative language and status annotations

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

Implementation annotations used below:

- **Existing:** capability already exists and should be retained.
- **Partial:** capability exists but does not meet this specification.
- **Required:** new or replacement behavior.

## 3. Product principles

1. **One journey, progressive detail.** The default UI is one Deployment Journey panel. Frameworks and runtime managers do not receive separate primary panels.
2. **Signal is authoritative.** Signal owns authorization, desired state, deployments, releases, processes, routes, domains, environment metadata, artifacts, audit, and retained operational evidence.
3. **FNGK executes on Devices.** FNGK materializes sources, invokes tools and supervisors, reads local state, streams observations, and stores secret material in the Device vault.
4. **Atlas interprets and presents.** Atlas detects projects, proposes plans, renders state, and submits explicit operations. It MUST NOT become a second durable deployment control plane.
5. **Terminals are optional tools.** Deployment must continue when a terminal, panel, browser, or Atlas process closes. Terminals may attach for diagnosis but MUST NOT own a persistent workload.
6. **Immutable releases, explicit state.** Source snapshots and application releases are immutable. Writable application state is declared separately.
7. **Evidence survives failure.** Every failed phase retains its command identity, sanitized output, exit status, target, timestamps, and correlation IDs.
8. **Production durability is truthful.** Atlas MUST distinguish a supervisor-backed workload from an ephemeral FNGK child process.
9. **Safe defaults with visible overrides.** Adapters propose a working plan; advanced users may edit it, but edits are versioned, validated, previewed, and audited.

## 4. Current-state baseline

### 4.1 Existing capabilities to preserve

- Semantic Atlas entities, assertions, interpreters, provenance, deterministic IDs, and declarative Inspector views.
- The bounded, observation-only `atlas.device-adapter.v1` protocol.
- Signal managed-process records, run history, cursor-bounded stdout/stderr logs, and process actions.
- FNGK Device daemon installation through systemd/launchd.
- Signal adapters for PM2, Docker, PostgreSQL, Files, Nginx, CI, and system health.
- Signal route publication, vanity/custom domains, DNS verification, and generated fallback hostnames.
- Signal artifact registry and managed deployment/release/event records.
- Atlas project-manifest validation, Node framework interpretation, deployment planning, managed-process invocation, browser diagnostics, and native PostgreSQL workbench foundations.
- Protected Dockview Operations grouping and persistent sidebar/workspace layout rules.

### 4.2 Partial behavior that must be replaced or completed

- `fngk.project.v1` models only install/build/start strings, one port, and shallow artifact/environment declarations.
- Atlas currently orchestrates deployment phases inside an API request. This couples execution to the Atlas process lifetime.
- Current production extraction assumes the repository already exists on the destination Device.
- The current fixed-port process model cannot provide a general health-gated release switch.
- Managed FNGK children are killed when the FNGK daemon stops. Signal can restart after a reported exit, but cannot guarantee survival when the exit event is lost.
- Environment secret references exist, but generic deployment-secret storage, revisioning, binding, injection, and rotation are incomplete.
- Deployment events contain some bounded command output, but there is no unified live deployment stream.
- Docker observation is substantial, but build/pull/create/Compose reconciliation and release association are incomplete.
- The current deployment UI opens many panels and exposes raw implementation concepts before explaining the journey.
- PostgreSQL is native but must fully replace DbGate before DbGate removal is considered complete.

## 5. System architecture

```text
Source adapter
  -> immutable source snapshot
  -> project interpreter
  -> versioned deployment plan
  -> build runner
  -> runtime manager + scheduler
  -> health-gated route activation
  -> continuous observers

Atlas UI -> Atlas orchestration API -> Signal deployment state machine
                                      -> FNGK Device daemon
                                         -> source/build/runtime/storage adapters
```

Adapters have explicit roles:

- **Source adapters:** acquire and verify material.
- **Project adapters:** detect project semantics and propose phase/role/resource defaults.
- **Build runners:** execute finite build phases.
- **Runtime managers:** own durable workload lifecycle.
- **Scheduler adapters:** own recurring jobs.
- **Resource adapters:** manage databases, storage, routes, and other dependencies.
- **Observer adapters:** report logs, metrics, health, topology, and activity.

`atlas.device-adapter.v1` remains observation-only. Execution MUST use authenticated, versioned Signal/FNGK contracts with capability and confirmation checks.

## 6. Canonical journey and state model

### 6.1 Opening contract

The central UI opens with a stable reference, never with a PID-only identity:

```ts
type DeploymentJourneyRef = {
  protocolVersion: 'atlas.deployment-journey.v1';
  source: {
    projectId: string;
    entityId: string;
    contextId: string;
    repositoryRoot: string;
    revision?: string;
    packageId?: string;
  };
  target?: {
    contextId: string;
    deviceEntityId: string;
    environmentId?: string;
    workloadId?: string;
    signalResourceId?: string;
  };
};
```

`projectId` is derived from context, canonical repository root, and declared repository/package identity. `workloadId` is derived from the strongest available manager/service/release evidence and MUST NOT be derived from a transient PID alone.

### 6.2 Journey stages

The single panel presents these stages:

1. **Understand:** detected project, framework, runtime roles, dependencies, existing deployments, evidence, and warnings.
2. **Source:** select Device path, Git, upload, artifact, or release; create and verify the immutable snapshot.
3. **Destination:** select a Device, environment, runtime manager, routes, domains, databases, and storage.
4. **Configure:** review environment bindings, phase scripts, roles, schedules, health, storage, artifacts, retention, and drain behavior.
5. **Review:** display the exact plan, diffs, required capabilities, confirmations, expected mutations, rollback feasibility, and warnings.
6. **Deploy:** show the persisted phase timeline and live output; allow safe cancellation and retry.
7. **Operate:** show current release, health, routes, logs, browser, processes, jobs, storage, artifacts, history, redeploy, promotion, rollback, and stop.

The journey state is addressable by stable IDs and recoverable after reload. Reopening a project returns to its active or most recent deployment.

## 7. Public contracts

### 7.1 `fngk.project.v2`

The manifest MUST contain:

- stable name and adapter identity/version;
- project root and optional monorepo workspace;
- application, worker, scheduler, migration, and one-shot roles;
- source requirements;
- ordered structured phases and rollback hooks;
- build runner and runtime-manager preference;
- environment-profile bindings;
- ports and protocols;
- readiness, liveness, shutdown, and drain configuration;
- generated, vanity, and custom routes;
- artifacts;
- durable and disposable storage;
- database/resource dependencies;
- log, release, artifact, and backup retention.

Readers MUST continue accepting `fngk.project.v1`. A deterministic upgrader presents an equivalent v2 plan without rewriting the user's file until confirmed.

### 7.2 `fngk.source.v1`

Sources are represented by provider-neutral descriptors:

- `device-directory`;
- `git`;
- `upload`;
- `artifact`;
- `release`.

Materialization produces a content-addressed snapshot with digest, byte/file counts, provenance, ignore rules, creation identity, and verification result. Device archives MUST respect `.gitignore` and `.fngkignore`, reject absolute/traversal paths and unsafe links, apply configured size/file limits, and verify the digest on the destination.

Production MAY use an uncommitted Device snapshot or upload only after explicit confirmation. The release must visibly retain its non-VCS provenance and exact digest.

### 7.3 `fngk.environment.v1`

An environment profile contains a name, environment class, non-secret variables, secret-key metadata, destination vault bindings, revision, consumers, and audit history.

- Non-secret values MAY be retained by Signal.
- Secret plaintext MUST be encrypted to the destination Device and stored in its Device vault.
- Signal and Atlas MUST NOT persist or echo secret plaintext.
- `.env` import runs locally on the source/destination boundary, classifies likely secrets, previews key-level changes, and requires confirmation.
- Generated environment files live outside immutable releases, use mode `0600`, and are injected using the runtime manager's supported mechanism.
- Deployment records bind to a specific environment revision.
- Rotation creates a new revision and offers a controlled reload/restart.
- Deleting a referenced key is blocked until dependent workloads are updated or removed.

`.env` is a compatibility import/export format, not the production source of truth.

### 7.4 `fngk.deployment.v2`

Signal owns an idempotent state machine supporting plan, approve, execute, cancel, retry, observe, promote, stop, rollback, and cleanup. A deployment continues independently of Atlas and terminal connections.

Every phase records queued, running, succeeded, failed, cancelled, or skipped state; attempt; timestamps; runner; sanitized command identity; exit status; output cursor; resource effects; and correlation IDs.

Default ordered phases are:

1. preflight;
2. acquire and verify source;
3. prepare immutable release;
4. install dependencies;
5. build;
6. migrate;
7. provision/bind resources;
8. activate runtime roles;
9. readiness and health;
10. publish/switch routes;
11. drain prior release;
12. post-deploy;
13. inventory artifacts;
14. cleanup.

Adapters propose phase commands, timeouts, working directories, capabilities, and rollback hooks. Users may edit phase definitions in an advanced editor. Each edit creates a revision with validation, diff, actor, timestamp, and restore-to-default support.

Production defaults to a health-gated switch: start the candidate on allocated internal ports, verify it, atomically switch the Signal route, drain the previous release, and retain that release for rollback. An in-place restart is an explicit compatibility override.

### 7.5 `fngk.runtime.v1`

Runtime roles declare manager, command/arguments, cwd, user, environment revision, instance count, restart/backoff, memory threshold, readiness, shutdown/drain, log sources, and durability class.

Supported managers:

- PM2;
- Supervisor;
- systemd;
- Docker;
- FNGK native.

Production plans MUST use a supervisor-backed durability class unless the user explicitly accepts an ephemeral override. FNGK-native children are labeled ephemeral because they terminate with the daemon in the present implementation.

FNGK MUST verify that the chosen supervisor is installed, reachable, configured for boot, and owns the expected process definition. It MUST NOT silently install packages, write privileged configuration, or invoke sudo. Missing prerequisites produce a guided, separately confirmed setup operation.

On Device connection and reconnect, FNGK reports observed manager/process identity, definition digest, state, PID where applicable, restart count, health, and log cursor. Signal reconciles desired and observed state without creating duplicates. Drift, disappearance, and manager failure are explicit conditions.

### 7.6 `fngk.schedule.v1`

Schedules declare manager, expression, timezone, command/role, environment revision, overlap policy, timeout, retry, output retention, enabled state, and optional framework semantics.

Prefer systemd timers where available; support existing cron entries through explicit adoption. Laravel scheduler roles and PM2 `cron_restart` must be modeled distinctly. Users can inspect next/last run, trigger now, pause/resume, view output, and detect missed or overlapping runs.

### 7.7 `fngk.storage.v1`

Storage declarations distinguish:

- immutable releases;
- named Docker volumes;
- durable Device directories;
- databases;
- object-storage bindings;
- backup targets;
- disposable build and package caches.

Each durable resource records ownership, permissions, mount/binding targets, capacity, free space, growth, backup policy, last verified backup, consumers, environment, and deletion protection.

Named durable resources MUST NOT be automatically deleted. Cleanup requires an impact preview and typed confirmation. Release rollback MUST reattach the same compatible durable resources rather than copying state into the release directory.

Default retention is current plus five successful rollback releases, failed releases for seven days, logs for seven days, and artifacts following their release unless pinned. Backup deletion follows only its explicit policy.

## 8. Adapter requirements

All adapters implement detect, explain, propose, validate, execute where applicable, and observe. Detection is read-only and evidence-preserving. Generated plans disclose confidence and source files.

### 8.1 Docker and complete Signal deployment

The Docker adapter MUST complete existing observation with image build/pull, BuildKit output, container create/update, Compose-style reconciliation, health, restart policies, volumes, networks, secrets, logs, stats, exec, image history, release association, rollback, and reviewed pruning.

The first-party acceptance deploys the actual Signal checkout: multi-stage image, PostgreSQL and Redis dependencies, migrations, API/web process, environment bindings, health, persistent volumes, routes, logs, release replacement, and rollback. Docker restart policies own container survival; no nested process supervisor is introduced by Atlas.

### 8.2 Svelte and SvelteKit

Detection distinguishes Vite/Svelte static applications from SvelteKit and identifies configured adapters. Static output is published as an artifact/hosted release. SvelteKit adapter-node runs as a supervised Node workload; static adapters use static publication. The plan includes package manager, build output, port, host binding, health, and runtime environment semantics.

### 8.3 Fastify

Detection identifies package scripts and likely entrypoints. The adapter proposes lockfile-safe install, optional TypeScript build, supervised start, host/port, health, structured Pino log ingestion, and graceful SIGINT/SIGTERM drain. When application logging is disabled, Atlas reports that limitation instead of showing an empty stream as healthy evidence.

### 8.4 Next.js

Support Node server, standalone output, Docker, and static export. Dynamic applications default to standalone Node or Docker. The adapter handles `.next/standalone`, public/static assets, `PORT`/`HOSTNAME`, reverse-proxy streaming checks, graceful drain, and multi-instance cache warnings.

### 8.5 Nuxt

Support Nitro Node output, static generation, Docker, and PM2. Node plans run `.output/server/index.mjs` with production mode and the correct host/port variables. The adapter detects server/static intent and records `.output` artifacts.

### 8.6 Laravel

Support Composer install, optional frontend package build, environment binding, application key reference, storage link, caches, migrations, PHP-FPM/web roles, queue workers, Horizon, scheduler, and writable storage.

Workers run under Supervisor or systemd with configurable concurrency, timeout, tries, graceful group stop, and retained output. Deployments gracefully restart workers after code activation. Migration and maintenance-mode behavior is previewed; destructive or non-reversible migrations require confirmation.

### 8.7 PostgreSQL

The native Signal PostgreSQL adapter replaces DbGate. It supports discovery or confirmed provisioning, Device-vault credentials, database selection, catalog/schema/table browsing, bounded queries/results, reviewed edits, saved queries/history, CSV export, activity/locks, metrics, logs, schema comparison, backup, restore, capacity, and deployment dependency links.

Database rows remain transient and bounded. Credential plaintext and result rows are not retained by Signal. Backups remain Device-side or move to a declared artifact/object-storage target.

### 8.8 Process managers and package managers

- PM2 support extends the existing adapter with generated/adopted ecosystem definitions, environment revisions, readiness, graceful reload, restart limits, log/metric correlation, `pm2 save`, and startup verification.
- Supervisor support includes discovery/adoption, program groups, autostart/autorestart, process-group stop, log paths, reread/update, and drift detection.
- systemd support includes user/system units, environment files, dependencies, restart/backoff, resource limits, readiness, enable-at-boot, journald, and drift detection.
- Package-manager selection follows lockfiles and supports npm, pnpm, Yarn, Bun, Composer, and Docker/Compose with frozen/reproducible installs and version preflight.

## 9. Observability and operational evidence

One cursor-based deployment stream combines:

- planning and approvals;
- source transfer and verification;
- install, build, and migration output;
- supervisor and application stdout/stderr;
- Docker, PM2, Supervisor, systemd, and schedule events;
- readiness, liveness, and health checks;
- route and domain changes;
- proxy/request health summaries;
- browser console, page, and request failures;
- storage, backup, and database checks;
- artifact and cleanup events;
- rollback and reconciliation events.

The stream preserves source, phase, role, run, attempt, timestamp, and sequence. UI filtering does not destroy raw source distinctions. Logs support follow, search, wrapping, source/level/time filters, cursor pagination, authorized download, and redaction.

Failed startup MUST retain the exact sanitized execution definition, manager, working directory, exit result, supervisor status, Device, release, and logs. A user must be able to open or attach a diagnostic terminal from the failure without making that terminal responsible for the workload.

Browser observation supports embedded preview, navigation/reload, console, network failures, timing, optional screenshots, and explicitly confirmed audited JavaScript evaluation. Environment-only browser policy warnings are separated from application errors.

Existing workloads may be adopted only after Atlas presents a desired-definition diff. Adoption never silently rewrites manager configuration.

## 10. UI and placement policy

The primary Deployment Journey is a workflow and MUST open in the central working area. It replaces the existing pattern of opening Overview, Plan, Runs, Logs, Browser, Routes, Artifacts, and History as eight simultaneous tabs.

The one panel uses progressive disclosure:

- the default path shows the adapter recommendation in plain language;
- advanced phase, manager, environment, and storage settings expand in context;
- status and next action remain visible;
- errors link directly to the failing phase and evidence;
- an experienced user can clone a previous configuration or redeploy without repeating onboarding.

Inline deployment logs remain in the journey. Full Logs, Terminal, Metrics, Browser Console, Database Inspector, Activity, and other observability tools MUST open only in the protected Operations group. New workflow editors MUST open in the central area. Intelligence chat belongs in the files/intelligence sidebar.

If all central tabs close, the center remains empty and sidebars retain their saved/default widths. Observability panels do not migrate into the workflow area and workflow panels do not migrate into Operations.

Right-click, overflow menus, command palette, semantic entities, Inspector, empty states, and journey actions share one contextual-action registry. Native context menus remain available in editors, terminals, inputs, selections, and embedded browser content.

## 11. Security and authorization

- Every mutation is authorized against team, project, Device, environment, and resource scope.
- High-risk and destructive operations require typed confirmation and an impact preview.
- Privilege escalation is never implicit.
- Secrets are encrypted to the Device, redacted from every output channel, and referenced by opaque IDs.
- Source extraction rejects traversal, device nodes, unsafe links, ownership surprises, and configured budget violations.
- Commands execute with explicit cwd, environment revision, timeout, output cap, cancellation, and actor.
- Adapter packages retain signature and publisher verification requirements.
- Browser evaluation is disabled by default and requires per-session confirmation and audit.
- Database queries and file/artifact downloads remain bounded and access-controlled.
- Audit records correlate plan revision, approval, actor, Device, source digest, environment revision, execution, and resource effects.

## 12. Failure, recovery, and reconciliation

The system must explicitly handle:

- Atlas restart during deployment;
- Signal restart during deployment;
- FNGK disconnect/reconnect or daemon restart;
- supervisor restart and machine reboot;
- lost, duplicated, or reordered events;
- source transfer interruption or digest mismatch;
- dependency installation, build, migration, or hook failure;
- process exit, OOM, restart loop, readiness timeout, and health regression;
- fixed-port collision and route-switch failure;
- missing or invalid environment bindings;
- insufficient disk capacity or permission mismatch;
- database/backup failure;
- artifact upload or verification failure;
- rollback failure.

Operations use idempotency keys. Signal resumes from persisted phase state and FNGK reports observed reality before replaying a mutation. A failed candidate never replaces a healthy route. If route switching fails, the prior release remains active. Rollback itself is health-gated and records partial recovery instructions when automatic restoration cannot finish.

## 13. Acceptance criteria

### 13.1 Contract and security tests

- Go and TypeScript fixtures prove all protocol versions and compatibility errors.
- Malformed, oversized, stale, duplicated, unauthorized, and secret-bearing messages are rejected safely.
- Secret values never appear in database rows, logs, events, command arguments, browser diagnostics, artifacts, or API payloads.
- v1 project manifests produce deterministic v2 plans.

### 13.2 Adapter fixtures

Provide representative projects for Svelte SPA, SvelteKit, Fastify, Laravel with queues and scheduler, Nuxt, Next standalone/static, generic Node, PostgreSQL, PM2, Supervisor, systemd timer, cron, and Docker Compose. Use the actual Signal, fngk-atlas, and holdup repositories as first-party fixtures.

### 13.3 End-to-end journey

A disposable two-Device run must:

1. discover a project on Device A;
2. open one Deployment Journey;
3. snapshot and transfer it to Device B;
4. import/bind environment values without leaking secrets;
5. provision or bind declared storage and PostgreSQL;
6. execute editable structured phases;
7. start web, worker, and scheduler roles through a real supervisor;
8. health-gate and publish a generated hostname, then exercise custom-domain lifecycle with a controlled fixture;
9. observe phase logs, application logs, browser console/network, manager metrics, database, storage, schedules, and artifacts;
10. close terminals and Atlas while the deployment continues;
11. restart Atlas, Signal, FNGK, the supervisor, and the Device and reconcile without duplicate workloads;
12. deploy a second release through a health-gated switch;
13. download an artifact and inspect release provenance;
14. roll back without losing durable state;
15. stop and clean releases without deleting protected storage.

The complete Signal Docker stack must pass this flow with disposable PostgreSQL and Redis.

### 13.4 Failure acceptance

Cover forced exit/OOM, restart-loop exhaustion, failed install/build/migration, Device disconnect, corrupt transfer, unavailable port, health timeout, missing supervisor, invalid `.env`, insufficient storage, failed route switch, failed backup, and failed rollback. Each failure must remain visible and diagnosable after reload.

### 13.5 UI acceptance

- A first-time user can complete the recommended flow without opening additional panels.
- Advanced configuration remains discoverable without dominating the default view.
- Contextual actions are keyboard accessible, viewport constrained, and consistent.
- Dockview placement follows the workflow/Operations/sidebar policy.
- Layout restoration, empty center, sidebar widths, narrow viewport, and body-scroll regressions are covered.
- No application console errors occur in the supported browser suite.

## 14. Implementation sequence and review gates

1. Stabilize and document the incoming Atlas and Signal deployment branches.
2. Complete Signal/FNGK contract documentation and exact-head compatibility checks.
3. Introduce source, environment, deployment, runtime, storage, and schedule contracts with migrations and tests.
4. Move the deployment state machine into Signal and implement reconnect reconciliation.
5. Complete runtime managers, source transfer, environment vault, structured phases, storage, and unified logs.
6. Implement every project/resource adapter listed in this specification.
7. Replace the multi-panel deployment workbench with the single Deployment Journey.
8. Correlate all deployment facts into the semantic Atlas and global action registry.
9. Complete native PostgreSQL acceptance and remove DbGate.
10. Run full cross-repository and live acceptance, request review, and address blocking findings.
11. Roll out behind exact protocol/capability checks with documented Signal-first deployment and rollback.

Each numbered stage must end with focused tests, full affected-repository checks, a reviewable commit, and updated progress evidence. A stage is not complete because its UI renders; its real Device path must pass where the behavior is operational.

## 15. Explicit defaults and non-goals

Defaults:

- managed environment profiles are authoritative;
- structured editable phases are used instead of one opaque script;
- production durability comes from PM2, Supervisor, systemd, or Docker;
- production uses health-gated route switching and graceful drain;
- all sources become verified immutable snapshots;
- persistent state is declared outside releases;
- generated Signal hostnames remain available when vanity/custom domains fail;
- GitHub integrates through provider-neutral source and event contracts;
- no framework or manager receives a separate primary UI.

This specification does not require Kubernetes, a hosted CI vendor, a GitHub-only source model, automatic privileged package installation, replacement of existing supervisors with a new FNGK supervisor, or unrestricted remote shell execution. Those may be future adapters only if they preserve the contracts and safety boundaries above.

