import { describe, expect, it } from "vitest";
import {
  enrichFromLocalDocumentation,
  selectAuthoritativeAssertion,
} from "../../src/world/enrichment.js";
import type {
  AtlasAssertion,
  AtlasEntity,
  InterpreterInput,
  LocalDocumentation,
} from "../../src/world/types.js";
import { WorldStore } from "../../src/world/store.js";
import { WorldService } from "../../src/world/service.js";

const at = "2026-09-20T12:00:00.000Z";
const workload: AtlasEntity = {
  id: "workload:web",
  contextId: "local",
  kind: "workload",
  namespace: "atlas.resolver.v2",
  label: "Web",
  aliases: [],
  attributes: { memberObservationIds: ["observation:repo"] },
  firstObservedAt: at,
  lastObservedAt: at,
  stale: false,
};
const inputs: InterpreterInput[] = [
  {
    id: "observation:repo",
    contextId: "local",
    kind: "repository",
    label: "web",
    attributes: { repositoryPath: "/srv/web" },
    observedAt: at,
    source: "analysis",
  },
];

describe("local documentation enrichment", () => {
  it("selects scoped declared purpose while retaining conflicts and redacting excerpts", () => {
    const documents: LocalDocumentation[] = [
        {
          path: "/srv/web/README.md",
          repositoryPath: "/srv/web",
          sourceInputId: "observation:repo",
          observationId: "observation:readme",
          text: "# Web\n\nServes the customer application and its public API. token=never-store-this-value",
        },
        {
          path: "/srv/web/package.json",
          repositoryPath: "/srv/web",
          sourceInputId: "observation:repo",
          observationId: "observation:package",
          text: JSON.stringify({
            name: "web",
            description: "Customer-facing web application",
            scripts: { start: "node server.js" },
          }),
        },
        {
          path: "/srv/other/README.md",
          repositoryPath: "/srv/other",
          sourceInputId: "observation:other",
          observationId: "observation:other-readme",
          text: "Unrelated billing service.",
        },
      ],
      output = enrichFromLocalDocumentation(
        workload,
        inputs,
        documents,
        () => at,
      ),
      inferred: AtlasAssertion = {
        id: "inferred:purpose",
        contextId: "local",
        subjectId: workload.id,
        predicate: "has-purpose",
        value: "Generic inferred web workload",
        classification: "inferred",
        confidence: 0.5,
        explanation: "Runtime inference",
        evidence: [{ observationId: "observation:runtime" }],
        interpreterId: "test.inference",
        interpreterVersion: "1",
        observedAt: at,
        derivedAt: at,
        stale: false,
      },
      purposes = [...output.assertions, inferred].filter(
        (item) => item.predicate === "has-purpose",
      );
    expect(selectAuthoritativeAssertion(purposes)?.value).toMatch(
      /customer application|Customer-facing/,
    );
    expect(purposes).toContain(inferred);
    expect(JSON.stringify(output)).not.toContain("never-store-this-value");
    expect(
      output.assertions.every((item) =>
        item.evidence.every((evidence) => (evidence.excerpt?.length ?? 0) <= 240),
      ),
    ).toBe(true);
    expect(JSON.stringify(output)).not.toContain("billing service");
    expect(output.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: "declared",
          evidence: expect.arrayContaining([
            expect.objectContaining({
              observationId: expect.any(String),
              sourceField: expect.stringContaining("/srv/web/"),
            }),
          ]),
        }),
      ]),
    );
  });
  it("withdrawably syncs authorized repository documents through WorldService", () => {
    const store = new WorldStore(":memory:"), service = new WorldService(store);
    service.refresh(
      "local",
      [
        { id: "repo", type: "repository", label: "web", path: "/srv/web", repositoryPath: "/srv/web" },
        { id: "process", type: "process", label: "node", metadata: { cwd: "/srv/web", processState: "S" } },
        { id: "readme", type: "configuration", label: "README.md", repositoryPath: "/srv/web", documentPath: "/srv/web/README.md", documentText: "Serves the live customer portal. token=do-not-persist" },
      ],
      [],
      { name: "kigathi", online: true },
    );
    expect(store.assertions("local")).toContainEqual(
      expect.objectContaining({ predicate: "has-purpose", value: "Serves the live customer portal. token=[redacted]" }),
    );
    expect(JSON.stringify(store.observations("local"))).not.toContain("do-not-persist");
    expect(store.interpreters()).toContainEqual(
      expect.objectContaining({ id: "atlas.enrichment.local-docs" }),
    );
    service.refresh(
      "local",
      [
        { id: "repo", type: "repository", label: "web", path: "/srv/web", repositoryPath: "/srv/web" },
        { id: "process", type: "process", label: "node", metadata: { cwd: "/srv/web", processState: "S" } },
      ],
      [],
      { name: "kigathi", online: true },
    );
    expect(store.assertions("local").some((item) => item.predicate === "has-purpose")).toBe(false);
    store.close();
  });
  it('never persists raw document bodies or credential fields in world evidence',()=>{
    const store=new WorldStore(':memory:'),service=new WorldService(store);
    service.refresh('local',[
      {id:'repo',type:'repository',label:'web',path:'/srv/web',repositoryPath:'/srv/web'},
      {id:'process',type:'process',label:'node',metadata:{cwd:'/srv/web',processState:'S'}},
      {id:'deployment-doc',type:'configuration',label:'deployment.json',repositoryPath:'/srv/web',documentPath:'/srv/web/deployment.json',documentText:'{"purpose":"Serves customers","databaseUrl":"postgres://user:fixture-secret@host/db","privateKey":"fixture-private"}'},
    ],[],{name:'Device',online:true});
    const persisted=JSON.stringify({observations:store.observations('local'),assertions:store.assertions('local')});
    expect(persisted).not.toContain('fixture-secret');
    expect(persisted).not.toContain('fixture-private');
    expect(persisted).not.toContain('databaseUrl');
    expect(store.assertions('local')).toContainEqual(expect.objectContaining({predicate:'has-purpose',value:'Serves customers'}));
    store.close();
  });
});
