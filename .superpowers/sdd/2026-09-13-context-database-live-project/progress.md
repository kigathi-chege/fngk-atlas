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
