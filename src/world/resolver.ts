import { createHash } from "node:crypto";
import type {
  AtlasAssertion,
  AtlasEntity,
  InterpreterInput,
  InterpreterOutput,
} from "./types.js";
import { worldId } from "./interpreter.js";

type ResolvedOutput = InterpreterOutput & {
  mapping: Record<string, string>;
  unresolved: Array<{ inputId: string; reason: string }>;
};
const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const attrs = (input: InterpreterInput) => input.attributes ?? {};
const priority = (signal: string) =>
  signal.startsWith("systemd:")
    ? 0
    : signal.startsWith("container:")
      ? 1
      : signal.startsWith("service:")
        ? 2
        : signal.startsWith("database:")
          ? 3
          : 4;
const baseSignals = (input: InterpreterInput) => {
  const a = attrs(input),
    values: string[] = [],
    unit = text(a.systemdUnit ?? a.unit),
    service = text(a.serviceName),
    container = text(a.containerId ?? a.container_id),
    repo = text(
      a.repositoryPath ??
        a.root ??
        (input.kind === "repository" ? a.path : undefined),
    ),
    endpoint = text(a.endpoint ?? a.socket ?? a.address),
    engine = text(a.engine ?? a.databaseEngine);
  if (unit) values.push(`systemd:${unit}`);
  if (container) values.push(`container:${container}`);
  if (service) values.push(`service:${service}`);
  if (engine && endpoint) values.push(`database:${engine}:${endpoint}`);
  else if (input.kind === "database")
    values.push(`database:${engine ?? input.label}`);
  if (repo) values.push(`repository:${repo}`);
  if (input.kind === "service" && !values.length)
    values.push(`service:${input.label}`);
  return [...new Set(values)];
};

/** Fuse observations only through stable operational signals. PID, executable name,
 * parent PID, and conventional ports never become identity anchors by themselves.
 */
export function resolveWorkloads(
  inputs: InterpreterInput[],
  clock = () => new Date().toISOString(),
): ResolvedOutput {
  const candidates = inputs
      .slice(0, 10_000)
      .filter((input) =>
        [
          "service",
          "process",
          "container",
          "repository",
          "database",
          "port",
        ].includes(input.kind),
      ),
    parent = new Map<string, string>(),
    signalOwner = new Map<string, string>();
  const signalMap = new Map(
    candidates.map((input) => [input.id, baseSignals(input)]),
  );
  const repositories = candidates
    .filter((input) => input.kind === "repository")
    .map((input) =>
      text(
        input.attributes.repositoryPath ??
          input.attributes.root ??
          input.attributes.path,
      ),
    )
    .filter(Boolean)
    .sort((a, b) => b!.length - a!.length) as string[];
  const processesByPid = new Map<string, InterpreterInput>();
  for (const input of candidates.filter((value) => value.kind === "process")) {
    const pid = Number(input.attributes.pid);
    if (Number.isInteger(pid))
      processesByPid.set(`${input.contextId}:${pid}`, input);
    const cwd = text(input.attributes.cwd);
    const repository =
      cwd &&
      repositories.find((root) => cwd === root || cwd.startsWith(`${root}/`));
    if (repository) signalMap.get(input.id)!.push(`repository:${repository}`);
  }
  for (const input of candidates.filter((value) =>
    ["port", "socket"].includes(value.kind),
  )) {
    const pid = Number(input.attributes.pid),
      owner = Number.isInteger(pid)
        ? processesByPid.get(`${input.contextId}:${pid}`)
        : undefined;
    if (owner)
      signalMap.get(input.id)!.push(...(signalMap.get(owner.id) ?? []));
  }
  const signals = (input: InterpreterInput) => [
    ...new Set(signalMap.get(input.id) ?? []),
  ];
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) {
      parent.set(id, id);
      return id;
    }
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const a = find(left),
      b = find(right);
    if (a !== b) parent.set(b, a);
  };
  for (const input of candidates) {
    parent.set(input.id, input.id);
    for (const signal of signals(input)) {
      const owner = signalOwner.get(signal);
      if (owner) union(input.id, owner);
      else signalOwner.set(signal, input.id);
    }
  }
  const groups = new Map<string, InterpreterInput[]>(),
    unresolved: ResolvedOutput["unresolved"] = [];
  for (const input of candidates) {
    if (!signals(input).length) {
      unresolved.push({
        inputId: input.id,
        reason: "No stable workload identity signal.",
      });
      continue;
    }
    const root = find(input.id),
      group = groups.get(root) ?? [];
    group.push(input);
    groups.set(root, group);
  }
  const entities: AtlasEntity[] = [],
    assertions: AtlasAssertion[] = [],
    mapping: Record<string, string> = {},
    at = clock();
  for (const group of [...groups.values()].sort((a, b) =>
    a[0].id.localeCompare(b[0].id),
  )) {
    const contextId = group[0].contextId,
      anchors = [...new Set(group.flatMap(signals))].sort(
        (a, b) => priority(a) - priority(b) || a.localeCompare(b),
      ),
      anchor = anchors[0],
      id = worldId(contextId, "atlas.resolver", "workload", anchor),
      first = group.map((v) => v.observedAt).sort()[0] ?? at,
      last =
        group
          .map((v) => v.observedAt)
          .sort()
          .at(-1) ?? at,
      preferred = [...group].sort(
        (a, b) =>
          (a.kind === "service"
            ? 0
            : a.kind === "database"
              ? 1
              : a.kind === "repository"
                ? 2
                : 3) -
          (b.kind === "service"
            ? 0
            : b.kind === "database"
              ? 1
              : b.kind === "repository"
                ? 2
                : 3),
      )[0],
      label =
        text(preferred.attributes.displayName ?? preferred.attributes.name) ??
        preferred.label;
    const aliases = [
        ...new Set(
          group.map((v) => v.label).filter((value) => value !== label),
        ),
      ],
      confidence = anchor.startsWith("systemd:")
        ? 0.98
        : anchor.startsWith("container:")
          ? 0.95
          : anchor.startsWith("service:")
            ? 0.92
            : anchor.startsWith("database:")
              ? 0.94
              : 0.9;
    entities.push({
      id,
      contextId,
      kind: "workload",
      namespace: "atlas.resolver",
      label,
      aliases,
      attributes: {
        anchor,
        identitySignals: anchors,
        memberObservationIds: group.map((v) => v.id),
        memberKinds: [...new Set(group.map((v) => v.kind))],
      },
      firstObservedAt: first,
      lastObservedAt: last,
      stale: group.every((v) => Boolean(v.stale)),
    });
    for (const input of group) {
      mapping[input.id] = id;
      assertions.push({
        id: worldId(
          contextId,
          "atlas.resolver",
          "assertion",
          `${anchor}:realized-by:${input.id}`,
        ),
        contextId,
        subjectId: id,
        predicate: "realized-by",
        objectId: input.id,
        classification: "derived",
        confidence,
        explanation:
          "Stable operational identity signals connect this workload to the observed technical entity.",
        evidence: [{ observationId: input.id, method: input.source }],
        interpreterId: "atlas.resolver",
        interpreterVersion: "1.1.0",
        observedAt: input.observedAt,
        derivedAt: at,
        stale: Boolean(input.stale),
      });
    }
  }
  return { entities, assertions, views: [], mapping, unresolved };
}

export const resolverInputId = (contextId: string, kind: string, key: string) =>
  `observation:${createHash("sha256").update(`${contextId}\0${kind}\0${key}`).digest("hex").slice(0, 28)}`;
