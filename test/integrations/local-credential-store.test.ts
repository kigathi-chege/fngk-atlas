import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCredentialStore } from '../../src/integrations/local-credential-store.js';

const mode = (path: string) => statSync(path).mode & 0o777;

describe('LocalCredentialStore', () => {
  it('round-trips a secret, keeps it out of the file, and uses owner-only modes', () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-store-')), data = join(root, 'new-dir');
    const files = { file: join(data, 'secret.json'), keyFile: join(data, 'credentials.key') };
    const store = new LocalCredentialStore(files);
    store.save('super-secret-value', { label: 'visible' });
    const raw = readFileSync(files.file, 'utf8');
    expect(raw).not.toContain('super-secret-value');
    expect(JSON.parse(raw).label).toBe('visible');
    expect(store.secret()).toBe('super-secret-value');
    expect(new LocalCredentialStore(files).secret()).toBe('super-secret-value');
    expect(mode(files.file)).toBe(0o600); expect(mode(files.keyFile)).toBe(0o600); expect(mode(data)).toBe(0o700);
  });
  it('returns null after clear, for a tampered record, and under a different key file', () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-store-')), other = mkdtempSync(join(tmpdir(), 'atlas-store-'));
    const files = { file: join(root, 's.json'), keyFile: join(root, 'credentials.key') };
    const store = new LocalCredentialStore(files); store.save('abc');
    expect(new LocalCredentialStore({ file: files.file, keyFile: join(other, 'credentials.key') }).secret()).toBeNull();
    store.clear(); expect(store.secret()).toBeNull(); expect(store.load()).toBeNull();
  });
});
