import path from 'node:path';
import type { FileSearchMatch } from '../transports/file-transport.js';

/**
 * Shared rules for filesystem search on every route: what is never walked,
 * how long a search may run, and how name matches are ordered.
 */

/** Kernel and runtime trees. Walking them is slow and reading them can block forever. */
export const PSEUDO_ROOTS = ['/proc', '/sys', '/dev', '/run', '/snap'] as const;
/** Directory names skipped below the search root. A future setting can override these. */
export const DEFAULT_PRUNE_NAMES = ['node_modules', '.git', '.cache', '.venv', '__pycache__', 'target', 'dist', '.next'] as const;
/** Mounted filesystems that hold no user files. Pruned wherever they are mounted. */
export const PSEUDO_FS_TYPES = ['proc', 'sysfs', 'devtmpfs', 'devpts', 'cgroup', 'cgroup2', 'securityfs', 'debugfs', 'tracefs', 'pstore', 'bpf', 'mqueue', 'hugetlbfs', 'fusectl', 'configfs', 'binfmt_misc', 'autofs', 'efivarfs', 'rpc_pipefs', 'nsfs', 'selinuxfs'] as const;
/** Network filesystems can stall a read; they are only searched when they are the root itself. */
export const NETWORK_FS_TYPES = ['nfs', 'nfs4', 'cifs', 'smb3', 'smbfs', 'fuse.sshfs', 'sshfs', 'afs', 'ceph', 'glusterfs', 'fuse.rclone', 'davfs', 'fuse.s3fs'] as const;

/** Time budgets. A search that runs out reports what it found as truncated. */
export const SEARCH_BUDGET_MS = { name: 3_000, content: 8_000, filesOnly: 15_000 } as const;
export const MAX_SEARCH_BUDGET_MS = 30_000;
/** A single filesystem call slower than this is treated as a stalled mount. */
export const SEARCH_OPERATION_TIMEOUT_MS = 2_000;

export type SearchStopReason = 'limit' | 'time' | 'entries' | 'stalled';
export interface FileSearchResult { matches: FileSearchMatch[]; truncated: boolean; reason?: SearchStopReason; examined?: number; elapsedMs: number }

export function budgetFor(options: { budgetMs?: number; mode?: string; filesOnly?: boolean }): number {
  const fallback = options.filesOnly ? SEARCH_BUDGET_MS.filesOnly : options.mode === 'name' ? SEARCH_BUDGET_MS.name : SEARCH_BUDGET_MS.content;
  const value = Number(options.budgetMs);
  return Number.isFinite(value) && value > 0 ? Math.min(MAX_SEARCH_BUDGET_MS, Math.max(100, Math.round(value))) : fallback;
}

/** Pseudo roots that lie strictly below `root`. Searching inside /proc itself is the caller's explicit choice. */
export function pseudoRootsUnder(root: string): string[] {
  const base = root === '/' ? '/' : root.replace(/\/+$/, '');
  return PSEUDO_ROOTS.filter(value => base === '/' || value.startsWith(`${base}/`));
}

/** Escapes fnmatch metacharacters so a query only ever matches literally. */
export function escapeGlob(value: string): string { return value.replace(/[\\*?[\]]/g, character => `\\${character}`); }

/** A query containing `/` matches against the path; otherwise against the name. */
export function isPathQuery(query: string): boolean { return query.includes('/'); }

export function nameMatches(query: string, name: string, fullPath: string): boolean {
  const wanted = query.trim().toLocaleLowerCase(); if (!wanted) return false;
  return isPathQuery(wanted) ? fullPath.toLocaleLowerCase().includes(wanted) : name.toLocaleLowerCase().includes(wanted);
}

/** Lower is better: exact name, then name prefix, then name substring, then path match. */
export function nameTier(query: string, value: string): number {
  const wanted = query.trim().toLocaleLowerCase(), name = path.posix.basename(value).toLocaleLowerCase(), full = value.toLocaleLowerCase();
  const stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
  if (name === wanted || stem === wanted) return 0;
  if (name.startsWith(wanted)) return 1;
  if (name.includes(wanted)) return 2;
  if (full.endsWith(wanted) || full.includes(`/${wanted}`)) return 3;
  if (full.includes(wanted)) return 4;
  return 5;
}

/**
 * Quick-open ordering: tier, then files before folders, then shallower and
 * shorter paths, then alphabetical so results are stable.
 */
export function rankNameMatches<T extends { path: string; type: string }>(query: string, matches: T[]): T[] {
  const scored = matches.map(match => ({ match, tier: nameTier(query, match.path), depth: match.path.split('/').length, length: match.path.length }));
  scored.sort((left, right) => left.tier - right.tier || (left.match.type === 'directory' ? 1 : 0) - (right.match.type === 'directory' ? 1 : 0) || left.depth - right.depth || left.length - right.length || left.match.path.localeCompare(right.match.path));
  return scored.map(value => value.match);
}

/** Splits /proc/self/mounts into the mount points to prune below `root`. */
export function prunedMounts(mounts: string, root: string): string[] {
  const base = root === '/' ? '' : root.replace(/\/+$/, ''), pseudo = new Set<string>(PSEUDO_FS_TYPES), network = new Set<string>(NETWORK_FS_TYPES), values = new Set<string>();
  for (const line of mounts.split('\n')) {
    const [, rawPoint, type] = line.split(' ');
    if (!rawPoint || !type || (!pseudo.has(type) && !network.has(type))) continue;
    const point = rawPoint.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
    if (point.startsWith(`${base}/`) && point !== root) values.add(point);
  }
  return [...values].sort();
}
