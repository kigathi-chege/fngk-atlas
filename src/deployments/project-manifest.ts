export const PROJECT_MANIFEST_PROTOCOL = "fngk.project.v1" as const;
export const PROJECT_MANIFEST_PROTOCOL_V2 = "fngk.project.v2" as const;
export type RestartPolicy = "never" | "on-failure" | "always";
export interface ProjectManifest {
  protocolVersion: typeof PROJECT_MANIFEST_PROTOCOL;
  name: string;
  commands: { install?: string; build?: string; start: string };
  port: number;
  health: { protocol: "http" | "tcp"; path: string; timeoutMs: number };
  artifacts: Array<{ path: string; kind: string }>;
  restartPolicy: RestartPolicy;
  environments: Record<
    string,
    { variables: Record<string, string>; secretReferences: string[] }
  >;
  routes: Array<{ name: string; hostname?: string }>;
}
export type RuntimeManager =
  "pm2" | "supervisor" | "systemd" | "docker" | "fngk-native";
export type RoleKind =
  "application" | "worker" | "scheduler" | "migration" | "one-shot";
export type PhaseKind =
  | "preflight"
  | "acquire"
  | "prepare"
  | "install"
  | "build"
  | "migrate"
  | "provision"
  | "activate"
  | "health"
  | "publish"
  | "drain"
  | "post-deploy"
  | "artifacts"
  | "cleanup";
export interface ProjectManifestV2 {
  protocolVersion: typeof PROJECT_MANIFEST_PROTOCOL_V2;
  name: string;
  adapter: { id: string; version: string };
  workspace?: string;
  roles: Array<{
    id: string;
    kind: RoleKind;
    command: string;
    arguments?: string[];
    cwd?: string;
    instances?: number;
    runtime: {
      manager: RuntimeManager;
      durability: "supervised" | "ephemeral";
      restartPolicy: RestartPolicy;
    };
  }>;
  phases: Array<{
    id: string;
    kind: PhaseKind;
    command?: string;
    timeoutMs: number;
    rollbackCommand?: string;
  }>;
  ports: Array<{ name: string; port: number; protocol: "http" | "tcp" }>;
  health: {
    readiness: { protocol: "http" | "tcp"; path: string; timeoutMs: number };
    liveness?: { protocol: "http" | "tcp"; path: string; timeoutMs: number };
    shutdownSignal?: "SIGINT" | "SIGTERM";
    drainTimeoutMs?: number;
  };
  environments: Record<
    string,
    { variables: Record<string, string>; secretReferences: string[] }
  >;
  routes: Array<{ name: string; hostname?: string }>;
  artifacts: Array<{ path: string; kind: string }>;
  storage: Array<{
    name: string;
    kind: "directory" | "volume" | "object";
    target: string;
    durable: boolean;
    deletionProtection: boolean;
  }>;
  resources: Array<{ name: string; kind: string; required: boolean }>;
  retention: {
    successfulReleases: number;
    failedReleaseDays: number;
    logDays: number;
  };
}

const record = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
const text = (value: unknown, label: string, max: number) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(
      `${label} is required and must not exceed ${max} characters.`
    );
  return value.trim();
};
const identifier = (value: unknown, label: string) => {
  const result = text(value, label, 100);
  if (!/^[a-zA-Z][\w.-]{0,99}$/.test(result))
    throw new Error(`${label} must be a bounded identifier.`);
  return result;
};
const relativePath = (value: unknown, label: string) => {
  const result = text(value, label, 2000);
  if (result.startsWith("/") || result.split(/[\\/]/).includes(".."))
    throw new Error(`${label} must remain inside the release directory.`);
  return result;
};
const boundedInteger = (
  value: unknown,
  label: string,
  min: number,
  max: number
) => {
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max)
    throw new Error(`${label} must be between ${min} and ${max}.`);
  return result;
};

export function parseProjectManifest(value: unknown): ProjectManifest {
  const input = record(value);
  if (input.protocolVersion !== PROJECT_MANIFEST_PROTOCOL)
    throw new Error(`protocolVersion must be ${PROJECT_MANIFEST_PROTOCOL}.`);
  const commands = record(input.commands),
    start = text(commands.start, "commands.start", 8192),
    port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("port must be between 1 and 65535.");
  const healthInput = record(input.health),
    protocol = healthInput.protocol ?? "http";
  if (!["http", "tcp"].includes(protocol))
    throw new Error("health.protocol must be http or tcp.");
  const healthPath = healthInput.path ?? "/";
  if (
    typeof healthPath !== "string" ||
    !healthPath.startsWith("/") ||
    healthPath.length > 1000
  )
    throw new Error("health.path must be a bounded absolute URL path.");
  const timeoutMs = Number(healthInput.timeoutMs ?? 30_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000)
    throw new Error("health.timeoutMs must be between 1000 and 300000.");
  const artifacts = (Array.isArray(input.artifacts) ? input.artifacts : []).map(
    (raw: any) => {
      const item = record(raw),
        artifactPath = text(item.path, "artifact path", 2000);
      if (
        artifactPath.startsWith("/") ||
        artifactPath.split(/[\\/]/).includes("..")
      )
        throw new Error(
          "artifact path must remain inside the release directory."
        );
      return {
        path: artifactPath,
        kind: text(item.kind, "artifact kind", 100)
      };
    }
  );
  if (artifacts.length > 100)
    throw new Error("artifacts must contain at most 100 entries.");
  const environments: ProjectManifest["environments"] = {};
  for (const [name, raw] of Object.entries(record(input.environments))) {
    if (!/^[a-zA-Z][\w.-]{0,63}$/.test(name))
      throw new Error("environment names must be bounded identifiers.");
    const item = record(raw),
      variables: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(record(item.variables))) {
      if (
        /secret|password|token|credential|private[_-]?key|database_url/i.test(
          key
        )
      )
        throw new Error(
          `${key} must use a secret reference instead of an inline value.`
        );
      if (typeof rawValue !== "string" || rawValue.length > 4000)
        throw new Error(
          `environment variable ${key} must be a bounded string.`
        );
      variables[key] = rawValue;
    }
    const secretReferences = Array.isArray(item.secretReferences)
      ? item.secretReferences.map((entry: unknown) =>
          text(entry, "secret reference", 200)
        )
      : [];
    environments[name] = {
      variables,
      secretReferences: [...new Set(secretReferences)]
    };
  }
  const routes = (Array.isArray(input.routes) ? input.routes : []).map(
    (raw: any) => {
      const item = record(raw),
        hostname =
          item.hostname === undefined
            ? undefined
            : text(item.hostname, "route hostname", 253);
      if (hostname && !/^[a-z0-9.-]+$/i.test(hostname))
        throw new Error("route hostname is invalid.");
      return {
        name: text(item.name, "route name", 100),
        ...(hostname ? { hostname } : {})
      };
    }
  );
  if (routes.length > 20)
    throw new Error("routes must contain at most 20 entries.");
  const restartPolicy = input.restartPolicy ?? "on-failure";
  if (!["never", "on-failure", "always"].includes(restartPolicy))
    throw new Error("restartPolicy is invalid.");
  return {
    protocolVersion: PROJECT_MANIFEST_PROTOCOL,
    name: text(input.name, "name", 100),
    commands: {
      ...(commands.install
        ? { install: text(commands.install, "commands.install", 8192) }
        : {}),
      ...(commands.build
        ? { build: text(commands.build, "commands.build", 8192) }
        : {}),
      start
    },
    port,
    health: { protocol, path: healthPath, timeoutMs },
    artifacts,
    restartPolicy,
    environments,
    routes
  };
}

function normalizeEnvironmentMap(
  value: unknown
): ProjectManifestV2["environments"] {
  const environments: ProjectManifestV2["environments"] = {};
  for (const [name, raw] of Object.entries(record(value))) {
    identifier(name, "environment name");
    const item = record(raw),
      variables: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(record(item.variables))) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
        throw new Error(`environment variable ${key} is invalid.`);
      if (
        /secret|password|token|credential|private[_-]?key|database_url/i.test(
          key
        )
      )
        throw new Error(
          `${key} must use a secret reference instead of an inline value.`
        );
      if (typeof rawValue !== "string" || rawValue.length > 4000)
        throw new Error(
          `environment variable ${key} must be a bounded string.`
        );
      variables[key] = rawValue;
    }
    const secretReferences = Array.isArray(item.secretReferences)
      ? item.secretReferences.map((entry: unknown) =>
          text(entry, "secret reference", 200)
        )
      : [];
    environments[name] = {
      variables,
      secretReferences: [...new Set(secretReferences)]
    };
  }
  return environments;
}

export function parseProjectManifestV2(value: unknown): ProjectManifestV2 {
  const input = record(value);
  if (input.protocolVersion === PROJECT_MANIFEST_PROTOCOL)
    return upgradeProjectManifest(input);
  if (input.protocolVersion !== PROJECT_MANIFEST_PROTOCOL_V2)
    throw new Error(`protocolVersion must be ${PROJECT_MANIFEST_PROTOCOL_V2}.`);
  const adapter = record(input.adapter),
    managerValues: RuntimeManager[] = [
      "pm2",
      "supervisor",
      "systemd",
      "docker",
      "fngk-native"
    ],
    roleKinds: RoleKind[] = [
      "application",
      "worker",
      "scheduler",
      "migration",
      "one-shot"
    ],
    phaseKinds: PhaseKind[] = [
      "preflight",
      "acquire",
      "prepare",
      "install",
      "build",
      "migrate",
      "provision",
      "activate",
      "health",
      "publish",
      "drain",
      "post-deploy",
      "artifacts",
      "cleanup"
    ];
  const roles = (Array.isArray(input.roles) ? input.roles : []).map(
    (raw: unknown) => {
      const item = record(raw),
        runtime = record(item.runtime),
        kind = item.kind as RoleKind,
        manager = runtime.manager as RuntimeManager,
        durability = runtime.durability,
        restartPolicy = runtime.restartPolicy as RestartPolicy;
      if (!roleKinds.includes(kind)) throw new Error("role kind is invalid.");
      if (!managerValues.includes(manager))
        throw new Error("runtime manager is invalid.");
      if (!["supervised", "ephemeral"].includes(durability))
        throw new Error("runtime durability is invalid.");
      if (!["never", "on-failure", "always"].includes(restartPolicy))
        throw new Error("runtime restart policy is invalid.");
      const cwd =
          item.cwd === undefined
            ? undefined
            : relativePath(item.cwd, "role working directory"),
        args =
          item.arguments === undefined
            ? undefined
            : Array.isArray(item.arguments)
              ? item.arguments.map((arg: unknown) =>
                  text(arg, "role argument", 4000)
                )
              : (() => {
                  throw new Error("role arguments must be an array.");
                })();
      return {
        id: identifier(item.id, "role id"),
        kind,
        command: text(item.command, "role command", 8192),
        ...(args ? { arguments: args } : {}),
        ...(cwd ? { cwd } : {}),
        ...(item.instances === undefined
          ? {}
          : {
              instances: boundedInteger(
                item.instances,
                "role instances",
                1,
                1000
              )
            }),
        runtime: { manager, durability, restartPolicy }
      };
    }
  );
  if (!roles.length || roles.length > 100)
    throw new Error("roles must contain between 1 and 100 entries.");
  if (new Set(roles.map(role => role.id)).size !== roles.length)
    throw new Error("role ids must be unique.");
  const phases = (Array.isArray(input.phases) ? input.phases : []).map(
    (raw: unknown) => {
      const item = record(raw),
        kind = item.kind as PhaseKind;
      if (!phaseKinds.includes(kind)) throw new Error("phase kind is invalid.");
      return {
        id: identifier(item.id, "phase id"),
        kind,
        ...(item.command === undefined
          ? {}
          : { command: text(item.command, "phase command", 8192) }),
        timeoutMs: boundedInteger(
          item.timeoutMs,
          "phase timeoutMs",
          1000,
          3_600_000
        ),
        ...(item.rollbackCommand === undefined
          ? {}
          : {
              rollbackCommand: text(
                item.rollbackCommand,
                "phase rollbackCommand",
                8192
              )
            })
      };
    }
  );
  if (!phases.length || phases.length > 100)
    throw new Error("phases must contain between 1 and 100 entries.");
  if (new Set(phases.map(phase => phase.id)).size !== phases.length)
    throw new Error("phase ids must be unique.");
  const ports = (Array.isArray(input.ports) ? input.ports : []).map(
    (raw: unknown) => {
      const item = record(raw),
        protocol = item.protocol as "http" | "tcp";
      if (!["http", "tcp"].includes(protocol))
        throw new Error("port protocol must be http or tcp.");
      return {
        name: identifier(item.name, "port name"),
        port: boundedInteger(item.port, "port", 1, 65535),
        protocol
      };
    }
  );
  if (ports.length > 50)
    throw new Error("ports must contain at most 50 entries.");
  const check = (raw: unknown, label: string) => {
    const item = record(raw),
      protocol = item.protocol as "http" | "tcp";
    if (!["http", "tcp"].includes(protocol))
      throw new Error(`${label}.protocol must be http or tcp.`);
    const path = item.path ?? "/";
    if (typeof path !== "string" || !path.startsWith("/") || path.length > 1000)
      throw new Error(`${label}.path must be a bounded absolute URL path.`);
    return {
      protocol,
      path,
      timeoutMs: boundedInteger(
        item.timeoutMs,
        `${label}.timeoutMs`,
        1000,
        300_000
      )
    };
  };
  const healthInput = record(input.health),
    readiness = check(healthInput.readiness, "health.readiness"),
    liveness =
      healthInput.liveness === undefined
        ? undefined
        : check(healthInput.liveness, "health.liveness"),
    shutdownSignal = healthInput.shutdownSignal;
  if (
    shutdownSignal !== undefined &&
    !["SIGINT", "SIGTERM"].includes(shutdownSignal)
  )
    throw new Error("health.shutdownSignal is invalid.");
  const routes = (Array.isArray(input.routes) ? input.routes : []).map(
    (raw: unknown) => {
      const item = record(raw),
        hostname =
          item.hostname === undefined
            ? undefined
            : text(item.hostname, "route hostname", 253);
      if (hostname && !/^[a-z0-9.-]+$/i.test(hostname))
        throw new Error("route hostname is invalid.");
      return {
        name: identifier(item.name, "route name"),
        ...(hostname ? { hostname } : {})
      };
    }
  );
  if (routes.length > 20)
    throw new Error("routes must contain at most 20 entries.");
  const artifacts = (Array.isArray(input.artifacts) ? input.artifacts : []).map(
    (raw: unknown) => {
      const item = record(raw);
      return {
        path: relativePath(item.path, "artifact path"),
        kind: text(item.kind, "artifact kind", 100)
      };
    }
  );
  if (artifacts.length > 100)
    throw new Error("artifacts must contain at most 100 entries.");
  const storage = (Array.isArray(input.storage) ? input.storage : []).map(
    (raw: unknown) => {
      const item = record(raw),
        kind = item.kind as "directory" | "volume" | "object";
      if (!["directory", "volume", "object"].includes(kind))
        throw new Error("storage kind is invalid.");
      return {
        name: identifier(item.name, "storage name"),
        kind,
        target: text(item.target, "storage target", 2000),
        durable: item.durable === true,
        deletionProtection: item.deletionProtection === true
      };
    }
  );
  const resources = (Array.isArray(input.resources) ? input.resources : []).map(
      (raw: unknown) => {
        const item = record(raw);
        return {
          name: identifier(item.name, "resource name"),
          kind: identifier(item.kind, "resource kind"),
          required: item.required !== false
        };
      }
    ),
    retention = record(input.retention);
  return {
    protocolVersion: PROJECT_MANIFEST_PROTOCOL_V2,
    name: text(input.name, "name", 100),
    adapter: {
      id: identifier(adapter.id, "adapter id"),
      version: text(adapter.version, "adapter version", 100)
    },
    ...(input.workspace === undefined
      ? {}
      : { workspace: relativePath(input.workspace, "workspace") }),
    roles,
    phases,
    ports,
    health: {
      readiness,
      ...(liveness ? { liveness } : {}),
      ...(shutdownSignal ? { shutdownSignal } : {}),
      ...(healthInput.drainTimeoutMs === undefined
        ? {}
        : {
            drainTimeoutMs: boundedInteger(
              healthInput.drainTimeoutMs,
              "health.drainTimeoutMs",
              0,
              300_000
            )
          })
    },
    environments: normalizeEnvironmentMap(input.environments),
    routes,
    artifacts,
    storage,
    resources,
    retention: {
      successfulReleases: boundedInteger(
        retention.successfulReleases,
        "retention.successfulReleases",
        1,
        100
      ),
      failedReleaseDays: boundedInteger(
        retention.failedReleaseDays,
        "retention.failedReleaseDays",
        1,
        3650
      ),
      logDays: boundedInteger(retention.logDays, "retention.logDays", 1, 3650)
    }
  };
}

export function upgradeProjectManifest(value: unknown): ProjectManifestV2 {
  const legacy = parseProjectManifest(value),
    phases: ProjectManifestV2["phases"] = [];
  if (legacy.commands.install)
    phases.push({
      id: "install",
      kind: "install",
      command: legacy.commands.install,
      timeoutMs: 900_000
    });
  if (legacy.commands.build)
    phases.push({
      id: "build",
      kind: "build",
      command: legacy.commands.build,
      timeoutMs: 900_000
    });
  phases.push({ id: "activate", kind: "activate", timeoutMs: 300_000 });
  return {
    protocolVersion: PROJECT_MANIFEST_PROTOCOL_V2,
    name: legacy.name,
    adapter: { id: "fngk.legacy-project", version: "1" },
    roles: [
      {
        id: "web",
        kind: "application",
        command: legacy.commands.start,
        runtime: {
          manager: "fngk-native",
          durability: "ephemeral",
          restartPolicy: legacy.restartPolicy
        }
      }
    ],
    phases,
    ports: [
      { name: "web", port: legacy.port, protocol: legacy.health.protocol }
    ],
    health: {
      readiness: legacy.health,
      shutdownSignal: "SIGTERM",
      drainTimeoutMs: 10_000
    },
    environments: legacy.environments,
    routes: legacy.routes,
    artifacts: legacy.artifacts,
    storage: [],
    resources: [],
    retention: { successfulReleases: 5, failedReleaseDays: 7, logDays: 7 }
  };
}
