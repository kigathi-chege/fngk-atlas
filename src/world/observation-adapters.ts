import { createHash } from "node:crypto";
import { redactFacts } from "../discovery/redaction.js";
import type { AtlasObservation } from "./types.js";

const stable = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 28);
const sensitiveKey =
  /(secret|token|credential|password|passwd|cookie|authorization|database_url|private[_-]?key)/i;
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
  for (const node of nodes.slice(0, 10_000)) {
    const raw = { label: node.label ?? node.name ?? node.id, ...node },
      facts = redactFacts(raw) as Record<string, unknown>;
    observations.push({
      id: `observation:${stable(`${contextId}:node:${node.id}`)}`,
      contextId,
      kind: String(node.type ?? "resource"),
      source: String(node.source ?? "atlas-existing-evidence"),
      sourceId: String(node.id),
      observedAt: String(node.observedAt ?? at),
      scanId: node.scanId,
      route: redactFacts(node.route) as Record<string, unknown>,
      facts,
      sensitivity: sensitivity(raw),
    });
  }
  for (const edge of edges.slice(0, 20_000)) {
    const raw = { ...edge },
      facts = redactFacts(raw) as Record<string, unknown>;
    observations.push({
      id: `observation:${stable(`${contextId}:edge:${edge.id}`)}`,
      contextId,
      kind: "relationship",
      source: String(edge.sourceName ?? "atlas-existing-evidence"),
      sourceId: String(edge.id),
      observedAt: String(edge.observedAt ?? at),
      scanId: edge.scanId,
      route: redactFacts(edge.route) as Record<string, unknown>,
      facts,
      sensitivity: sensitivity(raw),
    });
  }
  return observations;
}
