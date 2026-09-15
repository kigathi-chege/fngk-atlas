import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { redactFacts } from '../discovery/redaction.js';

export interface EvidenceEntity { id: string; contextId: string; type: string; name: string; path?: string; metadata?: Record<string, unknown>; stale?: boolean; staleReason?: string }
export interface EvidenceRelationship { id: string; contextId: string; type: string; sourceId: string; targetId: string; evidence?: Record<string, unknown>; stale?: boolean; staleReason?: string }
export interface EvidenceOperation { id: string; type: string; contextId: string; route: Record<string, unknown>; summary: Record<string, unknown>; recordedAt: string }

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
      CREATE TABLE IF NOT EXISTS atlas_operations(
        id TEXT PRIMARY KEY, type TEXT NOT NULL, context_id TEXT NOT NULL,
        route_json TEXT NOT NULL, summary_json TEXT NOT NULL, recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS atlas_operations_context_time ON atlas_operations(context_id,recorded_at DESC);
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
  putProjection(key:string,entities:EvidenceEntity[],relationships:EvidenceRelationship[]=[]){const scanId=`projection:${key}`;this.putEntities(scanId,entities);this.putRelationships(scanId,relationships)}

  completeScan(id: string, value: { partial: boolean }): void {
    this.db.prepare(`UPDATE atlas_scans SET status='complete',partial=?,completed_at=? WHERE id=?`).run(value.partial ? 1 : 0, new Date().toISOString(), id);
    if (!value.partial) {
      const scan = this.db.prepare('SELECT context_id contextId FROM atlas_scans WHERE id=?').get(id) as { contextId?: string } | undefined;
      if (scan?.contextId) {
        this.db.exec('BEGIN');try{this.db.prepare("DELETE FROM atlas_entities WHERE context_id=? AND last_scan_id<>? AND last_scan_id NOT LIKE 'projection:%'").run(scan.contextId, id);this.db.prepare("DELETE FROM atlas_relationships WHERE context_id=? AND last_scan_id<>? AND last_scan_id NOT LIKE 'projection:%'").run(scan.contextId, id);this.db.prepare("DELETE FROM atlas_search WHERE source='evidence' AND context_id=? AND entity_id NOT IN (SELECT id FROM atlas_entities WHERE context_id=?)").run(scan.contextId,scan.contextId);this.db.prepare(`INSERT INTO atlas_context_state(context_id,stale,reason,updated_at) VALUES(?,0,NULL,?) ON CONFLICT(context_id) DO UPDATE SET stale=0,reason=NULL,updated_at=excluded.updated_at`).run(scan.contextId, new Date().toISOString());this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
      }
    }
  }
  invalidateContext(contextId: string, reason: string): void {
    this.db.prepare(`INSERT INTO atlas_context_state(context_id,stale,reason,updated_at) VALUES(?,1,?,?) ON CONFLICT(context_id) DO UPDATE SET stale=1,reason=excluded.reason,updated_at=excluded.updated_at`).run(contextId, reason, new Date().toISOString());
  }
  recordOperation(value: EvidenceOperation): void {
    const route=redactFacts(value.route) as Record<string,unknown>,summary=redactFacts(value.summary) as Record<string,unknown>;
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO atlas_operations(id,type,context_id,route_json,summary_json,recorded_at) VALUES(?,?,?,?,?,?)').run(value.id,value.type,value.contextId,JSON.stringify(route),JSON.stringify(summary),value.recordedAt);
      this.db.prepare("DELETE FROM atlas_search WHERE source='operation' AND entity_id=?").run(value.id);
      this.db.prepare('INSERT INTO atlas_search(context_id,entity_id,type,label,path,detail,source) VALUES(?,?,?,?,?,?,?)').run(value.contextId,value.id,'operation',value.type,String(summary.path??''),JSON.stringify({route,summary}),'operation');
      const expired=this.db.prepare('SELECT id FROM atlas_operations WHERE context_id=? ORDER BY recorded_at DESC,id DESC LIMIT -1 OFFSET 2000').all(value.contextId) as Array<{id:string}>;
      for(const item of expired){this.db.prepare("DELETE FROM atlas_search WHERE source='operation' AND entity_id=?").run(item.id);this.db.prepare('DELETE FROM atlas_operations WHERE id=?').run(item.id);}
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  operations(contextId?: string, limit=200): EvidenceOperation[] {
    const bounded=Math.min(500,Math.max(1,limit)),rows=contextId?this.db.prepare('SELECT id,type,context_id contextId,route_json routeJson,summary_json summaryJson,recorded_at recordedAt FROM atlas_operations WHERE context_id=? ORDER BY recorded_at DESC LIMIT ?').all(contextId,bounded):this.db.prepare('SELECT id,type,context_id contextId,route_json routeJson,summary_json summaryJson,recorded_at recordedAt FROM atlas_operations ORDER BY recorded_at DESC LIMIT ?').all(bounded);
    return rows.map((row:any)=>({id:row.id,type:row.type,contextId:row.contextId,route:JSON.parse(row.routeJson),summary:JSON.parse(row.summaryJson),recordedAt:row.recordedAt}));
  }
  entities(contextId: string): Array<EvidenceEntity & { observedAt: string }> {
    return this.db.prepare(`SELECT e.id,e.context_id contextId,e.type,e.name,e.path,e.metadata_json metadataJson,e.observed_at observedAt,COALESCE(s.stale,0) stale,s.reason staleReason FROM atlas_entities e LEFT JOIN atlas_context_state s ON s.context_id=e.context_id WHERE e.context_id=? ORDER BY e.type,e.path,e.id`).all(contextId).map((row: any) => ({ id: row.id, contextId: row.contextId, type: row.type, name: row.name, path: row.path ?? undefined, metadata: JSON.parse(row.metadataJson), observedAt: row.observedAt, stale: Boolean(row.stale), staleReason: row.staleReason ?? undefined }));
  }
  relationships(contextId: string): Array<EvidenceRelationship & { observedAt: string }> {
    return this.db.prepare(`SELECT r.id,r.context_id contextId,r.type,r.source_id sourceId,r.target_id targetId,r.evidence_json evidenceJson,r.observed_at observedAt,COALESCE(s.stale,0) stale,s.reason staleReason FROM atlas_relationships r LEFT JOIN atlas_context_state s ON s.context_id=r.context_id WHERE r.context_id=? ORDER BY r.type,r.id`).all(contextId).map((row: any) => ({ id: row.id, contextId: row.contextId, type: row.type, sourceId: row.sourceId, targetId: row.targetId, evidence: JSON.parse(row.evidenceJson), observedAt: row.observedAt, stale: Boolean(row.stale), staleReason: row.staleReason ?? undefined }));
  }
  search(contextId:string,query:string,limit=100){const tokens=query.normalize('NFKC').trim().split(/\s+/).map(value=>value.replace(/[^\p{L}\p{N}_.:/-]/gu,'')).filter(Boolean).slice(0,8);if(!tokens.length)return[];const match=tokens.map(value=>`"${value.replaceAll('"','')}"*`).join(' AND ');try{return this.db.prepare(`SELECT a.context_id contextId,a.entity_id entityId,a.type,a.label,a.path,a.detail,a.source,bm25(atlas_search) rank,COALESCE(s.stale,0) stale,s.reason staleReason FROM atlas_search a LEFT JOIN atlas_context_state s ON s.context_id=a.context_id WHERE atlas_search MATCH ? AND a.context_id=? ORDER BY rank LIMIT ?`).all(match,contextId,Math.min(250,Math.max(1,limit))).map((row:any)=>({...row,stale:Boolean(row.stale),staleReason:row.staleReason??undefined}))}catch{return[]}}
  close(): void { this.db.close(); }
}
