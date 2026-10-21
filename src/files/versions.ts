import { createHash } from 'node:crypto';

/** How many previous versions Atlas keeps for every file it writes. */
export const VERSION_SLOTS = 3;

export interface FileVersion {
  /** 1 is the most recent previous version. */
  slot: number;
  fingerprint: string;
  bytes: number;
  /** When Atlas replaced this content with a newer save. */
  replacedAt: string;
  /** The modification time the content had before it was replaced. */
  modifiedAt?: string;
}

/**
 * Previous versions of files that Atlas wrote, kept on the machine that holds
 * the file. Rotation happens inside the transport's safe write so that it is
 * guarded by the same fingerprint check as the write itself; a store only
 * reads what was retained.
 *
 * Layout (shared by every implementation, so a remote mirror such as an
 * R2-backed store fed by Signal's encrypted Device backup can read it):
 *   <vault>/versions/<versionKey(path)>/{1,2,3}        content
 *   <vault>/versions/<versionKey(path)>/{1,2,3}.meta   "replacedEpoch modifiedEpoch bytes sha256"
 *   <vault>/versions/<versionKey(path)>/path.b64       base64 of the addressed path
 */
export interface VersionStore {
  list(path: string, options?: { signal?: AbortSignal }): Promise<FileVersion[]>;
  read(path: string, slot: number, options?: { signal?: AbortSignal }): Promise<Buffer>;
}

export function versionKey(path: string): string { return createHash('sha256').update(path).digest('hex'); }

export function parseVersionMeta(slot: number, line: string): FileVersion | undefined {
  const [replaced, modified, bytes, fingerprint] = line.trim().split(/\s+/);
  if (!/^[0-9a-f]{64}$/.test(fingerprint ?? '') || !Number.isFinite(Number(replaced)) || !Number.isFinite(Number(bytes))) return undefined;
  return { slot, fingerprint, bytes: Number(bytes), replacedAt: new Date(Number(replaced) * 1000).toISOString(), ...(Number.isFinite(Number(modified)) && modified ? { modifiedAt: new Date(Number(modified) * 1000).toISOString() } : {}) };
}

export function formatVersionMeta(replacedAt: Date, modifiedAt: Date | undefined, bytes: number, fingerprint: string): string {
  return `${Math.floor(replacedAt.getTime() / 1000)} ${modifiedAt ? Math.floor(modifiedAt.getTime() / 1000) : 0} ${bytes} ${fingerprint}\n`;
}

export function validSlot(slot: unknown): number {
  const value = Number(slot);
  if (!Number.isInteger(value) || value < 1 || value > VERSION_SLOTS) throw Object.assign(new Error(`Version slot must be between 1 and ${VERSION_SLOTS}.`), { code: 'invalid_version' });
  return value;
}
