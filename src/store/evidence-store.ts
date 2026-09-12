import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { redactFacts } from '../discovery/redaction.js';

export interface EvidenceEntity { id: string; contextId: string; type: string; name: string; path?: string; metadata?: Record<string, unknown> }
export interface EvidenceRelationship { id: string; contextId: string; type: string; sourceId: string; targetId: string; evidence?: Record<string, unknown> }

export class EvidenceStore {
  readonly db: DatabaseSync;
  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS atlas_scans(
        id TEXT PRIMARY KEY, context_id TEXT NOT NULL, route_id TEXT NOT NULL,
        status TEXT NOT NULL, partial INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS atlas_entities(
        id TEXT PRIMARY KEY, context_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
        path TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', last_scan_id TEXT NOT NULL,
        observed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS atlas_entities_context_type ON atlas_entities(context_id,type);
      CREATE TABLE IF NOT EXISTS atlas_relationships(
        id TEXT PRIMARY KEY, context_id TEXT NOT NULL, type TEXT NOT NULL,
        source_id TEXT NOT NULL, target_id TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '{}',
        last_scan_id TEXT NOT NULL, observed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS atlas_relationships_context ON atlas_relationships(context_id);
    `);
  }

  beginScan(value: { contextId: string; routeId: string }) {
    const scan = { id: randomUUID(), ...value, status: 'running', startedAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO atlas_scans(id,context_id,route_id,status,started_at) VALUES(?,?,?,?,?)').run(scan.id, scan.contextId, scan.routeId, scan.status, scan.startedAt);
    return scan;
  }

  putEntities(scanId: string, values: EvidenceEntity[]): void {
    const statement = this.db.prepare(`INSERT INTO atlas_entities(id,context_id,type,name,path,metadata_json,last_scan_id,observed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET context_id=excluded.context_id,type=excluded.type,name=excluded.name,path=excluded.path,metadata_json=excluded.metadata_json,last_scan_id=excluded.last_scan_id,observed_at=excluded.observed_at`);
    const observedAt = new Date().toISOString(); this.db.exec('BEGIN');
    try {
      for (const value of values) statement.run(value.id, value.contextId, value.type, value.name, value.path ?? null, JSON.stringify(redactFacts(value.metadata ?? {})), scanId, observedAt);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  putRelationships(scanId: string, values: EvidenceRelationship[]): void {
    const statement = this.db.prepare(`INSERT INTO atlas_relationships(id,context_id,type,source_id,target_id,evidence_json,last_scan_id,observed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET context_id=excluded.context_id,type=excluded.type,source_id=excluded.source_id,target_id=excluded.target_id,evidence_json=excluded.evidence_json,last_scan_id=excluded.last_scan_id,observed_at=excluded.observed_at`);
    const observedAt = new Date().toISOString(); this.db.exec('BEGIN');
    try {
      for (const value of values) statement.run(value.id, value.contextId, value.type, value.sourceId, value.targetId, JSON.stringify(redactFacts(value.evidence ?? {})), scanId, observedAt);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  completeScan(id: string, value: { partial: boolean }): void {
    this.db.prepare(`UPDATE atlas_scans SET status='complete',partial=?,completed_at=? WHERE id=?`).run(value.partial ? 1 : 0, new Date().toISOString(), id);
    if (!value.partial) {
      const scan = this.db.prepare('SELECT context_id contextId FROM atlas_scans WHERE id=?').get(id) as { contextId?: string } | undefined;
      if (scan?.contextId) {
        this.db.prepare('DELETE FROM atlas_entities WHERE context_id=? AND last_scan_id<>?').run(scan.contextId, id);
        this.db.prepare('DELETE FROM atlas_relationships WHERE context_id=? AND last_scan_id<>?').run(scan.contextId, id);
      }
    }
  }
  entities(contextId: string): Array<EvidenceEntity & { observedAt: string }> {
    return this.db.prepare(`SELECT id,context_id contextId,type,name,path,metadata_json metadataJson,observed_at observedAt FROM atlas_entities WHERE context_id=? ORDER BY type,path,id`).all(contextId).map((row: any) => ({ id: row.id, contextId: row.contextId, type: row.type, name: row.name, path: row.path ?? undefined, metadata: JSON.parse(row.metadataJson), observedAt: row.observedAt }));
  }
  relationships(contextId: string): Array<EvidenceRelationship & { observedAt: string }> {
    return this.db.prepare(`SELECT id,context_id contextId,type,source_id sourceId,target_id targetId,evidence_json evidenceJson,observed_at observedAt FROM atlas_relationships WHERE context_id=? ORDER BY type,id`).all(contextId).map((row: any) => ({ id: row.id, contextId: row.contextId, type: row.type, sourceId: row.sourceId, targetId: row.targetId, evidence: JSON.parse(row.evidenceJson), observedAt: row.observedAt }));
  }
  close(): void { this.db.close(); }
}
