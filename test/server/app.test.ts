import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { FngkProcessClient } from "../../src/fngk/process-client.js";
import { DiagnosticRegistry } from "../../src/diagnostics/registry.js";
import { Store } from "../../src/store.js";

const fixture = path.resolve("test/fixtures/fngk.mjs");
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function harness() {
  const directory = await mkdtemp(path.join(tmpdir(), "fngk-atlas-server-"));
  const app = await createApp({
    fngk: new FngkProcessClient({ binary: fixture }),
    dbPath: path.join(directory, "atlas.db"),
  });
  cleanups.push(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  return app;
}

describe("Atlas FNGK-native server", () => {
  it('requires confirmation and retains correction provenance without rewriting evidence',async()=>{
    const app=await harness();
    expect((await app.inject({method:'POST',url:'/api/world/refresh',payload:{contextId:'local'}})).statusCode).toBe(200);
    const home=(await app.inject({method:'GET',url:'/api/world/projection?contextId=local&lens=overview'})).json(),id=home.rootId;
    const url=`/api/world/entities/${encodeURIComponent(id)}/correction`;
    expect((await app.inject({method:'PUT',url,payload:{contextId:'local',kind:'rename',value:'Corrected machine'}})).statusCode).toBe(409);
    expect((await app.inject({method:'PUT',url,payload:{contextId:'local',kind:'merge',value:'missing',confirm:true}})).statusCode).toBe(400);
    expect((await app.inject({method:'PUT',url,payload:{contextId:'local',kind:'rename',value:'Corrected machine',confirm:true}})).statusCode).toBe(200);
    const corrected=(await app.inject({method:'GET',url:`/api/world/entities/${encodeURIComponent(id)}`})).json();
    expect(corrected.entity.label).toBe('Corrected machine');
    expect(corrected.assertions).toContainEqual(expect.objectContaining({classification:'user-defined',predicate:'has-name'}));
    expect((await app.inject({method:'DELETE',url,payload:{contextId:'local',confirm:true}})).statusCode).toBe(200);
    expect((await app.inject({method:'GET',url:`/api/world/entities/${encodeURIComponent(id)}`})).json().entity.label).not.toBe('Corrected machine');
  });
  it('deduplicates simultaneous explicit Observatory refresh requests',async()=>{
    const app=await harness(),responses=await Promise.all([
      app.inject({method:'POST',url:'/api/world/refresh',payload:{contextId:'local'}}),
      app.inject({method:'POST',url:'/api/world/refresh',payload:{contextId:'local'}}),
    ]);
    expect(responses.map(response=>response.statusCode)).toEqual([200,200]);
    expect(responses[0].json().projection.rootId).toBe(responses[1].json().projection.rootId);
  });
  it("does not expose legacy graph or Atlas alias routes", async () => {
    const app = await harness(),
      legacyGraph = "/api/" + "graph",
      legacyInterpreterAlias = "/api/" + "atlas/interpreters";
    expect(
      (await app.inject({ method: "GET", url: legacyGraph })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({ method: "GET", url: legacyInterpreterAlias })
      ).statusCode,
    ).toBe(404);
  });
  it("serves canonical observatory routes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fngk-atlas-canonical-")),
      dbPath = path.join(directory, "atlas.db"),
      seed = new Store(dbPath);
    seed.saveIndex({
      id: "index:software",
      contextId: "local",
      root: "/repo",
      revision: "abc",
      fingerprint: "fixture",
      summary: { files: 1, functions: 1, packages: 1 },
      nodes: [
        {
          id: "function:main",
          type: "function",
          label: "main",
          qualifiedName: "main",
          path: "src/main.ts",
          line: 3,
          endLine: 8,
          complexity: 4,
          coverage: { fraction: 0.75, stale: false, source: "lcov.info" },
          crap: 4.25,
        },
      ],
      edges: [],
    });
    seed.close();
    const app = await createApp({
      fngk: new FngkProcessClient({ binary: fixture }),
      dbPath,
    });
    cleanups.push(async () => {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/world/refresh",
          payload: { contextId: "local" },
        })
      ).statusCode,
    ).toBe(200);
    const overview = await app.inject({
      method: "GET",
      url: "/api/world/projection?contextId=local&lens=overview",
    });
    expect(overview.json()).toMatchObject({
      protocolVersion: "atlas.world.v2",
      observatory: {
        identity: expect.objectContaining({ label: expect.any(String) }),
        regions: expect.any(Array),
        flows: expect.any(Array),
        attention: expect.any(Array),
      },
    });
    expect(
      (
        await app.inject({ method: "GET", url: "/api/world/interpreters" })
      ).json(),
    ).toMatchObject({
      protocolVersion: "atlas.interpreter.v1",
      items: expect.arrayContaining([
        expect.objectContaining({ id: "atlas.resolver.v2" }),
      ]),
    });
    expect(
      (
        await app.inject({ method: "GET", url: "/api/device-adapters" })
      ).json(),
    ).toMatchObject({ protocolVersion: "atlas.device-adapter.v1", items: [] });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/world/interpreters/recompute",
          payload: { contextId: "local" },
        })
      ).statusCode,
    ).toBe(200);
    const functions = await app.inject({
      method: "GET",
      url: "/api/software/functions?contextId=local&indexId=index%3Asoftware&limit=20",
    });
    expect(functions.statusCode).toBe(200);
    expect(functions.json()).toEqual({
      items: [
        expect.objectContaining({
          id: "function:main",
          label: "main",
          path: "src/main.ts",
          complexity: 4,
          coverage: expect.objectContaining({ fraction: 0.75, stale: false }),
          crap: 4.25,
          stale: false,
        }),
      ],
    });
  });
  it('serves semantic projections without probing FNGK or recomputing evidence',async()=>{
    const directory=await mkdtemp(path.join(tmpdir(),'fngk-atlas-readonly-world-')),fngk={probe:async()=>{throw new Error('projection attempted FNGK discovery')}};
    const app=await createApp({fngk:fngk as any,dbPath:path.join(directory,'atlas.db')});cleanups.push(async()=>{await app.close();await rm(directory,{recursive:true,force:true})});
    const response=await app.inject({method:'GET',url:'/api/world/projection?contextId=local&lens=overview'});
    expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({protocolVersion:'atlas.world.v2',contextId:'local'});
    const state=await app.inject({method:'GET',url:'/api/state?contextId=local&fngk=0'});
    expect(state.statusCode).toBe(200);expect(state.json()).not.toHaveProperty('fngk');
  });
  it('returns redacted route causes for actionable filesystem failures',async()=>{
    const app=await harness(),response=await app.inject({method:'GET',url:'/api/files/content?contextId=local&path=%2Fdefinitely-not-an-atlas-file'});
    expect(response.statusCode).toBe(409);expect(response.json()).toMatchObject({error:'route_unavailable',routeCauses:expect.arrayContaining([expect.objectContaining({code:'ENOENT'})])});
  });
  it("lists redacted diagnostic sessions for operator inspection", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "fngk-atlas-diagnostics-"),
    );
    const diagnostics = new DiagnosticRegistry();
    const created = diagnostics.create({
      kind: "database",
      contextId: "device:1",
      command: "fngk resources resource-1 invoke --password secret",
    });
    cleanups.push(async () => {
      await rm(directory, { recursive: true, force: true });
    });
    const app = await createApp({
      fngk: new FngkProcessClient({ binary: fixture }),
      dbPath: path.join(directory, "atlas.db"),
      diagnosticRegistry: diagnostics,
    });
    cleanups.push(async () => {
      await app.close();
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/diagnostics/sessions",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toContainEqual(
      expect.objectContaining({
        id: created.id,
        kind: "database",
        command: expect.not.stringContaining("secret"),
      }),
    );
  });
  it("exposes process context and namespace without accepting credentials", async () => {
    const app = await harness();
    const context = await app.inject({
      method: "GET",
      url: "/api/fngk/context?profile=work",
    });
    expect(context.statusCode).toBe(200);
    expect(context.json()).toMatchObject({
      installed: true,
      compatible: true,
      profile: "work",
    });
    expect(context.body).not.toMatch(/credential|cookie|operator-secret/);

    const namespace = await app.inject({
      method: "GET",
      url: "/api/fngk/namespace?profile=work",
    });
    expect(namespace.json()).toMatchObject({
      protocolVersion: "fngk.namespace.v1",
      profile: { name: "work" },
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/fngk/sessions?profile=work",
        })
      ).json(),
    ).toMatchObject({ profile: { name: "work" }, sessions: [] });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/fngk/sessions/session-1/actions",
          payload: { action: "stop" },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/fngk/sessions/session-1/actions",
          payload: { action: "rename", title: "Build shell", profile: "work" },
        })
      ).json(),
    ).toMatchObject({ protocolVersion: "fngk.session.v1", action: "rename" });
    expect((await app.inject({method:'POST',url:'/api/world/refresh',payload:{contextId:'local'}})).statusCode).toBe(200);
    const semantic = await app.inject({
      method: "GET",
      url: "/api/world/projection?contextId=local&lens=overview&budget=100",
    });
    expect(semantic.statusCode).toBe(200);
    expect(semantic.json()).toMatchObject({
      protocolVersion: "atlas.world.v2",
      contextId: "local",
      availableViews: expect.arrayContaining([
        "overview",
        "software",
        "relationships",
        "evidence",
      ]),
      synthesis: {
        headline: expect.any(String),
        facts: expect.any(Array),
        attention: expect.any(Array),
      },
    });
    expect(semantic.body).not.toMatch(/password|credential|cookie/i);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/world/search?contextId=local&q=kigathi",
        })
      ).json(),
    ).toMatchObject({ items: expect.any(Array), errors: [] });
    expect(
      (
        await app.inject({ method: "GET", url: "/api/world/interpreters" })
      ).json().items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "atlas.resolver.v2", trusted: true }),
      ]),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/fngk/connect",
          payload: { session: "never-accept-this" },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("previews a production deployment without executing Device commands", async () => {
    const app = await harness(),
      response = await app.inject({
        method: "POST",
        url: "/api/deployments/plan",
        payload: {
          contextId: "device:device-1",
          repositoryPath: "/srv/web",
          environment: "production",
          commitSha: "a".repeat(40),
          manifest: {
            protocolVersion: "fngk.project.v1",
            name: "web",
            commands: {
              install: "npm ci",
              build: "npm run build",
              start: "npm start",
            },
            port: 8080,
            health: { protocol: "http", path: "/health", timeoutMs: 30000 },
            artifacts: [{ path: "dist", kind: "web" }],
            restartPolicy: "on-failure",
            environments: {},
            routes: [{ name: "web" }],
          },
        },
      });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      version: "atlas.deployment-plan.v1",
      phases: [
        "verify",
        "extract",
        "install",
        "build",
        "start",
        "health",
        "artifacts",
        "publish",
      ],
    });
  });

  it("interprets bounded project metadata without reading environment secrets", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fngk-atlas-interpret-"));
    const repository = path.join(directory, "app");
    await mkdir(repository);
    await writeFile(path.join(repository, "package.json"), JSON.stringify({name:"fixture",dependencies:{fastify:"5",pg:"8"},scripts:{start:"node server.js"}}));
    await writeFile(path.join(repository, ".env"), "DATABASE_URL=never-return-this\n");
    const app = await createApp({
      fngk: new FngkProcessClient({ binary: fixture }),
      dbPath: path.join(directory, "atlas.db"),
      localRoot: directory,
    });
    cleanups.push(async () => { await app.close(); await rm(directory, {recursive:true,force:true}); });
    const response = await app.inject({method:"POST",url:"/api/deployments/interpret",payload:{contextId:"local",repositoryPath:"/app",environment:"production"}});
    expect(response.statusCode,response.body).toBe(200);
    expect(response.json()).toMatchObject({protocolVersion:"atlas.deployment-proposal.v1",manifest:{protocolVersion:"fngk.project.v2",adapter:{id:"fastify"}},matches:expect.arrayContaining([expect.objectContaining({id:"fastify"}),expect.objectContaining({id:"postgres"})])});
    expect(response.body).not.toContain("never-return-this");
  });

  it("delegates retained deployment transitions through FNGK",async()=>{
    const app=await harness(),response=await app.inject({method:'POST',url:'/api/deployments/deployment-1/actions',payload:{action:'execute',planRevision:2,confirm:true,profile:'work'}});
    expect(response.statusCode,response.body).toBe(202);
    expect(response.json()).toMatchObject({input:{planRevision:2},argv:['deployments','deployment-1','execute','--json','--profile','work']});
  });

  it("creates a retained v2 journey through FNGK rather than Atlas-local execution",async()=>{const app=await harness(),response=await app.inject({method:'POST',url:'/api/deployments',payload:{contextId:'device:device-1',confirm:true,profile:'work',protocolVersion:'fngk.deployment.v2',name:'web'}});expect(response.statusCode,response.body).toBe(201);expect(response.json()).toMatchObject({deployment:{id:'deployment-1'},release:{id:'release-1'},input:{protocolVersion:'fngk.deployment.v2',name:'web'},argv:['deployments','device-1','create','--json','--profile','work']})});

  it("brokers deployment secret envelopes to the selected Device",async()=>{
    const app=await harness(),contextId='device:device-1',envelope={ephemeralPublicKey:'key',salt:'salt',nonce:'nonce',ciphertext:'opaque'};
    const key=await app.inject({method:'GET',url:`/api/deployment-secrets/key?contextId=${encodeURIComponent(contextId)}&profile=work`});expect(key.statusCode,key.body).toBe(200);expect(key.json()).toMatchObject({credentialPublicKey:'device-public-key'});
    expect((await app.inject({method:'POST',url:'/api/deployment-secrets',payload:{contextId,secretEnvelope:envelope}})).statusCode).toBe(409);
    const stored=await app.inject({method:'POST',url:'/api/deployment-secrets',payload:{contextId,secretEnvelope:envelope,confirm:true,profile:'work'}});expect(stored.statusCode,stored.body).toBe(201);expect(stored.json()).toMatchObject({vaultBindingId:'deployment-vault:reference',input:{secretEnvelope:envelope}});expect(stored.json().argv.join(' ')).not.toContain('opaque');
    const rotated=await app.inject({method:'PUT',url:`/api/deployment-secrets/${encodeURIComponent('deployment-vault:reference')}`,payload:{contextId,secretEnvelope:{...envelope,ciphertext:'rotated'},confirm:true,profile:'work'}});expect(rotated.statusCode,rotated.body).toBe(200);expect(rotated.json().argv).toContain('secret-rotate');
  });

  it("requests a verified immutable source snapshot from the selected Device",async()=>{const app=await harness(),response=await app.inject({method:'POST',url:'/api/deployment-sources/snapshot',payload:{contextId:'device:device-1',path:'/srv/app',profile:'work'}});expect(response.statusCode,response.body).toBe(201);expect(response.json()).toMatchObject({protocolVersion:'fngk.source.v1',kind:'device-directory',verified:true,input:{path:'/srv/app'}})});

  it("relays a terminal as WebSocket JSONL events", async () => {
    const app = await harness();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(
      address.replace(/^http/, "ws") +
        "/api/fngk/terminals?target=kigathi&new=1",
    );
    const messages: any[] = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    while (!messages.some((message) => message.type === "ready"))
      await once(socket, "message");
    socket.send(
      JSON.stringify({
        type: "command",
        requestId: "test-1",
        command: "npm test",
      }),
    );
    while (!messages.some((message) => message.type === "command_state"))
      await once(socket, "message");
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "command_state",
        requestId: "test-1",
        status: "succeeded",
      }),
    );
    socket.send(JSON.stringify({ type: "detach", requestId: "done" }));
    await once(socket, "close");
  });

  it("scopes terminal sessions to one Device and reports lifecycle counts", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "fngk-atlas-sessions-"),
    );
    const app = await createApp({
      fngk: new FngkProcessClient({
        binary: fixture,
        env: { FNGK_FIXTURE_MODE: "session-list" },
      }),
      dbPath: path.join(directory, "atlas.db"),
    });
    cleanups.push(async () => {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/fngk/sessions?deviceId=device-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sessions: [
        { id: "session-live", deviceId: "device-1" },
        { id: "session-detached", deviceId: "device-1" },
        { id: "session-archived", deviceId: "device-1" },
      ],
      counts: { total: 3, active: 2, live: 1, detached: 1, archived: 1 },
    });
  });

  it("requires explicit confirmation and streams a guided FNGK update", async () => {
    const app = await harness();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/fngk/update",
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    const response = await app.inject({
      method: "POST",
      url: "/api/fngk/update",
      payload: { confirm: true },
    });
    expect(response.statusCode).toBe(200);
    const events = response.body
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toEqual([
      expect.objectContaining({ type: "output", line: "downloaded" }),
      expect.objectContaining({ type: "output", line: "installed" }),
      expect.objectContaining({
        type: "complete",
        context: expect.objectContaining({ compatible: true }),
      }),
    ]);
  });

  it("runs an explicitly confirmed Device adapter and publishes its semantic evidence", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fngk-atlas-adapter-")),
      manifest: any = {
        protocolVersion: "atlas.device-adapter.v1",
        id: "test.adapter",
        version: "1.0.0",
        publisher: "test",
        displayName: "Test adapter",
        command:
          'printf \'%s\\n\' \'{"kind":"database","label":"PostgreSQL test","sourceId":"db"}\'',
        interpreter: {
          protocolVersion: "atlas.interpreter.v1",
          ontologyVersion: "atlas.world.v2",
          id: "test.adapter.semantic",
          version: "1.0.0",
          publisher: "test",
          displayName: "Test adapter semantics",
          inputs: ["database"],
          outputKinds: ["workload", "capability"],
          outputPredicates: ["provides-capability"],
          rules: [
            {
              id: "db",
              when: { all: [{ field: "kind", op: "eq", value: "database" }] },
              emit: {
                kind: "workload",
                capability: "relational-storage",
                explanation: "The confirmed test adapter observed a database.",
              },
            },
          ],
        },
      };
    const app = await createApp({
      fngk: new FngkProcessClient({ binary: fixture }),
      dbPath: path.join(directory, "atlas.db"),
      deviceAdapters: [{ manifest, trusted: false, source: "development" }],
    });
    cleanups.push(async () => {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/device-adapters/test.adapter/run",
          payload: { contextId: "local" },
        })
      ).statusCode,
    ).toBe(409);
    const ran = await app.inject({
      method: "POST",
      url: "/api/device-adapters/test.adapter/run",
      payload: { contextId: "local", confirm: true },
    });
    expect(ran.statusCode).toBe(200);
    expect(ran.json()).toMatchObject({
      route: "terminal-preferred-command",
      observations: 1,
      entities: 2,
      assertions: 1,
    });
    const searched = (
      await app.inject({
        method: "GET",
        url: "/api/search?contextId=local&q=PostgreSQL",
      })
    ).json();
    expect(searched.items).toContainEqual(
      expect.objectContaining({ type: "workload", label: "PostgreSQL test" }),
    );
  });

  it("uses the native Device database Surface without a TCP relay or sidecar", async () => {
    const app = await harness();
    const surface = await app.inject({
      method: "GET",
      url: "/api/databases/surface?resourceId=resource-1",
    });
    expect(surface.statusCode).toBe(200);
    expect(surface.json()).toMatchObject({ credentialPublicKey: "device-key" });
    const bindings = await app.inject({
      method: "GET",
      url: "/api/databases/bindings?resourceId=resource-1",
    });
    expect(bindings.statusCode).toBe(200);
    expect(bindings.json()).toMatchObject({ items: [] });
  });

  it("publishes database discovery and recorded operations into semantic Data and Activity views", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "fngk-atlas-semantic-runtime-"),
    );
    const app = await createApp({
      fngk: new FngkProcessClient({
        binary: fixture,
        env: { FNGK_FIXTURE_MODE: "database-resource" },
      }),
      dbPath: path.join(directory, "atlas.db"),
    });
    cleanups.push(async () => {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    });
    const discovered = await app.inject({
      method: "GET",
      url: "/api/databases/discover?contextId=local",
    });
    expect(discovered.statusCode).toBe(200);
    expect(discovered.json().items).toContainEqual(
      expect.objectContaining({ engine: "postgres", source: "adapter" }),
    );
    await app.inject({method:'POST',url:'/api/world/refresh',payload:{contextId:'local'}});
    const data = (
      await app.inject({
        method: "GET",
        url: "/api/world/projection?contextId=local&lens=data&level=2&budget=100",
      })
    ).json();
    expect(data.nodes).toContainEqual(
      expect.objectContaining({
        kind: "data-store",
        label: expect.stringContaining("postgres"),
      }),
    );
    const createdBinding=await app.inject({
      method: "POST",
      url: "/api/databases/bindings",
      payload: {
        contextId: "local",
        resourceId: "postgres-resource",
        name: "Development",
        environment: "development",
      },
    });
    expect(createdBinding.json().input).not.toHaveProperty('contextId');
    const invocation=await app.inject({method:'POST',url:'/api/databases/bindings/binding-1/invoke',payload:{contextId:'local',capability:'database.catalog',input:{section:'databases'}}});
    expect(invocation.statusCode).toBe(200);
    expect(invocation.json().input).not.toHaveProperty('contextId');
    await app.inject({method:'POST',url:'/api/world/refresh',payload:{contextId:'local'}});
    const activity = (
      await app.inject({
        method: "GET",
        url: "/api/world/projection?contextId=local&lens=activity&level=2&budget=100",
      })
    ).json();
    expect(activity.nodes).toContainEqual(
      expect.objectContaining({
        kind: "operation",
        label: "database.profile.create",
      }),
    );
  });

  it("reports an invalid remote package manifest without failing the coverage surface", async () => {
    const app = await harness();
    const response = await app.inject({
      method: "GET",
      url: "/api/coverage/commands?contextId=device%3Adevice-1&repositoryPath=%2Fsrv%2Fapp",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      commands: [],
      errors: [expect.objectContaining({ code: "invalid_package_manifest" })],
    });
  });

  it("browses, conflict-checks, saves, and scans the process-visible machine context", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "fngk-atlas-local-context-"),
    );
    await import("node:fs/promises").then(async (fs) => {
      await fs.mkdir(path.join(directory, "repo", ".git"), { recursive: true });
      await fs.mkdir(path.join(directory, "repo", "coverage"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(directory, "repo", "package.json"),
        '{"name":"local","scripts":{"coverage":"vitest --coverage"}}',
      );
      await fs.writeFile(
        path.join(directory, "repo", "index.ts"),
        "export function local(){return true;}",
      );
      await fs.writeFile(
        path.join(directory, "repo", "coverage", "lcov.info"),
        "SF:index.ts\nDA:1,1\nend_of_record\n",
      );
    });
    const app = await createApp({
      fngk: new FngkProcessClient({ binary: fixture }),
      dbPath: path.join(directory, "atlas.db"),
      localRoot: directory,
    });
    cleanups.push(async () => {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    });
    const listed = await app.inject({
      method: "GET",
      url: "/api/files?contextId=local&path=/",
    });
    expect(listed.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ name: "repo", type: "directory" }),
      ]),
      route: expect.objectContaining({ kind: "direct" }),
    });
    const opened = (
      await app.inject({
        method: "GET",
        url: "/api/files/content?contextId=local&path=/repo/index.ts",
      })
    ).json();
    expect(opened.text).toContain("return true");
    const saved = await app.inject({
      method: "PUT",
      url: "/api/files/content",
      payload: {
        contextId: "local",
        path: "/repo/index.ts",
        contentBase64: Buffer.from(
          "export function local(){return false;}",
        ).toString("base64"),
        expectedFingerprint: opened.fingerprint,
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/files/content",
          payload: {
            contextId: "local",
            path: "/repo/index.ts",
            contentBase64: Buffer.from("stale").toString("base64"),
            expectedFingerprint: opened.fingerprint,
          },
        })
      ).statusCode,
    ).toBe(409);

    const address = await app.listen({ host: "127.0.0.1", port: 0 }),
      socket = new WebSocket(
        address.replace(/^http/, "ws") + "/api/discovery/scan?contextId=local",
      ),
      batches: any[] = [];
    socket.on("message", (raw) => batches.push(JSON.parse(raw.toString())));
    await once(socket, "close");
    expect(batches.flatMap((batch) => batch.entities ?? [])).toContainEqual(
      expect.objectContaining({ type: "repository", path: "/repo" }),
    );
    const evidence = (
      await app.inject({
        method: "GET",
        url: "/api/discovery/entities?contextId=local",
      })
    ).json();
    expect(evidence.entities).toContainEqual(
      expect.objectContaining({ type: "package", path: "/repo/package.json" }),
    );
    const analysisSocket = new WebSocket(
        address.replace(/^http/, "ws") +
          "/api/analysis/repository?contextId=local&path=/repo",
      ),
      analysisMessages: any[] = [];
    analysisSocket.on("message", (raw) =>
      analysisMessages.push(JSON.parse(raw.toString())),
    );
    await once(analysisSocket, "close");
    expect(analysisMessages).toContainEqual(
      expect.objectContaining({
        type: "analysis_complete",
        index: expect.objectContaining({
          summary: expect.objectContaining({ functions: 1 }),
        }),
        coverage: "/repo/coverage/lcov.info",
      }),
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/coverage/commands?contextId=local&repositoryPath=/repo",
        })
      ).json().commands,
    ).toContainEqual(
      expect.objectContaining({
        command: "npm run coverage",
        producesCoverage: true,
      }),
    );
    const coverage = await app.inject({
      method: "POST",
      url: "/api/coverage/ingest",
      payload: { contextId: "local", repositoryPath: "/repo", revision: "abc" },
    });
    expect(coverage.json()).toMatchObject({
      evidence: { format: "lcov", revision: "abc" },
      summary: { functions: 0 },
    });
    const refreshed = await app.inject({
      method: "POST",
      url: "/api/coverage/refresh",
      payload: { contextId: "local", repositoryPath: "/repo", command: "true" },
    });
    expect(refreshed.json()).toMatchObject({
      run: { status: "succeeded" },
      coverage: { artifact: "/repo/coverage/lcov.info", verified: true },
    });
    const graph = (
      await app.inject({ method: "GET", url: "/api/software/functions?contextId=local" })
    ).json();
    expect(
      graph.items.find((node: any) => node.label === "local"),
    ).toMatchObject({ coverage: { fraction: 1, stale: false }, crap: 1 });

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/files",
          payload: { contextId: "local", path: "/repo/new", type: "directory" },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/files",
          payload: {
            contextId: "local",
            path: "/repo/new/readme.txt",
            type: "file",
            contentBase64: Buffer.from("Atlas searchable content").toString(
              "base64",
            ),
          },
        })
      ).statusCode,
    ).toBe(201);
    const firstSave = await app.inject({
      method: "POST",
      url: "/api/files/content",
      payload: {
        contextId: "local",
        path: "/repo/new/from-buffer.ts",
        contentBase64: Buffer.from("export const first = true;").toString(
          "base64",
        ),
        createOnly: true,
      },
    });
    expect(firstSave.statusCode).toBe(201);
    expect(firstSave.json()).toMatchObject({
      fingerprint: expect.any(String),
      operation: { type: "file.create.content" },
    });
    const conflictingSave = await app.inject({
      method: "POST",
      url: "/api/files/content",
      payload: {
        contextId: "local",
        path: "/repo/new/from-buffer.ts",
        contentBase64: Buffer.from("overwritten").toString("base64"),
        createOnly: true,
      },
    });
    expect(conflictingSave.statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/files/content?contextId=local&path=/repo/new/from-buffer.ts",
        })
      ).json().text,
    ).toBe("export const first = true;");
    const searched = (
      await app.inject({
        method: "GET",
        url: "/api/files/search?contextId=local&path=/repo&query=searchable&mode=all",
      })
    ).json();
    expect(searched.matches).toContainEqual(
      expect.objectContaining({ path: "/repo/new/readme.txt", line: 1 }),
    );
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/files",
          payload: {
            contextId: "local",
            path: "/repo/new/readme.txt",
            destination: "/repo/new/renamed.txt",
          },
        })
      ).statusCode,
    ).toBe(200);
    const trashed = await app.inject({
      method: "DELETE",
      url: "/api/files",
      payload: { contextId: "local", path: "/repo/new/renamed.txt" },
    });
    expect(trashed.json()).toMatchObject({
      permanent: false,
      restoreAvailable: true,
      restorePath: expect.stringMatching(/^\/\.atlas-trash\//),
      route: expect.objectContaining({ kind: "direct" }),
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/files/restore",
          payload: { contextId: "local", path: trashed.json().restorePath },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/files",
          payload: {
            contextId: "local",
            path: "/repo/new/renamed.txt",
            permanent: true,
            confirm: true,
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/files",
          payload: { contextId: "local", path: "/repo", permanent: true },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/files",
          payload: {
            contextId: "local",
            path: "//",
            permanent: true,
            confirm: true,
          },
        })
      ).statusCode,
    ).toBe(400);
    const operations = (
      await app.inject({
        method: "GET",
        url: "/api/operations?contextId=local",
      })
    ).json();
    expect(operations.items).toContainEqual(
      expect.objectContaining({
        type: "file.trash",
        summary: expect.objectContaining({ path: "/repo/new/renamed.txt" }),
      }),
    );
    const indexedSearch = (
      await app.inject({
        method: "GET",
        url: "/api/search?contextId=local&q=local",
      })
    ).json();
    expect(indexedSearch.items).toContainEqual(
      expect.objectContaining({
        type: "function",
        repositoryRoot: "/repo",
        contextId: "local",
      }),
    );
  });
});
