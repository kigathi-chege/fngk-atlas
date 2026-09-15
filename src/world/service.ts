import {
  ATLAS_INTERPRETER_VERSION,
  ATLAS_WORLD_VERSION,
  type AtlasAssertion,
  type AtlasEntity,
  type AtlasObservation,
  type InterpreterInput,
  type InterpreterManifest,
  type InterpreterOutput,
} from "./types.js";
import { runInterpreter, workloadInterpreter, worldId } from "./interpreter.js";
import { resolveWorkloads } from "./resolver.js";
import { projectWorld } from "./projector.js";
import { WorldStore } from "./store.js";
import type { RegisteredInterpreter } from "./registry.js";
import { adaptWorldObservations } from "./observation-adapters.js";
import { runBuiltInSpecialists } from "./specialists.js";
import { normalizePredicate } from "./relationships.js";

const kindMap: Record<string, string> = {
  filesystem: "data-store",
  endpoint: "http-endpoint",
  external: "external-system",
  flow: "resource",
  coverage: "resource",
  command: "operation",
  terminal: "operation",
  output: "event",
};
const legacyManifest: InterpreterManifest = {
  protocolVersion: ATLAS_INTERPRETER_VERSION,
  ontologyVersion: ATLAS_WORLD_VERSION,
  id: "atlas.compatibility",
  version: "1.0.0",
  publisher: "atlas",
  displayName: "Atlas compatibility interpreter",
  inputs: ["*"],
  outputKinds: [],
  outputPredicates: [],
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
      deviceId = worldId(contextId, "atlas.core", "device", contextId),
      observations: AtlasObservation[] = adaptWorldObservations(
        contextId,
        nodes,
        edges,
        device,
        at,
      );
    this.store.putObservations(observations);
    const sourceNodes = nodes.slice(0, 10000),
      mapped = new Map<string, string>(),
      entities: AtlasEntity[] = [
        {
          id: deviceId,
          contextId,
          kind: "device",
          namespace: "atlas.core",
          label:
            device?.name ??
            (contextId === "local"
              ? "Atlas process host"
              : contextId.replace(/^device:/, "")),
          aliases: [contextId],
          attributes: {
            online: device?.online ?? true,
            sourceId: device?.id ?? contextId,
          },
          firstObservedAt: at,
          lastObservedAt: at,
          stale: device?.online === false,
        },
      ],
      assertions: AtlasAssertion[] = [];
    for (const node of sourceNodes) {
      const kind =
        kindMap[String(node.type)] ?? String(node.type ?? "resource");
      mapped.set(
        String(node.id),
        worldId(contextId, legacyManifest.id, kind, String(node.id)),
      );
    }
    for (const node of sourceNodes) {
      const kind =
          kindMap[String(node.type)] ?? String(node.type ?? "resource"),
        id = mapped.get(String(node.id))!;
      entities.push({
        id,
        contextId,
        kind,
        namespace: legacyManifest.id,
        label: String(node.label ?? node.name ?? node.id),
        aliases: [
          String(node.qualifiedName ?? ""),
          String(node.path ?? ""),
        ].filter(Boolean),
        parentId: node.parent ? mapped.get(String(node.parent)) : undefined,
        attributes: { ...node, legacyId: node.id },
        firstObservedAt: String(node.observedAt ?? at),
        lastObservedAt: String(node.observedAt ?? at),
        stale: Boolean(node.stale),
      });
      assertions.push(
        this.assertion(contextId, deviceId, "contains", id, node, at),
      );
    }
    for (const edge of edges.slice(0, 20000)) {
      const source = mapped.get(String(edge.source)),
        target = mapped.get(String(edge.target));
      if (source && target)
        assertions.push(
          this.assertion(
            contextId,
            source,
            normalizePredicate(String(edge.type ?? "related-to")),
            target,
            edge,
            at,
          ),
        );
    }
    const compatibility: InterpreterOutput = {
      entities,
      assertions,
      views: [
        {
          id: "atlas.core.evidence",
          title: "Evidence",
          appliesTo: ["*"],
          priority: 0,
          sections: [
            { kind: "properties", title: "Identity" },
            { kind: "relationships", title: "Relationships" },
            { kind: "evidence", title: "Why Atlas believes this" },
            { kind: "timeline", title: "Recent changes" },
          ],
        },
      ],
    };
    this.store.register(legacyManifest);
    const inputs: InterpreterInput[] = observations
      .filter(
        (value) => value.kind !== "relationship" && value.kind !== "device",
      )
      .map((value) => ({
        id: value.id,
        contextId,
        kind: value.kind,
        label: String(value.facts.label ?? value.sourceId),
        attributes: { ...value.facts, legacyId: value.sourceId },
        observedAt: value.observedAt,
        stale: Boolean((value.facts as any).stale),
        source: value.source,
      }));
    const semantic = resolveWorkloads(inputs, () => at);
    semantic.assertions = semantic.assertions.filter(
      (value) => value.predicate !== "realized-by",
    );
    for (const entity of semantic.entities)
      if (entity.kind === "workload") {
        entity.parentId = deviceId;
        const contained = this.assertion(
          contextId,
          deviceId,
          "contains",
          entity.id,
          { source: "atlas.resolver" },
          at,
          "derived",
          0.9,
          "The workload was resolved from observations on this Device.",
        );
        contained.interpreterId = "atlas.resolver";
        contained.interpreterVersion = "1.1.0";
        semantic.assertions.push(contained);
        for (const inputId of entity.attributes
          .memberObservationIds as string[]) {
          const source = inputs.find((value) => value.id === inputId),
            realized =
              source && mapped.get(String(source.attributes.legacyId ?? ""));
          if (realized) {
            const technical = entities.find((value) => value.id === realized);
            if (technical) technical.workloadId = entity.id;
            const predicate =
                source.kind === "repository"
                  ? "implemented-by"
                  : source.kind === "port" ||
                      source.kind === "socket" ||
                      source.kind === "interface"
                    ? "listens-on"
                    : source.kind === "service"
                      ? "controlled-by"
                      : "realized-by",
              explanation =
                predicate === "implemented-by"
                  ? "Repository identity and runtime correlation connect this software to the workload."
                  : predicate === "listens-on"
                    ? "Listener ownership evidence connects this interface to the workload."
                    : predicate === "controlled-by"
                      ? "Service ownership evidence identifies the workload control unit."
                      : "The resolved workload is realized by this observed technical entity.",
              realization = this.assertion(
                contextId,
                entity.id,
                predicate,
                realized,
                { id: inputId, source: "atlas.resolver" },
                at,
                "derived",
                0.92,
                explanation,
              );
            realization.interpreterId = "atlas.resolver";
            realization.interpreterVersion = "1.1.0";
            semantic.assertions.push(realization);
          }
        }
      }
    this.store.register(workloadInterpreter);
    const resolverManifest = {
      ...workloadInterpreter,
      id: "atlas.resolver",
      version: "1.1.0",
      displayName: "Atlas workload resolver",
    };
    this.store.register(resolverManifest);
    this.store.sync(contextId, legacyManifest, {
      entities,
      assertions,
      views: compatibility.views,
    });
    this.store.sync(contextId, resolverManifest, semantic);
    for (const specialist of runBuiltInSpecialists(semantic, inputs, at)) {
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
  private assertion(
    contextId: string,
    subjectId: string,
    predicate: string,
    objectId: string,
    evidence: any,
    at: string,
    classification: AtlasAssertion["classification"] = "observed",
    confidence = 0.95,
    explanation = "Existing Atlas evidence directly supports this relationship.",
  ): AtlasAssertion {
    const id = worldId(
      contextId,
      "atlas.compatibility",
      "assertion",
      `${subjectId}:${predicate}:${objectId}`,
    );
    return {
      id,
      contextId,
      subjectId,
      predicate,
      objectId,
      classification,
      confidence,
      explanation,
      evidence: [
        {
          observationId: String(evidence.id ?? evidence.source ?? objectId),
          method: "atlas-existing-evidence",
        },
      ],
      interpreterId: "atlas.compatibility",
      interpreterVersion: "1.0.0",
      observedAt: String(evidence.observedAt ?? at),
      derivedAt: at,
      stale: Boolean(evidence.stale),
    };
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
