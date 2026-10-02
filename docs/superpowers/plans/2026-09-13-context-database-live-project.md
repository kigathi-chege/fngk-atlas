# Context, Database, and Live Project Implementation Plan

**Goal:** Complete the context-centered FNGK Atlas workbench, safe filesystem/search and terminal session workflows, generic database/DbGate sessions, and live HTTP projects exposed through Signal/FNGK, with one disposable operational acceptance run.

**Architecture:** Signal remains the authenticated control plane, FNGK remains the outbound-connected Device authority, and Atlas consumes versioned machine protocols. DbGate is an optional unprivileged sidecar behind an Atlas/Signal session proxy rather than bundled into the Svelte application. Persistent Atlas storage contains indexed derived evidence and bounded metadata, never credentials, file bodies, terminal bodies, screenshots, or live project output.

**Spec:** The user-approved plan in this conversation is authoritative. This file is its execution breakdown and supersedes incomplete Task 7 details in `2026-09-12-fngk-native-atlas.md` where they conflict.

## Global Constraints

- Preserve completed Tasks 1–6 and existing interactive FNGK behavior.
- Signal changes are generic FNGK capabilities, never Atlas-specific credential bridges.
- Prefer native structured capabilities; use terminal fallback only with equivalent effective authority and label the chosen route.
- Follow strict red-green-refactor TDD for new behavior.
- Destructive file and process actions require explicit confirmation; deletion is trash-first.
- DbGate must be patched, loopback-only, short-lived, and non-root, with no Signal credentials, SSH keys, or Docker socket.
- Remote Devices require outbound connectivity only. Public HTTP routes remain governed by Signal/HKMN.
- Live output and diagnostics are ephemeral bounded buffers. Atlas does not mirror remote files or retain browser captures by default.

## Task 8: Finish contextual search and safe filesystem operations

- Complete and validate the in-progress SQLite FTS, context rail, file name/content search, metadata, sorting, create, move/rename, trash, restore, and confirmed permanent delete work.
- Add bounded/cancellable search, safe path validation, reliable terminal quoting, capability/route metadata, and operation records.
- Add component/server/transport tests and commit the slice.

## Task 9: Terminal lifecycle and compact session rail

- Add a terminal session model sourced from FNGK namespace/session APIs.
- Auto-attach new and restored panels, reattach existing session IDs, distinguish lifecycle states, reconnect transient failures with bounded backoff, and prevent duplicate sockets.
- Add a deterministic color-coded right rail with create, select, rename, reconnect, terminate, archive/delete, and close actions.
- Preserve PTY input, resize, interrupt, approvals, replay, and command completion. Add unit/browser tests and commit.

## Task 10: Generic database resources and DbGate sidecar

- Add engine-neutral database discovery/resources/sessions and capability checks without credential scraping.
- Add an injectable sidecar supervisor and authenticated reverse proxy contract; pin and verify a patched DbGate release for the operational fixture.
- Enforce non-root, loopback-only, expiry, restricted environment/filesystem, and credential-redacted persistence.
- Add Dockview database discovery/session panels, tests, license/security documentation, and commit.

## Task 11: Live project sessions and FNGK HTTP tunnel protocol

- Add generic machine-readable managed-project and tunnel lifecycle operations to Signal/FNGK.
- Add Atlas live-project sessions for command/cwd/env allowlist/port, bounded output, health, stop/restart/interrupt, route expiry, and stale/reconnect states.
- Register port 8000 through existing Signal published-proxy/HKMN infrastructure and embed the authenticated URL in Dockview.
- Add explicit opt-in Playwright diagnostics for reachability, console/network failures, timings, and optional screenshot without persistent capture.
- Add protocol, server, and browser tests; commit Signal and Atlas slices.

## Task 12: Remote compatibility and operational acceptance

- Add compatibility/preflight states for binary, protocol, profile, operator API, Device reachability, terminal, filesystem, managed process, tunnel, and database capabilities.
- Document exact-head/minimum-compatible remote install and outbound pairing.
- Extend the disposable harness to run Signal PostgreSQL/Redis, an outbound remote-style Device, Atlas, a fixture HTTP project on port 8000, search/files/terminal/database workflows, tunnel rendering, diagnostics, disconnect/reconnect, and teardown/artifact scans.
- Commit the integration and documentation slice.

## Task 13: Whole-system verification and review

- Run complete Signal CLI/unit/targeted integration checks and Atlas unit/type/Svelte/build/browser checks.
- Run one operational disposable acceptance flow and inspect evidence.
- Run audit and secret/helper-artifact scans.
- Request cross-repository review, address findings, and finish the feature branches without pushing or merging.
