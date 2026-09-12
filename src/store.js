import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(file) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      DROP TABLE IF EXISTS deployments;
      CREATE TABLE IF NOT EXISTS layouts (
        graph_id TEXT NOT NULL, node_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY(graph_id,node_id)
      );
      CREATE TABLE IF NOT EXISTS indexes (
        id TEXT PRIMARY KEY, root TEXT NOT NULL, fingerprint TEXT NOT NULL,
        summary_json TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, symbol_id TEXT NOT NULL, mode TEXT NOT NULL,
        status TEXT NOT NULL, duration_ms INTEGER, summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS consents (
        scope TEXT PRIMARY KEY, mode TEXT NOT NULL, expires_at TEXT, updated_at TEXT NOT NULL
      );
    `);
    const indexColumns=this.db.prepare('PRAGMA table_info(indexes)').all().map(column=>column.name);
    if(!indexColumns.includes('graph_json'))this.db.exec("ALTER TABLE indexes ADD COLUMN graph_json TEXT NOT NULL DEFAULT '{}' ");
  }
  saveLayout(graphId, positions) {
    const insert = this.db.prepare(`INSERT INTO layouts VALUES(?,?,?,?,?) ON CONFLICT(graph_id,node_id) DO UPDATE SET x=excluded.x,y=excluded.y,updated_at=excluded.updated_at`);
    this.db.exec('BEGIN');
    try { for (const p of positions) insert.run(graphId, p.id, p.x, p.y, new Date().toISOString()); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  layout(graphId) { return this.db.prepare('SELECT node_id id,x,y FROM layouts WHERE graph_id=?').all(graphId); }
  saveIndex(value) {
    this.db.prepare(`INSERT INTO indexes(id,root,fingerprint,summary_json,updated_at,graph_json) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET root=excluded.root,fingerprint=excluded.fingerprint,summary_json=excluded.summary_json,updated_at=excluded.updated_at,graph_json=excluded.graph_json`).run(value.id,value.root,value.fingerprint,JSON.stringify(value.summary),new Date().toISOString(),JSON.stringify(value));
  }
  latestIndex() { const row=this.db.prepare("SELECT graph_json graphJson FROM indexes WHERE graph_json<>'{}' ORDER BY updated_at DESC LIMIT 1").get();if(!row)return null;try{return JSON.parse(row.graphJson)}catch{return null} }
  saveRun(value) { this.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)').run(value.id,value.symbolId,value.mode,value.status,value.durationMs??null,JSON.stringify(value.summary??{}),new Date().toISOString()); }
  runs(limit=30) { return this.db.prepare('SELECT id,symbol_id symbolId,mode,status,duration_ms durationMs,summary_json summaryJson,created_at createdAt FROM runs ORDER BY created_at DESC LIMIT ?').all(limit).map(r=>({...r,summary:JSON.parse(r.summaryJson)})); }
}
