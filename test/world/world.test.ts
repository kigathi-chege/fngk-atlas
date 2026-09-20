import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runInterpreter,
  validateInterpreterManifest,
  workloadInterpreter,
} from "../../src/world/interpreter.js";
import { projectWorld } from "../../src/world/projector.js";
import { WorldService } from "../../src/world/service.js";
import { WorldStore } from "../../src/world/store.js";
import { resolveWorkloads } from "../../src/world/resolver.js";
import { adaptWorldObservations } from "../../src/world/observation-adapters.js";
import {
  canonicalBreadcrumb,
  normalizePredicate,
  relationshipNeighborhood,
} from "../../src/world/relationships.js";
import { runBuiltInSpecialists } from "../../src/world/specialists.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});
describe("semantic Device atlas", () => {
  it("resolves service and process observations into one stable workload", () => {
    const inputs = [
      {
        id: "service:signal",
        contextId: "device:one",
        kind: "service",
        label: "Signal API",
        attributes: { systemdUnit: "signal.service" },
        observedAt: "2026-09-14T00:00:00Z",
        source: "native",
      },
      {
        id: "process:1",
        contextId: "device:one",
        kind: "process",
        label: "node",
        attributes: {
          systemdUnit: "signal.service",
          command: "node dist/server.js",
        },
        observedAt: "2026-09-14T00:00:01Z",
        source: "terminal",
      },
    ];
    const output = resolveWorkloads(inputs, () => "2026-09-14T00:01:00Z");
    expect(output.entities.filter((v) => v.kind === "workload")).toHaveLength(
      1,
    );
    expect(
      output.assertions.filter((v) => v.predicate === "realized-by"),
    ).toHaveLength(2);
    expect(output.entities[0].attributes.memberKinds).toEqual([
      "service",
      "process",
    ]);
    expect(resolveWorkloads(inputs, () => "2026-09-14T00:01:00Z")).toEqual(
      output,
    );
  });
  it("bridges service, repository, process, and listener signals without using PID or port alone as identity", () => {
    const inputs = [
      {
        id: "service",
        contextId: "local",
        kind: "service",
        label: "Signal",
        attributes: {
          systemdUnit: "signal.service",
          repositoryPath: "/srv/signal",
        },
        observedAt: "2026-09-14T00:00:00Z",
        source: "native",
      },
      {
        id: "repo",
        contextId: "local",
        kind: "repository",
        label: "signal",
        attributes: { path: "/srv/signal" },
        observedAt: "2026-09-14T00:00:00Z",
        source: "analysis",
      },
      {
        id: "process",
        contextId: "local",
        kind: "process",
        label: "node",
        attributes: { systemdUnit: "signal.service", pid: 42 },
        observedAt: "2026-09-14T00:00:00Z",
        source: "terminal",
      },
      {
        id: "port",
        contextId: "local",
        kind: "port",
        label: ":3000",
        attributes: { port: 3000 },
        observedAt: "2026-09-14T00:00:00Z",
        source: "terminal",
      },
    ];
    const output = resolveWorkloads(inputs);
    expect(output.entities.filter((v) => v.kind === "workload")).toHaveLength(
      1,
    );
    expect(output.mapping.repo).toBe(output.mapping.service);
    expect(output.mapping.process).toBe(output.mapping.service);
    expect(output.mapping.port).toBeUndefined();
    expect(output.unresolved).toContainEqual({
      inputId: "port",
      reason: expect.any(String),
    });
  });
  it("applies specialists to resolved workloads and resists generic Node false positives", () => {
    const input = {
        id: "node",
        contextId: "local",
        kind: "process",
        label: "node",
        attributes: { repositoryPath: "/srv/plain", command: "node script.js" },
        observedAt: "2026-09-14T00:00:00Z",
        source: "terminal",
      },
      plain = resolveWorkloads([input]),
      plainOutputs = runBuiltInSpecialists(plain, [input]);
    expect(plainOutputs.flatMap((value) => value.output.assertions)).toEqual(
      [],
    );
    const explicit = {
        ...input,
        id: "fastify",
        attributes: {
          repositoryPath: "/srv/api",
          framework: "Fastify",
          command: "node server.js",
        },
      },
      resolved = resolveWorkloads([explicit]),
      outputs = runBuiltInSpecialists(resolved, [explicit]);
    expect(outputs.flatMap((value) => value.output.assertions)).toContainEqual(
      expect.objectContaining({
        predicate: "provides-capability",
        confidence: 0.94,
      }),
    );
  });
  it("normalizes and redacts observations before semantic interpretation", () => {
    const [observation] = adaptWorldObservations(
      "local",
      [
        {
          id: "process:1",
          type: "process",
          name: "server",
          metadata: {
            command: "node app.js --token secret",
            password: "hidden",
          },
        },
      ],
      [],
      undefined,
      "2026-09-14T00:00:00Z",
    );
    expect(observation.sourceId).toBe("process:1");
    expect(JSON.stringify(observation.facts)).not.toContain("secret");
    expect(JSON.stringify(observation.facts)).not.toContain("hidden");
    expect(observation.sensitivity).toBe("sensitive-reference");
  });
  it("validates and deterministically executes data-only interpreter specifications", () => {
    expect(validateInterpreterManifest(workloadInterpreter)).toMatchObject({
      ok: true,
    });
    const input = [
        {
          id: "process:1",
          contextId: "device:one",
          kind: "process",
          label: "postgres",
          attributes: { command: "/usr/bin/postgres" },
          observedAt: "2026-09-14T00:00:00Z",
          source: "terminal",
        },
      ],
      left = runInterpreter(
        workloadInterpreter,
        input,
        () => "2026-09-14T00:01:00Z",
      ),
      right = runInterpreter(
        workloadInterpreter,
        input,
        () => "2026-09-14T00:01:00Z",
      );
    expect(left).toEqual(right);
    expect(left.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "workload" }),
        expect.objectContaining({
          kind: "capability",
          label: "relational-storage",
        }),
      ]),
    );
    expect(left.assertions).toContainEqual(
      expect.objectContaining({
        predicate: "provides-capability",
        classification: "derived",
        confidence: 0.98,
      }),
    );
  });
  it("lifts existing evidence into workloads, provenance, search, and bounded projections", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "atlas-world-")),
      store = new WorldStore(path.join(directory, "atlas.db")),
      world = new WorldService(store);
    cleanups.push(async () => {
      store.close();
      await rm(directory, { recursive: true, force: true });
    });
    world.refresh(
      "device:one",
      [
        {
          id: "service:signal",
          type: "service",
          label: "Signal API",
          metadata: { command: "node dist/server.js" },
        },
        {
          id: "process:postgres",
          type: "process",
          label: "postgres",
          metadata: { command: "/usr/bin/postgres" },
        },
        {
          id: "port:3000",
          type: "port",
          label: ":3000",
          metadata: { protocol: "http" },
        },
      ],
      [
        {
          id: "runs",
          source: "service:signal",
          target: "port:3000",
          type: "served_by",
        },
      ],
      { name: "kigathi", online: true },
    );
    const entities = store.entities("device:one"),
      assertions = store.assertions("device:one");
    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "device", label: "kigathi" }),
        expect.objectContaining({ kind: "workload" }),
        expect.objectContaining({
          kind: "capability",
          label: "remote-machine-control",
        }),
      ]),
    );
    expect(
      assertions.some((value) => value.predicate === "provides-capability"),
    ).toBe(true);
    expect(store.search("device:one", "Signal")).not.toHaveLength(0);
    const projection = projectWorld("device:one", entities, assertions, {
      lens: "overview",
      budget: 1,
    });
    expect(projection.protocolVersion).toBe("atlas.world.v2");
    expect(projection.nodes.length).toBeLessThanOrEqual(1);
    expect(
      projection.cards?.some((value) => value.title === "Signal API"),
    ).toBe(true);
    expect(projection.synthesis?.facts[0]?.text).toContain("workload");
    expect(projection.availableViews).toContain("relationships");
    expect(projection.cursor || projection.aggregates.length).toBeTruthy();
    expect(store.interpreters()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "atlas.resolver" }),
        expect.objectContaining({ id: "atlas.specialist.postgresql" }),
        expect.objectContaining({ id: "atlas.specialist.signal" }),
      ]),
    );
  });
  it("does not rewrite unchanged entities, assertions, observations, or search rows",async()=>{
    const directory=await mkdtemp(path.join(tmpdir(),'atlas-world-')),store=new WorldStore(path.join(directory,'atlas.db')),world=new WorldService(store);
    cleanups.push(async()=>{store.close();await rm(directory,{recursive:true,force:true})});
    const nodes=[{id:'process:postgres',type:'process',label:'postgres',metadata:{command:'/usr/bin/postgres'}}];
    world.refresh('local',nodes,[],{name:'host',online:true});
    const before=(store.db.prepare('SELECT total_changes() value').get() as any).value,changes=store.timeline('local',undefined,500).length,search=(store.db.prepare('SELECT count(*) value FROM atlas_world_search').get() as any).value;
    world.refresh('local',nodes,[],{name:'host',online:true});
    const after=(store.db.prepare('SELECT total_changes() value').get() as any).value;
    expect(store.timeline('local',undefined,500)).toHaveLength(changes);expect((store.db.prepare('SELECT count(*) value FROM atlas_world_search').get() as any).value).toBe(search);
    expect(after-before).toBeLessThan(20);
  });
  it("keeps breadcrumbs canonical and dependencies lateral", () => {
    const entities: any[] = [
        { id: "device", parentId: undefined },
        { id: "workload", parentId: "device" },
        { id: "module", parentId: "workload" },
        { id: "other", parentId: "device" },
      ],
      assertions: any[] = [
        { id: "dependency", subjectId: "module", objectId: "other" },
      ];
    expect(
      canonicalBreadcrumb("module", entities).map((value) => value.id),
    ).toEqual(["device", "workload", "module"]);
    expect(relationshipNeighborhood("module", assertions).ids).toEqual(
      new Set(["module", "other"]),
    );
    expect(normalizePredicate("depends_on")).toBe("depends-on");
  });
  it("retains conflicting assertions instead of silently replacing them", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "atlas-world-")),
      store = new WorldStore(path.join(directory, "atlas.db"));
    cleanups.push(async () => {
      store.close();
      await rm(directory, { recursive: true, force: true });
    });
    const entity = {
        id: "entity",
        contextId: "local",
        kind: "workload",
        namespace: "one",
        label: "Web",
        aliases: [],
        attributes: {},
        firstObservedAt: "2026-09-14T00:00:00Z",
        lastObservedAt: "2026-09-14T00:00:00Z",
        stale: false,
      },
      manifest = { ...workloadInterpreter, id: "one" },
      manifestTwo = { ...workloadInterpreter, id: "two" },
      base = {
        contextId: "local",
        subjectId: "entity",
        predicate: "provides-capability",
        classification: "inferred" as const,
        confidence: 0.5,
        explanation: "fixture",
        evidence: [],
        interpreterVersion: "1",
        observedAt: "2026-09-14T00:00:00Z",
        derivedAt: "2026-09-14T00:00:00Z",
        stale: false,
      };
    store.sync("local", manifest, {
      entities: [entity],
      assertions: [{ ...base, id: "a", interpreterId: "one", value: "http" }],
      views: [],
    });
    store.sync("local", manifestTwo, {
      entities: [],
      assertions: [
        { ...base, id: "b", interpreterId: "two", value: "not-http" },
      ],
      views: [],
    });
    expect(store.assertions("local", "entity")).toHaveLength(2);
  });
  it("reveals finer code structure by semantic zoom and preserves mixed-kind parents", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "atlas-world-")),
      store = new WorldStore(path.join(directory, "atlas.db")),
      world = new WorldService(store);
    cleanups.push(async () => {
      store.close();
      await rm(directory, { recursive: true, force: true });
    });
    world.refresh(
      "local",
      [
        { id: "repo", type: "repository", label: "Atlas" },
        { id: "module", type: "module", label: "world.ts", parent: "repo" },
        { id: "fn", type: "function", label: "projectWorld", parent: "module" },
      ],
      [],
      { name: "host", online: true },
    );
    const entities = store.entities("local"),
      repo = entities.find((value) => value.label === "Atlas")!,
      module = entities.find((value) => value.label === "world.ts")!,
      fn = entities.find((value) => value.label === "projectWorld")!;
    expect(module.parentId).toBe(repo.id);
    expect(fn.parentId).toBe(module.id);
    expect(
      projectWorld("local", entities, store.assertions("local"), {
        lens: "code",
        level: 0,
      }).nodes.map((value) => value.kind),
    ).not.toContain("function");
    expect(
      projectWorld("local", entities, store.assertions("local"), {
        lens: "code",
        level: 4,
      }).nodes.map((value) => value.kind),
    ).toContain("function");
  });
});
