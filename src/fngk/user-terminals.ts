import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface UserTerminalOwnership { deviceId: string; profile?: string; owner: 'atlas-user'; purpose: 'interactive' }

/**
 * Interactive terminals Atlas created for the user. FNGK owns the sessions;
 * Atlas only remembers which ones are its own so it can reattach them after a
 * restart. No output, titles, or credentials are stored.
 */
export class UserTerminalRegistry {
  readonly db: DatabaseSync;

  constructor(file = ':memory:') {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS atlas_user_terminals (
        session_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, profile TEXT, created_at TEXT NOT NULL
      );
    `);
  }

  get(sessionId: string): UserTerminalOwnership | undefined {
    const row = this.db.prepare('SELECT device_id, profile FROM atlas_user_terminals WHERE session_id = ?').get(sessionId) as { device_id: string; profile: string | null } | undefined;
    return row ? { deviceId: row.device_id, ...(row.profile ? { profile: row.profile } : {}), owner: 'atlas-user', purpose: 'interactive' } : undefined;
  }

  has(sessionId: string): boolean { return this.get(sessionId) !== undefined; }

  remember(sessionId: string, deviceId: string, profile?: string): void {
    this.db.prepare('INSERT INTO atlas_user_terminals(session_id, device_id, profile, created_at) VALUES(?, ?, ?, ?) ON CONFLICT(session_id) DO NOTHING')
      .run(sessionId, deviceId, profile ?? null, new Date().toISOString());
  }

  forget(sessionId: string): void { this.db.prepare('DELETE FROM atlas_user_terminals WHERE session_id = ?').run(sessionId); }
}
