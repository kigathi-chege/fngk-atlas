import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  runInterpreter,
  validateInterpreterManifest,
} from "../../src/world/interpreter.js";
import { interpreterFixture } from "./interpreter-fixture.js";
import { projectWorld } from "../../src/world/projector.js";
import { WorldService } from "../../src/world/service.js";
import { WorldStore } from "../../src/world/store.js";
import { backgroundRefresh } from '../../src/world/background-refresh.js';
import { resolveOperationalWorld } from "../../src/world/resolution-policy.js";
import { materializeWorld } from "../../src/world/materializer.js";
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
  it('rejects a worker that exits without a committed success message',async()=>{
    await expect(backgroundRefresh({databaseFile:':memory:',contextId:'local',nodes:[],edges:[],extensions:[]},{workerUrl:new URL('../fixtures/refresh-exit.mjs',import.meta.url)})).rejects.toThrow('without a committed success message');
  });
  it('cancels a stalled refresh worker without claiming success',async()=>{
    const controller=new AbortController(),pending=backgroundRefresh({databaseFile:':memory:',contextId:'local',nodes:[],edges:[],extensions:[]},{workerUrl:new URL('../fixtures/refresh-hang.mjs',import.meta.url),signal:controller.signal});
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
  });
  it('quarantines malformed extension output while committing a complete core world',()=>{
    const store=new WorldStore(':memory:'),broken={...interpreterFixture,id:'test.malformed',rules:[{id:'invalid',when:{},emit:{kind:'undeclared',explanation:'Invalid output kind.'}}]},world=new WorldService(store,[{manifest:broken,trusted:false,source:'development'}]);
    world.refresh('local',[{id:'repo',type:'repository',label:'web',path:'/srv/web',repositoryPath:'/srv/web'},{id:'process',type:'process',label:'node',metadata:{cwd:'/srv/web',processState:'S'}}],[],{name:'Device',online:true});
    expect(world.projection('local',{lens:'overview'}).observatory?.regions.flatMap(region=>region.items).length).toBeGreaterThan(0);
    expect(store.interpreters()).toContainEqual(expect.objectContaining({id:'test.malformed',status:'error'}));
    expect(store.entities('local').some(entity=>entity.namespace==='test.malformed')).toBe(false);
    expect(store.lastGoodAt('local')).toBeDefined();
    store.close();
  });
  it('bounds a 20,000-node source fixture to a compact home and retained observation budget',()=>{
    const store=new WorldStore(':memory:'),world=new WorldService(store),nodes=[
      {id:'repo',type:'repository',label:'web',path:'/srv/web',repositoryPath:'/srv/web'},
      {id:'process',type:'process',label:'node',metadata:{cwd:'/srv/web',processState:'S'}},
      ...Array.from({length:20_000},(_,index)=>({id:`file:${index}`,type:'file',label:`file-${index}`,path:`/srv/web/file-${index}.ts`,repositoryPath:'/srv/web'})),
    ];
    world.refresh('local',nodes,[],{name:'Device',online:true});
    const projection=world.projection('local',{lens:'overview',budget:100});
    expect(store.observations('local').length).toBeLessThanOrEqual(10_000);
    expect(store.entities('local').length).toBeLessThan(250);
    expect(projection.nodes.length).toBeLessThanOrEqual(100);
    expect(projection.observatory!.regions.flatMap(region=>region.items).length).toBeLessThanOrEqual(24);
    store.close();
  });
  it('keeps the last complete world visible after a failed refresh',()=>{
    const store=new WorldStore(':memory:'),world=new WorldService(store),nodes=[{id:'repo',type:'repository',label:'before',path:'/srv/before',repositoryPath:'/srv/before'},{id:'process',type:'process',label:'node',metadata:{cwd:'/srv/before',processState:'S'}}];
    world.refresh('local',nodes,[],{name:'Device',online:true});
    const prior=world.projection('local',{lens:'overview'}),lastGood=store.lastGoodAt('local'),original=store.sync.bind(store);
    let calls=0;
    store.sync=(...args:Parameters<WorldStore['sync']>)=>{original(...args);if(++calls===1)throw new Error('forced mid-refresh failure')};
    expect(()=>world.refresh('local',[{...nodes[0],label:'after'},nodes[1]],[],{name:'Device',online:true})).toThrow('forced mid-refresh failure');
    expect({...world.projection('local',{lens:'overview'}).observatory,measuredAt:undefined}).toEqual({...prior.observatory,measuredAt:undefined});
    expect(store.lastGoodAt('local')).toBe(lastGood);
    expect(store.refreshError('local')).toContain('forced mid-refresh failure');
    store.close();
  });
  it('restores stable semantic IDs and refresh status after reopening the database',async()=>{
    const directory=await mkdtemp(path.join(tmpdir(),'atlas-world-restart-')),file=path.join(directory,'atlas.db');
    cleanups.push(()=>rm(directory,{recursive:true,force:true}));
    const first=new WorldStore(file),world=new WorldService(first),nodes=[{id:'repo',type:'repository',label:'web',path:'/srv/web',repositoryPath:'/srv/web'},{id:'process',type:'process',label:'node',metadata:{cwd:'/srv/web',processState:'S'}}];
    world.refresh('local',nodes,[],{name:'Device',online:true});
    const ids=first.entities('local').map(entity=>entity.id).sort(),lastGood=first.lastGoodAt('local');
    first.close();
    const reopened=new WorldStore(file);
    expect(reopened.entities('local').map(entity=>entity.id).sort()).toEqual(ids);
    expect(reopened.lastGoodAt('local')).toBe(lastGood);
    reopened.close();
  });
  it("materializes a compact semantic world with complete provenance", () => {
    const runtime = [
        {
          id: "deployment:atlas",
          contextId: "local",
          kind: "deployment",
          label: "atlas-web",
          attributes: {
            managedDeploymentId: "deployment:atlas",
            repositoryPath: "/srv/atlas",
          },
          observedAt: "2026-09-20T00:00:00.000Z",
          source: "deployment",
        },
        {
          id: "repo:atlas",
          contextId: "local",
          kind: "repository",
          label: "atlas",
          attributes: { repositoryPath: "/srv/atlas" },
          observedAt: "2026-09-20T00:00:00.000Z",
          source: "analysis",
        },
        {
          id: "process:42",
          contextId: "local",
          kind: "process",
          label: "node",
          attributes: { cwd: "/srv/atlas", processState: "S" },
          observedAt: "2026-09-20T00:00:00.000Z",
          source: "runtime",
        },
        {
          id: "database:postgres",
          contextId: "local",
          kind: "database",
          label: "postgresql",
          attributes: {
            databaseEngine: "postgresql",
            address: "127.0.0.1",
            port: 5432,
          },
          observedAt: "2026-09-20T00:00:00.000Z",
          source: "database",
        },
      ],
      inputs = [
        ...runtime,
        ...Array.from({ length: 20_000 }, (_, index) => ({
          id: `function:${index}`,
          contextId: "local",
          kind: index % 2 ? "function" : "file",
          label: `symbol-${index}`,
          attributes: { repositoryPath: "/srv/atlas" },
          observedAt: "2026-09-20T00:00:00.000Z",
          source: "analysis",
        })),
      ],
      resolved = resolveOperationalWorld(
        inputs,
        () => "2026-09-20T00:01:00.000Z",
      ),
      output = materializeWorld(
        "local",
        {
          id: "device:one",
          label: "kigathi",
          online: true,
          observationId: "observation:device",
          observedAt: "2026-09-20T00:00:00.000Z",
        },
        resolved,
        inputs,
        () => "2026-09-20T00:01:00.000Z",
      );

    expect(output.entities.length).toBeLessThan(250);
    expect(output.entities.some((item) => item.kind === "function")).toBe(
      false,
    );
    expect(output.assertions.every((item) => item.evidence.length > 0)).toBe(
      true,
    );
    expect(
      output.entities.filter(
        (item) =>
          item.kind === "workload" &&
          item.attributes.visibility === "primary",
      ),
    ).toHaveLength(2);
  });
  it("migrates the semantic world to v2 while preserving observations", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "atlas-world-v1-"));
    const file = path.join(directory, "atlas.db");
    cleanups.push(async () => {
      await rm(directory, { recursive: true, force: true });
    });
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      CREATE TABLE atlas_world_observations(id TEXT PRIMARY KEY,context_id TEXT NOT NULL,kind TEXT NOT NULL,source TEXT NOT NULL,source_id TEXT NOT NULL,observed_at TEXT NOT NULL,scan_id TEXT,route_json TEXT NOT NULL,facts_json TEXT NOT NULL,sensitivity TEXT NOT NULL);
      CREATE TABLE atlas_world_entities(id TEXT PRIMARY KEY,context_id TEXT NOT NULL,kind TEXT NOT NULL,namespace TEXT NOT NULL,label TEXT NOT NULL,aliases_json TEXT NOT NULL,parent_id TEXT,workload_id TEXT,attributes_json TEXT NOT NULL,first_observed_at TEXT NOT NULL,last_observed_at TEXT NOT NULL,stale INTEGER NOT NULL DEFAULT 0,content_hash TEXT NOT NULL);
      CREATE TABLE atlas_world_interpreters(id TEXT PRIMARY KEY,version TEXT NOT NULL,publisher TEXT NOT NULL,manifest_json TEXT NOT NULL,trusted INTEGER NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL,error TEXT,updated_at TEXT NOT NULL);
      INSERT INTO atlas_world_observations VALUES('observation:one','local','process','runtime','process:1','2026-09-20T00:00:00.000Z',NULL,'{}','{"pid":1}','safe-metadata');
      INSERT INTO atlas_world_entities VALUES('derived:one','local','process','legacy.derived','node','[]',NULL,NULL,'{}','2026-09-20T00:00:00.000Z','2026-09-20T00:00:00.000Z',0,'legacy');
      INSERT INTO atlas_world_interpreters VALUES('legacy.derived','1','atlas','{}',1,'builtin','healthy',NULL,'2026-09-20T00:00:00.000Z');
    `);
    legacy.close();

    const migrated = new WorldStore(file);
    expect(migrated.schemaVersion()).toBe(2);
    expect(migrated.observations("local")).toHaveLength(1);
    expect(migrated.entities("local")).toEqual([]);
    expect(migrated.interpreters().map((item) => item.id)).not.toContain(
      "legacy.derived",
    );
    migrated.sync("local", { ...interpreterFixture, id: "atlas.v2.fixture" }, {
      entities: [
        {
          id: "workload:v2",
          contextId: "local",
          kind: "workload",
          namespace: "atlas.v2.fixture",
          label: "V2 workload",
          aliases: [],
          attributes: {},
          firstObservedAt: "2026-09-20T00:00:00.000Z",
          lastObservedAt: "2026-09-20T00:00:00.000Z",
          stale: false,
        },
      ],
      assertions: [],
      views: [],
    });
    migrated.close();

    const reopened = new WorldStore(file);
    expect(reopened.schemaVersion()).toBe(2);
    expect(reopened.observations("local")).toHaveLength(1);
    expect(reopened.entities("local").map((item) => item.id)).toEqual([
      "workload:v2",
    ]);
    reopened.close();
  });
  it("scopes specialist evidence to one workload", () => {
    const workload = (id: string, label: string, memberIds: string[]) => ({
        id,
        contextId: "local",
        kind: "workload",
        namespace: "atlas.resolver.v2",
        label,
        aliases: [],
        attributes: { memberObservationIds: memberIds },
        firstObservedAt: "2026-09-20T00:00:00.000Z",
        lastObservedAt: "2026-09-20T00:00:00.000Z",
        stale: false,
      }),
      inputs = [
        { id: "fastify", contextId: "local", kind: "repository", label: "web", attributes: { framework: "Fastify" }, observedAt: "2026-09-20T00:00:00.000Z", source: "manifest" },
        { id: "tcp", contextId: "local", kind: "port", label: ":9000", attributes: { protocol: "tcp" }, observedAt: "2026-09-20T00:00:00.000Z", source: "runtime" },
        { id: "postgres", contextId: "local", kind: "database", label: "postgresql", attributes: {}, observedAt: "2026-09-20T00:00:00.000Z", source: "database" },
        { id: "docker", contextId: "local", kind: "service", label: "docker.service", attributes: {}, observedAt: "2026-09-20T00:00:00.000Z", source: "systemd" },
        { id: "signal", contextId: "local", kind: "service", label: "signal.service", attributes: {}, observedAt: "2026-09-20T00:00:00.000Z", source: "systemd" },
      ],
      entities = [
        workload("workload:web", "web", ["fastify"]),
        workload("workload:tcp", "listener", ["tcp"]),
        workload("workload:postgres", "postgresql", ["postgres"]),
        workload("workload:docker", "docker", ["docker"]),
        workload("workload:signal", "signal", ["signal"]),
      ],
      outputs = runBuiltInSpecialists({ entities, mapping: {} }, inputs),
      outputEntities = outputs.flatMap((value) => value.output.entities),
      assertions = outputs.flatMap((value) => value.output.assertions),
      http = assertions.filter(
        (value) =>
          value.predicate === "provides-capability" &&
          outputEntities.find((entity) => entity.id === value.objectId)?.label ===
            "http-serving",
      );
    expect(http.map((value) => value.subjectId)).toEqual(["workload:web"]);
    const members = new Map(
      entities.map((entity) => [
        entity.id,
        new Set(entity.attributes.memberObservationIds as string[]),
      ]),
    );
    expect(assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subjectId: "workload:postgres" }),
        expect.objectContaining({ subjectId: "workload:docker" }),
        expect.objectContaining({ subjectId: "workload:signal" }),
      ]),
    );
    for (const assertion of assertions)
      expect(
        assertion.evidence.every((item) =>
          members.get(assertion.subjectId)?.has(item.observationId),
        ),
      ).toBe(true);
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
    expect(validateInterpreterManifest(interpreterFixture)).toMatchObject({
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
        interpreterFixture,
        input,
        () => "2026-09-14T00:01:00Z",
      ),
      right = runInterpreter(
        interpreterFixture,
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
          id: "deployment:signal",
          type: "deployment",
          label: "Signal API",
          metadata: {
            managedDeploymentId: "signal",
            repositoryPath: "/srv/signal",
          },
        },
        {
          id: "repository:signal",
          type: "repository",
          label: "Signal",
          metadata: { repositoryPath: "/srv/signal" },
        },
        {
          id: "process:signal",
          type: "process",
          label: "node",
          metadata: { cwd: "/srv/signal", processState: "S" },
        },
        {
          id: "database:postgres",
          type: "database",
          label: "postgresql",
          metadata: { address: "127.0.0.1", port: 5432 },
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
          source: "deployment:signal",
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
      budget: 50,
    });
    expect(projection.protocolVersion).toBe("atlas.world.v2");
    expect(projection.nodes.length).toBeLessThanOrEqual(50);
    expect(
      projection.observatory?.regions
        .flatMap((value) => value.items)
        .some((value) => value.label === "Signal API"),
    ).toBe(true);
    expect(projection.synthesis?.facts[0]?.text).toContain("workload");
    expect(projection.availableViews).toContain("relationships");
    const bounded = projectWorld("device:one", entities, assertions, {
      lens: "overview",
      budget: 1,
    });
    expect(bounded.nodes).toHaveLength(1);
    expect(bounded.cursor || bounded.aggregates.length).toBeTruthy();
    expect(store.interpreters()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "atlas.resolver.v2" }),
        expect.objectContaining({ id: "atlas.specialist.postgresql" }),
        expect.objectContaining({ id: "atlas.specialist.signal" }),
      ]),
    );
  });
  it("does not rewrite unchanged entities, assertions, observations, or search rows",async()=>{
    const directory=await mkdtemp(path.join(tmpdir(),'atlas-world-')),store=new WorldStore(path.join(directory,'atlas.db')),world=new WorldService(store);
    cleanups.push(async()=>{store.close();await rm(directory,{recursive:true,force:true})});
    const nodes=[{id:'deployment:atlas',type:'deployment',label:'atlas-web',metadata:{managedDeploymentId:'atlas'}}];
    world.refresh('local',nodes,[],{name:'host',online:true});
    const workloadId=store.entities('local').find(value=>value.kind==='workload')!.id;
    const before=(store.db.prepare('SELECT total_changes() value').get() as any).value,changes=store.timeline('local',undefined,500).length,search=(store.db.prepare('SELECT count(*) value FROM atlas_world_search').get() as any).value;
    world.refresh('local',nodes,[],{name:'host',online:true});
    const after=(store.db.prepare('SELECT total_changes() value').get() as any).value;
    expect(store.timeline('local',undefined,500)).toHaveLength(changes);expect((store.db.prepare('SELECT count(*) value FROM atlas_world_search').get() as any).value).toBe(search);
    expect(after-before).toBeLessThan(20);
    world.refresh('local',[],[],{name:'host',online:true});
    expect(store.timeline('local',workloadId,50)).toContainEqual(expect.objectContaining({itemType:'entity',changeType:'withdrawn',interpreterId:'atlas.resolver.v2'}));
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
      manifest = { ...interpreterFixture, id: "one" },
      manifestTwo = { ...interpreterFixture, id: "two" },
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
  it("keeps software detail out of the compact semantic world", async () => {
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
    const entities = store.entities("local");
    expect(entities.map((value) => value.kind)).not.toEqual(
      expect.arrayContaining(["repository", "module", "function"]),
    );
    expect(
      entities.find(
        (value) =>
          value.kind === "topology-region" &&
          value.attributes.region === "development",
      )?.attributes.collapsedCount,
    ).toBe(3);
  });
});
