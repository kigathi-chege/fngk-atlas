# Unified Deployment Journey implementation progress

**Specification:** `2026-09-15-unified-deployment-journey-design.md`  
**Updated:** 2026-09-15

This file records evidence against the numbered review gates in section 14 of the specification. A checked gate means its scoped behavior is committed and verified; it does not imply later operational gates are complete.

## Gate 1 — Stabilize incoming deployment branches

**Status:** Complete before this implementation run.

- Atlas deployment work was consolidated on `feat/fngk-native-atlas`.
- Signal deployment protocol work was consolidated on `feat/routes-hosted-workbench-completion`.
- Both canonical checkouts were clean at the start of the contract run.

## Gate 2 — Contract documentation and exact-head compatibility

**Status:** Complete for the retained v1 surface; extended for v2 negotiation in Gate 3.

- Signal documents every public operator route through its canonical API catalog.
- Atlas and the exact-head FNGK CLI retain v1 compatibility.
- The FNGK deployment wrapper now preserves a recognized v2 response protocol instead of relabeling it as v1.

## Gate 3 — Journey contracts and persistence

**Status:** Complete.

Implemented:

- deterministic, non-mutating `fngk.project.v1` to `fngk.project.v2` upgrade in Atlas;
- native v2 manifest validation for roles, phases, ports, health, environments, routes, artifacts, storage, resources, and retention;
- authoritative Signal schemas for `fngk.source.v1`, `fngk.environment.v1`, `fngk.project.v2`, `fngk.deployment.v2`, `fngk.runtime.v1`, `fngk.schedule.v1`, and `fngk.storage.v1`;
- secret-like environment values rejected from retained non-secret variables;
- truthful runtime durability validation;
- migration `050_deployment_journey_contracts.sql`;
- retained source snapshots, environment revisions, immutable plan revisions, ordered phase attempts, runtime roles, schedules, and storage declarations;
- v2 creation validates that source digest, environment revision/class, actor, runtime roles, schedules, storage, and plan describe the same journey;
- non-Git source releases use their verified digest and do not invent a commit SHA.

Verification evidence:

- Atlas baseline: 4 legacy and 139 current tests passed before changes.
- Atlas focused contract tests and TypeScript passed after changes.
- Signal baseline: 66 integration and 258 unit tests passed before changes; one broker fixture remained intentionally skipped.
- Signal v2 persistence integration: 67 tests passed; one broker fixture skipped.
- Signal contract tests, Go compatibility tests, TypeScript, and Svelte checks passed.

## Gate 4 — Signal-owned deployment state machine

**Status:** In progress; the retained execution boundary is implemented and verified, while reconnect reality reconciliation remains open.

Implemented:

- persisted phase-log storage with stable cursors;
- authorized approve, execute, cancel, and retry transitions against an immutable plan revision;
- asynchronous Signal-owned execution which survives the Atlas request lifecycle;
- duplicate execute suppression and ordered retained phase attempts;
- bounded FNGK phase execution with explicit absolute cwd, environment revision values, timeout, stdout/stderr caps, process-group cancellation, and non-blocking Device message handling;
- Signal startup recovery for plans left in `executing`, preserving an interrupted attempt and creating a new attempt;
- a private Device-side phase journal keyed by plan/phase and command digest, allowing completed results to be deduplicated and queried after reconnect;
- reconnect reconciliation which resumes only after FNGK reports a matching successful phase, waits for a still-running phase, and fails safely with recovery instructions when reality is missing, changed, or unknown;
- Atlas/FNGK action APIs so Atlas delegates v2 transitions instead of executing them through a terminal;
- v2 deployment-log projection from the retained Signal phase ledger.

Verified:

- Signal: 261 unit tests, 67 integration tests (one broker fixture skipped), TypeScript/Svelte checks, and the full Go CLI suite;
- Atlas: 4 legacy tests, 143 current tests, TypeScript, and Svelte checks.

Remaining before Gate 4 can be checked complete:

- run the exact Signal/FNGK socket path through a forced daemon restart and Device disconnect in disposable live acceptance, proving no duplicate mutation.

## Gates 5–11

**Status:** Pending.

No runtime-manager, transfer, vault, adapter, single-journey UI, semantic-correlation, native PostgreSQL, or production-rollout claim is complete until its real Device path passes the corresponding later gate.
