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
import { WorldStore, type WorldSample } from "./store.js";
import type { RegisteredInterpreter } from "./registry.js";
import { adaptWorldObservations } from "./observation-adapters.js";
import { runBuiltInSpecialists } from "./specialists.js";
import { CORE_PREDICATES } from "./relationships.js";
import { normalizeObservation } from "./normalization.js";
import { resolveOperationalWorld } from "./resolution-policy.js";
import { materializeWorld, RESOLVER_NAMESPACE } from "./materializer.js";
import {
  enrichFromLocalDocumentation,
  localDocumentationManifest,
} from "./enrichment.js";
import type { LocalDocumentation } from "./types.js";
import {applyCorrections,correctionId,validateCorrection,type AtlasCorrectionKind} from './corrections.js';

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
    this.store.beginRefresh();
    try {
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
    const documents: LocalDocumentation[] = inputs
      .filter(
        (input) =>
          typeof input.attributes.documentPath === "string" &&
          typeof input.attributes.documentText === "string" &&
          typeof input.attributes.repositoryPath === "string",
      )
      .map((input) => ({
        path: String(input.attributes.documentPath),
        repositoryPath: String(input.attributes.repositoryPath),
        sourceInputId: input.id,
        observationId: input.id,
        text: String(input.attributes.documentText),
      }));
    const enriched = semantic.entities
      .filter((entity) => entity.kind === "workload")
      .map((entity) =>
        enrichFromLocalDocumentation(entity, inputs, documents, () => at),
      );
    this.store.register(localDocumentationManifest);
    this.store.sync(contextId, localDocumentationManifest, {
      entities: enriched.flatMap((output) => output.entities),
      assertions: enriched.flatMap((output) => output.assertions),
      views: [],
    });
    const samples: WorldSample[] = [];
    for (const entity of semantic.entities.filter(
      (value) => value.kind === "workload",
    )) {
      for (const [metric, unit] of [
        ["cpuPercent", "percent"],
        ["rssBytes", "bytes"],
        ["memoryUtilization", "ratio"],
        ["restartCount", "count"],
      ] as const) {
        const value = entity.attributes[metric];
        if (typeof value === "number")
          samples.push({
            contextId,
            entityId: entity.id,
            metric,
            value,
            unit,
            observedAt: entity.lastObservedAt,
          });
      }
      if (entity.attributes.readiness !== undefined)
        samples.push({
          contextId,
          entityId: entity.id,
          metric: "readiness",
          value:
            entity.attributes.readiness === true ||
            ["ready", "healthy", "passing"].includes(
              String(entity.attributes.readiness).toLowerCase(),
            )
              ? 1
              : 0,
          unit: "boolean",
          observedAt: entity.lastObservedAt,
        });
    }
    this.store.putSamples(samples);
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
    this.store.completeRefresh(contextId);
    } catch(error) {
      this.store.abortRefresh(contextId,error);
      throw error;
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
    const corrected=applyCorrections(this.store.entities(contextId),this.store.assertions(contextId),this.store.corrections(contextId));
    return projectWorld(
      contextId,
      corrected.entities,
      corrected.assertions,
      options,
      {
        changes: this.store.timeline(contextId, undefined, 200),
        samples: this.store.samples(contextId),
      },
    );
  }
  corrections(contextId:string,subjectId?:string){return this.store.corrections(contextId,subjectId)}
  putCorrection(contextId:string,subjectId:string,kind:AtlasCorrectionKind,value:unknown){
    validateCorrection(contextId,subjectId,kind,value,this.store.entities(contextId));
    const at=new Date().toISOString(),id=correctionId(contextId,subjectId,kind),prior=this.store.corrections(contextId,subjectId).find(item=>item.kind===kind);
    this.store.putCorrection({id,contextId,subjectId,kind,value,createdAt:prior?.createdAt??at,updatedAt:at});
    return this.store.corrections(contextId,subjectId);
  }
  deleteCorrections(contextId:string,subjectId:string,kind?:AtlasCorrectionKind){
    if(this.store.entity(subjectId)?.entity?.contextId!==contextId)throw new Error('entity_not_found');
    return this.store.deleteCorrections(contextId,subjectId,kind);
  }
  detail(id:string){
    const raw=this.store.entity(id),synthetic=id.startsWith('workload:split:')?this.store.correctionById(id.slice('workload:split:'.length)):undefined,contextId=raw?.entity?.contextId??synthetic?.contextId;
    if(!contextId)return null;
    const corrected=applyCorrections(this.store.entities(contextId),this.store.assertions(contextId),this.store.corrections(contextId));
    const entity=corrected.entities.find(value=>value.id===id)??raw?.entity;
    if(!entity)return null;
    return {...raw,entity,assertions:corrected.assertions.filter(item=>item.subjectId===id||item.objectId===id),relatedEntities:corrected.entities.filter(value=>corrected.assertions.some(item=>(item.subjectId===id&&item.objectId===value.id)||(item.objectId===id&&item.subjectId===value.id))),corrections:this.store.corrections(contextId,id),views:raw?.views??[]};
  }
}
