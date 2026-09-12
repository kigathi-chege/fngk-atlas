import { describe, expect, it } from 'vitest';
import { createWorkbenchState } from '../../src/web/lib/workbench-state.js';

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
});
