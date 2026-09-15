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

## Gates 4–11

**Status:** Pending.

The next gate moves phase ownership from the Atlas request lifecycle into a Signal-owned idempotent execution state machine with reconnect reconciliation. No UI replacement or adapter claim is complete until its real Device path passes the corresponding later gate.
