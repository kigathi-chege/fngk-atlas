import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DeviceScope } from '../device-sessions/types.js';

export type GrantKind = 'once' | 'conversation' | 'durable' | 'full_access';
export type Grant = {
  id: string; scope: DeviceScope; toolIds: string[]; kind: GrantKind; actor: string;
  createdAt: string; expiresAt: string | null; maxUses: number | null; uses: number; revokedAt: string | null; revokedBy: string | null;
};

const key = (scope: DeviceScope) => JSON.stringify([scope.profile, scope.teamId ?? null, scope.projectId ?? null, scope.deviceId]);
const parse = (row: any): Grant => ({
  id: row.id,
  scope: JSON.parse(row.scope_json),
  toolIds: JSON.parse(row.tool_ids_json),
  kind: row.kind,
  actor: row.actor,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  maxUses: row.max_uses === null ? null : Number(row.max_uses),
  uses: Number(row.uses ?? 0),
  revokedAt: row.revoked_at,
  revokedBy: row.revoked_by
});

/** Persistent, scope-bound agent authorizations. Conversation grants are pruned on restart. */
export class GrantStore {
  readonly db: DatabaseSync;

  constructor(file = ':memory:') {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS atlas_agent_tool_grants (
        id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, scope_json TEXT NOT NULL,
        tool_ids_json TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL,
        created_at TEXT NOT NULL, expires_at TEXT, max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0,
        revoked_at TEXT, revoked_by TEXT
      );
      CREATE INDEX IF NOT EXISTS atlas_agent_tool_grants_scope
        ON atlas_agent_tool_grants(scope_key, revoked_at, expires_at);
      DELETE FROM atlas_agent_tool_grants WHERE kind='conversation';
    `);
    const columns = this.db.prepare('PRAGMA table_info(atlas_agent_tool_grants)').all().map((value: any) => value.name);
    if (!columns.includes('max_uses')) this.db.exec('ALTER TABLE atlas_agent_tool_grants ADD COLUMN max_uses INTEGER');
    if (!columns.includes('uses')) this.db.exec('ALTER TABLE atlas_agent_tool_grants ADD COLUMN uses INTEGER NOT NULL DEFAULT 0');
  }

  create(input: { scope: DeviceScope; toolIds: string[]; kind: GrantKind; actor: string; expiresAt?: string | null }): Grant {
    const grant: Grant = {
      id: randomUUID(), scope: structuredClone(input.scope), toolIds: [...new Set(input.toolIds)], kind: input.kind,
      actor: input.actor, createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt ?? (input.kind === 'full_access' ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null),
      maxUses: input.kind === 'once' ? 1 : null,
      uses: 0,
      revokedAt: null, revokedBy: null
    };
    this.db.prepare(`INSERT INTO atlas_agent_tool_grants
      (id,scope_key,scope_json,tool_ids_json,kind,actor,created_at,expires_at,max_uses,uses,revoked_at,revoked_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      grant.id, key(grant.scope), JSON.stringify(grant.scope), JSON.stringify(grant.toolIds), grant.kind, grant.actor,
      grant.createdAt, grant.expiresAt, grant.maxUses, grant.uses, null, null
    );
    return structuredClone(grant);
  }

  active(scope: DeviceScope): Grant[] {
    const now = new Date().toISOString();
    return this.db.prepare(`SELECT * FROM atlas_agent_tool_grants
      WHERE scope_key=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) AND (max_uses IS NULL OR uses<max_uses)
      ORDER BY created_at`).all(key(scope), now).map(parse).map(value => structuredClone(value));
  }

  revoke(id: string, actor: string): boolean {
    const result = this.db.prepare(`UPDATE atlas_agent_tool_grants
      SET revoked_at=COALESCE(revoked_at,?), revoked_by=COALESCE(revoked_by,?) WHERE id=?`).run(new Date().toISOString(), actor, id);
    return Number(result.changes) > 0;
  }

  reserve(id: string): boolean {
    const result = this.db.prepare(`UPDATE atlas_agent_tool_grants SET uses=uses+1
      WHERE id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) AND (max_uses IS NULL OR uses<max_uses)`).run(id, new Date().toISOString());
    return Number(result.changes) > 0;
  }

  list(): Grant[] { return this.db.prepare('SELECT * FROM atlas_agent_tool_grants ORDER BY created_at DESC').all().map(parse).map(value => structuredClone(value)); }
  close(): void { this.db.close(); }
}
