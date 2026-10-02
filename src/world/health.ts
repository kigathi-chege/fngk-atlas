import type {
  AtlasAssertion,
  AtlasEntity,
  AtlasObservatoryFlow,
  InterpreterInput,
  OperationalHealth,
  OperationalPhase,
} from "./types.js";

export interface OperationalState {
  health: OperationalHealth;
  phase: OperationalPhase;
  active: boolean;
  reasons: string[];
}

const text = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : undefined;
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export function evaluateOperationalState(
  entity: AtlasEntity,
  members: InterpreterInput[],
  deviceOnline: boolean,
): OperationalState {
  const facts = [entity.attributes, ...members.map((member) => member.attributes)],
    states = facts.flatMap((attributes) =>
      [
        attributes.activeState,
        attributes.subState,
        attributes.phase,
        attributes.status,
      ]
        .map(text)
        .filter(Boolean) as string[],
    ),
    failed = states.some((state) =>
      ["failed", "crash-loop", "crashloopbackoff", "unhealthy"].includes(
        state,
      ),
    ),
    starting = states.some((state) =>
      ["starting", "activating", "pending", "deploying"].includes(state),
    ),
    stopping = states.some((state) =>
      ["stopping", "deactivating", "terminating"].includes(state),
    ),
    running =
      states.some((state) =>
        ["active", "running", "ready", "listening"].includes(state),
      ) ||
      facts.some((attributes) => {
        const state = text(attributes.processState)?.toUpperCase();
        return Boolean(state && !state.startsWith("Z"));
      }),
    idle = states.some((state) =>
      ["inactive", "dead", "exited", "stopped", "idle"].includes(state),
    ),
    phase: OperationalPhase = failed
      ? "failed"
      : starting
        ? "starting"
        : stopping
          ? "stopping"
          : running
            ? "running"
            : idle
              ? "idle"
              : "unknown",
    readinessValues = facts
      .map((attributes) => attributes.readiness ?? attributes.ready)
      .filter((value) => value !== undefined),
    explicitlyReady = readinessValues.some(
      (value) =>
        value === true ||
        ["ready", "healthy", "passing"].includes(text(value) ?? ""),
    ),
    explicitlyUnready = readinessValues.some(
      (value) =>
        value === false ||
        ["not-ready", "unready", "unhealthy", "failing"].includes(
          text(value) ?? "",
        ),
    ),
    cpuPressure = facts.some(
      (attributes) => (number(attributes.cpuPercent) ?? 0) >= 90,
    ),
    memoryPressure = facts.some((attributes) => {
      const value =
        number(attributes.memoryUtilization) ??
        number(attributes.memoryPercent);
      return value !== undefined && (value <= 1 ? value >= 0.9 : value >= 90);
    }),
    restartPressure = facts.some(
      (attributes) => (number(attributes.restartCount) ?? 0) >= 3,
    ),
    reasons: string[] = [];

  if (!deviceOnline) reasons.push("The Device is offline; state is last-observed.");
  if (failed) reasons.push("Explicit runtime evidence reports a failed state.");
  if (explicitlyUnready)
    reasons.push("Readiness evidence reports the workload is not ready.");
  if (cpuPressure) reasons.push("CPU utilization is at or above 90%.");
  if (memoryPressure) reasons.push("Memory utilization is at or above 90%.");
  if (restartPressure) reasons.push("Restart count exceeds the attention policy.");

  const health: OperationalHealth = !deviceOnline
    ? "stale"
    : failed
      ? "critical"
      : explicitlyUnready || cpuPressure || memoryPressure || restartPressure
        ? "degraded"
        : running && explicitlyReady
          ? "healthy"
          : "unknown";
  if (health === "healthy")
    reasons.push("The workload is running and explicitly ready.");
  else if (health === "unknown" && !reasons.length)
    reasons.push("Atlas lacks enough readiness evidence to determine health.");

  return {
    health,
    phase,
    active: phase === "running" || phase === "starting" || phase === "stopping",
    reasons,
  };
}

const flowPredicates = new Set([
  "depends-on",
  "connects-to",
  "listens-on",
  "exposes",
  "reads",
  "writes",
  "queries",
  "routes-to",
]);
export function deriveActiveFlows(
  entities: AtlasEntity[],
  assertions: AtlasAssertion[],
): AtlasObservatoryFlow[] {
  const byId = new Map(entities.map((entity) => [entity.id, entity])),
    semanticId = (id: string) => {
      const entity = byId.get(id);
      return entity?.kind === "workload"
        ? entity.id
        : (entity?.workloadId ?? entity?.id);
    },
    flows = new Map<string, AtlasObservatoryFlow>();
  for (const assertion of assertions) {
    if (
      !assertion.objectId ||
      assertion.stale ||
      !flowPredicates.has(assertion.predicate)
    )
      continue;
    const sourceId = semanticId(assertion.subjectId),
      targetId = semanticId(assertion.objectId),
      source = sourceId && byId.get(sourceId),
      target = targetId && byId.get(targetId);
    if (!sourceId || !targetId || sourceId === targetId || !source || !target)
      continue;
    const active = !source.stale && !target.stale,
      key = `${sourceId}:${assertion.predicate}:${targetId}`;
    flows.set(key, {
      id: assertion.id,
      sourceId,
      targetId,
      label: assertion.predicate,
      active,
      health: active ? "healthy" : "stale",
      confidence: assertion.confidence,
      stale: !active,
    });
  }
  return [...flows.values()].sort((left, right) => left.id.localeCompare(right.id));
}
