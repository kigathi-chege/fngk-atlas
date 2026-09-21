import {
  ATLAS_INTERPRETER_VERSION,
  ATLAS_WORLD_VERSION,
  type AtlasObservation,
  type InterpreterInput,
  type InterpreterManifest,
  type InterpreterOutput,
} from "./types.js";
import { runInterpreter } from "./interpreter.js";
import { projectWorld } from "./projector.js";
import { WorldStore } from "./store.js";
import type { RegisteredInterpreter } from "./registry.js";
import { adaptWorldObservations } from "./observation-adapters.js";
import { runBuiltInSpecialists } from "./specialists.js";
import { CORE_PREDICATES } from "./relationships.js";
import { normalizeObservation } from "./normalization.js";
import { resolveOperationalWorld } from "./resolution-policy.js";
import { materializeWorld, RESOLVER_NAMESPACE } from "./materializer.js";

const resolverManifest: InterpreterManifest = {
  protocolVersion: ATLAS_INTERPRETER_VERSION,
  ontologyVersion: ATLAS_WORLD_VERSION,
  id: RESOLVER_NAMESPACE,
  version: "2.0.0",
  publisher: "atlas",
  displayName: "Atlas operational world resolver",
  inputs: ["*"],
  outputKinds: [
    "device",
    "topology-region",
    "workload",
    "service",
    "process",
    "container",
    "interface",
    "data-store",
    "repository",
    "event",
    "operation",
  ],
  outputPredicates: [...CORE_PREDICATES],
  rules: [],
};
export class WorldService {
  constructor(
    readonly store: WorldStore,
    readonly extensions: RegisteredInterpreter[] = [],
  ) {
    for (const item of extensions)
      this.store.register(item.manifest, item.trusted, item.source, item.error);
  }
  refresh(
    contextId: string,
    nodes: any[],
    edges: any[],
    device?: { id?: string; name?: string; online?: boolean },
  ) {
    const at = new Date().toISOString(),
      observedDevice = device ?? {
        id: contextId,
        name:
          contextId === "local"
            ? "Atlas process host"
            : contextId.replace(/^device:/, ""),
        online: true,
      },
      observations: AtlasObservation[] = adaptWorldObservations(
        contextId,
        nodes,
        edges,
        observedDevice,
        at,
      );
    this.store.putObservations(observations);
    const inputs: InterpreterInput[] = observations
      .filter(
        (value) => value.kind !== "relationship" && value.kind !== "device",
      )
      .map(normalizeObservation),
      resolved = resolveOperationalWorld(inputs, () => at),
      deviceObservation = observations.find((value) => value.kind === "device")!,
      semantic = materializeWorld(
        contextId,
        {
          id: observedDevice.id,
          label: observedDevice.name ?? contextId,
          online: observedDevice.online ?? true,
          observationId: deviceObservation.id,
          observedAt: deviceObservation.observedAt,
        },
        resolved,
        inputs,
        () => at,
      );
    this.store.register(resolverManifest);
    this.store.sync(contextId, resolverManifest, semantic);
    for (const specialist of runBuiltInSpecialists(
      { entities: semantic.entities, assertions: semantic.assertions, mapping: resolved.mapping },
      inputs,
      at,
    )) {
      this.store.register(specialist.manifest);
      this.store.sync(contextId, specialist.manifest, specialist.output);
    }
    for (const item of this.extensions) {
      if (item.error) continue;
      try {
        this.store.sync(
          contextId,
          item.manifest,
          runInterpreter(item.manifest, inputs),
        );
      } catch (error) {
        this.store.register(
          item.manifest,
          item.trusted,
          item.source,
          (error as Error).message,
        );
      }
    }
  }
  ingest(
    manifest: InterpreterManifest,
    inputs: InterpreterInput[],
    output: InterpreterOutput,
  ) {
    this.store.putObservations(
      inputs.map((input) => ({
        id: input.id,
        contextId: input.contextId,
        kind: input.kind,
        source: input.source,
        sourceId: input.id,
        observedAt: input.observedAt,
        facts: { label: input.label, ...input.attributes },
        sensitivity: "safe-metadata",
      })),
    );
    this.store.register(manifest);
    for (const contextId of new Set(inputs.map((value) => value.contextId)))
      this.store.sync(contextId, manifest, {
        entities: output.entities.filter(
          (value) => value.contextId === contextId,
        ),
        assertions: output.assertions.filter(
          (value) => value.contextId === contextId,
        ),
        views: output.views,
      });
  }
  projection(contextId: string, options: Parameters<typeof projectWorld>[3]) {
    return projectWorld(
      contextId,
      this.store.entities(contextId),
      this.store.assertions(contextId),
      options,
    );
  }
}
