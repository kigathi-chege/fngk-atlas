import {describe, expect, it} from 'vitest';
import {isPermanentPanel, isWorkspaceFallbackVisible, shellLayoutVersion} from '../../src/web/lib/workbench-shell.js';

describe('workbench shell contract', () => {
  it('shows the Workspace recovery panel only when no ordinary center panel remains', () => {
    expect(isWorkspaceFallbackVisible([])).toBe(true);
    expect(isWorkspaceFallbackVisible(['file:/srv/a.ts'])).toBe(false);
    expect(isWorkspaceFallbackVisible(['atlas.operations'])).toBe(true);
  });

  it('identifies only retained shell panels as permanent', () => {
    expect(isPermanentPanel('atlas.devices')).toBe(true);
    expect(isPermanentPanel('atlas.inspector')).toBe(true);
    expect(isPermanentPanel('file:/srv/a.ts')).toBe(false);
  });

  it('uses version 8 for the redesigned persisted shell', () => {
    expect(shellLayoutVersion).toBe(8);
  });
});
