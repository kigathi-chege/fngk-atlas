import type {
  AssertionClass,
  AtlasAssertion,
  AtlasEntity,
  AtlasSynthesis,
} from "./types.js";

export function synthesizeObservatorySummary(
  online: boolean,
  running: number,
  primary: number,
  attention: number,
) {
  if (!online)
    return `This Device was last observed with ${primary} primary workload${primary === 1 ? "" : "s"}. Current state is unavailable.`;
  const activity = `${running} primary workload${running === 1 ? " is" : "s are"} running`;
  return `This Device ${activity} from ${primary} resolved workload${primary === 1 ? "" : "s"}.${attention ? ` ${attention} item${attention === 1 ? "" : "s"} require attention.` : ""}`;
}

export function synthesizeWorld(
  rootId: string,
  entities: AtlasEntity[],
  assertions: AtlasAssertion[],
): AtlasSynthesis {
  const root = entities.find((value) => value.id === rootId),
    workloads =
      root?.kind === "workload"
        ? [root]
        : entities.filter((value) => value.kind === "workload"),
    scopedAssertions =
      root?.kind === "workload"
        ? assertions.filter(
            (value) => value.subjectId === rootId || value.objectId === rootId,
          )
        : assertions,
    active = workloads.filter((value) => !value.stale),
    stale = workloads.filter((value) => value.stale),
    capabilities = new Set(
      scopedAssertions
        .filter((value) => value.predicate === "provides-capability")
        .map(
          (value) =>
            entities.find((entity) => entity.id === value.objectId)?.label,
        )
        .filter(Boolean),
    );
  const facts: AtlasSynthesis["facts"] = [];
  if (workloads.length)
    facts.push({
      id: "workloads",
      text: `${active.length} current workload${active.length === 1 ? "" : "s"} resolved from ${workloads.length} total.`,
      entityIds: workloads.map((value) => value.id),
      classification: "derived" as AssertionClass,
      confidence: 0.9,
      stale: false,
    });
  if (capabilities.size)
    facts.push({
      id: "capabilities",
      text: `Known capabilities: ${[...capabilities].slice(0, 5).join(", ")}.`,
      entityIds: assertions
        .filter((value) => value.predicate === "provides-capability")
        .map((value) => value.subjectId),
      classification: "derived",
      confidence: 0.85,
      stale: false,
    });
  return {
    headline:
      entities.find((value) => value.id === rootId)?.label ?? "Device overview",
    facts,
    attention: stale.slice(0, 8).map((value) => ({
      id: `stale:${value.id}`,
      text: `${value.label} was observed previously and is now stale.`,
      entityIds: [value.id],
      severity: "warning",
      stale: true,
    })),
    counters: {
      workloads: workloads.length,
      currentWorkloads: active.length,
      capabilities: capabilities.size,
    },
  };
}
