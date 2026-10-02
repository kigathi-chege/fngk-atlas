import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {summarizeLocalDocument} from './world/document-summary.js';
import {redactCommandLine,redactSensitiveText} from './discovery/redaction.js';

function safeIndexGraph(index){
  if(!index||typeof index!=='object')return{};
  return{...index,nodes:Array.isArray(index.nodes)?index.nodes.map(node=>{
    if(!node||typeof node!=='object')return node;
    const safe={...node};
    delete safe.metadata;
    for(const field of ['label','name'])if(typeof safe[field]==='string'){
      const cleaned=redactSensitiveText(safe[field]);
      safe[field]=cleaned===safe[field]?cleaned:'[redacted]';
    }
    if(typeof safe.documentText==='string')safe.documentText=summarizeLocalDocument(String(safe.documentPath??''),safe.documentText)??'';
    if(safe.dependencies&&typeof safe.dependencies==='object')safe.dependencies=Object.fromEntries(Object.entries(safe.dependencies).map(([scope,versions])=>[scope,versions&&typeof versions==='object'?Object.fromEntries(Object.entries(versions).map(([name,version])=>[name,redactSensitiveText(redactCommandLine(String(version)))])):versions]));
    if(typeof safe.version==='string')safe.version=redactSensitiveText(redactCommandLine(safe.version));
    return safe;
  }):index.nodes};
}

export class Store {
  constructor(file) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA secure_delete=ON;
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
      CREATE VIRTUAL TABLE IF NOT EXISTS atlas_search USING fts5(
        context_id UNINDEXED, entity_id UNINDEXED, type UNINDEXED,
        label, path, detail, source UNINDEXED, tokenize='unicode61'
      );
    `);
    const indexColumns=this.db.prepare('PRAGMA table_info(indexes)').all().map(column=>column.name);
    if(!indexColumns.includes('graph_json'))this.db.exec("ALTER TABLE indexes ADD COLUMN graph_json TEXT NOT NULL DEFAULT '{}' ");
    if(!indexColumns.includes('context_id'))this.db.exec("ALTER TABLE indexes ADD COLUMN context_id TEXT NOT NULL DEFAULT 'local'");
    if(!indexColumns.includes('revision'))this.db.exec('ALTER TABLE indexes ADD COLUMN revision TEXT');
    this.db.exec('CREATE TABLE IF NOT EXISTS atlas_index_privacy_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    if(!this.db.prepare("SELECT value FROM atlas_index_privacy_meta WHERE key='document_summary_version'").get()){
      const rows=this.db.prepare("SELECT id,graph_json graphJson FROM indexes WHERE graph_json<>'{}'").all(),update=this.db.prepare('UPDATE indexes SET graph_json=? WHERE id=?');
      this.db.exec('BEGIN IMMEDIATE');
      try{
        for(const row of rows){
          let index;try{index=JSON.parse(row.graphJson)}catch{index={}}
          update.run(JSON.stringify(safeIndexGraph(index)),row.id);
        }
        const searchRows=this.db.prepare("SELECT rowid,context_id contextId,entity_id entityId,type,label,path,detail,source FROM atlas_search WHERE source='index'").all();
        const updateSearch=this.db.prepare('UPDATE atlas_search SET context_id=?,entity_id=?,type=?,label=?,path=?,detail=?,source=? WHERE rowid=?');
        for(const row of searchRows){
          const label=redactSensitiveText(String(row.label??''));
          updateSearch.run(row.contextId,row.entityId,row.type,label===row.label?label:'[redacted]',redactSensitiveText(String(row.path??'')),redactSensitiveText(String(row.detail??'')),row.source,row.rowid);
        }
        this.db.prepare("INSERT INTO atlas_index_privacy_meta VALUES('document_summary_version','1')").run();
        this.db.exec('COMMIT');
      }catch(error){this.db.exec('ROLLBACK');throw error}
    }
  }
  saveLayout(graphId, positions) {
    const insert = this.db.prepare(`INSERT INTO layouts VALUES(?,?,?,?,?) ON CONFLICT(graph_id,node_id) DO UPDATE SET x=excluded.x,y=excluded.y,updated_at=excluded.updated_at`);
    this.db.exec('BEGIN');
    try { for (const p of positions) insert.run(graphId, p.id, p.x, p.y, new Date().toISOString()); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  layout(graphId) { return this.db.prepare('SELECT node_id id,x,y FROM layouts WHERE graph_id=?').all(graphId); }
  saveIndex(value) {
    const safe=safeIndexGraph(value);
    this.db.prepare(`INSERT INTO indexes(id,root,fingerprint,summary_json,updated_at,graph_json,context_id,revision) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET root=excluded.root,fingerprint=excluded.fingerprint,summary_json=excluded.summary_json,updated_at=excluded.updated_at,graph_json=excluded.graph_json,context_id=excluded.context_id,revision=excluded.revision`).run(safe.id,safe.root,safe.fingerprint,JSON.stringify(safe.summary),new Date().toISOString(),JSON.stringify(safe),safe.contextId??'local',safe.revision??null);
    const contextId=value.contextId??'local',remove=this.db.prepare("DELETE FROM atlas_search WHERE source='index' AND context_id=?"),insert=this.db.prepare('INSERT INTO atlas_search(context_id,entity_id,type,label,path,detail,source) VALUES(?,?,?,?,?,?,?)');
    this.db.exec('BEGIN');try{remove.run(contextId);for(const node of safe.nodes??[])insert.run(contextId,node.id,String(node.type??'entity'),String(node.label??node.name??node.id),redactSensitiveText(String(node.path??'')),redactSensitiveText([node.qualifiedName,node.signature,node.runtime,node.complexity,node.crap].filter(v=>v!==undefined&&v!==null).join(' ')),'index');this.db.exec('COMMIT')}catch(error){this.db.exec('ROLLBACK');throw error}
  }
  index(id) { const row=this.db.prepare("SELECT graph_json graphJson FROM indexes WHERE id=? AND graph_json<>'{}'").get(id);if(!row)return null;try{return JSON.parse(row.graphJson)}catch{return null} }
  latestIndex(contextId) { const row=contextId?this.db.prepare("SELECT graph_json graphJson FROM indexes WHERE context_id=? AND graph_json<>'{}' ORDER BY updated_at DESC LIMIT 1").get(contextId):this.db.prepare("SELECT graph_json graphJson FROM indexes WHERE graph_json<>'{}' ORDER BY updated_at DESC LIMIT 1").get();if(!row)return null;try{return JSON.parse(row.graphJson)}catch{return null} }
  indexes(contextId) { const rows=contextId?this.db.prepare("SELECT id,root,context_id contextId,revision,summary_json summaryJson,updated_at updatedAt FROM indexes WHERE context_id=? ORDER BY updated_at DESC").all(contextId):this.db.prepare("SELECT id,root,context_id contextId,revision,summary_json summaryJson,updated_at updatedAt FROM indexes ORDER BY updated_at DESC").all();return rows.map(row=>({...row,summary:JSON.parse(row.summaryJson)})); }
  saveRun(value) { this.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)').run(value.id,value.symbolId,value.mode,value.status,value.durationMs??null,JSON.stringify(value.summary??{}),new Date().toISOString());this.db.prepare("DELETE FROM atlas_search WHERE source='run' AND entity_id=?").run(value.id);this.db.prepare('INSERT INTO atlas_search(context_id,entity_id,type,label,path,detail,source) VALUES(?,?,?,?,?,?,?)').run(String(value.summary?.contextId??''),value.id,'run',`${value.mode} ${value.status}`,'',`${value.symbolId} ${JSON.stringify(value.summary??{})}`,'run'); }
  runs(limit=30) { return this.db.prepare('SELECT id,symbol_id symbolId,mode,status,duration_ms durationMs,summary_json summaryJson,created_at createdAt FROM runs ORDER BY created_at DESC LIMIT ?').all(limit).map(r=>({...r,summary:JSON.parse(r.summaryJson)})); }
  search(contextId,query,limit=100){const tokens=String(query).normalize('NFKC').trim().split(/\s+/).map(value=>value.replace(/[^\p{L}\p{N}_.:/-]/gu,'')).filter(Boolean).slice(0,8);if(!tokens.length)return[];const match=tokens.map(value=>`"${value.replaceAll('"','')}"*`).join(' AND '),bounded=Math.min(250,Math.max(1,limit));try{return contextId?this.db.prepare(`SELECT context_id contextId,entity_id entityId,type,label,path,detail,source,bm25(atlas_search) rank FROM atlas_search WHERE atlas_search MATCH ? AND (context_id=? OR context_id='') ORDER BY rank LIMIT ?`).all(match,contextId,bounded):this.db.prepare(`SELECT context_id contextId,entity_id entityId,type,label,path,detail,source,bm25(atlas_search) rank FROM atlas_search WHERE atlas_search MATCH ? ORDER BY rank LIMIT ?`).all(match,bounded)}catch{return[]}}
  close() { this.db.close(); }
}
