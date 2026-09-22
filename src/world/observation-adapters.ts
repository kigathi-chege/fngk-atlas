import { createHash } from "node:crypto";
import { redactFacts } from "../discovery/redaction.js";
import type { AtlasObservation } from "./types.js";

const stable = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 28);
const sensitiveKey =
  /(secret|token|credential|password|passwd|cookie|authorization|database_url|private[_-]?key|api[_-]?key|access[_-]?key)/i;
const allowedFacts=new Set(['label','name','id','type','stale','online','profile','pid','ppid','cwd','systemdUnit','containerId','protocol','address','routeId','environment','managedDeploymentId','activeState','active','subState','state','repositoryPath','root','path','port','cpuPercent','rssBytes','elapsedSeconds','memoryUtilization','restartCount','processState','readiness','ready','description','purpose','documentPath','documentText']);
const allowedRoute=new Set(['kind','privilege','effectiveIdentity','authority']);
const safeRecord=(value:unknown,allowed:Set<string>)=>Object.fromEntries(Object.entries(value&&typeof value==='object'&&!Array.isArray(value)?value:{}).filter(([key,item])=>allowed.has(key)&&item!==undefined));
const safeFacts=(value:Record<string,unknown>)=>redactFacts({...safeRecord(value,allowedFacts),metadata:safeRecord(value.metadata,allowedFacts)}) as Record<string,unknown>;
const sensitivity = (value: unknown): AtlasObservation["sensitivity"] =>
  JSON.stringify(value, (key, item) =>
    sensitiveKey.test(key) ? "[sensitive]" : item,
  ).includes("[sensitive]")
    ? "sensitive-reference"
    : "safe-metadata";

export function adaptWorldObservations(
  contextId: string,
  nodes: any[],
  edges: any[],
  device?: { id?: string; name?: string; online?: boolean; profile?: string },
  at = new Date().toISOString(),
): AtlasObservation[] {
  const observations: AtlasObservation[] = [];
  const operationalKinds=new Set(['deployment','process','service','container','database','data-store','port','socket','interface','repository','project','operation','event']);
  const nodeBudget=9_999-Math.min(edges.length,2_000),selectedNodes:any[]=[];
  for(const priority of [true,false])for(const node of nodes){if(selectedNodes.length>=nodeBudget)break;if(operationalKinds.has(String(node.type))===priority)selectedNodes.push(node)}
  if (device)
    observations.push({
      id: `observation:${stable(`${contextId}:device:${device.id ?? contextId}`)}`,
      contextId,
      kind: "device",
      source: "fngk-context",
      sourceId: String(device.id ?? contextId),
      observedAt: at,
      facts: redactFacts({
        label: device.name ?? contextId,
        online: device.online,
        profile: device.profile,
      }) as Record<string, unknown>,
      sensitivity: "safe-metadata",
    });
  for (const node of selectedNodes) {
    const raw = { label: node.label ?? node.name ?? node.id, ...node },
      facts = safeFacts(raw);
    observations.push({
      id: `observation:${stable(`${contextId}:node:${node.id}`)}`,
      contextId,
      kind: String(node.type ?? "resource"),
      source: String(node.source ?? "atlas-existing-evidence"),
      sourceId: String(node.id),
      observedAt: String(node.observedAt ?? at),
      scanId: node.scanId,
      route: redactFacts(safeRecord(node.route,allowedRoute)) as Record<string, unknown>,
      facts,
      sensitivity: sensitivity(raw),
    });
  }
  for (const edge of edges.slice(0, 10_000-observations.length)) {
    const raw = { ...edge },
      facts = redactFacts(safeRecord(raw,new Set(['source','target','type','stale']))) as Record<string, unknown>;
    observations.push({
      id: `observation:${stable(`${contextId}:edge:${edge.id}`)}`,
      contextId,
      kind: "relationship",
      source: String(edge.sourceName ?? "atlas-existing-evidence"),
      sourceId: String(edge.id),
      observedAt: String(edge.observedAt ?? at),
      scanId: edge.scanId,
      route: redactFacts(safeRecord(edge.route,allowedRoute)) as Record<string, unknown>,
      facts,
      sensitivity: sensitivity(raw),
    });
  }
  return observations;
}
