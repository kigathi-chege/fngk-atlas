import {
  ATLAS_WORLD_VERSION,
  type AtlasAssertion,
  type AtlasEntity,
  type AtlasProjection,
} from "./types.js";
import {
  canonicalBreadcrumb,
  relationshipNeighborhood,
} from "./relationships.js";
import { salientFacts } from "./salience.js";
import { synthesizeWorld } from "./synthesis.js";

const viewKinds: Record<string, Set<string>> = {
  overview: new Set([
    "device",
    "environment",
    "workload",
    "capability",
    "identity",
    "data-store",
    "interface",
  ]),
  runtime: new Set([
    "device",
    "workload",
    "service",
    "process",
    "job",
    "container",
    "runtime",
    "port",
    "socket",
    "interface",
  ]),
  software: new Set([
    "device",
    "workload",
    "repository",
    "package",
    "module",
    "class",
    "function",
    "test",
    "file",
  ]),
  code: new Set([
    "device",
    "workload",
    "repository",
    "package",
    "module",
    "class",
    "function",
    "test",
    "file",
  ]),
  data: new Set([
    "device",
    "workload",
    "capability",
    "data-store",
    "database",
    "table",
    "file",
  ]),
  network: new Set([
    "device",
    "workload",
    "interface",
    "port",
    "socket",
    "http-endpoint",
    "external-system",
  ]),
  resources: new Set([
    "device",
    "workload",
    "resource",
    "process",
    "data-store",
  ]),
  security: new Set([
    "device",
    "workload",
    "identity",
    "interface",
    "port",
    "configuration",
  ]),
  activity: new Set(["device", "workload", "event", "operation", "process"]),
  relationships: new Set(["*"]),
  evidence: new Set(["*"]),
};
const detail: Record<string, Record<string, number>> = {
  runtime: {
    device: 0,
    workload: 0,
    service: 1,
    container: 1,
    runtime: 1,
    process: 2,
    job: 2,
    port: 2,
    socket: 2,
    interface: 2,
  },
  software: {
    device: 0,
    workload: 0,
    repository: 0,
    package: 1,
    module: 2,
    class: 3,
    test: 3,
    function: 4,
    file: 3,
  },
  code: {
    device: 0,
    workload: 0,
    repository: 0,
    package: 1,
    module: 2,
    class: 3,
    test: 3,
    function: 4,
    file: 3,
  },
  data: {
    device: 0,
    workload: 0,
    capability: 0,
    "data-store": 0,
    database: 1,
    table: 2,
    file: 3,
  },
  network: {
    device: 0,
    workload: 0,
    interface: 0,
    "external-system": 1,
    port: 2,
    socket: 2,
    "http-endpoint": 3,
  },
  resources: {
    device: 0,
    workload: 0,
    resource: 1,
    process: 2,
    "data-store": 2,
  },
  security: {
    device: 0,
    workload: 0,
    identity: 1,
    interface: 1,
    port: 2,
    configuration: 3,
  },
  activity: { device: 0, workload: 0, process: 1, operation: 2, event: 3 },
};
const ALL_VIEWS = [
  "overview",
  "runtime",
  "software",
  "data",
  "network",
  "resources",
  "security",
  "activity",
  "relationships",
  "evidence",
];

export function projectWorld(
  contextId: string,
  entities: AtlasEntity[],
  assertions: AtlasAssertion[],
  options: {
    rootId?: string;
    lens?: string;
    level?: number;
    budget?: number;
    cursor?: string;
  } = {},
): AtlasProjection {
  const requested = options.lens ?? "overview",
    lens = viewKinds[requested] ? requested : "overview",
    level = Math.max(0, Math.min(4, options.level ?? 0)),
    byId = new Map(entities.map((value) => [value.id, value])),
    device = entities.find((value) => value.kind === "device"),
    rootId =
      options.rootId && byId.has(options.rootId)
        ? options.rootId
        : (device?.id ?? entities[0]?.id ?? `device:${contextId}`),
    root = byId.get(rootId),
    allowed = viewKinds[lens];
  const visibleKind = (entity: AtlasEntity) =>
      allowed.has("*") || allowed.has(entity.kind),
    maxLevel = detail[lens] ?? {},
    relationshipMode = lens === "relationships" || lens === "evidence";
  let candidates: AtlasEntity[];
  if (relationshipMode) {
    const neighborhood = relationshipNeighborhood(
      rootId,
      assertions,
      Math.max(1, level + 1),
    );
    candidates = entities.filter(
      (value) => neighborhood.ids.has(value.id) && visibleKind(value),
    );
  } else if (lens === "overview") {
    const children = entities.filter((value) => value.parentId === rootId);
    candidates = [...(root ? [root] : []), ...children.filter(visibleKind)];
  } else
    candidates = entities.filter(
      (value) =>
        visibleKind(value) &&
        (value.id === rootId ||
          value.workloadId === rootId ||
          value.parentId === rootId ||
          root?.kind === "device") &&
        (value.id === rootId || (maxLevel[value.kind] ?? 4) <= level),
    );
  const offset = Math.max(
      0,
      Number.parseInt(
        Buffer.from(options.cursor ?? "MA==", "base64url").toString("utf8"),
      ) || 0,
    ),
    budget = Math.min(500, Math.max(1, options.budget ?? 100)),
    sorted = [
      ...new Map(candidates.map((value) => [value.id, value])).values(),
    ].sort((a, b) =>
      a.id === rootId
        ? -1
        : b.id === rootId
          ? 1
          : a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label),
    ),
    visible = sorted.slice(offset, offset + budget),
    ids = new Set(visible.map((value) => value.id)),
    related = assertions.filter(
      (value) =>
        value.objectId && ids.has(value.subjectId) && ids.has(value.objectId),
    ),
    strongest = (id: string) =>
      assertions
        .filter((value) => value.subjectId === id || value.objectId === id)
        .sort((a, b) => b.confidence - a.confidence)[0];
  const nodes = visible.map((value) => {
      const evidence = strongest(value.id);
      return {
        ...value,
        classification: evidence?.classification,
        confidence: evidence?.confidence,
      };
    }),
    edges = related.map((value) => ({
      id: value.id,
      source: value.subjectId,
      target: value.objectId!,
      type: value.predicate,
      classification: value.classification,
      confidence: value.confidence,
      stale: value.stale,
    }));
  const folded = sorted.slice(offset + budget),
    counts = new Map<string, number>();
  for (const value of folded)
    counts.set(value.kind, (counts.get(value.kind) ?? 0) + 1);
  const aggregates = [...counts].map(([kind, count]) => ({
    id: `aggregate:${rootId}:${lens}:${kind}`,
    label: `${count} more ${kind.replaceAll("-", " ")}`,
    kind,
    count,
    destination: { rootId, lens, level: Math.min(4, level + 1) },
    summary: `Continue into ${kind.replaceAll("-", " ")} evidence`,
    stale: folded
      .filter((value) => value.kind === kind)
      .some((value) => value.stale),
  }));
  const cardEntities =
    lens === "overview"
      ? entities.filter((value) =>
          root?.kind === "device"
            ? value.parentId === rootId && value.kind === "workload"
            : value.id !== rootId &&
              (value.parentId === rootId || value.workloadId === rootId),
        )
      : [];
  const cards = cardEntities.slice(0, 80).map((value) => {
    const caps = assertions
        .filter(
          (item) =>
            item.subjectId === value.id &&
            item.predicate === "provides-capability",
        )
        .map((item) => byId.get(item.objectId ?? "")?.label)
        .filter(Boolean) as string[],
      confidence = Math.max(
        ...assertions
          .filter(
            (item) => item.subjectId === value.id || item.objectId === value.id,
          )
          .map((item) => item.confidence),
        0.5,
      );
    return {
      id: value.id,
      kind: value.kind,
      title: value.label,
      status: (value.stale ? "stale" : "current") as "current" | "stale",
      purpose: caps.length
        ? caps.join(" · ")
        : value.kind === "workload"
          ? "Observed workload"
          : `${value.kind.replaceAll("-", " ")} evidence`,
      facts: salientFacts(value, assertions, entities),
      confidence,
    };
  });
  return {
    protocolVersion: ATLAS_WORLD_VERSION,
    contextId,
    rootId,
    lens,
    level,
    nodes,
    edges,
    aggregates,
    cards: lens === "overview" ? cards : undefined,
    synthesis: synthesizeWorld(rootId, entities, assertions),
    breadcrumbs: canonicalBreadcrumb(rootId, entities).map((value) => ({
      id: value.id,
      label: value.label,
      kind: value.kind,
    })),
    availableViews: ALL_VIEWS,
    availableExpansions:
      level < 4
        ? [
            {
              level: level + 1,
              label:
                [
                  "Runtime units",
                  "Components",
                  "Symbols",
                  "Functions and evidence",
                ][level] ?? "More detail",
            },
          ]
        : [],
    cursor:
      offset + budget < sorted.length
        ? Buffer.from(String(offset + budget)).toString("base64url")
        : undefined,
    errors: [],
  };
}
