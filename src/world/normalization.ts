import type { AtlasObservation, InterpreterInput } from "./types.js";

const aliases = {
  activeState: ["activeState", "active"],
  subState: ["subState", "state"],
  repositoryPath: ["repositoryPath", "root", "path"],
} as const;
const safeKeys = [
  "pid",
  "ppid",
  "cwd",
  "systemdUnit",
  "containerId",
  "protocol",
  "address",
  "routeId",
  "environment",
  "managedDeploymentId",
] as const;
const numericKeys = [
  "cpuPercent",
  "rssBytes",
  "elapsedSeconds",
  "memoryUtilization",
  "restartCount",
] as const;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const candidate = (
  facts: Record<string, unknown>,
  metadata: Record<string, unknown>,
  names: readonly string[],
) => {
  for (const source of [facts, metadata])
    for (const name of names)
      if (source[name] !== undefined) return source[name];
};
const safeString = (value: unknown) =>
  typeof value === "string" && value.trim() && value.length <= 4096
    ? value
    : undefined;
const nonNegative = (value: unknown) => {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};
const nonNegativeInteger = (value: unknown) => {
  const number = nonNegative(value);
  return number !== undefined && Number.isInteger(number) ? number : undefined;
};

export function normalizeObservation(
  observation: AtlasObservation,
): InterpreterInput {
  const facts = record(observation.facts),
    metadata = record(facts.metadata),
    attributes: Record<string, unknown> = {};

  for (const key of safeKeys) {
    const value = candidate(facts, metadata, [key]);
    if (key === "pid" || key === "ppid") {
      const number = nonNegativeInteger(value);
      if (number !== undefined) attributes[key] = number;
    } else {
      const text = safeString(value);
      if (text !== undefined) attributes[key] = text;
    }
  }
  for (const [key, names] of Object.entries(aliases)) {
    const text = safeString(candidate(facts, metadata, names));
    if (text !== undefined) attributes[key] = text;
  }
  const portValue = candidate(facts, metadata, ["port"]),
    port =
      typeof portValue === "number" ||
      (typeof portValue === "string" && /^\d+$/.test(portValue))
        ? Number(portValue)
        : Number.NaN;
  if (Number.isInteger(port) && port >= 1 && port <= 65_535)
    attributes.port = port;
  for (const key of numericKeys) {
    const number =
      key === "cpuPercent" || key === "memoryUtilization"
        ? nonNegative(candidate(facts, metadata, [key]))
        : nonNegativeInteger(candidate(facts, metadata, [key]));
    if (number !== undefined) attributes[key] = number;
  }
  const processState = safeString(
    candidate(facts, metadata, ["processState"]),
  );
  if (processState !== undefined) attributes.processState = processState;
  const readiness = candidate(facts, metadata, ["readiness", "ready"]);
  if (typeof readiness === "boolean") attributes.readiness = readiness;
  else {
    const value = safeString(readiness);
    if (value !== undefined) attributes.readiness = value;
  }

  return {
    id: observation.id,
    contextId: observation.contextId,
    kind: observation.kind,
    label: safeString(facts.label) ?? observation.sourceId,
    attributes,
    observedAt: observation.observedAt,
    ...(typeof facts.stale === "boolean" ? { stale: facts.stale } : {}),
    source: observation.source,
  };
}
