import type {
  AtlasAssertion,
  AtlasEntity,
  InterpreterInput,
  InterpreterManifest,
  InterpreterOutput,
} from "./types.js";
import { ATLAS_INTERPRETER_VERSION, ATLAS_WORLD_VERSION } from "./types.js";
import { worldId } from "./interpreter.js";

export interface SpecialistContext {
  workload: AtlasEntity;
  members: InterpreterInput[];
  relationships: AtlasAssertion[];
}
type Specialist = {
  manifest: InterpreterManifest;
  matches: (
    context: SpecialistContext,
    text: string,
  ) => Array<{ capability: string; confidence: number; explanation: string }>;
};
const manifest = (id: string, name: string): InterpreterManifest => ({
  protocolVersion: ATLAS_INTERPRETER_VERSION,
  ontologyVersion: ATLAS_WORLD_VERSION,
  id,
  version: "1.0.0",
  publisher: "atlas",
  displayName: name,
  inputs: ["workload"],
  outputKinds: ["capability"],
  outputPredicates: ["provides-capability"],
  rules: [],
});
export const BUILTIN_SPECIALISTS: Specialist[] = [
  {
    manifest: manifest("atlas.specialist.postgresql", "PostgreSQL specialist"),
    matches: (_context, text) =>
      /\bpostgres(?:ql)?\b/.test(text)
        ? [
            {
              capability: "relational-storage",
              confidence: 0.99,
              explanation:
                "Explicit PostgreSQL process, service, package, or engine evidence identifies relational storage.",
            },
          ]
        : [],
  },
  {
    manifest: manifest(
      "atlas.specialist.docker",
      "Docker/containerd specialist",
    ),
    matches: (_context, text) =>
      /\b(dockerd|docker\.service|containerd(?:\.service)?)\b/.test(text)
        ? [
            {
              capability: "container-orchestration",
              confidence: 0.96,
              explanation:
                "Explicit Docker or containerd daemon evidence identifies container orchestration.",
            },
          ]
        : [],
  },
  {
    manifest: manifest(
      "atlas.specialist.node",
      "Node/SvelteKit/Fastify specialist",
    ),
    matches: (context, text) =>
      /\b(sveltekit|fastify|next\.js|express)\b/.test(text) ||
      context.members.some(
        (value) =>
          value.kind === "port" &&
          /https?/.test(String(value.attributes.protocol ?? "")),
      )
        ? [
            {
              capability: "http-serving",
              confidence: /\b(sveltekit|fastify|next\.js|express)\b/.test(text)
                ? 0.94
                : 0.82,
              explanation:
                "Framework or explicit HTTP listener evidence identifies HTTP serving.",
            },
          ]
        : [],
  },
  {
    manifest: manifest("atlas.specialist.signal", "Signal/FNGK specialist"),
    matches: (_context, text) =>
      /\b(signal|fngk)\b/.test(text)
        ? [
            {
              capability: "remote-machine-control",
              confidence: 0.97,
              explanation:
                "Explicit Signal or FNGK identity evidence identifies remote machine control.",
            },
          ]
        : [],
  },
];

export function runBuiltInSpecialists(
  resolved: { entities: AtlasEntity[]; assertions?: AtlasAssertion[]; mapping?: Record<string, string> },
  inputs: InterpreterInput[],
  at = new Date().toISOString(),
) {
  const byId = new Map(inputs.map((value) => [value.id, value])),
    outputs = new Map<string, InterpreterOutput>();
  for (const specialist of BUILTIN_SPECIALISTS)
    outputs.set(specialist.manifest.id, {
      entities: [],
      assertions: [],
      views: [],
    });
  for (const workload of resolved.entities.filter(
    (value) => value.kind === "workload",
  )) {
    const members = (
        (workload.attributes.memberObservationIds as string[] | undefined) ?? []
      )
        .map((id) => byId.get(id))
        .filter(Boolean) as InterpreterInput[],
      context: SpecialistContext = {
        workload,
        members,
        relationships: (resolved.assertions ?? []).filter(
          (assertion) =>
            assertion.subjectId === workload.id ||
            assertion.objectId === workload.id,
        ),
      },
      text =
        `${workload.label} ${workload.aliases.join(" ")} ${members.map((value) => `${value.label} ${JSON.stringify(value.attributes)}`).join(" ")}`.toLowerCase();
    for (const specialist of BUILTIN_SPECIALISTS) {
      const output = outputs.get(specialist.manifest.id)!;
      for (const match of specialist.matches(context, text)) {
        const capabilityId = worldId(
          workload.contextId,
          specialist.manifest.id,
          "capability",
          match.capability,
        );
        if (!output.entities.some((value) => value.id === capabilityId))
          output.entities.push({
            id: capabilityId,
            contextId: workload.contextId,
            kind: "capability",
            namespace: specialist.manifest.id,
            label: match.capability,
            aliases: [],
            attributes: { specialist: specialist.manifest.id },
            firstObservedAt: workload.firstObservedAt,
            lastObservedAt: workload.lastObservedAt,
            stale: workload.stale,
          });
        const evidence = members.map((value) => ({
          observationId: value.id,
          method: value.source,
        }));
        const assertion: AtlasAssertion = {
          id: worldId(
            workload.contextId,
            specialist.manifest.id,
            "assertion",
            `${workload.id}:${match.capability}`,
          ),
          contextId: workload.contextId,
          subjectId: workload.id,
          predicate: "provides-capability",
          objectId: capabilityId,
          classification: "derived",
          confidence: match.confidence,
          explanation: match.explanation,
          evidence,
          interpreterId: specialist.manifest.id,
          interpreterVersion: specialist.manifest.version,
          observedAt: workload.lastObservedAt,
          derivedAt: at,
          stale: workload.stale,
        };
        output.assertions.push(assertion);
      }
    }
  }
  return BUILTIN_SPECIALISTS.map((specialist) => ({
    manifest: specialist.manifest,
    output: outputs.get(specialist.manifest.id)!,
  }));
}
