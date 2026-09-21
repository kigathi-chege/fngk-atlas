import { deriveActiveFlows } from "./health.js";
import { healthSeverity, operationalSalience, salientFacts } from "./salience.js";
import { synthesizeObservatorySummary } from "./synthesis.js";
import { selectAuthoritativeAssertion } from "./enrichment.js";
import type { WorldSample } from "./store.js";
import type {
  AtlasAssertion,
  AtlasAttentionItem,
  AtlasEntity,
  AtlasObservatory,
  AtlasObservatoryHistoryItem,
  AtlasObservatoryItem,
  OperationalHealth,
  OperationalPhase,
  TopologyRegionId,
} from "./types.js";

const regions: Array<{ id: TopologyRegionId; label: string }> = [
  { id: "applications", label: "Applications" },
  { id: "data", label: "Data" },
  { id: "infrastructure", label: "Infrastructure" },
  { id: "development", label: "Development" },
  { id: "system", label: "System" },
  { id: "external", label: "External" },
];
const health = (value: unknown): OperationalHealth =>
  ["healthy", "degraded", "critical", "unknown", "stale"].includes(
    String(value),
  )
    ? (value as OperationalHealth)
    : "unknown";
const phase = (value: unknown): OperationalPhase =>
  ["idle", "starting", "running", "stopping", "failed", "unknown"].includes(
    String(value),
  )
    ? (value as OperationalPhase)
    : "unknown";
const worst = (values: OperationalHealth[], fallback: OperationalHealth) =>
  values.sort((left, right) => healthSeverity(right) - healthSeverity(left))[0] ??
  fallback;

export function buildObservatory(
  rootId: string,
  entities: AtlasEntity[],
  assertions: AtlasAssertion[],
  changes: Array<{
    id: number | string;
    itemId: string;
    itemType: string;
    changeType: string;
    interpreterId: string;
    changedAt: string;
    summary: Record<string, unknown>;
  }>,
  samples: WorldSample[],
  now = new Date().toISOString(),
): AtlasObservatory {
  const byId = new Map(entities.map((entity) => [entity.id, entity])),
    device = byId.get(rootId) ?? entities.find((entity) => entity.kind === "device"),
    online = device?.attributes.online !== false && !device?.stale,
    workloads = entities.filter((entity) => entity.kind === "workload"),
    primary = workloads.filter(
      (entity) => entity.attributes.visibility === "primary",
    ),
    sorted = [...primary].sort((left, right) => {
      const healthOrder =
        healthSeverity(online ? health(right.attributes.health) : "stale") -
        healthSeverity(online ? health(left.attributes.health) : "stale");
      if (healthOrder) return healthOrder;
      const activeOrder =
        Number(right.attributes.active === true) -
        Number(left.attributes.active === true);
      if (activeOrder) return activeOrder;
      return (
        operationalSalience(right) - operationalSalience(left) ||
        left.id.localeCompare(right.id)
      );
    }),
    selected = sorted.slice(0, 24),
    selectedIds = new Set(selected.map((entity) => entity.id)),
    items = new Map<string, AtlasObservatoryItem>();
  for (const workload of selected) {
    const capabilities = assertions
        .filter(
          (assertion) =>
            assertion.subjectId === workload.id &&
            assertion.predicate === "provides-capability",
        )
        .map((assertion) => byId.get(assertion.objectId ?? "")?.label)
        .filter(Boolean) as string[],
      purpose = selectAuthoritativeAssertion(
        assertions.filter(
          (assertion) =>
            assertion.subjectId === workload.id &&
            assertion.predicate === "has-purpose",
        ),
      ),
      stale = !online || workload.stale,
      confidence =
        typeof workload.attributes.confidence === "number"
          ? workload.attributes.confidence
          : Math.max(
              ...assertions
                .filter(
                  (assertion) =>
                    assertion.subjectId === workload.id ||
                    assertion.objectId === workload.id,
                )
                .map((assertion) => assertion.confidence),
              0.5,
            );
    items.set(workload.id, {
      id: workload.id,
      label: workload.label,
      kind: workload.kind,
      health: stale ? "stale" : health(workload.attributes.health),
      phase: phase(workload.attributes.phase),
      purpose:
        (typeof purpose?.value === "string" ? purpose.value : undefined) ??
        (capabilities.join(" · ") || "Observed workload"),
      active: online && workload.attributes.active === true,
      stale,
      confidence,
      facts: salientFacts(workload, assertions, entities),
    });
  }

  const regionModels = regions.map((region) => {
      const regionEntity = entities.find(
          (entity) =>
            entity.kind === "topology-region" &&
            entity.attributes.region === region.id,
        ),
        regionItems = selected
          .filter((entity) => entity.attributes.region === region.id)
          .map((entity) => items.get(entity.id)!),
        collapsed = workloads.filter(
          (entity) =>
            entity.attributes.region === region.id &&
            (entity.attributes.visibility === "collapsed" ||
              !selectedIds.has(entity.id)),
        ).length,
        collapsedCount =
          (typeof regionEntity?.attributes.collapsedCount === "number"
            ? regionEntity.attributes.collapsedCount
            : 0) + collapsed;
      return {
        id: region.id,
        label: region.label,
        health: !online
          ? ("stale" as const)
          : worst(
              regionItems.map((item) => item.health),
              collapsedCount ? "unknown" : "healthy",
            ),
        items: regionItems,
        collapsedCount,
      };
    }),
    baseFlows = deriveActiveFlows(entities, assertions),
    flows = baseFlows
      .map((flow) => {
        const source = byId.get(flow.sourceId),
          target = byId.get(flow.targetId),
          stale =
            !online ||
            flow.stale ||
            Boolean(source?.stale) ||
            Boolean(target?.stale),
          flowHealth = stale
            ? "stale"
            : worst(
                [health(source?.attributes.health), health(target?.attributes.health)],
                "unknown",
              );
        return { ...flow, active: flow.active && !stale, stale, health: flowHealth };
      })
      .sort(
        (left, right) =>
          Number(right.active) - Number(left.active) ||
          healthSeverity(right.health) - healthSeverity(left.health) ||
          right.confidence - left.confidence ||
          left.id.localeCompare(right.id),
      )
      .slice(0, 12),
    attention: AtlasAttentionItem[] = [];
  for (const workload of workloads) {
    const state = online ? health(workload.attributes.health) : "stale";
    if (state !== "critical" && state !== "degraded") continue;
    const reasons = Array.isArray(workload.attributes.healthReasons)
      ? workload.attributes.healthReasons.map(String)
      : [];
    attention.push({
      id: `health:${workload.id}`,
      text: `${workload.label}: ${reasons[0] ?? (state === "critical" ? "requires immediate attention" : "is degraded")}`,
      entityIds: [workload.id],
      severity: state === "critical" ? "critical" : "warning",
      stale: false,
    });
  }
  const latestSamples = new Map<string, WorldSample>();
  for (const sample of samples) {
    const key = `${sample.entityId}:${sample.metric}`,
      prior = latestSamples.get(key);
    if (!prior || sample.observedAt > prior.observedAt)
      latestSamples.set(key, sample);
  }
  for (const sample of latestSamples.values()) {
    const pressured =
      (sample.metric === "cpuPercent" && sample.value >= 90) ||
      (sample.metric === "memoryUtilization" &&
        (sample.value <= 1 ? sample.value >= 0.9 : sample.value >= 90));
    if (!pressured) continue;
    attention.push({
      id: `pressure:${sample.entityId}:${sample.metric}`,
      text: `${byId.get(sample.entityId)?.label ?? "Workload"} ${sample.metric === "cpuPercent" ? "CPU" : "memory"} pressure is ${sample.value}${sample.unit === "percent" ? "%" : ""}.`,
      entityIds: [sample.entityId],
      severity: "warning",
      stale: !online,
    });
  }
  const boundedAttention = attention
      .sort(
        (left, right) =>
          ({ critical: 3, warning: 2, info: 1 })[right.severity] -
            ({ critical: 3, warning: 2, info: 1 })[left.severity] ||
          left.id.localeCompare(right.id),
      )
      .slice(0, 8),
    history: AtlasObservatoryHistoryItem[] = [...changes]
      .sort(
        (left, right) =>
          right.changedAt.localeCompare(left.changedAt) ||
          String(left.id).localeCompare(String(right.id)),
      )
      .slice(0, 12)
      .map((change) => ({
        id: String(change.id),
        entityId: change.itemId,
        text: `${String(change.summary.label ?? change.itemType)} ${change.changeType}.`,
        at: change.changedAt,
        severity: change.changeType === "withdrawn" ? "warning" : "info",
      })),
    overallHealth: OperationalHealth = !online
      ? "stale"
      : boundedAttention.some((item) => item.severity === "critical")
        ? "critical"
        : boundedAttention.length
          ? "degraded"
          : primary.length && primary.every((workload) => health(workload.attributes.health) === "healthy")
            ? "healthy"
            : "unknown",
    overallPhase: OperationalPhase = primary.some(
      (workload) => phase(workload.attributes.phase) === "running",
    )
      ? "running"
      : primary.some((workload) => phase(workload.attributes.phase) === "starting")
        ? "starting"
        : primary.some((workload) => phase(workload.attributes.phase) === "failed")
          ? "failed"
          : "unknown",
    running = primary.filter(
      (workload) => phase(workload.attributes.phase) === "running",
    ).length;
  return {
    identity: {
      id: device?.id ?? rootId,
      label: device?.label ?? "Device",
      online,
    },
    health: overallHealth,
    phase: overallPhase,
    summary: synthesizeObservatorySummary(
      online,
      running,
      primary.length,
      boundedAttention.length,
    ),
    regions: regionModels,
    flows,
    attention: boundedAttention,
    history,
    measuredAt: now,
    stale: !online,
  };
}
