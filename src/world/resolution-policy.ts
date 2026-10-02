import { worldId } from "./interpreter.js";
import type {
  InterpreterInput,
  OperationalHealth,
  TopologyRegionId,
} from "./types.js";

export interface ResolvedWorkload {
  id: string;
  label: string;
  anchor: string;
  memberIds: string[];
  region: TopologyRegionId;
  visibility: "primary" | "collapsed";
  healthHint?: OperationalHealth;
  confidence: number;
}
export interface IdentityConflict {
  id: string;
  inputIds: string[];
  anchors: string[];
  reason: string;
}
export interface ResolvedWorld {
  workloads: ResolvedWorkload[];
  mapping: Record<string, string>;
  aggregates: { system: number; inactive: number; unknown: number };
  conflicts: IdentityConflict[];
  unresolved: Array<{
    inputId: string;
    bucket: "system" | "inactive" | "unknown";
    reason: string;
  }>;
}

interface Candidate {
  contextId: string;
  anchor: string;
  label: string;
  score: number;
  region: TopologyRegionId;
  visibility: "primary" | "collapsed";
  members: Set<string>;
  healthHint?: OperationalHealth;
}

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const active = (input: InterpreterInput) => {
  const activeState = text(input.attributes.activeState)?.toLowerCase(),
    subState = text(input.attributes.subState)?.toLowerCase(),
    processState = text(input.attributes.processState)?.toUpperCase();
  if (activeState)
    return ["active", "running", "ready"].includes(activeState);
  if (subState)
    return ["active", "running", "ready", "listening"].includes(subState);
  if (processState) return !processState.startsWith("Z");
  return input.kind === "process" || input.kind === "deployment";
};
const inactive = (input: InterpreterInput) => {
  const values = [input.attributes.activeState, input.attributes.subState]
    .map((value) => text(value)?.toLowerCase())
    .filter(Boolean);
  return values.some((value) =>
    ["inactive", "dead", "exited", "stopped"].includes(value!),
  );
};
const failed = (input: InterpreterInput) =>
  [input.attributes.activeState, input.attributes.subState]
    .map((value) => text(value)?.toLowerCase())
    .some((value) => value === "failed" || value === "crash-loop");
const repositoryPath = (input: InterpreterInput) =>
  text(input.attributes.repositoryPath);
const deploymentAnchor = (value: string) =>
  value.startsWith("deployment:") ? value : `deployment:${value}`;

export function resolveOperationalWorld(
  source: InterpreterInput[],
  _clock = () => new Date().toISOString(),
): ResolvedWorld {
  const inputs = source.slice(0, 10_000),
    byId = new Map(inputs.map((input) => [input.id, input])),
    candidates = new Map<string, Candidate>(),
    conflicts: IdentityConflict[] = [];
  const add = (candidate: Candidate) => {
    candidates.set(candidate.anchor, candidate);
    return candidate;
  };

  for (const input of inputs) {
    const managed = text(input.attributes.managedDeploymentId);
    if (input.kind !== "deployment" && !managed) continue;
    const anchor = deploymentAnchor(managed ?? input.id),
      existing = candidates.get(anchor);
    if (existing) existing.members.add(input.id);
    else
      add({
        contextId: input.contextId,
        anchor,
        label: input.label,
        score: 100,
        region: "applications",
        visibility: "primary",
        members: new Set([input.id]),
        healthHint: failed(input) ? "critical" : undefined,
      });
  }

  for (const input of inputs.filter((value) => value.kind === "database")) {
    const engine = text(input.attributes.databaseEngine) ?? input.label,
      address = text(input.attributes.address),
      port = Number(input.attributes.port);
    if (!engine || (!address && !Number.isInteger(port))) continue;
    add({
      contextId: input.contextId,
      anchor: `database:${engine}:${address ?? ""}:${Number.isInteger(port) ? port : ""}`,
      label: input.label,
      score: 95,
      region: "data",
      visibility: "primary",
      members: new Set([input.id]),
      healthHint: failed(input) ? "critical" : undefined,
    });
  }

  for (const input of inputs.filter(
    (value) => value.kind === "container" && active(value),
  )) {
    const containerId = text(input.attributes.containerId);
    if (!containerId) continue;
    add({
      contextId: input.contextId,
      anchor: `container:${containerId}`,
      label: input.label,
      score: 90,
      region: "infrastructure",
      visibility: "collapsed",
      members: new Set([input.id]),
      healthHint: failed(input) ? "critical" : undefined,
    });
  }

  const repositories = inputs
    .filter((input) => input.kind === "repository" && repositoryPath(input))
    .sort(
      (left, right) =>
        repositoryPath(right)!.length - repositoryPath(left)!.length ||
        left.id.localeCompare(right.id),
    );
  for (const repository of repositories) {
    const root = repositoryPath(repository)!,
      processes = inputs.filter((input) => {
        const cwd = text(input.attributes.cwd);
        return (
          input.kind === "process" &&
          active(input) &&
          Boolean(cwd && (cwd === root || cwd.startsWith(`${root}/`)))
        );
      }),
      deployments = [...candidates.values()].filter(
        (candidate) =>
          candidate.anchor.startsWith("deployment:") &&
          [...candidate.members].some(
            (id) => repositoryPath(byId.get(id)!) === root,
          ),
      );
    if (deployments.length > 1) {
      conflicts.push({
        id: worldId(
          repository.contextId,
          "atlas.resolver.v2",
          "identity-conflict",
          `${root}:${deployments.map((value) => value.anchor).sort().join(":")}`,
        ),
        inputIds: [repository.id, ...processes.map((value) => value.id)].sort(),
        anchors: deployments.map((value) => value.anchor).sort(),
        reason: "Multiple managed deployments claim the same repository identity.",
      });
      continue;
    }
    if (deployments.length === 1) {
      deployments[0].members.add(repository.id);
      for (const process of processes) deployments[0].members.add(process.id);
    } else if (processes.length) {
      add({
        contextId: repository.contextId,
        anchor: `repository:${root}`,
        label: repository.label,
        score: 90,
        region: "applications",
        visibility: "primary",
        members: new Set([repository.id, ...processes.map((value) => value.id)]),
        healthHint: processes.some(failed) ? "critical" : undefined,
      });
    }
  }

  const groupsFor = (id: string) =>
    [...candidates.values()].filter((candidate) => candidate.members.has(id));
  for (const service of inputs.filter(
    (input) => input.kind === "service" && active(input),
  )) {
    const unit = text(service.attributes.systemdUnit);
    if (!unit) continue;
    const processes = inputs.filter(
      (input) =>
        input.kind === "process" &&
        active(input) &&
        text(input.attributes.systemdUnit) === unit,
    );
    if (!processes.length) continue;
    const owners = [
      ...new Set(processes.flatMap((process) => groupsFor(process.id))),
    ];
    if (owners.length === 1) {
      owners[0].members.add(service.id);
      for (const process of processes) owners[0].members.add(process.id);
    } else if (!owners.length) {
      add({
        contextId: service.contextId,
        anchor: `systemd:${unit}`,
        label: service.label,
        score: 75,
        region: "system",
        visibility:
          service.attributes.userOwned === true ? "primary" : "collapsed",
        members: new Set([service.id, ...processes.map((value) => value.id)]),
        healthHint: failed(service) ? "critical" : undefined,
      });
    }
  }

  const promoted = [...candidates.values()]
      .filter((candidate) => candidate.score >= 75)
      .sort((left, right) => left.anchor.localeCompare(right.anchor)),
    mapping: Record<string, string> = {},
    workloads: ResolvedWorkload[] = promoted.map((candidate) => {
      const id = worldId(
        candidate.contextId,
        "atlas.resolver.v2",
        "workload",
        candidate.anchor,
      );
      for (const memberId of candidate.members) mapping[memberId] = id;
      return {
        id,
        label: candidate.label,
        anchor: candidate.anchor,
        memberIds: [...candidate.members].sort(),
        region: candidate.region,
        visibility: candidate.visibility,
        ...(candidate.healthHint ? { healthHint: candidate.healthHint } : {}),
        confidence: candidate.score / 100,
      };
    }),
    unresolved: ResolvedWorld["unresolved"] = [],
    aggregates = { system: 0, inactive: 0, unknown: 0 };

  for (const input of inputs) {
    if (mapping[input.id]) continue;
    const bucket =
      input.kind === "service" && inactive(input)
        ? "inactive"
        : input.kind === "service" && active(input)
          ? "system"
          : "unknown";
    aggregates[bucket] += 1;
    unresolved.push({
      inputId: input.id,
      bucket,
      reason:
        bucket === "inactive"
          ? "Inactive service inventory is retained as evidence."
          : bucket === "system"
            ? "Active system inventory lacks an owned runtime identity."
            : "No strong workload identity signal was observed.",
    });
  }
  aggregates.system += workloads.filter(
    (workload) =>
      workload.visibility === "collapsed" && workload.region === "system",
  ).length;

  return { workloads, mapping, aggregates, conflicts, unresolved };
}
