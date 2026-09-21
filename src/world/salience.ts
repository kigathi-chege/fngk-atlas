import type {
  AtlasAssertion,
  AtlasEntity,
  OperationalHealth,
} from "./types.js";

export const healthSeverity = (health: OperationalHealth) =>
  ({ critical: 5, degraded: 4, stale: 3, unknown: 2, healthy: 1 })[health];
export const operationalSalience = (entity: AtlasEntity) => {
  const confidence =
      typeof entity.attributes.confidence === "number"
        ? entity.attributes.confidence
        : 0,
    exposure = entity.attributes.public === true ? 2 : 0,
    active = entity.attributes.active === true ? 1 : 0;
  return exposure + active + confidence;
};

export function salientFacts(
  entity: AtlasEntity,
  assertions: AtlasAssertion[],
  entities: AtlasEntity[],
) {
  const byId = new Map(entities.map((value) => [value.id, value])),
    related = assertions.filter(
      (value) => value.subjectId === entity.id || value.objectId === entity.id,
    ),
    out: Array<{ label: string; value: string }> = [];
  const capabilities = related
    .filter(
      (value) =>
        value.subjectId === entity.id &&
        value.predicate === "provides-capability",
    )
    .map((value) => byId.get(value.objectId ?? "")?.label)
    .filter(Boolean) as string[];
  if (capabilities.length)
    out.push({
      label: "Capabilities",
      value: capabilities.slice(0, 2).join(", "),
    });
  const members = Array.isArray(entity.attributes.memberObservationIds)
    ? entity.attributes.memberObservationIds.length
    : 0;
  if (members) out.push({ label: "Evidence", value: String(members) });
  const interfaces = related.filter((value) =>
    ["exposes", "listens-on"].includes(value.predicate),
  ).length;
  if (interfaces) out.push({ label: "Interfaces", value: String(interfaces) });
  const dependencies = related.filter(
    (value) => value.predicate === "depends-on",
  ).length;
  if (dependencies)
    out.push({ label: "Dependencies", value: String(dependencies) });
  const confidence = Math.max(...related.map((value) => value.confidence), 0.5);
  out.push({ label: "Confidence", value: `${Math.round(confidence * 100)}%` });
  return out.slice(0, 4);
}
