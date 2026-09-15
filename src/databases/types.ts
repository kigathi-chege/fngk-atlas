export type DatabaseEngine='postgres'|'mysql'|'mariadb'|'redis'|'mongodb'|'mssql'|'oracle'|'sqlite'|'unknown';
export interface DatabaseResource {id:string;contextId:string;engine:DatabaseEngine;host:string;port?:number;socket?:string;version?:string;source:'terminal'|'adapter'|'explicit';evidence:Record<string,unknown>;observedAt:string;stale?:boolean}
