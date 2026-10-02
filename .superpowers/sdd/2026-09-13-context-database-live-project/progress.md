# Context, database, and live-project progress

## Stable prerequisite: Atlas workbench shell

The shell prerequisite is implemented on `feat/atlas-workbench-shell`. It establishes the UI and lifecycle contracts that the DatabasePanel will consume:

- persistent context and root rails outside Dockview;
- recoverable/minimizable/floating panel descriptors without volatile data;
- one context-scoped unified search collection;
- one bounded terminal surface with explicit session creation;
- context-bound filesystem roots and complete safe file operations;
- memory-only editor buffers and exclusive first save;
- presentation tokens and responsive Dockview geometry.

DbGate code is not part of this branch. It should be resumed only after rebasing or integrating this checkpoint, then registered as an idempotent panel command and unified-search provider rather than introducing another navigation shell.

## Verification ledger

Fresh verification on 2026-09-13:

- `npm test`: 4/4 legacy tests and 78/78 Vitest tests passed across 23 files.
- `npm run check:web`: 0 Svelte errors and 0 warnings.
- `npm run typecheck`: passed.
- `npm run build`: server and web production builds passed. Vite retains the pre-existing chunk-size advisory for the 1.82 MB main bundle (556 kB gzip).
- `npm run test:e2e`: 3/3 Playwright scenarios passed. They cover the full file/search/terminal workflow, memory-only buffer restoration behavior, and desktop/narrow shell presentation.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `git diff --check`: clean.
- Persistence scan: browser storage writes are limited to safe workbench state/layout descriptors and context-bound roots; BufferStore persists an empty list. The browser regression also proves a sentinel editor body is absent from `localStorage` and its stale descriptor is discarded after reload.
- Secret-pattern scan of the branch diff: no private keys, access keys, GitHub tokens, or literal password assignments found.

Inspected screenshots:

- `output/playwright/shell-default.png`
- `output/playwright/shell-search.png`
- `output/playwright/shell-terminal.png`
- `output/playwright/shell-minimized.png`
- `output/playwright/shell-narrow-final.png`

The narrow screenshot reports a 506px central graph group at a 620px viewport, both expanded Dockview sidebars absent, both permanent outer rails present, an empty responsive minimized tray, and zero horizontal overflow.

## Plan completion ledger

Task 8: complete. Contextual FTS/search and safe filesystem operations were consolidated in commits `fdbdf78` through `ae65c27`; the workbench-shell prerequisite was integrated by merge commit `3749a53` without regressing its file, search, buffer, or route contracts.

Task 9: complete. Terminal lifecycle, retained-session handling, and the compact session rail are present in the Signal protocol commits through `46b477a` and the Atlas commits through `b375711`, with the stable shell integrated at `3749a53`.

Task 10: complete. Engine-neutral database discovery, routed sessions, the authenticated proxy, and the pinned non-root loopback DbGate sidecar were completed in Atlas commits `842007f` and `f4afb5`. The final disposable acceptance opened and stopped a PostgreSQL workbench through the paired Device without persisting credentials.

Task 11: complete. Signal commit `65a66db` added `fngk.publish.v1`; commits `2386acb`, `7ea2106`, and `ad48f7f` completed streamed response handling, harmless late flow-control acknowledgements, reusable-target reactivation, effective public URLs, hermetic CLI verification, and patched production dependencies. Atlas commit `0bc131d` added bounded terminal-backed live-project sessions, explicit start/interrupt/restart/stop actions, public embedding, ephemeral Playwright diagnostics, UI integration, and operator documentation. Both lifecycle regressions were mutation checked: restoring the old late-ack reset emitted a fatal `RESET`, and removing target reactivation made the Signal integration assertion fail.

Task 12: complete in Atlas commit `375fd14`. The disposable harness builds the exact Signal/FNGK head, pairs an outbound root Device, exercises filesystem conflict handling, terminal lifecycle, isolated DbGate, a public HTTP project, browser diagnostics, interrupt/restart/republish, runtime-to-code correlation, verified coverage/CRAP, reconnect/stale refresh, teardown, and artifact scans.

Task 13: complete. Final controller verification on 2026-09-14:

- Signal: 253/253 unit tests, 61/61 active integration tests (one broker test skipped by configuration), all Go packages, canonical node contracts, Svelte/TypeScript checks, and production build passed.
- Atlas: 4/4 legacy tests, 91/91 Vitest tests across 27 files, 4/4 Playwright tests, TypeScript, Svelte, and production server/web builds passed. The existing Vite large-chunk advisory remains informational.
- Operational acceptance passed on the final dependency tree. Sanitized evidence is stored at `output/live-acceptance/20260914T061441Z`; it records HTTP 200 with zero application console errors, a stopped database session, a fresh reconnect session, one process-to-code edge, verified coverage, no captured credentials, and no helper artifacts.
- `git diff --check`, secret-pattern scanning, helper-artifact scanning, and disposable process/container cleanup checks passed. Secret-pattern matches were limited to deliberate disposable test passwords.
- Atlas `npm audit --audit-level=high` and Signal production `npm audit --omit=dev --audit-level=high` report zero vulnerabilities after the lockfile refresh. Signal's development tree retains two moderate `@vitest/mocker` findings whose available remediation is the separate breaking Vitest 5 upgrade; no production package is affected.
- Cross-repository controller review found and corrected one ineffective late-frame regression assertion and one false Playwright expectation. No Critical or Important findings remain in the reviewed final diffs.

Both feature branches are complete locally and have not been pushed or merged.
