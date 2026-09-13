import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { redactFacts } from '../discovery/redaction.js';

export interface EvidenceEntity { id: string; contextId: string; type: string; name: string; path?: string; metadata?: Record<string, unknown>; stale?: boolean; staleReason?: string }
export interface EvidenceRelationship { id: string; contextId: string; type: string; sourceId: string; targetId: string; evidence?: Record<string, unknown>; stale?: boolean; staleReason?: string }

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
      CREATE TABLE IF NOT EXISTS atlas_context_state(
        context_id TEXT PRIMARY KEY, stale INTEGER NOT NULL DEFAULT 0,
        reason TEXT, updated_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS atlas_search USING fts5(
        context_id UNINDEXED, entity_id UNINDEXED, type UNINDEXED,
        label, path, detail, source UNINDEXED, tokenize='unicode61'
      );
    `);
  }

  beginScan(value: { contextId: string; routeId: string }) {
    const scan = { id: randomUUID(), ...value, status: 'running', startedAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO atlas_scans(id,context_id,route_id,status,started_at) VALUES(?,?,?,?,?)').run(scan.id, scan.contextId, scan.routeId, scan.status, scan.startedAt);
    return scan;
  }

  putEntities(scanId: string, values: EvidenceEntity[]): void {
    const statement = this.db.prepare(`INSERT INTO atlas_entities(id,context_id,type,name,path,metadata_json,last_scan_id,observed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET context_id=excluded.context_id,type=excluded.type,name=excluded.name,path=excluded.path,metadata_json=excluded.metadata_json,last_scan_id=excluded.last_scan_id,observed_at=excluded.observed_at`);
    const searchDelete=this.db.prepare("DELETE FROM atlas_search WHERE source='evidence' AND entity_id=?"),searchInsert=this.db.prepare('INSERT INTO atlas_search(context_id,entity_id,type,label,path,detail,source) VALUES(?,?,?,?,?,?,?)');
    const observedAt = new Date().toISOString(); this.db.exec('BEGIN');
    try {
      for (const value of values) {const metadata=redactFacts(value.metadata??{});statement.run(value.id, value.contextId, value.type, value.name, value.path ?? null, JSON.stringify(metadata), scanId, observedAt);searchDelete.run(value.id);searchInsert.run(value.contextId,value.id,value.type,value.name,value.path??'',JSON.stringify(metadata),'evidence');}
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
        this.db.prepare(`INSERT INTO atlas_context_state(context_id,stale,reason,updated_at) VALUES(?,0,NULL,?) ON CONFLICT(context_id) DO UPDATE SET stale=0,reason=NULL,updated_at=excluded.updated_at`).run(scan.contextId, new Date().toISOString());
      }
    }
  }
  invalidateContext(contextId: string, reason: string): void {
    this.db.prepare(`INSERT INTO atlas_context_state(context_id,stale,reason,updated_at) VALUES(?,1,?,?) ON CONFLICT(context_id) DO UPDATE SET stale=1,reason=excluded.reason,updated_at=excluded.updated_at`).run(contextId, reason, new Date().toISOString());
  }
  entities(contextId: string): Array<EvidenceEntity & { observedAt: string }> {
    return this.db.prepare(`SELECT e.id,e.context_id contextId,e.type,e.name,e.path,e.metadata_json metadataJson,e.observed_at observedAt,COALESCE(s.stale,0) stale,s.reason staleReason FROM atlas_entities e LEFT JOIN atlas_context_state s ON s.context_id=e.context_id WHERE e.context_id=? ORDER BY e.type,e.path,e.id`).all(contextId).map((row: any) => ({ id: row.id, contextId: row.contextId, type: row.type, name: row.name, path: row.path ?? undefined, metadata: JSON.parse(row.metadataJson), observedAt: row.observedAt, stale: Boolean(row.stale), staleReason: row.staleReason ?? undefined }));
  }
  relationships(contextId: string): Array<EvidenceRelationship & { observedAt: string }> {
    return this.db.prepare(`SELECT r.id,r.context_id contextId,r.type,r.source_id sourceId,r.target_id targetId,r.evidence_json evidenceJson,r.observed_at observedAt,COALESCE(s.stale,0) stale,s.reason staleReason FROM atlas_relationships r LEFT JOIN atlas_context_state s ON s.context_id=r.context_id WHERE r.context_id=? ORDER BY r.type,r.id`).all(contextId).map((row: any) => ({ id: row.id, contextId: row.contextId, type: row.type, sourceId: row.sourceId, targetId: row.targetId, evidence: JSON.parse(row.evidenceJson), observedAt: row.observedAt, stale: Boolean(row.stale), staleReason: row.staleReason ?? undefined }));
  }
  search(contextId:string,query:string,limit=100){const tokens=query.normalize('NFKC').trim().split(/\s+/).map(value=>value.replace(/[^\p{L}\p{N}_.:/-]/gu,'')).filter(Boolean).slice(0,8);if(!tokens.length)return[];const match=tokens.map(value=>`"${value.replaceAll('"','')}"*`).join(' AND ');try{return this.db.prepare(`SELECT context_id contextId,entity_id entityId,type,label,path,detail,source,bm25(atlas_search) rank FROM atlas_search WHERE atlas_search MATCH ? AND context_id=? ORDER BY rank LIMIT ?`).all(match,contextId,Math.min(250,Math.max(1,limit)))}catch{return[]}}
  close(): void { this.db.close(); }
}
