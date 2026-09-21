export const ATLAS_WORLD_VERSION = "atlas.world.v2" as const;
export const ATLAS_INTERPRETER_VERSION = "atlas.interpreter.v1" as const;

export type AssertionClass =
  "observed" | "declared" | "derived" | "inferred" | "user-defined";
export type CoreKind =
  | "device"
  | "environment"
  | "identity"
  | "topology-region"
  | "workload"
  | "capability"
  | "service"
  | "process"
  | "job"
  | "container"
  | "runtime"
  | "interface"
  | "port"
  | "socket"
  | "http-endpoint"
  | "external-system"
  | "repository"
  | "package"
  | "module"
  | "class"
  | "function"
  | "test"
  | "file"
  | "directory"
  | "data-store"
  | "database"
  | "table"
  | "configuration"
  | "dependency"
  | "resource"
  | "event"
  | "operation";

export interface AtlasEvidenceRef {
  observationId: string;
  sourceField?: string;
  excerpt?: string;
  method?: string;
  authority?: string;
}
export interface AtlasEntity {
  id: string;
  contextId: string;
  kind: CoreKind | string;
  namespace: string;
  label: string;
  aliases: string[];
  parentId?: string;
  workloadId?: string;
  attributes: Record<string, unknown>;
  firstObservedAt: string;
  lastObservedAt: string;
  stale: boolean;
}
export interface AtlasAssertion {
  id: string;
  contextId: string;
  subjectId: string;
  predicate: string;
  objectId?: string;
  value?: unknown;
  classification: AssertionClass;
  confidence: number;
  explanation: string;
  evidence: AtlasEvidenceRef[];
  interpreterId: string;
  interpreterVersion: string;
  observedAt: string;
  derivedAt: string;
  stale: boolean;
}
export interface AtlasObservation {
  id: string;
  contextId: string;
  kind: string;
  source: string;
  sourceId: string;
  observedAt: string;
  scanId?: string;
  route?: Record<string, unknown>;
  facts: Record<string, unknown>;
  sensitivity: "safe-metadata" | "sensitive-reference";
}
export interface AtlasViewDescriptor {
  id: string;
  title: string;
  appliesTo: string[];
  priority?: number;
  sections: Array<{
    kind:
      | "properties"
      | "metrics"
      | "table"
      | "hierarchy"
      | "relationships"
      | "timeline"
      | "evidence"
      | "documentation";
    title?: string;
    fields?: string[];
    predicate?: string;
    empty?: string;
  }>;
}
export interface AtlasAttentionItem {
  id: string;
  text: string;
  entityIds: string[];
  severity: "info" | "warning" | "critical";
  stale: boolean;
}
export type OperationalHealth =
  | "healthy"
  | "degraded"
  | "critical"
  | "unknown"
  | "stale";
export type OperationalPhase =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "failed"
  | "unknown";
export type TopologyRegionId =
  | "applications"
  | "data"
  | "infrastructure"
  | "development"
  | "system"
  | "external";
export interface AtlasObservatoryItem {
  id: string;
  label: string;
  kind: string;
  health: OperationalHealth;
  phase: OperationalPhase;
  purpose: string;
  active: boolean;
  stale: boolean;
  confidence: number;
  facts: Array<{ label: string; value: string }>;
}
export interface AtlasObservatoryRegion {
  id: TopologyRegionId;
  label: string;
  health: OperationalHealth;
  items: AtlasObservatoryItem[];
  collapsedCount: number;
}
export interface AtlasObservatoryFlow {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  active: boolean;
  health: OperationalHealth;
  confidence: number;
  stale: boolean;
}
export interface AtlasObservatoryHistoryItem {
  id: string;
  entityId: string;
  text: string;
  at: string;
  severity: "info" | "warning" | "critical";
}
export interface AtlasObservatory {
  identity: { id: string; label: string; online: boolean };
  health: OperationalHealth;
  phase: OperationalPhase;
  summary: string;
  regions: AtlasObservatoryRegion[];
  flows: AtlasObservatoryFlow[];
  attention: AtlasAttentionItem[];
  history: AtlasObservatoryHistoryItem[];
  measuredAt: string;
  stale: boolean;
}
export interface AtlasSynthesis {
  headline: string;
  facts: Array<{
    id: string;
    text: string;
    entityIds: string[];
    classification: AssertionClass;
    confidence: number;
    stale: boolean;
  }>;
  attention: AtlasAttentionItem[];
  counters: Record<string, number | string>;
}
export interface AtlasProjection {
  protocolVersion: typeof ATLAS_WORLD_VERSION;
  contextId: string;
  rootId: string;
  lens: string;
  level: number;
  nodes: Array<
    AtlasEntity & {
      classification?: AssertionClass;
      confidence?: number;
      aggregateCount?: number;
    }
  >;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    classification: AssertionClass;
    confidence: number;
    stale: boolean;
  }>;
  aggregates: Array<{
    id?: string;
    label?: string;
    kind: string;
    count: number;
    destination?: { rootId: string; lens: string; level: number };
    summary?: string;
    stale?: boolean;
  }>;
  cards?: Array<{
    id: string;
    kind: string;
    title: string;
    status: "current" | "stale";
    purpose?: string;
    facts: Array<{ label: string; value: string }>;
    confidence?: number;
  }>;
  synthesis?: AtlasSynthesis;
  observatory?: AtlasObservatory;
  breadcrumbs: Array<{ id: string; label: string; kind: string }>;
  availableViews: string[];
  availableExpansions: Array<{ level: number; label: string }>;
  cursor?: string;
  errors: Array<{ code: string; message: string }>;
}

export interface InterpreterManifest {
  protocolVersion: typeof ATLAS_INTERPRETER_VERSION;
  id: string;
  version: string;
  publisher: string;
  ontologyVersion: typeof ATLAS_WORLD_VERSION;
  displayName: string;
  description?: string;
  license?: string;
  stage?: "recognize" | "enrich" | "present";
  inputs: string[];
  outputKinds: string[];
  outputPredicates: string[];
  rules: InterpreterRule[];
  views?: AtlasViewDescriptor[];
  budgets?: {
    maxInput?: number;
    maxEntities?: number;
    maxAssertions?: number;
    timeoutMs?: number;
  };
}
export interface InterpreterRule {
  id: string;
  when: { all?: InterpreterCondition[]; any?: InterpreterCondition[] };
  emit: {
    kind?: string;
    label?: string;
    idFrom?: string;
    predicate?: string;
    objectKind?: string;
    objectLabel?: string;
    classification?: AssertionClass;
    confidence?: number;
    explanation: string;
    capability?: string;
  };
}
export interface InterpreterCondition {
  field: string;
  op: "eq" | "contains" | "matches" | "exists" | "in";
  value?: unknown;
}
export interface InterpreterInput {
  id: string;
  contextId: string;
  kind: string;
  label: string;
  attributes: Record<string, unknown>;
  observedAt: string;
  stale?: boolean;
  source: string;
}
export interface InterpreterOutput {
  entities: AtlasEntity[];
  assertions: AtlasAssertion[];
  views: AtlasViewDescriptor[];
}
