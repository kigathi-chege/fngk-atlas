import type { AtlasAssertion, AtlasEntity } from "./types.js";

export const CORE_PREDICATES = [
  "contains",
  "realized-by",
  "controlled-by",
  "runs-as",
  "implemented-by",
  "provides-capability",
  "consumes-capability",
  "depends-on",
  "exposes",
  "listens-on",
  "connects-to",
  "reads",
  "writes",
  "configured-by",
  "owned-by",
  "imports",
  "calls",
] as const;
export type CorePredicate = (typeof CORE_PREDICATES)[number];
const predicateSet = new Set<string>(CORE_PREDICATES);
export const isCorePredicate = (value: string): value is CorePredicate =>
  predicateSet.has(value);
const aliases: Record<string, CorePredicate> = {
  depends_on: "depends-on",
  served_by: "exposes",
  runs_as: "runs-as",
  runtime_in: "realized-by",
  configured_by: "configured-by",
  owned_by: "owned-by",
  listens_on: "listens-on",
  connects_to: "connects-to",
};
export const normalizePredicate = (value: string) =>
  aliases[value] ?? value.replaceAll("_", "-");
export const materializedRelationship = (kind: string): CorePredicate =>
  kind === "service"
    ? "controlled-by"
    : kind === "repository"
      ? "implemented-by"
      : ["port", "socket", "interface", "http-endpoint"].includes(kind)
        ? "listens-on"
        : ["database", "data-store"].includes(kind)
          ? "writes"
          : "realized-by";

export function canonicalBreadcrumb(
  entityId: string,
  entities: AtlasEntity[],
  limit = 12,
) {
  const byId = new Map(entities.map((value) => [value.id, value])),
    result: AtlasEntity[] = [],
    seen = new Set<string>();
  let current = byId.get(entityId);
  while (current && result.length < limit && !seen.has(current.id)) {
    seen.add(current.id);
    result.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
}
export function relationshipNeighborhood(
  rootId: string,
  assertions: AtlasAssertion[],
  depth = 1,
) {
  const ids = new Set([rootId]),
    selected: AtlasAssertion[] = [];
  for (let level = 0; level < Math.max(1, depth); level++) {
    for (const assertion of assertions)
      if (
        !selected.includes(assertion) &&
        (ids.has(assertion.subjectId) ||
          (assertion.objectId && ids.has(assertion.objectId)))
      ) {
        selected.push(assertion);
        ids.add(assertion.subjectId);
        if (assertion.objectId) ids.add(assertion.objectId);
      }
  }
  return { ids, assertions: selected };
}
