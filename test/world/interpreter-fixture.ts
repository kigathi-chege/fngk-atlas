import {
  ATLAS_INTERPRETER_VERSION,
  ATLAS_WORLD_VERSION,
  type InterpreterManifest,
} from "../../src/world/types.js";

export const interpreterFixture: InterpreterManifest = {
  protocolVersion: ATLAS_INTERPRETER_VERSION,
  ontologyVersion: ATLAS_WORLD_VERSION,
  id: "test.workload-semantics",
  version: "1.0.0",
  publisher: "test",
  displayName: "Test workload semantics",
  inputs: ["service", "process", "container", "repository", "database", "port"],
  outputKinds: ["workload", "capability"],
  outputPredicates: ["provides-capability"],
  rules: [
    {
      id: "workload",
      when: { any: [{ field: "kind", op: "in", value: ["service", "container", "repository", "database"] }] },
      emit: { kind: "workload", classification: "derived", confidence: 0.82, explanation: "Test evidence is grouped into a workload." },
    },
    {
      id: "postgres",
      when: { any: [{ field: "label", op: "matches", value: "postgres(?:ql)?" }, { field: "attributes.engine", op: "eq", value: "postgres" }] },
      emit: { kind: "workload", capability: "relational-storage", confidence: 0.98, explanation: "Test PostgreSQL evidence provides storage." },
    },
  ],
};
