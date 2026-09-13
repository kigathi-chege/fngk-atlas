# Task 8 report: contextual search and safe filesystem operations

## Implemented

- Completed contextual SQLite FTS search exposure and context rail result labels, with context/source metadata.
- Completed bounded filesystem name/content search. Direct search checks cancellation, limits matches, entries, depth, and per-file read size; terminal search bounds `find` depth, candidate count, and file size before `grep`, passes its abort signal, and uses a 10-second command timeout.
- Added central absolute/NUL-free path normalization, root-alias protection (`//` normalizes to `/`), recovery-vault protection, and route fallback behavior.
- Added direct-route trash-first recovery backed by a protected `.atlas-trash` vault, `restore` capability/endpoint, and explicit permanent-delete confirmation.
- Added route/effective-identity/privilege/capability metadata and operation records to file search/mutation responses and filesystem activity.
- Finished the filesystem UI: sorting, metadata, route capability chip, search, create/rename/delete dialogs, trash notice, and restoration control. Fixed the Navigator `{@const}` placement and removed the autofocus warning.
- Updated the browser workflow for the compact context rail and added contextual search and trash/restore coverage.

## TDD evidence

### RED

`npm run check:web`

Expected failure reproduced: `Navigator.svelte:26` reported invalid `{@const}` placement and `FilesystemTree.svelte:27` reported the autofocus warning.

`npx vitest run test/files/file-service.test.ts test/transports/terminal.test.ts`

Expected failures before the implementation: `//` was accepted for delete, an already-aborted search resolved, and no local trash route existed (3 failed tests).

`npx vitest run test/server/app.test.ts`

Expected failure before adding the endpoint: `POST /api/files/restore` returned 404.

`npx vitest run test/transports/terminal.test.ts`

Expected failure before the terminal search change: the content search used `grep -R` without candidate/depth bounds.

`npm run test:e2e`

Expected regression failure exposed the stale `.context-row` selector after the context-rail UI change; the browser test was updated to exercise the current rail and safe filesystem workflow.

### GREEN

`npx vitest run test/server/app.test.ts test/files/file-service.test.ts test/transports/terminal.test.ts`

17/17 focused tests passed.

`npm run check:web && npm run typecheck`

Svelte check completed with 0 errors and 0 warnings; TypeScript completed successfully.

## Full verification

`npm test && npm run check:web && npm run typecheck && npm run build && npm run test:e2e`

- Legacy tests: 4/4 passed.
- Vitest: 17 files, 51/51 passed.
- Svelte check: 0 errors, 0 warnings.
- Typecheck and server/web builds passed.
- Playwright: 1/1 passed.

## Files changed

- Access/file transports and service: `src/domain/access.ts`, `src/files/file-service.ts`, `src/transports/{file-transport,direct,adapter-file,terminal-file}.ts`
- HTTP and persistence search: `src/server/app.ts`, `src/store.js`, `src/store/evidence-store.ts`
- UI: `src/web/components/{Navigator,FilesystemTree,AtlasContextMenu}.svelte`
- Tests: `test/files/file-service.test.ts`, `test/server/app.test.ts`, `test/store/{evidence-store,index-store}.test.ts`, `test/transports/terminal.test.ts`, `e2e/workbench.spec.ts`
- Plan and this report: `docs/superpowers/plans/2026-09-13-context-database-live-project.md`, `.superpowers/sdd/2026-09-13-context-database-live-project/task-8-report.md`

## Self-review and concerns

- Reviewed the complete Task 8 diff and ran `git diff --check`; no whitespace errors.
- Direct recovery records store only recovery metadata; file contents remain in the selected filesystem's trash vault and are not copied into Atlas persistence.
- The production web build retains the existing Vite advisory for a minified JavaScript chunk above 500 kB. It does not affect test, type, Svelte, build, or browser-test success and is outside this focused slice.

## Native Files and effective-authority closure

- Added generic `fngk files --json` and `fngk files invoke` contracts in Signal. Credentials remain inside FNGK; Atlas receives only binding metadata and operation results.
- Atlas exposes native Files bindings as adapter routes, but orders remote terminal routes before adapters. A failed or unavailable terminal falls back to an authorized native binding.
- Native mutation capabilities honor binding grants and read-only state rather than advertising writes unconditionally.
- Terminal trash now has a private recoverable per-user vault; direct host trash uses an out-of-root state vault when Atlas maps `/`, including cross-device copy fallback.
- File operation evidence is redacted, searchable, persisted, and bounded to the latest 2,000 operations per context.
- Final verification: Atlas 4/4 legacy and 62/62 Vitest tests, clean TypeScript/Svelte checks; Signal server check; Signal CLI Docker target passed Go tests and all release cross-builds.

## Fix round 1: security, bounds, and context races

### What changed

- Recovery restore now accepts only UUID tokens immediately under the canonical, non-symlinked `.atlas-trash` vault. It validates the token directory, metadata, and payload as canonical non-symlink paths before reading, renaming, or removing anything.
- Direct trash validates the vault before source movement; if metadata persistence fails it rolls the payload back to its original path, or preserves the recovery record and reports its recovery path if rollback itself fails. Symlink sources are rejected rather than moved into a record that cannot be safely restored.
- Direct search streams directories through `opendir`, applies entry and result limits before more work, and rechecks file size after reading. Terminal search uses bounded NUL-structured name/type records, bounded content candidates, `pipefail`, and non-masking grep exit handling.
- Nonempty terminal file create stages data then uses an exclusive hard-link, never `mv -f` onto an existing destination.
- Evidence scan completion deletes superseded FTS entries transactionally; evidence FTS results include stale state/reason.
- Contextual indexed search returns `repositoryRoot`; Navigator opens relative results against that provenance rather than the editable repository field.
- Both Svelte search surfaces cancel superseded requests and ignore stale generations/context responses. Pending mutation dialogs and recovery actions are bound to their original context and invalidated on context changes. The server also aborts file search work on response disconnect.

### TDD evidence

#### RED

`npx vitest run test/files/file-service.test.ts test/transports/terminal.test.ts test/store/evidence-store.test.ts test/server/app.test.ts`

7 expected failures before implementation: direct name search returned 3 results for `limit:1`; arbitrary restore succeeded; a symlinked vault moved data; nonempty terminal create resolved instead of refusing an existing path; terminal names corrupted newline/colon paths; deleted evidence remained searchable; indexed results had no repository provenance.

`npm run test:e2e`

The initial two-test browser run exposed a Chromium single-process launch closure before its second context. The race regression was then run on the existing browser page, matching the configured single-process execution model.

#### GREEN

`npx vitest run test/files/file-service.test.ts test/transports/terminal.test.ts test/store/evidence-store.test.ts test/server/app.test.ts && npm run check:web && npm run typecheck`

26/26 focused tests passed; Svelte check had 0 errors/warnings and TypeScript passed.

`npm run test:e2e`

1/1 browser scenario passed, including delayed filesystem and indexed-search response races across context changes.

### Full verification

`npm test && npm run check:web && npm run typecheck && npm run build && npm run test:e2e`

- Legacy tests: 4/4 passed.
- Vitest: 17 files, 57/57 passed.
- Svelte check: 0 errors, 0 warnings.
- Typecheck and server/web builds passed.
- Playwright: 1/1 passed.

### Files changed

- `src/transports/direct.ts`
- `src/transports/terminal-file.ts`
- `src/files/file-service.ts`
- `src/store/evidence-store.ts`
- `src/server/app.ts`
- `src/web/components/FilesystemTree.svelte`
- `src/web/components/Navigator.svelte`
- `test/files/file-service.test.ts`
- `test/transports/terminal.test.ts`
- `test/store/evidence-store.test.ts`
- `test/server/app.test.ts`
- `e2e/workbench.spec.ts`

### Self-review

- Reviewed recovery behavior for arbitrary directories, vault/payload symlinks, malformed metadata, destination conflicts, and metadata-write rollback preservation.
- Verified direct and terminal search limit/cancellation paths, context-bound UI mutations/restores, indexed-root provenance, and stale evidence query state.
- `git diff --check` is clean. The pre-existing Vite chunk-size advisory remains the only non-failing build notice.
