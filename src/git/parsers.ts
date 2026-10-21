/**
 * Parsers for git's machine-readable output. They take raw bytes or text as
 * git printed it (with `-z` where available, so paths may hold spaces,
 * newlines and any unicode) and never shell out themselves.
 */

export type GitEntryKind = 'ordinary' | 'renamed' | 'unmerged' | 'untracked' | 'ignored';
export type GitGroup = 'staged' | 'changes' | 'untracked' | 'conflicts';

export interface GitStatusEntry {
  kind: GitEntryKind;
  /** Path relative to the repository top level, exactly as git reported it. */
  path: string;
  /** The source of a rename or copy. */
  origPath?: string;
  /** Index (staged) status letter, '.' when unchanged. */
  index: string;
  /** Working tree status letter, '.' when unchanged. */
  worktree: string;
  /** For a rename or copy, R or C followed by git's similarity score. */
  score?: string;
  submodule?: string;
}

export interface GitBranchState {
  oid?: string;
  head?: string;
  detached: boolean;
  unborn: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
}

export interface GitStatus { branch: GitBranchState; entries: GitStatusEntry[] }

function malformed(what: string): Error {
  return Object.assign(new Error(`Git returned malformed ${what}.`), { code: 'git_protocol_invalid' });
}

/** Split the first `count` space-separated fields off and keep the rest whole. */
function fields(record: string, count: number): string[] | undefined {
  const values: string[] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const space = record.indexOf(' ', cursor);
    if (space < 0) return undefined;
    values.push(record.slice(cursor, space));
    cursor = space + 1;
  }
  values.push(record.slice(cursor));
  return values;
}

/** `git status --porcelain=v2 -z --branch`. */
export function parseStatus(raw: Buffer | string): GitStatus {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  const branch: GitBranchState = { detached: false, unborn: false, ahead: 0, behind: 0 };
  const entries: GitStatusEntry[] = [];
  const records = text.split('\0');
  if (records.at(-1) === '') records.pop();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith('# ')) {
      const [, key, ...rest] = record.split(' '), value = rest.join(' ');
      if (key === 'branch.oid') { if (value === '(initial)') branch.unborn = true; else branch.oid = value; }
      else if (key === 'branch.head') { if (value === '(detached)') branch.detached = true; else branch.head = value; }
      else if (key === 'branch.upstream') branch.upstream = value;
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (!match) throw malformed('branch tracking counts');
        branch.ahead = Number(match[1]); branch.behind = Number(match[2]);
      }
      continue;
    }
    const type = record[0];
    if (type === '1') {
      const value = fields(record, 8); if (!value) throw malformed('status entry');
      const [, xy, sub] = value;
      entries.push({ kind: 'ordinary', index: xy[0], worktree: xy[1], path: value[8], ...(sub !== 'N...' ? { submodule: sub } : {}) });
    } else if (type === '2') {
      const value = fields(record, 9); if (!value) throw malformed('rename entry');
      const [, xy, sub] = value, origPath = records[index + 1];
      if (origPath === undefined) throw malformed('rename entry');
      index += 1;
      entries.push({ kind: 'renamed', index: xy[0], worktree: xy[1], score: value[8], path: value[9], origPath, ...(sub !== 'N...' ? { submodule: sub } : {}) });
    } else if (type === 'u') {
      const value = fields(record, 10); if (!value) throw malformed('conflict entry');
      const [, xy] = value;
      entries.push({ kind: 'unmerged', index: xy[0], worktree: xy[1], path: value[10] });
    } else if (type === '?' || type === '!') {
      if (record[1] !== ' ') throw malformed('untracked entry');
      entries.push({ kind: type === '?' ? 'untracked' : 'ignored', index: type, worktree: type, path: record.slice(2) });
    } else throw malformed('status record');
  }
  return { branch, entries };
}

/** The Source Control groups an entry belongs to; a file can be staged and changed. */
export function statusGroups(entry: GitStatusEntry): GitGroup[] {
  if (entry.kind === 'unmerged') return ['conflicts'];
  if (entry.kind === 'untracked') return ['untracked'];
  if (entry.kind === 'ignored') return [];
  const groups: GitGroup[] = [];
  if (entry.index !== '.') groups.push('staged');
  if (entry.worktree !== '.') groups.push('changes');
  return groups;
}

/** The single letter VS Code style trees show for a path. */
export function statusLetter(entry: GitStatusEntry): string {
  if (entry.kind === 'unmerged') return '!';
  if (entry.kind === 'untracked') return 'U';
  if (entry.kind === 'ignored') return 'I';
  const letter = entry.worktree !== '.' ? entry.worktree : entry.index;
  return letter === 'T' ? 'M' : letter;
}

/** Decode a C-quoted path git prints for unusual names (`"a\tb\303\251"`). */
export function unquotePath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value;
  const body = value.slice(1, -1), bytes: number[] = [];
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character !== '\\') { bytes.push(...Buffer.from(character, 'utf8')); continue; }
    const next = body[index + 1];
    if (/[0-7]/.test(next ?? '')) { bytes.push(Number.parseInt(body.slice(index + 1, index + 4), 8)); index += 3; continue; }
    if (next !== undefined && next in escapes) { bytes.push(escapes[next]); index += 1; continue; }
    bytes.push(92);
  }
  return Buffer.from(bytes).toString('utf8');
}

export interface DiffLine { type: 'context' | 'add' | 'delete' | 'note'; text: string; oldLine?: number; newLine?: number }
export interface DiffHunk { header: string; oldStart: number; oldLines: number; newStart: number; newLines: number; section: string; lines: DiffLine[] }
export interface DiffFile {
  oldPath?: string;
  newPath?: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'mode';
  binary: boolean;
  oldMode?: string;
  newMode?: string;
  similarity?: number;
  hunks: DiffHunk[];
}

function diffPath(value: string, prefix: 'a/' | 'b/'): string | undefined {
  // Header paths may carry a trailing tab when they contain spaces.
  const raw = value.replace(/\t$/, '');
  if (raw === '/dev/null') return undefined;
  const unquoted = unquotePath(raw);
  return unquoted.startsWith(prefix) ? unquoted.slice(2) : unquoted;
}

/** Paths from `diff --git a/x b/y` when no other header names them (binary, mode-only). */
function headerPaths(value: string): { oldPath?: string; newPath?: string } {
  if (value.startsWith('"')) {
    const end = value.indexOf('" ', 1);
    if (end > 0) return { oldPath: diffPath(value.slice(0, end + 1), 'a/'), newPath: diffPath(value.slice(end + 2), 'b/') };
  }
  // Unquoted and unrenamed: "a/<p> b/<p>" with both halves equal.
  const half = (value.length - 1) / 2;
  if (Number.isInteger(half) && value.startsWith('a/') && value.slice(half + 1).startsWith('b/') && value.slice(2, half) === value.slice(half + 3)) {
    const name = value.slice(2, half);
    return { oldPath: name, newPath: name };
  }
  const split = value.indexOf(' b/');
  return split > 0 ? { oldPath: diffPath(value.slice(0, split), 'a/'), newPath: diffPath(value.slice(split + 1), 'b/') } : {};
}

/** A unified diff (`git diff -U3`, staged or not) as files and hunks. */
export function parseDiff(raw: Buffer | string): DiffFile[] {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  const files: DiffFile[] = [];
  let file: DiffFile | undefined, hunk: DiffHunk | undefined, oldLine = 0, newLine = 0;
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      file = { status: 'modified', binary: false, hunks: [], ...headerPaths(line.slice('diff --git '.length)) };
      files.push(file); hunk = undefined; continue;
    }
    if (!file) continue;
    if (hunk) {
      const marker = line[0];
      if (marker === ' ' || marker === '+' || marker === '-' || marker === '\\' || line === '') {
        if (marker === '+') hunk.lines.push({ type: 'add', text: line.slice(1), newLine: newLine++ });
        else if (marker === '-') hunk.lines.push({ type: 'delete', text: line.slice(1), oldLine: oldLine++ });
        else if (marker === '\\') hunk.lines.push({ type: 'note', text: line.slice(2) });
        else hunk.lines.push({ type: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
        continue;
      }
      hunk = undefined;
    }
    const range = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
    if (range) {
      hunk = { header: line, oldStart: Number(range[1]), oldLines: range[2] === undefined ? 1 : Number(range[2]), newStart: Number(range[3]), newLines: range[4] === undefined ? 1 : Number(range[4]), section: range[5] ?? '', lines: [] };
      oldLine = hunk.oldStart; newLine = hunk.newStart; file.hunks.push(hunk); continue;
    }
    if (line.startsWith('--- ')) { file.oldPath = diffPath(line.slice(4), 'a/'); if (file.oldPath === undefined) file.status = 'added'; }
    else if (line.startsWith('+++ ')) { file.newPath = diffPath(line.slice(4), 'b/'); if (file.newPath === undefined) file.status = 'deleted'; }
    else if (line.startsWith('new file mode ')) { file.status = 'added'; file.newMode = line.slice(14); file.oldPath = undefined; }
    else if (line.startsWith('deleted file mode ')) { file.status = 'deleted'; file.oldMode = line.slice(18); file.newPath = undefined; }
    else if (line.startsWith('old mode ')) { file.oldMode = line.slice(9); if (file.status === 'modified') file.status = 'mode'; }
    else if (line.startsWith('new mode ')) file.newMode = line.slice(9);
    else if (line.startsWith('rename from ')) { file.status = 'renamed'; file.oldPath = unquotePath(line.slice(12)); }
    else if (line.startsWith('rename to ')) file.newPath = unquotePath(line.slice(10));
    else if (line.startsWith('copy from ')) { file.status = 'copied'; file.oldPath = unquotePath(line.slice(10)); }
    else if (line.startsWith('copy to ')) file.newPath = unquotePath(line.slice(8));
    else if (line.startsWith('similarity index ')) file.similarity = Number.parseInt(line.slice(17), 10);
    else if (line.startsWith('Binary files ') || line === 'GIT binary patch') file.binary = true;
  }
  for (const value of files) if (value.status === 'mode' && value.hunks.length) value.status = 'modified';
  return files;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committerName: string;
  committerEmail: string;
  committedAt: string;
  refs: string[];
  subject: string;
  body: string;
}

/** Field separator for `logFormat`; unit separator never appears in git metadata. */
export const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%D%x1f%s%x1f%b';

/** `git log -z --format=${LOG_FORMAT}`. */
export function parseLog(raw: Buffer | string): GitCommit[] {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  const commits: GitCommit[] = [];
  for (const record of text.split('\0')) {
    // git separates -z records with NUL but may prefix a newline on some versions.
    const value = record.replace(/^\n/, '');
    if (!value) continue;
    const parts = value.split('\x1f');
    if (parts.length < 11 || !/^[0-9a-f]{7,64}$/.test(parts[0])) throw malformed('history');
    const [hash, parents, authorName, authorEmail, authoredAt, committerName, committerEmail, committedAt, refs, subject, ...body] = parts;
    const iso = (seconds: string) => new Date(Number(seconds) * 1000).toISOString();
    commits.push({
      hash, shortHash: hash.slice(0, 7), parents: parents ? parents.split(' ') : [], authorName, authorEmail, authoredAt: iso(authoredAt),
      committerName, committerEmail, committedAt: iso(committedAt), refs: refs ? refs.split(', ').filter(Boolean) : [], subject, body: body.join('\x1f').replace(/\n+$/, ''),
    });
  }
  return commits;
}

export interface BlameLine {
  line: number;
  hash: string;
  originalLine: number;
  author: string;
  authorEmail: string;
  authoredAt: string;
  summary: string;
  /** True for lines not yet committed (the all-zero hash). */
  uncommitted: boolean;
  text: string;
}

/** `git blame --porcelain`. Commit metadata appears once and is reused for later lines. */
export function parseBlame(raw: Buffer | string): BlameLine[] {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  const commits = new Map<string, Record<string, string>>(), result: BlameLine[] = [];
  const lines = text.split('\n');
  let current: { hash: string; originalLine: number; finalLine: number } | undefined;
  for (const line of lines) {
    if (current === undefined) {
      const header = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: \d+)?$/.exec(line);
      if (!header) { if (line) throw malformed('blame'); continue; }
      current = { hash: header[1], originalLine: Number(header[2]), finalLine: Number(header[3]) };
      if (!commits.has(current.hash)) commits.set(current.hash, {});
      continue;
    }
    if (line.startsWith('\t')) {
      const meta = commits.get(current.hash)!;
      const seconds = Number(meta['author-time'] ?? 0);
      result.push({
        line: current.finalLine, hash: current.hash, originalLine: current.originalLine, author: meta.author ?? '', authorEmail: (meta['author-mail'] ?? '').replace(/^<|>$/g, ''),
        authoredAt: new Date(seconds * 1000).toISOString(), summary: meta.summary ?? '', uncommitted: /^0+$/.test(current.hash), text: line.slice(1),
      });
      current = undefined;
      continue;
    }
    const space = line.indexOf(' '), key = space < 0 ? line : line.slice(0, space), value = space < 0 ? '' : line.slice(space + 1);
    commits.get(current.hash)![key] = value;
  }
  return result;
}

export interface GitBranch {
  name: string;
  ref: string;
  remote: boolean;
  current: boolean;
  oid: string;
  upstream?: string;
  ahead: number;
  behind: number;
  gone: boolean;
  committedAt?: string;
  subject: string;
}

/** `git for-each-ref` fields used by `parseBranches`, NUL separated, one ref per line. */
export const BRANCH_FORMAT = '%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%00%(committerdate:unix)%00%(contents:subject)%00';

export function parseBranches(raw: Buffer | string): GitBranch[] {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  const branches: GitBranch[] = [];
  for (const record of text.split('\0\n')) {
    if (!record.trim()) continue;
    const [ref, name, oid, upstream, track, head, committed, subject] = record.replace(/\0$/, '').split('\0');
    if (!ref?.startsWith('refs/') || !oid) throw malformed('branch list');
    if (ref.endsWith('/HEAD') && ref.startsWith('refs/remotes/')) continue;
    const ahead = /ahead (\d+)/.exec(track ?? '')?.[1], behind = /behind (\d+)/.exec(track ?? '')?.[1];
    branches.push({
      name, ref, remote: ref.startsWith('refs/remotes/'), current: head === '*', oid, ...(upstream ? { upstream } : {}),
      ahead: Number(ahead ?? 0), behind: Number(behind ?? 0), gone: (track ?? '').includes('gone'),
      ...(committed ? { committedAt: new Date(Number(committed) * 1000).toISOString() } : {}), subject: subject ?? '',
    });
  }
  return branches;
}
