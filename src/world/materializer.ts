import { worldId } from "./interpreter.js";
import { materializedRelationship } from "./relationships.js";
import { evaluateOperationalState } from "./health.js";
import type { ResolvedWorld } from "./resolution-policy.js";
import type {
  AtlasAssertion,
  AtlasEntity,
  InterpreterInput,
  InterpreterOutput,
  TopologyRegionId,
} from "./types.js";

export const RESOLVER_NAMESPACE = "atlas.resolver.v2";
export const TOPOLOGY_REGIONS: Array<{
  id: TopologyRegionId;
  label: string;
}> = [
  { id: "applications", label: "Applications" },
  { id: "data", label: "Data" },
  { id: "infrastructure", label: "Infrastructure" },
  { id: "development", label: "Development" },
  { id: "system", label: "System" },
  { id: "external", label: "External" },
];

export interface MaterializedDevice {
  id?: string;
  label: string;
  online: boolean;
  observationId: string;
  observedAt: string;
}

const relevantKinds = new Set([
  "service",
  "process",
  "container",
  "port",
  "socket",
  "interface",
  "http-endpoint",
  "database",
  "data-store",
  "repository",
  "deployment",
  "event",
  "operation",
]);
const entityKind = (kind: string) =>
  ["port", "socket", "http-endpoint"].includes(kind)
    ? "interface"
    : kind === "database"
      ? "data-store"
      : kind === "deployment"
        ? "operation"
        : kind;

export function materializeWorld(
  contextId: string,
  device: MaterializedDevice,
  resolved: ResolvedWorld,
  inputs: InterpreterInput[],
  clock = () => new Date().toISOString(),
): InterpreterOutput {
  const at = clock(),
    byId = new Map(inputs.map((input) => [input.id, input])),
    deviceId = worldId(contextId, RESOLVER_NAMESPACE, "device", contextId),
    entities: AtlasEntity[] = [
      {
        id: deviceId,
        contextId,
        kind: "device",
        namespace: RESOLVER_NAMESPACE,
        label: device.label,
        aliases: [contextId],
        attributes: { online: device.online, sourceId: device.id ?? contextId },
        firstObservedAt: device.observedAt,
        lastObservedAt: device.observedAt,
        stale: !device.online,
      },
    ],
    assertions: AtlasAssertion[] = [],
    regionIds = new Map<TopologyRegionId, string>();
  const assertion = (
    subjectId: string,
    predicate: string,
    objectId: string,
    evidence: InterpreterInput | { id: string; source: string; observedAt: string },
    confidence = 1,
    explanation = "Observed machine evidence supports this semantic relationship.",
  ) => {
    assertions.push({
      id: worldId(
        contextId,
        RESOLVER_NAMESPACE,
        "assertion",
        `${subjectId}:${predicate}:${objectId}:${evidence.id}`,
      ),
      contextId,
      subjectId,
      predicate,
      objectId,
      classification: "derived",
      confidence,
      explanation,
      evidence: [{ observationId: evidence.id, method: evidence.source }],
      interpreterId: RESOLVER_NAMESPACE,
      interpreterVersion: "2.0.0",
      observedAt: evidence.observedAt,
      derivedAt: at,
      stale: "stale" in evidence ? Boolean(evidence.stale) : !device.online,
    });
  };
  const deviceEvidence = {
    id: device.observationId,
    source: "fngk-context",
    observedAt: device.observedAt,
  };

  for (const region of TOPOLOGY_REGIONS) {
    const id = worldId(contextId, RESOLVER_NAMESPACE, "topology-region", region.id);
    regionIds.set(region.id, id);
    entities.push({
      id,
      contextId,
      kind: "topology-region",
      namespace: RESOLVER_NAMESPACE,
      label: region.label,
      aliases: [],
      parentId: deviceId,
      attributes: {
        region: region.id,
        collapsedCount:
          region.id === "system"
            ? resolved.aggregates.system + resolved.aggregates.inactive
            : region.id === "development"
              ? resolved.aggregates.unknown
              : 0,
        ...(region.id === "system"
          ? {
              activeSystemCount: resolved.aggregates.system,
              inactiveCount: resolved.aggregates.inactive,
            }
          : {}),
      },
      firstObservedAt: device.observedAt,
      lastObservedAt: device.observedAt,
      stale: !device.online,
    });
    assertion(deviceId, "contains", id, deviceEvidence);
  }

  for (const workload of resolved.workloads) {
    const members = workload.memberIds
        .map((id) => byId.get(id))
        .filter(Boolean) as InterpreterInput[],
      firstObservedAt =
        members.map((member) => member.observedAt).sort()[0] ?? at,
      lastObservedAt =
        members
          .map((member) => member.observedAt)
          .sort()
          .at(-1) ?? at,
      regionId = regionIds.get(workload.region)!,
      operational = evaluateOperationalState(
        {
          id: workload.id,
          contextId,
          kind: "workload",
          namespace: RESOLVER_NAMESPACE,
          label: workload.label,
          aliases: [],
          attributes: {},
          firstObservedAt,
          lastObservedAt,
          stale: !device.online,
        },
        members,
        device.online,
      ),
      cpuPercent = members.reduce(
        (sum, member) =>
          sum +
          (typeof member.attributes.cpuPercent === "number"
            ? member.attributes.cpuPercent
            : 0),
        0,
      ),
      rssBytes = members.reduce(
        (sum, member) =>
          sum +
          (typeof member.attributes.rssBytes === "number"
            ? member.attributes.rssBytes
            : 0),
        0,
      ),
      memoryUtilization = Math.max(
        ...members
          .map((member) => member.attributes.memoryUtilization)
          .filter((value): value is number => typeof value === "number"),
        0,
      ),
      restartCount = Math.max(
        ...members
          .map((member) => member.attributes.restartCount)
          .filter((value): value is number => typeof value === "number"),
        0,
      ),
      readiness = members
        .map((member) => member.attributes.readiness)
        .find((value) => value !== undefined);
    entities.push({
      id: workload.id,
      contextId,
      kind: "workload",
      namespace: RESOLVER_NAMESPACE,
      label: workload.label,
      aliases: [],
      parentId: regionId,
      attributes: {
        anchor: workload.anchor,
        memberObservationIds: workload.memberIds,
        region: workload.region,
        visibility: workload.visibility,
        confidence: workload.confidence,
        health: operational.health,
        phase: operational.phase,
        active: operational.active,
        healthReasons: operational.reasons,
        ...(cpuPercent ? { cpuPercent } : {}),
        ...(rssBytes ? { rssBytes } : {}),
        ...(memoryUtilization ? { memoryUtilization } : {}),
        ...(restartCount ? { restartCount } : {}),
        ...(readiness !== undefined ? { readiness } : {}),
        ...(workload.healthHint ? { healthHint: workload.healthHint } : {}),
      },
      firstObservedAt,
      lastObservedAt,
      stale: !device.online || members.every((member) => Boolean(member.stale)),
    });
    assertion(
      regionId,
      "contains",
      workload.id,
      members[0] ?? deviceEvidence,
      workload.confidence,
      "Strong operational identity evidence places this workload in the machine topology.",
    );
    for (const member of members) {
      if (!relevantKinds.has(member.kind)) continue;
      const kind = entityKind(member.kind),
        id = worldId(contextId, RESOLVER_NAMESPACE, kind, member.id);
      entities.push({
        id,
        contextId,
        kind,
        namespace: RESOLVER_NAMESPACE,
        label: member.label,
        aliases: [],
        parentId: workload.id,
        workloadId: workload.id,
        attributes: { ...member.attributes, observationId: member.id },
        firstObservedAt: member.observedAt,
        lastObservedAt: member.observedAt,
        stale: !device.online || Boolean(member.stale),
      });
      assertion(
        workload.id,
        materializedRelationship(member.kind),
        id,
        member,
        workload.confidence,
      );
    }
  }

  for (const input of inputs.filter(
    (value) =>
      !resolved.mapping[value.id] &&
      (value.kind === "event" || value.kind === "operation"),
  )) {
    const id = worldId(
        contextId,
        RESOLVER_NAMESPACE,
        input.kind,
        input.id,
      ),
      parentId = regionIds.get("system")!;
    entities.push({
      id,
      contextId,
      kind: input.kind,
      namespace: RESOLVER_NAMESPACE,
      label: input.label,
      aliases: [],
      parentId,
      attributes: { ...input.attributes, observationId: input.id },
      firstObservedAt: input.observedAt,
      lastObservedAt: input.observedAt,
      stale: !device.online || Boolean(input.stale),
    });
    assertion(
      parentId,
      "contains",
      id,
      input,
      1,
      "A recorded Atlas operation or event is part of recent machine activity.",
    );
  }

  return {
    entities,
    assertions,
    views: [
      {
        id: "atlas.core.evidence",
        title: "Evidence",
        appliesTo: ["*"],
        priority: 0,
        sections: [
          { kind: "properties", title: "Identity" },
          { kind: "relationships", title: "Relationships" },
          { kind: "evidence", title: "Why Atlas believes this" },
          { kind: "timeline", title: "Recent changes" },
        ],
      },
    ],
  };
}
