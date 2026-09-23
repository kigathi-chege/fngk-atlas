import { describe, expect, it } from 'vitest';
import { chooseContext, createWorkbenchState } from '../../src/web/lib/workbench-state.js';

describe('shared workbench state', () => {
  it('links selection and navigation history across panels', () => {
    const state = createWorkbenchState();
    state.select({ id: 'fn:one', type: 'function', path: 'src/a.ts', line: 12 });
    state.select({ id: 'fn:two', type: 'function', path: 'src/b.ts', line: 7 });
    expect(state.snapshot().selection?.id).toBe('fn:two');
    state.back();
    expect(state.snapshot().selection?.id).toBe('fn:one');
    state.forward();
    expect(state.snapshot().selection?.id).toBe('fn:two');
  });

  it('persists UI descriptors but excludes terminal output and editor buffers', () => {
    const state = createWorkbenchState();
    state.setContext('device:one');
    state.setLayout({ central: { grid: [] }, bottom: { grid: [] } });
    state.appendActivity('must-not-persist');
    const persisted = state.persistable();
    expect(persisted).toMatchObject({ contextId: 'device:one', layout: { central: { grid: [] } } });
    expect(JSON.stringify(persisted)).not.toContain('must-not-persist');
  });

  it('prefers an online FNGK Device until the operator explicitly selects a context', () => {
    const contexts = [{ id: 'local', kind: 'local', online: true }, { id: 'device:one', kind: 'fngk-device', online: true }];
    expect(chooseContext(contexts, createWorkbenchState().snapshot())).toBe('device:one');
    const state = createWorkbenchState(); state.setContext('local');
    expect(chooseContext(contexts, state.snapshot())).toBe('local');
  });

  it('does not restore an explicitly selected Device after that identity goes offline', () => {
    const contexts = [
      { id: 'local', kind: 'local', online: true },
      { id: 'device:retired', kind: 'fngk-device', online: false },
      { id: 'device:replacement', kind: 'fngk-device', online: true },
    ];
    const state = createWorkbenchState(); state.setContext('device:retired');
    expect(chooseContext(contexts, state.snapshot())).toBe('device:replacement');
  });

  it('exposes FNGK connection truth without persisting transient status', () => {
    const state = createWorkbenchState();
    state.setConnection({ phase: 'unavailable', message: 'binary_missing' });
    expect(state.snapshot().connection.phase).toBe('unavailable');
    expect(JSON.stringify(state.persistable())).not.toContain('binary_missing');
  });

  it('persists the selected workspace theme without connection state', () => {
    const state = createWorkbenchState();
    state.setTheme('light');
    expect(state.snapshot().theme).toBe('light');
    expect(state.persistable()).toMatchObject({ theme: 'light' });
  });
});
