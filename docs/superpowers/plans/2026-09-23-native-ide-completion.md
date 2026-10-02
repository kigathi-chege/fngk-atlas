# FNGK Atlas Native IDE Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete FNGK Atlas as a compact, persistent desktop development workspace that can discover and manage FNGK devices without routine server-shell work.

**Architecture:** Preserve the Svelte 5, Dockview, xterm and Tauri architecture. Build the experience around the existing scoped workbench and typed API boundary: the application shell coordinates panels and focus, the lifecycle API exposes only safe status and explicit mutations, and terminal ownership remains outside panel presentation. Reuse existing lazy panels; add focused stores and components rather than a second UI framework.

**Tech Stack:** Svelte 5, TypeScript, Dockview, xterm, Fastify, Tauri 2, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-23-device-lifecycle-recovery-design.md`, `docs/superpowers/specs/2026-09-22-atlas-desktop-bootstrap-design.md`, and the user’s native-IDE redesign brief in this conversation.

## Global Constraints

- Do not replace Dockview, xterm, CodeMirror, Svelte, Tauri, or the existing typed FNGK process boundary.
- Retain terminal session ownership across docking, minimizing, floating, resizing, and sidebar visibility changes.
- Persist only safe UI metadata and scope workspace state to profile plus context.
- Profile discovery comes from FNGK’s safe JSON contract; credentials and raw config files never enter Atlas state.
- Mutations including pairing, update, release, retirement, deletion, and connection release require explicit confirmation.
- Dark theme is primary; every new surface has a light-theme token and visible keyboard focus.
- Lazy-load optional panels and add no new dependency unless a measurable existing limitation requires it.

## Review Focus

- Restoring a saved layout with disconnected or stale panels must not destroy an active terminal session.
- A remote device with exactly one usable profile must select it; zero or multiple profiles must remain explicit.
- A frame-limited or legacy terminal must show a recovery state rather than a generic timeout or false ready state.
- Retire and permanent deletion must be visibly distinct, impact-scoped, and impossible to trigger from one click.
- At narrow desktop widths every rail action, minimized terminal, device, and notification must remain keyboard reachable.

---

### Task 1: Establish a real application shell and workspace navigation

**Files:**
- Modify: `src/web/App.svelte`
- Modify: `src/web/components/AtlasMenu.svelte`
- Modify: `src/web/components/ActivityRail.svelte`
- Modify: `src/web/components/PinnedRootsRail.svelte`
- Modify: `src/web/components/Workbench.svelte`
- Modify: `src/web/enhancements.css`
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- Consumes: `WorkbenchState`, `PanelRegistry`, existing `atlas:*` window events.
- Produces: keyboard-addressable rail navigation, independent sidebar minimization, and a center-first workspace entry.

- [ ] **Step 1: Write failing browser tests**

```ts
test('keeps both sidebars independent while a terminal remains in the bottom dock', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'Open terminal' }).click();
  await page.getByRole('button', { name: 'Minimize Atlas' }).click();
  await page.getByRole('button', { name: 'Minimize Filesystem' }).click();
  await expect(page.getByLabel('Minimized panels')).toContainText('Terminal');
  await page.getByRole('button', { name: 'Restore Terminal' }).click();
  await expect(page.getByRole('region', { name: 'Terminal' })).toBeVisible();
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the rail controls or preservation contract are absent.**

Run: `npx playwright test e2e/workbench.spec.ts --grep "keeps both sidebars" --reporter=line`

- [ ] **Step 3: Implement the smallest shell changes**

```ts
const minimizePanel = (panel: any) => {
  remember(panel);
  panelRegistry.minimize(panel.id);
  dock.removePanel(panel);
};
```

Keep fixed shell controls in `App.svelte`, dispatch named `atlas:*` events from rails, and keep Dockview ownership in `Workbench.svelte`.

- [ ] **Step 4: Run focused and full browser tests.**

Run: `npx playwright test --reporter=line`

- [ ] **Step 5: Commit.**

```bash
git add src/web e2e/workbench.spec.ts
git commit -m "feat(atlas): complete native workspace shell"
```

### Task 2: Make commands, tabs, focus, and workspace restoration IDE-grade

**Files:**
- Modify: `src/web/components/AtlasMenu.svelte`
- Modify: `src/web/components/UnifiedSearch.svelte`
- Modify: `src/web/components/Workbench.svelte`
- Modify: `src/web/lib/command-registry.ts`
- Modify: `src/web/lib/workspace-persistence.ts`
- Test: `e2e/workbench.spec.ts`
- Test: `test/web/workspace-persistence.test.ts` (create)

**Interfaces:**
- Consumes: `AtlasCommandRegistry.execute(id)` and `SafeWorkspaceSnapshot`.
- Produces: command discovery, keyboard focus restoration, and versioned safe layout persistence.

- [ ] **Step 1: Write failing tests**

```ts
test('opens the command palette with Ctrl+Shift+P and restores focus to its invoker', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'Command palette' }).focus();
  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Command palette' })).toBeFocused();
});
```

```ts
it('drops unknown layout params before profile-context scoped persistence', () => {
  const storage = new Map<string, string>();
  writeWorkspaceSnapshot(storage, 'work', 'device:x', { version: 1, layout: {}, panels: [{ id: 'x', params: { profile: 'work', secret: 'no' } }] });
  expect(readWorkspaceSnapshot(storage, 'work', 'device:x')?.panels?.[0].params).toEqual({ profile: 'work' });
});
```

- [ ] **Step 2: Run tests to verify RED.**

Run: `npx vitest run test/web/workspace-persistence.test.ts && npx playwright test e2e/workbench.spec.ts --grep "command palette" --reporter=line`

- [ ] **Step 3: Implement focus return, semantic commands, and safe migration.**

```ts
let opener: HTMLElement | undefined;
function show() { opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; open = true; }
function dismiss() { open = false; queueMicrotask(() => opener?.focus()); }
```

- [ ] **Step 4: Run the focused tests, then all unit and browser tests.**

Run: `npm test && npx playwright test --reporter=line`

- [ ] **Step 5: Commit.**

```bash
git add src/web test/web e2e/workbench.spec.ts
git commit -m "feat(atlas): harden workspace commands and restoration"
```

### Task 3: Complete safe profile discovery and context selection

**Files:**
- Modify: `src/fngk/protocol.ts`
- Modify: `src/fngk/process-client.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/context-service.ts`
- Modify: `src/web/components/AtlasMenu.svelte`
- Modify: `src/web/components/ActivityRail.svelte`
- Test: `test/fngk/process-client.test.ts` (create or extend)
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- Produces `GET /api/fngk/profiles -> { profiles: FngkProfileSummary[] }`.
- `FngkProfileSummary = { name, current, mode, paired, operatorAuthorized, daemon, executable?, agentVersion? }`.

- [ ] **Step 1: Write failing profile-contract and browser tests.**

```ts
it('normalizes safe profile fields while dropping credential-shaped fields', async () => {
  expect(normalizeProfiles({ profiles: [{ name: 'local', token: 'secret', daemon: 'running' }] })).toEqual([{ name: 'local', daemon: 'running' }]);
});
```

```ts
test('shows a selector only for multiple discovered profiles and scopes reload to the selected profile', async ({ page }) => {
  await page.route('**/api/fngk/profiles', route => route.fulfill({ json: { profiles: [{ name: 'local' }, { name: 'work' }] } }));
  await openWorkbench(page);
  await expect(page.getByLabel('FNGK profile')).toBeVisible();
});
```

- [ ] **Step 2: Verify RED.**

Run: `npx vitest run test/fngk/process-client.test.ts && npx playwright test e2e/workbench.spec.ts --grep "multiple discovered profiles" --reporter=line`

- [ ] **Step 3: Implement only the validated profile normalization and scoped selection.**

```ts
export function normalizeProfiles(value: unknown): FngkProfileSummary[] {
  return Array.isArray((value as any)?.profiles) ? (value as any).profiles.map(toSafeProfile).filter(Boolean) : [];
}
```

- [ ] **Step 4: Verify focused tests and `npm test`.**

- [ ] **Step 5: Commit.**

```bash
git add src/fngk src/server src/web test e2e
git commit -m "feat(atlas): discover and select safe FNGK profiles"
```

### Task 4: Deliver a complete Device lifecycle center

**Files:**
- Modify: `src/server/app.ts`
- Create: `src/lifecycle/service.ts`
- Create: `src/lifecycle/types.ts`
- Modify: `src/web/components/DeviceLifecyclePanel.svelte`
- Modify: `src/web/components/ActivityRail.svelte`
- Modify: `src/web/components/PanelHost.svelte`
- Test: `test/lifecycle/service.test.ts`
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- Produces read-only `GET /api/device-lifecycle?contextId=` and `GET /api/device-lifecycle/:contextId/connections`.
- `DeviceReadiness.state` is one of `ready | needs-profile | needs-login | needs-pairing | needs-daemon | needs-update | legacy-recovery | offline`.

- [ ] **Step 1: Write failing readiness tests for zero, one, multiple, and frame-limit profiles.**

```ts
it('marks a frame-limited device as legacy recovery instead of terminal unavailable', async () => {
  const result = await lifecycle.inspect({ contextId: 'device:old' });
  expect(result.state).toBe('legacy-recovery');
  expect(result.terminal).toBe('frame-limit');
});
```

```ts
test('opens Device lifecycle from the dedicated rail icon and renders the selected device readiness', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'Open Device lifecycle' }).click();
  await expect(page.getByLabel('Device lifecycle')).toBeVisible();
});
```

- [ ] **Step 2: Verify RED.**

Run: `npx vitest run test/lifecycle/service.test.ts && npx playwright test e2e/workbench.spec.ts --grep "Device lifecycle" --reporter=line`

- [ ] **Step 3: Implement the lifecycle adapter and panel timeline.**

Use existing FNGK status, profiles, namespace and handoff contracts. Classify bounded transport errors by their existing error codes; never parse secrets or execute arbitrary strings.

- [ ] **Step 4: Verify focused tests and all server tests.**

Run: `npm test && npx playwright test --reporter=line`

- [ ] **Step 5: Commit.**

```bash
git add src/lifecycle src/server src/web test e2e
git commit -m "feat(atlas): add actionable device lifecycle center"
```

### Task 5: Add explicit update, pairing, recovery, and stale-connection flows

**Files:**
- Modify: `src/lifecycle/service.ts`
- Modify: `src/server/app.ts`
- Modify: `src/web/components/DeviceLifecyclePanel.svelte`
- Modify: `src/web/components/FngkHeadHandoffPanel.svelte`
- Test: `test/lifecycle/service.test.ts`
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- Consumes Device readiness and existing exact-head handoff service.
- Produces confirmation-gated endpoints for login, pairing, update/recover, and connection release.

- [ ] **Step 1: Write failing tests for confirmation and false-ready prevention.**

```ts
it('does not report update success when the returned heartbeat has the old version', async () => {
  await expect(lifecycle.update({ contextId: 'device:x', profile: 'local', confirm: true })).rejects.toMatchObject({ code: 'agent_version_unverified' });
});
```

```ts
test('requires confirmation before releasing a stale connection', async ({ page }) => {
  await openLifecycle(page);
  await page.getByRole('button', { name: 'Release stale connection' }).click();
  await expect(page.getByRole('dialog', { name: 'Release connection?' })).toBeVisible();
});
```

- [ ] **Step 2: Verify RED.**

- [ ] **Step 3: Implement operation IDs, exact profile forwarding, safe diagnostics, and confirmation dialogs.**

```ts
if (!request.confirm) throw Object.assign(new Error('Explicit confirmation is required.'), { code: 'confirmation_required' });
```

- [ ] **Step 4: Verify focused tests, unit suite, and browser suite.**

- [ ] **Step 5: Commit.**

```bash
git add src/lifecycle src/server src/web test e2e
git commit -m "feat(atlas): manage recovery and stale device connections"
```

### Task 6: Add retire and permanent deletion as separate safe device operations

**Files:**
- Modify: `src/lifecycle/service.ts`
- Modify: `src/server/app.ts`
- Modify: `src/web/components/DeviceLifecyclePanel.svelte`
- Test: `test/lifecycle/service.test.ts`
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- Produces `GET impact`, `POST retire`, and `POST delete` lifecycle actions.
- Retire requires exact phrase `RETIRE`; delete requires exact phrase `DELETE`.

- [ ] **Step 1: Write failing distinctions tests.**

```ts
it('requires DELETE and does not call permanent deletion when RETIRE is supplied', async () => {
  await expect(lifecycle.delete({ contextId: 'device:x', phrase: 'RETIRE', confirm: true })).rejects.toMatchObject({ code: 'confirmation_phrase_invalid' });
});
```

```ts
test('shows separate Retire and Permanently delete actions with precise impact confirmations', async ({ page }) => {
  await openLifecycle(page);
  await expect(page.getByRole('button', { name: 'Retire device' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Permanently delete device' })).toBeVisible();
});
```

- [ ] **Step 2: Verify RED.**

- [ ] **Step 3: Implement bounded impact summary and phrase-gated dialogs.**

- [ ] **Step 4: Verify focused tests and all suites.**

- [ ] **Step 5: Commit.**

```bash
git add src/lifecycle src/server src/web test e2e
git commit -m "feat(atlas): manage device retirement and deletion safely"
```

### Task 7: Replace persistent readiness notices with an accessible notification system

**Files:**
- Create: `src/web/lib/notifications.ts`
- Create: `src/web/components/NotificationStack.svelte`
- Modify: `src/web/App.svelte`
- Modify: `src/web/components/DesktopOnboarding.svelte`
- Modify: `src/web/enhancements.css`
- Test: `test/web/notifications.test.ts`
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- Produces `NotificationStore.push({ id, level, message, dismissAfterMs? })` and `dismiss(id)`.
- Success auto-dismisses; warnings/errors persist until dismissed; duplicates coalesce by ID.

- [ ] **Step 1: Write failing store and browser tests.**

```ts
it('coalesces readiness by id and auto-dismisses success notifications', () => {
  const notices = new NotificationStore();
  notices.push({ id: 'ready', level: 'success', message: 'FNGK is ready.', dismissAfterMs: 1 });
  notices.push({ id: 'ready', level: 'success', message: 'FNGK is ready.', dismissAfterMs: 1 });
  expect(notices.snapshot()).toHaveLength(1);
});
```

```ts
test('places notifications at the bottom right and allows persistent errors to be dismissed', async ({ page }) => {
  await openWorkbench(page);
  await expect(page.getByLabel('Notifications')).toHaveCSS('position', 'fixed');
});
```

- [ ] **Step 2: Verify RED.**

- [ ] **Step 3: Implement store, polite live region, dismiss controls, and theme tokens.**

- [ ] **Step 4: Verify focused tests and full suites.**

- [ ] **Step 5: Commit.**

```bash
git add src/web test e2e
git commit -m "feat(atlas): add dismissible workspace notifications"
```

### Task 8: Performance, visual consolidation, and desktop acceptance

**Files:**
- Modify: `src/web/styles.css`
- Modify: `src/web/enhancements.css`
- Modify: `vite.config.ts` only if measured chunk boundaries require it
- Modify: `README.md`
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- Consumes the workspace shell and lazy panel registry.
- Produces a documented performance baseline and a desktop test procedure.

- [ ] **Step 1: Write a browser test that opens the workspace without eagerly mounting terminal, file editor, or inspector panels.**

```ts
test('does not mount optional heavy panels before the user opens them', async ({ page }) => {
  await openWorkbench(page);
  await expect(page.locator('.terminal-panel,.file-panel,.database-panel')).toHaveCount(0);
});
```

- [ ] **Step 2: Verify RED or record the existing lazy behavior explicitly.**

- [ ] **Step 3: Consolidate duplicate shell CSS into token-based rules and preserve lazy imports.**

- [ ] **Step 4: Capture production output and desktop build prerequisites in README.**

Run: `npm run build && npm run build:fngk-head && APPIMAGE_EXTRACT_AND_RUN=1 npm run desktop:build -- --bundles appimage`

- [ ] **Step 5: Run all verification and commit.**

```bash
npm test
npm run check:web
npm run build
npx playwright test --reporter=line
git diff --check
git add src/web vite.config.ts README.md e2e
git commit -m "perf(atlas): complete native workspace delivery"
```

## Final verification and handoff

- [ ] Run `npm test`, `npm run check:web`, `npm run build`, `npx playwright test --reporter=line`, and `git diff --check`.
- [ ] Build FNGK head and the Tauri AppImage where the Signal core worktree/artifacts are available.
- [ ] Use the desktop artifact for a manual path: start Atlas, select profile, open two terminals, minimize/restore both, open Device lifecycle, perform only non-mutating readiness inspection, switch theme, dismiss a toast, and reload.
- [ ] Request a fresh whole-branch review before merge or push.
