import { describe, expect, it } from 'vitest';
import { parseBlame, parseBranches, parseDiff, parseLog, parseStatus, statusGroups, statusLetter, unquotePath } from '../../src/git/parsers.js';
import { decode, recorded } from './recorded.js';

describe('git status --porcelain=v2 -z', () => {
  it('parses branch tracking and every entry kind with unusual names', () => {
    const status = parseStatus(decode(recorded.status));
    expect(status.branch).toEqual({ oid: '40c173deda07a03d4470ca21214c5326915c1093', head: 'main', upstream: 'origin/main', ahead: 1, behind: 0, detached: false, unborn: false });
    const byPath = Object.fromEntries(status.entries.map(entry => [entry.path, entry]));
    expect(Object.keys(byPath).sort()).toEqual(['café ☕.md', 'gone.txt', 'new name.txt', 'new\nline.txt', 'plain.txt', 'tab\there.txt', 'untracked file.txt', 'untracked\nnewline.txt', 'with space.txt'].sort());
    expect(byPath['café ☕.md']).toMatchObject({ kind: 'ordinary', index: 'M', worktree: 'M' });
    expect(statusGroups(byPath['café ☕.md'])).toEqual(['staged', 'changes']);
    expect(byPath['gone.txt']).toMatchObject({ index: '.', worktree: 'D' });
    expect(statusLetter(byPath['gone.txt'])).toBe('D');
    expect(byPath['new name.txt']).toMatchObject({ kind: 'renamed', origPath: 'old-name.txt', score: 'R100', index: 'R', worktree: '.' });
    expect(statusGroups(byPath['new name.txt'])).toEqual(['staged']);
    expect(byPath['untracked\nnewline.txt']).toMatchObject({ kind: 'untracked' });
    expect(statusGroups(byPath['untracked file.txt'])).toEqual(['untracked']);
    expect(statusLetter(byPath['untracked file.txt'])).toBe('U');
  });

  it('parses conflicts and unborn branches', () => {
    const conflict = parseStatus(decode(recorded.conflict));
    expect(conflict.entries).toEqual([{ kind: 'unmerged', index: 'U', worktree: 'U', path: 'conflict me.txt' }]);
    expect(statusGroups(conflict.entries[0])).toEqual(['conflicts']);
    expect(statusLetter(conflict.entries[0])).toBe('!');
    const unborn = parseStatus(decode(recorded.unborn));
    expect(unborn.branch).toMatchObject({ unborn: true, head: 'fresh', ahead: 0, behind: 0 });
    expect(unborn.entries[0]).toMatchObject({ path: 'a.txt', index: 'A', worktree: '.' });
  });

  it('parses detached heads, submodules and gone upstreams', () => {
    const raw = ['# branch.oid abc', '# branch.head (detached)', '1 .M SC.. 160000 160000 160000 a b vendor/lib', ''].join('\0');
    const status = parseStatus(raw);
    expect(status.branch).toMatchObject({ detached: true, oid: 'abc' });
    expect(status.entries[0]).toMatchObject({ path: 'vendor/lib', submodule: 'SC..' });
  });

  it('rejects truncated or unknown records instead of guessing', () => {
    expect(() => parseStatus('2 R. N... 100644 100644 100644 a b R100 new.txt')).toThrow(/malformed/);
    expect(() => parseStatus('1 .M N... 100644')).toThrow(/malformed/);
    expect(() => parseStatus('# branch.ab nonsense\0')).toThrow(/malformed/);
    expect(() => parseStatus('x what\0')).toThrow(/malformed/);
  });
});

describe('git diff -U3', () => {
  it('parses work tree changes, quoted names and deletions', () => {
    const files = parseDiff(decode(recorded.diff));
    expect(files.map(file => [file.status, file.oldPath, file.newPath])).toEqual([
      ['modified', 'café ☕.md', 'café ☕.md'],
      ['deleted', 'gone.txt', undefined],
      ['modified', 'new\nline.txt', 'new\nline.txt'],
      ['modified', 'plain.txt', 'plain.txt'],
      ['modified', 'tab\there.txt', 'tab\there.txt'],
      ['modified', 'with space.txt', 'with space.txt'],
    ]);
    const plain = files[3].hunks[0];
    expect(plain).toMatchObject({ oldStart: 2, oldLines: 3, newStart: 2, newLines: 4, section: 'one' });
    expect(plain.lines.at(-1)).toEqual({ type: 'add', text: 'five', newLine: 5 });
    expect(files[1].hunks[0].lines).toEqual([{ type: 'delete', text: 'del', oldLine: 1 }]);
  });

  it('parses staged renames without hunks', () => {
    const files = parseDiff(decode(recorded.diffCached));
    expect(files.find(file => file.status === 'renamed')).toMatchObject({ oldPath: 'old-name.txt', newPath: 'new name.txt', similarity: 100, hunks: [] });
  });

  it('marks binary files and new files', () => {
    const files = parseDiff('diff --git a/img.png b/img.png\nnew file mode 100644\nindex 0000000..e69de29\nBinary files /dev/null and b/img.png differ\n');
    expect(files).toEqual([{ status: 'added', binary: true, oldPath: undefined, newPath: 'img.png', newMode: '100644', hunks: [] }]);
  });

  it('keeps "no newline at end of file" notes and diff-looking content inside hunks', () => {
    const files = parseDiff('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1,2 @@\n--- not a header\n++++ not either\n+x\n\\ No newline at end of file\n');
    expect(files).toHaveLength(1);
    expect(files[0].hunks[0].lines.map(line => line.type)).toEqual(['delete', 'add', 'add', 'note']);
  });
});

describe('other git formats', () => {
  it('parses log -z records with bodies and decorations', () => {
    const commits = parseLog(decode(recorded.log));
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({ subject: 'second', refs: ['HEAD -> main'], parents: ['111b6d571f0eeb716f9e1f2338429a998babe46b'], authorName: 'Ada Lovelace', authorEmail: 'ada@example.test', body: '' });
    expect(commits[1]).toMatchObject({ subject: 'initial commit', parents: [], refs: ['origin/main'], body: 'Body line one\nBody line two', shortHash: '111b6d5' });
    expect(commits[1].authoredAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('parses blame --porcelain, reusing commit metadata and flagging uncommitted lines', () => {
    const lines = parseBlame(decode(recorded.blame));
    expect(lines.map(line => line.text)).toEqual(['one', 'TWO', 'three', 'four', 'five']);
    expect(lines[0]).toMatchObject({ line: 1, summary: 'initial commit', author: 'Ada Lovelace', authorEmail: 'ada@example.test', uncommitted: false });
    expect(lines[2]).toMatchObject({ summary: 'initial commit', author: 'Ada Lovelace' });
    expect(lines[4]).toMatchObject({ uncommitted: true, line: 5 });
  });

  it('parses for-each-ref branch listings', () => {
    expect(parseBranches(decode(recorded.branches))).toEqual([
      expect.objectContaining({ name: 'main', current: true, remote: false, upstream: 'origin/main', ahead: 1, behind: 0, subject: 'second' }),
      expect.objectContaining({ name: 'origin/main', current: false, remote: true, subject: 'initial commit' }),
    ]);
  });

  it('decodes C-quoted paths', () => {
    expect(unquotePath('"caf\\303\\251 \\"x\\"\\t.md"')).toBe('café "x"\t.md');
    expect(unquotePath('plain.txt')).toBe('plain.txt');
  });
});
