# Machine Observatory Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Atlas's compatibility-heavy workload/card inventory with a small, evidence-backed Machine Observatory that explains a Device's identity, current activity, health, flows, anomalies, and recent change before exposing controls.

**Architecture:** Preserve the existing FNGK transports, discovery, repository indexes, operational tools, and immutable observations. Introduce `atlas.world.v2`, normalize operational facts once, resolve only meaningful workload identities, project a stable six-region topology, and render that topology as the Device home. Migrate the remaining graph consumers to purpose-specific APIs, then remove the legacy compatibility interpreter, semantic aliases, dead graph UI, and old graph endpoint in the same cutover.

**Tech Stack:** TypeScript, Node.js `node:sqlite`, Fastify, Svelte 5, Dockview, Vitest, Playwright, existing FNGK terminal/native transports.

**Spec:** `docs/fngk-atlas-semantic-atlas-docs/2026-09-14-semantic-atlas-navigation-design.md`

## Global Constraints

- Work only on the existing `feat/fngk-native-atlas` branch; do not create another worktree.
- `atlas.world.v2` is a deliberate cutover: retain source observations and operational stores, but discard all v1-derived semantic entities, assertions, views, search rows, and changes.
- Do not retain an API, component, database row, or interpreter solely for backwards compatibility; Atlas has no external v1 consumer to preserve.
- Automatic discovery remains read-only. Every mutation or executable adapter remains explicitly confirmed through its existing boundary.
- Never persist secret values, environment plaintext, credentials, terminal tickets, or unredacted command lines in observations, semantic entities, samples, logs, or search text.
- Files, symbols, processes, services, ports, and inactive units remain evidence; they do not automatically become top-level workloads.
- The default surface is containment/topology. Cytoscape, if retained at all, is contextual relationship detail and never the Device home.
- The six topology regions and their order are fixed: Applications, Data, Infrastructure, Development, System, External.
- Normal, inactive, or low-value system inventory recedes into bounded aggregates. Degraded, failed, stale, exposed, or high-pressure facts become attention items with evidence.
- Projection budgets are semantic budgets. A Device home response contains at most 24 primary workload summaries, 12 flows, 8 attention items, and 12 recent changes.
- All IDs remain deterministic across refreshes when the underlying operational identity has not changed.
- All new behavior follows red-green-refactor TDD, with the failing command and expected failure recorded before implementation.

## Review Focus

- A host with hundreds of inactive systemd units must show a collapsed System aggregate, not hundreds of workload cards; Task 4 pins this with a 200-unit fixture.
- Nested `metadata` facts, redacted sensitive keys, and conflicting top-level values must normalize deterministically without leaking plaintext; Task 3 tests all three cases.
- An HTTP listener elsewhere on the Device must not make an unrelated Node workload look like an HTTP server; Task 6 adds a workload-scoped specialist regression.
- An offline Device with old observations must remain understandable but explicitly stale, without being reported as failed; Tasks 7 and 8 test this distinction.
- A corrupted or partially migrated v1 semantic store must recover atomically while preserving observations and non-world Atlas data; Task 2 tests rollback and restart behavior.

---

## File and interface map

Create these focused units rather than enlarging `service.ts`, `projector.ts`, or `SemanticAtlas.svelte` further:

- `src/world/normalization.ts` — converts raw `AtlasObservation` records into the one canonical operational fact shape.
- `src/world/resolution-policy.ts` — pure promotion, grouping, region, and visibility decisions.
- `src/world/materializer.ts` — builds v2 Device/workload/runtime/interface/data entities and provenance assertions from resolved groups.
- `src/world/health.ts` — pure operational state, pressure, and attention evaluation.
- `src/world/observatory.ts` — creates the bounded Device-home topology, flows, history, and synthesis contract.
- `src/world/software-projection.ts` — converts an existing repository index into the purpose-specific software/function response formerly supplied by `/api/graph`.
- `src/web/components/MachineObservatory.svelte` — Device-home orchestration only.
- `src/web/components/ObservatoryRegion.svelte` — one stable topology region and its collapsed aggregate.
- `src/web/components/ObservatoryFlow.svelte` — accessible directional flow list/overlay.
- `src/web/components/ObservatoryAttention.svelte` — bounded exceptions and recent changes.

The following files are deleted by the final cutover:

- `src/web/components/GraphPanel.svelte`
- `src/web/components/FileExplorer.svelte`
- the `atlas.compatibility` manifest/path in `src/world/service.ts` and `src/world/store.ts`
- `workloadInterpreter` / `atlas.workloads` in `src/world/interpreter.ts`
- `/api/atlas/devices/*`, `/api/atlas/entities/*`, `/api/atlas/interpreters*`, and `/api/graph` routes

## Task 1: Freeze the v2 observatory contract

**Files:**
- Modify: `src/world/types.ts`
- Modify: `test/world/world.test.ts`
- Create: `test/world/observatory-contract.test.ts`

**Interfaces:**
- Produces: `ATLAS_WORLD_VERSION = "atlas.world.v2"`.
- Produces: `OperationalHealth`, `OperationalPhase`, `TopologyRegionId`, `AtlasObservatoryRegion`, `AtlasObservatoryFlow`, `AtlasObservatoryHistoryItem`, and `AtlasObservatory`.
- Adds `topology-region` to `CoreKind`; it is presentation geography, not a workload.
- Produces: `AtlasProjection.observatory?: AtlasObservatory`; existing `nodes`, `edges`, breadcrumbs, and evidence remain available for drill-down.

- [ ] **Step 1: Write the failing protocol and budget test**

```ts
import {describe,expect,it} from 'vitest';
import {ATLAS_WORLD_VERSION,type AtlasObservatory} from '../../src/world/types.js';

describe('atlas.world.v2 observatory contract',()=>{
  it('fixes the home geography and semantic budgets',()=>{
    expect(ATLAS_WORLD_VERSION).toBe('atlas.world.v2');
    const value:AtlasObservatory={
      identity:{id:'device:one',label:'kigathi',online:true},
      health:'healthy',phase:'running',summary:'Serving one application.',
      regions:['applications','data','infrastructure','development','system','external'].map(id=>({id:id as any,label:id,health:'healthy',items:[],collapsedCount:0})),
      flows:[],attention:[],history:[],measuredAt:'2026-09-20T00:00:00.000Z',stale:false,
    };
    expect(value.regions.map(item=>item.id)).toEqual(['applications','data','infrastructure','development','system','external']);
  });
});
```

- [ ] **Step 2: Run the test and capture the expected type/protocol failure**

Run: `npx vitest run test/world/observatory-contract.test.ts`

Expected: TypeScript/Vitest fails because `AtlasObservatory` is absent and the version is `atlas.world.v1`.

- [ ] **Step 3: Add the exact v2 types**

```ts
export const ATLAS_WORLD_VERSION = 'atlas.world.v2' as const;
export type OperationalHealth='healthy'|'degraded'|'critical'|'unknown'|'stale';
export type OperationalPhase='idle'|'starting'|'running'|'stopping'|'failed'|'unknown';
export type TopologyRegionId='applications'|'data'|'infrastructure'|'development'|'system'|'external';
export interface AtlasObservatoryItem {id:string;label:string;kind:string;health:OperationalHealth;phase:OperationalPhase;purpose:string;active:boolean;stale:boolean;confidence:number;facts:Array<{label:string;value:string}>}
export interface AtlasObservatoryRegion {id:TopologyRegionId;label:string;health:OperationalHealth;items:AtlasObservatoryItem[];collapsedCount:number}
export interface AtlasObservatoryFlow {id:string;sourceId:string;targetId:string;label:string;active:boolean;health:OperationalHealth;confidence:number;stale:boolean}
export interface AtlasObservatoryHistoryItem {id:string;entityId:string;text:string;at:string;severity:'info'|'warning'|'critical'}
export interface AtlasObservatory {identity:{id:string;label:string;online:boolean};health:OperationalHealth;phase:OperationalPhase;summary:string;regions:AtlasObservatoryRegion[];flows:AtlasObservatoryFlow[];attention:AtlasAttentionItem[];history:AtlasObservatoryHistoryItem[];measuredAt:string;stale:boolean}
```

Add `observatory?: AtlasObservatory` to `AtlasProjection`. Keep v1 field removals for Task 12 so intermediate commits compile.

- [ ] **Step 4: Run contract and existing world tests**

Run: `npx vitest run test/world/observatory-contract.test.ts test/world/world.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add src/world/types.ts test/world/observatory-contract.test.ts test/world/world.test.ts
git commit -m "feat(world): define the v2 observatory contract"
```

## Task 2: Atomically discard v1-derived semantic state

**Files:**
- Modify: `src/world/store.ts`
- Modify: `test/world/world.test.ts`

**Interfaces:**
- Produces: `WorldStore.schemaVersion(): number` returning `2`.
- Produces: `WorldStore.resetDerivedWorld(): void`, transactionally clearing only world-derived tables.
- Preserves: `atlas_world_observations`; all repository indexes, evidence, operations, deployments, terminal sessions, and files live outside this reset.

- [ ] **Step 1: Add a failing migration preservation test**

Seed a temporary SQLite file with a v1 observation plus `atlas.compatibility` and `atlas.workloads` entities, reopen it through `WorldStore`, and assert:

```ts
expect(store.schemaVersion()).toBe(2);
expect(store.observations('local')).toHaveLength(1);
expect(store.entities('local')).toEqual([]);
expect(store.interpreters().map(item=>item.id)).not.toContain('atlas.compatibility');
```

Also open a fixture whose `atlas_world_meta` says `2` and assert reopening does not erase v2 entities.

- [ ] **Step 2: Run the migration test and verify stale rows survive today**

Run: `npx vitest run test/world/world.test.ts -t 'migrates the semantic world to v2'`

Expected: FAIL because no schema marker exists and v1-derived rows remain.

- [ ] **Step 3: Implement one transactionally guarded schema gate**

In the constructor, create `atlas_world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)`, read `schema_version`, and when it is not `2` execute one `BEGIN IMMEDIATE` transaction that:

1. preserves `atlas_world_observations`;
2. drops/recreates `atlas_world_entities`, `atlas_world_assertions`, `atlas_world_changes`, `atlas_world_interpreters`, `atlas_world_views`, and `atlas_world_search`;
3. writes `schema_version=2` only after all recreated tables/indexes succeed;
4. rolls back on any error.

Add these concrete accessors:

```ts
schemaVersion(){return Number((this.db.prepare("SELECT value FROM atlas_world_meta WHERE key='schema_version'").get() as any)?.value??0)}
observations(contextId:string){/* map stored rows back to AtlasObservation */}
resetDerivedWorld(){/* same derived-table transaction, preserving observations */}
```

Remove the `manifest.id==='atlas.compatibility'` ownership exception from `sync`; every interpreter owns only its own namespace.

- [ ] **Step 4: Verify atomic migration and ordinary persistence**

Run: `npx vitest run test/world/world.test.ts`

Expected: PASS, including observation preservation and idempotent reopen.

- [ ] **Step 5: Commit the schema cutover**

```bash
git add src/world/store.ts test/world/world.test.ts
git commit -m "refactor(world): reset v1 derived semantic state"
```

## Task 3: Normalize operational observations once

**Files:**
- Create: `src/world/normalization.ts`
- Modify: `src/world/observation-adapters.ts`
- Modify: `src/world/service.ts`
- Modify: `src/discovery/runtime-discovery.ts`
- Create: `test/world/normalization.test.ts`
- Modify: `test/discovery/runtime-discovery.test.ts`

**Interfaces:**
- Produces: `normalizeObservation(observation: AtlasObservation): InterpreterInput`.
- Produces canonical attributes: `pid`, `ppid`, `cwd`, `systemdUnit`, `activeState`, `subState`, `containerId`, `repositoryPath`, `protocol`, `address`, `port`, `cpuPercent`, `rssBytes`, `elapsedSeconds`, `processState`, `managedDeploymentId`, `environment`, and `routeId`.
- Rule: explicit safe top-level facts win over nested `metadata`; sensitive keys are omitted rather than copied.

- [ ] **Step 1: Write failing normalization tests**

```ts
it('flattens allowed runtime metadata without leaking secrets',()=>{
  const input=normalizeObservation(observation({facts:{pid:12,metadata:{pid:99,cwd:'/srv/app',active:'active',state:'running',rssBytes:2048,password:'never'}}}));
  expect(input.attributes).toMatchObject({pid:12,cwd:'/srv/app',activeState:'active',subState:'running',rssBytes:2048});
  expect(JSON.stringify(input)).not.toContain('never');
});
```

Add a second test proving string ports become integers only when `1..65535`, and invalid CPU/RSS values are omitted.

- [ ] **Step 2: Run the tests and verify `cwd`/state are currently nested**

Run: `npx vitest run test/world/normalization.test.ts test/discovery/runtime-discovery.test.ts`

Expected: FAIL because `normalizeObservation` does not exist.

- [ ] **Step 3: Implement allowlisted normalization**

Use an explicit alias table, not object spreading:

```ts
const aliases={activeState:['activeState','active'],subState:['subState','state'],repositoryPath:['repositoryPath','root','path']} as const;
const safeKeys=['pid','ppid','cwd','systemdUnit','containerId','protocol','address','routeId','environment','managedDeploymentId'] as const;
```

Read candidates from `{...facts.metadata,...facts}` only through these names, validate number/string domains, and return a redacted `InterpreterInput`. Preserve `source`, `observedAt`, and `stale` exactly.

Change `WorldService.refresh` to call `normalizeObservation` instead of reconstructing inputs ad hoc.

- [ ] **Step 4: Add bounded live activity fields to runtime discovery**

Change the process command to:

```sh
ps -eo pid=,ppid=,user=,comm=,pcpu=,rss=,etimes=,stat=,args=
```

Parse `%CPU`, RSS KiB→bytes, elapsed seconds, and process state into metadata. Do not add another shell round trip.

- [ ] **Step 5: Verify normalized and discovery fixtures**

Run: `npx vitest run test/world/normalization.test.ts test/discovery/runtime-discovery.test.ts test/world/world.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit normalization**

```bash
git add src/world/normalization.ts src/world/observation-adapters.ts src/world/service.ts src/discovery/runtime-discovery.ts test/world/normalization.test.ts test/discovery/runtime-discovery.test.ts test/world/world.test.ts
git commit -m "feat(world): normalize operational observations"
```

## Task 4: Resolve meaningful workloads and collapse system inventory

**Files:**
- Create: `src/world/resolution-policy.ts`
- Modify: `src/world/resolver.ts`
- Create: `test/world/resolution-policy.test.ts`
- Modify: `test/world/world.test.ts`

**Interfaces:**
- Produces: `resolveOperationalWorld(inputs: InterpreterInput[], clock?:()=>string): ResolvedWorld`.
- Produces `ResolvedWorkload {id:string;label:string;anchor:string;memberIds:string[];region:TopologyRegionId;visibility:'primary'|'collapsed';healthHint?:OperationalHealth;confidence:number}`.
- Produces `ResolvedWorld {workloads:ResolvedWorkload[];mapping:Record<string,string>;aggregates:{system:number;inactive:number;unknown:number};conflicts:IdentityConflict[];unresolved:Array<{inputId:string;bucket:'system'|'inactive'|'unknown';reason:string}>}`.
- Produces `unresolved` grouped into `system`, `inactive`, and `unknown`; unresolved inputs are retained as observation references, not promoted entities.

- [ ] **Step 1: Write the 200-unit regression fixture**

Create 180 inactive systemd services, 15 active OS services, one active PostgreSQL service, one managed deployment, one repository plus correlated process, and three unrelated processes. Assert:

```ts
const result=resolveOperationalWorld(inputs,clock);
expect(result.workloads.filter(item=>item.visibility==='primary').map(item=>item.label).sort()).toEqual(['atlas-web','postgresql']);
expect(result.workloads.find(item=>item.label==='atlas-web')?.memberIds).toEqual(expect.arrayContaining(['repo:atlas','process:42','deployment:atlas']));
expect(result.aggregates).toMatchObject({system:15,inactive:180,unknown:3});
```

Add non-merge cases for same executable name, same conventional port, unrelated repositories, and PID reuse.

- [ ] **Step 2: Run the resolver test and record the present over-promotion**

Run: `npx vitest run test/world/resolution-policy.test.ts`

Expected: FAIL because current `resolveWorkloads` promotes every service/repository with one signal.

- [ ] **Step 3: Implement explicit promotion scores**

Use these fixed signals:

| Signal | Score | Region |
|---|---:|---|
| managed deployment/release identity | 100 | applications |
| explicit database instance/engine+endpoint | 95 | data |
| running container identity | 90 | infrastructure unless repository-correlated |
| repository plus running process whose cwd is inside it | 90 | applications |
| active service plus owned running process | 75 | system by default |
| repository alone | 25 | development aggregate |
| process, executable name, PID, or conventional port alone | 0 | unresolved |

Promote at `>=75`. Mark only managed deployments, repository-correlated processes, databases, and explicitly user-owned services as `primary`; active OS services remain `collapsed` in System. Union groups only through deployment ID, container ID, systemd unit ownership, database identity, or repository↔cwd correlation.

- [ ] **Step 4: Preserve deterministic identity and conflicts**

Generate IDs from the highest-priority stable anchor, retain every agreeing signal, and emit an `identity-conflict` record when two strong anchors disagree. Do not merge the conflicting groups.

- [ ] **Step 5: Verify resolution tests**

Run: `npx vitest run test/world/resolution-policy.test.ts test/world/world.test.ts`

Expected: PASS with two primary workloads and bounded aggregates.

- [ ] **Step 6: Commit the resolver policy**

```bash
git add src/world/resolution-policy.ts src/world/resolver.ts test/world/resolution-policy.test.ts test/world/world.test.ts
git commit -m "feat(world): resolve operational workloads by strong identity"
```

## Task 5: Materialize a compact semantic world with provenance

**Files:**
- Create: `src/world/materializer.ts`
- Modify: `src/world/service.ts`
- Modify: `src/world/relationships.ts`
- Modify: `test/world/world.test.ts`

**Interfaces:**
- Consumes: `ResolvedWorld` from Task 4.
- Produces: `materializeWorld(contextId, device, resolved, inputs, clock): InterpreterOutput`.
- Produces only Device, primary/collapsed workload, capability, relevant runtime unit, interface, data store, topology-region, event, and operation entities.

- [ ] **Step 1: Add a failing compactness/provenance test**

Feed 20,000 file/function observations plus the Task 4 runtime fixture and assert:

```ts
const output=materializeWorld('local',device,resolved,inputs,clock);
expect(output.entities.length).toBeLessThan(250);
expect(output.entities.some(item=>item.kind==='function')).toBe(false);
expect(output.assertions.every(item=>item.evidence.length>0)).toBe(true);
expect(output.entities.filter(item=>item.kind==='workload'&&item.attributes.visibility==='primary')).toHaveLength(2);
```

- [ ] **Step 2: Run and verify the compatibility mirror violates the budget**

Run: `npx vitest run test/world/world.test.ts -t 'materializes a compact semantic world'`

Expected: FAIL because `WorldService` still copies the technical graph.

- [ ] **Step 3: Implement semantic materialization**

Create the Device plus six deterministic `topology-region` entities. For each resolved workload, create one workload entity and only its service/process/container/port/database members. Emit canonical assertions:

```text
device contains topology-region
topology-region contains workload
workload realized-by process|container
workload controlled-by service
workload implemented-by repository
workload listens-on interface
workload stores-in data-store
workload depends-on workload|external-system
```

Every assertion names the exact observation IDs and method. Repository files/symbols remain in the repository index until the software projection is requested.

- [ ] **Step 4: Replace the compatibility path in `WorldService.refresh`**

Remove `kindMap`, `legacyManifest`, technical node copying, legacy edge copying, and compatibility-owned core entities. Register/sync only `atlas.resolver.v2`, built-in specialists, and trusted extensions.

- [ ] **Step 5: Verify compactness, stable IDs, and withdrawal history**

Run: `npx vitest run test/world/world.test.ts test/world/observatory-contract.test.ts`

Expected: PASS. A second identical refresh creates no `changed` events; removing a workload creates one `withdrawn` event.

- [ ] **Step 6: Commit materialization**

```bash
git add src/world/materializer.ts src/world/service.ts src/world/relationships.ts test/world/world.test.ts
git commit -m "refactor(world): materialize a compact semantic model"
```

## Task 6: Make specialists workload-scoped and extensible

**Files:**
- Modify: `src/world/specialists.ts`
- Modify: `src/world/interpreter.ts`
- Modify: `src/world/registry.ts`
- Modify: `src/world/types.ts`
- Modify: `test/world/world.test.ts`
- Modify: `test/world/registry.test.ts`

**Interfaces:**
- Produces: `SpecialistContext {workload:AtlasEntity;members:InterpreterInput[];relationships:AtlasAssertion[]}`.
- Extends interpreter manifests with optional bounded `stage: 'recognize'|'enrich'|'present'` and `views`; JSON rule packages remain data-only.
- Signed code packages are not introduced in this cutover; advanced execution remains the existing confirmed Device-adapter boundary.

- [ ] **Step 1: Add the cross-workload HTTP regression**

Build workload A with Fastify evidence and workload B with an unrelated TCP listener. Assert only A receives `http-serving`. Add PostgreSQL, Docker, and Signal identity fixtures and require evidence refs to belong to the matched workload.

- [ ] **Step 2: Run and demonstrate the global-input bug**

Run: `npx vitest run test/world/world.test.ts -t 'scopes specialist evidence to one workload'`

Expected: FAIL because the Node specialist currently scans all Device inputs.

- [ ] **Step 3: Pass only member inputs to each specialist**

Change every matcher to accept `SpecialistContext`; delete access to the global input array. Keep capabilities and descriptors deterministic. Validate that manifests cannot claim output kinds or predicates outside their declaration and that production rejects unsigned packages.

- [ ] **Step 4: Verify specialist and registry tests**

Run: `npx vitest run test/world/world.test.ts test/world/registry.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit specialist isolation**

```bash
git add src/world/specialists.ts src/world/interpreter.ts src/world/registry.ts src/world/types.ts test/world/world.test.ts test/world/registry.test.ts
git commit -m "fix(world): scope specialists to resolved workloads"
```

## Task 7: Derive health, phase, pressure, and active flows

**Files:**
- Create: `src/world/health.ts`
- Modify: `src/world/store.ts`
- Modify: `src/world/materializer.ts`
- Create: `test/world/health.test.ts`
- Modify: `test/world/world.test.ts`

**Interfaces:**
- Produces: `evaluateOperationalState(entity, members, deviceOnline): {health,phase,active,reasons}`.
- Produces: `WorldStore.putSamples(samples)`, `WorldStore.samples(contextId, entityId?, since?)` with a 24-hour/10,000-row-per-context bound.
- Health precedence: offline→stale; explicit failed/crash-loop→critical; unhealthy readiness or pressure→degraded; running+ready→healthy; insufficient evidence→unknown.

- [ ] **Step 1: Write failing health-table tests**

Cover running, starting, stopped/idle, failed, stale-offline, 95% CPU, memory pressure, and unknown evidence. Explicitly assert offline is `stale`, not `critical`.

- [ ] **Step 2: Run and verify the health model is absent**

Run: `npx vitest run test/world/health.test.ts`

Expected: FAIL because `evaluateOperationalState` does not exist.

- [ ] **Step 3: Implement pure health/phase evaluation**

Evaluate only normalized fields and explicit readiness/deployment events. Include machine pressure only when a threshold is crossed (`cpuPercent>=90`, memory utilization `>=90%`, or restart count over policy). Return human-readable evidence-backed reasons; never infer “healthy” merely from freshness.

- [ ] **Step 4: Add bounded sample persistence**

Create `atlas_world_samples(context_id,entity_id,metric,value,unit,observed_at)` and indexes. Upsert current CPU/RSS/restart/readiness samples during refresh, then prune rows older than 24 hours and rows beyond the newest 10,000 per context.

- [ ] **Step 5: Derive flows only from scoped assertions**

Mark flows active when source and target are current and a current listener/dependency/operation assertion supports them. Never connect workloads by shared port number or label.

- [ ] **Step 6: Verify state, bounds, and flows**

Run: `npx vitest run test/world/health.test.ts test/world/world.test.ts`

Expected: PASS, including sample pruning and stale behavior.

- [ ] **Step 7: Commit operational semantics**

```bash
git add src/world/health.ts src/world/store.ts src/world/materializer.ts test/world/health.test.ts test/world/world.test.ts
git commit -m "feat(world): derive operational health and activity"
```

## Task 8: Project the bounded Machine Observatory

**Files:**
- Create: `src/world/observatory.ts`
- Modify: `src/world/projector.ts`
- Modify: `src/world/synthesis.ts`
- Modify: `src/world/salience.ts`
- Modify: `src/world/service.ts`
- Modify: `src/world/store.ts`
- Create: `test/world/observatory.test.ts`

**Interfaces:**
- Produces: `buildObservatory(rootId, entities, assertions, changes, samples, now): AtlasObservatory`.
- `projectWorld(...,{lens:'overview'})` includes `observatory`; non-overview lenses retain bounded semantic nodes/edges.
- `WorldService.projection` reads bounded `timeline(contextId, undefined, 200)` and samples from `WorldStore`, then passes both to `projectWorld`; callers never query the database from projector helpers.

- [ ] **Step 1: Write the five-question acceptance fixture**

For one Device with a healthy web deployment, PostgreSQL, an external route, a failed worker, and CPU pressure, assert the response answers:

```ts
expect(model.identity.label).toBe('kigathi');
expect(model.phase).toBe('running');
expect(model.health).toBe('degraded');
expect(model.flows).toEqual(expect.arrayContaining([expect.objectContaining({sourceId:webId,targetId:postgresId,active:true})]));
expect(model.attention.map(item=>item.text).join(' ')).toMatch(/worker|CPU/);
```

Assert exact region ordering and budgets: primary items `<=24`, flows `<=12`, attention `<=8`, history `<=12`.

- [ ] **Step 2: Run and verify current synthesis only counts workloads**

Run: `npx vitest run test/world/observatory.test.ts`

Expected: FAIL because no observatory projection exists.

- [ ] **Step 3: Implement deterministic topology and synthesis**

Sort primary items by health severity, active state, operational salience, then stable ID. Put collapsed workloads into their region count. Select flows by active first, unhealthy second, confidence third. Synthesis language must be factual and bounded:

```text
"This Device is running 2 primary workloads. Web serves HTTP through one public route and depends on PostgreSQL. One worker requires attention."
```

Do not use “healthy” when readiness is unknown and do not describe stale observations in the present tense.

- [ ] **Step 4: Verify topology determinism and offline copy**

Shuffle entity/assertion input order and expect byte-equivalent regions/flows. Set the Device offline and assert the summary uses “was last observed” and every current-state claim is stale.

- [ ] **Step 5: Commit the projector**

```bash
git add src/world/observatory.ts src/world/projector.ts src/world/synthesis.ts src/world/salience.ts test/world/observatory.test.ts
git commit -m "feat(world): project the machine observatory"
```

## Task 9: Add canonical world and software APIs

**Files:**
- Create: `src/world/software-projection.ts`
- Modify: `src/server/app.ts`
- Modify: `test/server/app.test.ts`
- Modify: `test/integration/live-acceptance.ts`

**Interfaces:**
- Keeps: `/api/world/projection`, `/api/world/search`, `/api/world/entities/:id`, `/evidence`, `/timeline`, `/neighborhood`, `/refresh`.
- Adds: `GET /api/software/functions?contextId&indexId&limit` returning `{items:[{id,label,path,complexity,coverage,crap,stale}]}`.
- Adds canonical interpreter/device-adapter administration at `/api/world/interpreters`, `/api/world/interpreters/recompute`, `/api/device-adapters`, and `/api/device-adapters/:id/run`.
- Keeps old `/api/atlas/*` and `/api/graph` routes only until Tasks 11–12 migrate every in-repository consumer and delete them; no final compatibility route remains.

- [ ] **Step 1: Add failing canonical-route tests**

Assert the overview response uses `atlas.world.v2` and contains `observatory`. Add a function projection fixture with coverage/CRAP and assert the new endpoint response. Assert the new interpreter and adapter route names return the same canonical payload during this migration task.

- [ ] **Step 2: Run and verify aliases still resolve**

Run: `npx vitest run test/server/app.test.ts -t 'serves canonical observatory routes'`

Expected: FAIL because the canonical administration and software-function routes do not exist.

- [ ] **Step 3: Extract function projection and register canonical routes**

Move the existing function filtering/coverage serialization out of `/api/graph` into `software-projection.ts`. Register exact routes above and update live acceptance from `/api/graph?type=function` to `/api/software/functions`.

Do not remove old aliases or `/api/graph` in this intermediate commit. Their deletion is Task 12 and is accepted only after the source scan proves no consumer remains.

- [ ] **Step 4: Verify server and live-acceptance compilation**

Run: `npx vitest run test/server/app.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit canonical APIs**

```bash
git add src/world/software-projection.ts src/server/app.ts test/server/app.test.ts test/integration/live-acceptance.ts
git commit -m "feat(api): expose canonical observatory and software routes"
```

## Task 10: Replace the Device home with a stable observatory schematic

**Files:**
- Create: `src/web/components/MachineObservatory.svelte`
- Create: `src/web/components/ObservatoryRegion.svelte`
- Create: `src/web/components/ObservatoryFlow.svelte`
- Create: `src/web/components/ObservatoryAttention.svelte`
- Modify: `src/web/components/SemanticAtlas.svelte`
- Modify: `src/web/components/PanelHost.svelte`
- Modify: `src/web/enhancements.css`
- Modify: `e2e/workbench.spec.ts`

**Interfaces:**
- Consumes: `projection.observatory` from Task 8.
- Emits existing `onenter(entityId)` and `state.select(...)`; no second navigation store.
- Placement policy remains: Observatory/workflows in central workspace, terminal/log/activity/coverage in Operations, intelligence in the left sidebar.

- [ ] **Step 1: Write a failing first-launch Playwright scenario**

Stub a v2 observatory and assert, without opening another tab:

```ts
await expect(page.getByRole('heading',{name:'kigathi'})).toBeVisible();
await expect(page.getByText('Applications',{exact:true})).toBeVisible();
await expect(page.getByText('web → PostgreSQL')).toBeVisible();
await expect(page.getByRole('button',{name:/failed worker/i})).toBeVisible();
await expect(page.getByText('180 inactive system services')).toBeVisible();
```

Also assert each of the six regions has one stable DOM region and the page has no horizontal body scrollbar at 1440×900 or 390×844.

- [ ] **Step 2: Run and verify the card wall fails the scenario**

Run: `npx playwright test e2e/workbench.spec.ts --grep 'orients a first-time user with the Machine Observatory' --reporter=line`

Expected: FAIL because `MachineOverview` renders counters/cards rather than topology/state/flow.

- [ ] **Step 3: Build the schematic from semantic regions**

`MachineObservatory` renders, in order:

1. Device identity, purpose summary, overall health, phase, and freshness;
2. six stable `ObservatoryRegion` boxes in a responsive semantic grid;
3. active directional flows as accessible text plus restrained CSS connectors;
4. attention items at their affected region and in one bounded strip;
5. recent meaningful history;
6. secondary controls (refresh, relationships, inspect).

Normal items use low contrast. `degraded`, `critical`, and `stale` use distinct icon+text+color treatments. Motion respects `prefers-reduced-motion`. Every click target has a keyboard path and visible focus.

- [ ] **Step 4: Wire home and preserve drill-down**

Render `MachineObservatory` only for Device overview. A workload click enters its existing semantic interior; Inspect selects it without navigation. Relationships stays an explicit top-level view.

- [ ] **Step 5: Verify focused browser and Svelte checks**

Run: `npm run check:web && npx playwright test e2e/workbench.spec.ts --grep 'Machine Observatory|semantic Device atlas' --reporter=line`

Expected: PASS with no console errors.

- [ ] **Step 6: Commit the Observatory UI**

```bash
git add src/web/components/MachineObservatory.svelte src/web/components/ObservatoryRegion.svelte src/web/components/ObservatoryFlow.svelte src/web/components/ObservatoryAttention.svelte src/web/components/SemanticAtlas.svelte src/web/components/PanelHost.svelte src/web/enhancements.css e2e/workbench.spec.ts
git commit -m "feat(web): make the Machine Observatory the Device home"
```

## Task 11: Migrate drill-down, Inspector, search, and coverage consumers

**Files:**
- Modify: `src/web/components/SemanticAtlas.svelte`
- Create: `src/web/components/WorkloadInterior.svelte`
- Create: `src/web/components/SpecialistSections.svelte`
- Modify: `src/web/components/RelationshipsView.svelte`
- Modify: `src/web/components/DetailsPanel.svelte`
- Modify: `src/web/components/Navigator.svelte`
- Modify: `src/web/components/MetricsPanel.svelte`
- Modify: `src/web/components/UnifiedSearch.svelte`
- Modify: `src/web/lib/atlas-navigation.ts`
- Modify: `test/web/atlas-navigation.test.ts`
- Modify: `e2e/workbench.spec.ts`

**Interfaces:**
- Details uses only `/api/world/entities/*`.
- Metrics uses only `/api/software/functions`.
- Search uses `/api/search` as the one merged endpoint; Navigator no longer performs parallel world+legacy requests.
- Interpreter and adapter management uses `/api/world/interpreters*` and `/api/device-adapters*`.
- Navigation remains `{contextId,rootId?,view,level}` and browser back/forward restores it.

- [ ] **Step 1: Add failing consumer tests**

Use request interception to fail any `/api/atlas/*` or `/api/graph*` request. Navigate Device→workload→runtime→software→function, render a specialist descriptor, open Inspector evidence, run a search, open Functions & Coverage, and assert all complete.

- [ ] **Step 2: Run and capture legacy requests**

Run: `npx playwright test e2e/workbench.spec.ts --grep 'uses only canonical observatory APIs' --reporter=line`

Expected: FAIL from `DetailsPanel`, `Navigator`, or `MetricsPanel` requesting an old route.

- [ ] **Step 3: Migrate each consumer**

Change `DetailsPanel` entity/timeline URLs to `/api/world`. Make Navigator call only `/api/search`, whose server already merges semantic, repository, evidence, deployment, and live-project results, and move its interpreter/adapter calls to the new canonical routes. Change Metrics to `/api/software/functions`. Preserve semantic `workloadId` when opening a file/function so breadcrumbs return to the workload.

`WorkloadInterior` renders purpose/status first, then Components & capabilities, Runtime, Interfaces, Data, Resources, Activity, and Software. `SpecialistSections` renders only validated `AtlasViewDescriptor` sections and never executes markup or code from an interpreter package.

Keep `RelationshipsView` contextual: it receives only the selected root's bounded neighborhood, lays nodes out from stable semantic IDs, exposes the same relationships as an accessible list, selects on one click, and enters on an explicit Enter/Open action. It never becomes the home view or silently expands to the whole Device.

- [ ] **Step 4: Verify drill-down and history**

Run: `npx vitest run test/web/atlas-navigation.test.ts && npx playwright test e2e/workbench.spec.ts --grep 'canonical observatory APIs|browser history' --reporter=line`

Expected: PASS.

- [ ] **Step 5: Commit consumer migration**

```bash
git add src/web/components/SemanticAtlas.svelte src/web/components/WorkloadInterior.svelte src/web/components/SpecialistSections.svelte src/web/components/RelationshipsView.svelte src/web/components/DetailsPanel.svelte src/web/components/Navigator.svelte src/web/components/MetricsPanel.svelte src/web/components/UnifiedSearch.svelte src/web/lib/atlas-navigation.ts test/web/atlas-navigation.test.ts e2e/workbench.spec.ts
git commit -m "refactor(web): converge on canonical world navigation"
```

## Task 12: Delete compatibility code and the old graph schema

**Files:**
- Delete: `src/web/components/GraphPanel.svelte`
- Delete: `src/web/components/FileExplorer.svelte`
- Delete: `src/web/components/MachineOverview.svelte`
- Delete: `src/web/components/SemanticCard.svelte`
- Delete: `src/web/components/SemanticCardGrid.svelte`
- Modify: `src/web/components/PanelHost.svelte`
- Modify: `src/world/interpreter.ts`
- Modify: `src/world/service.ts`
- Modify: `src/world/store.ts`
- Modify: `src/server/app.ts`
- Modify: `test/world/world.test.ts`
- Modify: `test/server/app.test.ts`
- Modify: `e2e/workbench.spec.ts`

**Interfaces:**
- Removes: `workloadInterpreter`, `atlas.workloads`, `atlas.compatibility`, PanelHost `graph`, all `/api/atlas/*`, and `/api/graph`.
- Keeps: `RelationshipsView.svelte` as the sole contextual graph visualization.

- [ ] **Step 1: Add a failing absence test**

```ts
expect((await app.inject({method:'GET',url:'/api/graph'})).statusCode).toBe(404);
expect((await app.inject({method:'GET',url:'/api/atlas/interpreters'})).statusCode).toBe(404);
expect(worldStore.interpreters().map(item=>item.id)).not.toEqual(expect.arrayContaining(['atlas.compatibility','atlas.workloads']));
```

Add a source-level test that `PanelHost.svelte` contains neither `graph:` nor `FileExplorer`, and that no source imports `MachineOverview` or `SemanticCardGrid`.

- [ ] **Step 2: Run and verify old surfaces still exist**

Run: `npx vitest run test/server/app.test.ts test/world/world.test.ts test/web/context-actions.test.ts`

Expected: FAIL until the old routes and loaders are deleted.

- [ ] **Step 3: Delete old code rather than deprecating it**

Remove the files, exports, routes, manifest registration, compatibility-specific store branch, tests, and event names. Update the live acceptance execution correlation proof to query `/api/world/projection?lens=runtime` or entity evidence, never `/api/graph`.

- [ ] **Step 4: Scan for dead references**

Run:

```bash
rg -n "atlas\.compatibility|atlas\.workloads|workloadInterpreter|/api/atlas|/api/graph|GraphPanel|FileExplorer|MachineOverview|SemanticCard(Grid)?|component:'graph'" src test e2e
```

Expected: no matches.

- [ ] **Step 5: Verify the cutover tests**

Run: `npm test && npm run typecheck && npm run check:web`

Expected: PASS.

- [ ] **Step 6: Commit deletion**

```bash
git add -A src test e2e
git commit -m "refactor(atlas): remove the legacy graph compatibility layer"
```

## Task 13: Add bounded local documentation enrichment

**Files:**
- Create: `src/world/enrichment.ts`
- Modify: `src/world/service.ts`
- Modify: `src/world/types.ts`
- Create: `test/world/enrichment.test.ts`

**Interfaces:**
- Produces: `enrichFromLocalDocumentation(workload, inputs, documents, clock): InterpreterOutput`.
- Accepts only already-authorized bounded text from `README*`, package manifests, service descriptions, and deployment manifests; no network fetch occurs in this release.
- Emits `declared` purpose/capability assertions in namespace `atlas.enrichment.local-docs`, always citing path, observation ID, and excerpt.

- [ ] **Step 1: Write failing authority and redaction tests**

Provide a README purpose sentence, a `package.json` description, a conflicting inferred purpose, and a document containing a token-shaped value. Assert the declared purpose wins presentation, the conflict remains in evidence, the token is absent, excerpts are at most 240 characters, and unrelated documentation cannot enrich another workload.

- [ ] **Step 2: Run and verify enrichment is absent**

Run: `npx vitest run test/world/enrichment.test.ts`

Expected: FAIL because local documentation has no bounded enrichment path.

- [ ] **Step 3: Implement deterministic local enrichment**

Read only content already supplied by the repository analyzer or an authorized file read. Cap each document at 64 KiB and each workload at 10 documents. Extract package description, first README prose paragraph, declared ports/scripts, and deployment-manifest purpose. Apply existing redaction before persistence; reject binary or invalid UTF-8 input.

Authority ordering is fixed: `user-defined > observed > declared > derived > inferred`. A higher-authority assertion selects presentation copy; lower/conflicting assertions remain queryable.

- [ ] **Step 4: Wire enrichment after resolution and before projection**

Run enrichment only for resolved workloads whose repository/deployment members identify the document scope. Register/sync it like any other interpreter output so withdrawal occurs when the source document disappears.

- [ ] **Step 5: Verify enrichment and world tests**

Run: `npx vitest run test/world/enrichment.test.ts test/world/world.test.ts`

Expected: PASS without network access or secret-shaped text.

- [ ] **Step 6: Commit local enrichment**

```bash
git add src/world/enrichment.ts src/world/service.ts src/world/types.ts test/world/enrichment.test.ts test/world/world.test.ts
git commit -m "feat(world): enrich workloads from local documentation"
```

## Task 14: Add user corrections without mutating evidence

**Files:**
- Create: `src/world/corrections.ts`
- Modify: `src/world/store.ts`
- Modify: `src/world/service.ts`
- Modify: `src/server/app.ts`
- Modify: `src/web/components/DetailsPanel.svelte`
- Create: `test/world/corrections.test.ts`
- Modify: `test/server/app.test.ts`

**Interfaces:**
- Produces: `AtlasCorrection {id,contextId,subjectId,kind:'rename'|'purpose'|'group'|'ignore'|'split'|'merge',value,createdAt,updatedAt}`.
- Adds: `PUT /api/world/entities/:id/correction` with `{kind,value,confirm:true}` and `DELETE` with `{confirm:true}`.
- Corrections create `user-defined` assertions and never edit observations or interpreter assertions.

- [ ] **Step 1: Write failing correction precedence tests**

Assert rename/purpose/group override presentation, ignore hides only the selected entity, and deleting the correction restores interpreter output. Assert conflicting interpreter evidence remains in the evidence response.

- [ ] **Step 2: Run and verify corrections are absent**

Run: `npx vitest run test/world/corrections.test.ts`

Expected: FAIL because correction storage/API does not exist.

- [ ] **Step 3: Implement correction storage and application**

Store corrections in `atlas_world_corrections`, keyed independently of derived entities. Apply them after resolver/specialists and before projection. Split/merge values must name explicit stable entity IDs and reject cross-context IDs. Require `confirm:true` for every mutation.

- [ ] **Step 4: Add Inspector controls with provenance copy**

Expose Rename, Describe purpose, Move region, Ignore, Split, Merge, and Reset under a “Correct Atlas” disclosure. Show “User-defined” beside corrected fields and retain “Why Atlas believes this” separately.

- [ ] **Step 5: Verify correction and server tests**

Run: `npx vitest run test/world/corrections.test.ts test/server/app.test.ts && npm run check:web`

Expected: PASS.

- [ ] **Step 6: Commit corrections**

```bash
git add src/world/corrections.ts src/world/store.ts src/world/service.ts src/server/app.ts src/web/components/DetailsPanel.svelte test/world/corrections.test.ts test/server/app.test.ts
git commit -m "feat(world): retain explicit semantic corrections"
```

## Task 15: Prove bounded refresh, restart recovery, and live Device behavior

**Files:**
- Modify: `src/world/background-refresh.ts`
- Modify: `src/world/refresh-worker.ts`
- Modify: `test/world/world.test.ts`
- Modify: `test/integration/live-acceptance.ts`
- Modify: `scripts/live-acceptance.sh`
- Modify: `docs/fngk-atlas-semantic-atlas-docs/2026-09-14-semantic-atlas-current-state-audit.md`
- Create: `docs/machine-observatory.md`

**Interfaces:**
- Refresh remains explicit/deduplicated and worker-bounded at 512 MiB old generation.
- A worker failure leaves the last complete v2 projection readable and records one refresh error; it never half-applies a world.

- [ ] **Step 1: Add failure/restart tests**

Test worker cancellation, malformed extension output, forced worker exit, two simultaneous refresh requests, restart over the same database, and a 20,000-observation fixture. Assert last-good projection remains readable and entity/home budgets hold.

- [ ] **Step 2: Run and record any atomicity failures**

Run: `npx vitest run test/world/world.test.ts test/server/app.test.ts`

Expected before implementation: at least the forced-exit/last-good assertion fails if refresh writes are visible incrementally.

- [ ] **Step 3: Stage refreshes by generation**

Add a refresh generation ID to derived rows or write into temporary generation tables, then atomically switch the active generation only after resolver, specialists, assertions, search, and samples complete. On failure, delete the incomplete generation and expose `{code:'world_refresh_failed',lastGoodAt}`.

Implementation deviation (2026-09-21): SQLite WAL already provides the required last-good isolation. The cutover uses one `BEGIN IMMEDIATE` transaction around the complete refresh and savepoints for nested store writes, rather than duplicating every derived table by generation. A worker exit rolls back the uncommitted transaction; the parent records a refresh error and the API exposes `lastGoodAt`. Failure, worker-exit, restart, and live Device tests verify the observable contract.

- [ ] **Step 4: Extend live acceptance**

The disposable exact-head run must prove:

1. pair and authorize one Device;
2. discover runtime/repository evidence;
3. refresh `atlas.world.v2`;
4. show at least one primary workload and a bounded System aggregate;
5. correlate process→repository without `/api/graph`;
6. expose state/flow/attention provenance;
7. restart Atlas and restore the same semantic IDs;
8. disconnect the Device and show stale—not failed—state;
9. reconnect and clear staleness after refresh;
10. scan retained evidence for fixture secrets.

- [ ] **Step 5: Document the product and update the stale audit**

`docs/machine-observatory.md` explains topology, state, flow, attention, evidence, corrections, refresh, and specialist boundaries. Update the audit with a dated “implemented cutover” section; retain its historical diagnosis rather than rewriting history.

- [ ] **Step 6: Run the complete verification matrix**

```bash
npm test
npm run typecheck
npm run check:web
npm run build
npm run test:e2e
npm run test:live
npm audit --audit-level=high
git diff --check
```

Expected: all tests/builds pass; audit reports zero high-or-higher vulnerabilities; the known Vite chunk advisory may remain only if it is still lazy and non-blocking.

- [ ] **Step 7: Commit acceptance and documentation**

```bash
git add src/world/background-refresh.ts src/world/refresh-worker.ts test/world/world.test.ts test/integration/live-acceptance.ts scripts/live-acceptance.sh docs/machine-observatory.md docs/fngk-atlas-semantic-atlas-docs/2026-09-14-semantic-atlas-current-state-audit.md
git commit -m "test(atlas): prove the Machine Observatory cutover"
```

## Final review and completion gate

- [ ] Confirm `git status --short` is clean before review.
- [ ] Review every commit against this plan and the navigation design; reject any compatibility alias or unproven present-tense health claim.
- [ ] Verify a source scan returns no legacy identifiers listed in Task 12.
- [ ] Inspect the Device home at desktop and narrow viewport with reduced motion enabled.
- [ ] Confirm workflows still open in the central workspace, observability tabs in Operations, filesystem/Intelligence in the left sidebar, and sidebars retain width when the center is empty.
- [ ] Confirm no secret fixture value appears in `.atlas/atlas.db`, browser storage, terminal replay, world observations, search rows, or build output.
- [ ] Update this plan only with factual deviations discovered during implementation; do not mark a task complete from compilation alone.

The cutover is complete only when a first-time user can open a Device and answer, from the initial screen, what it is, what it is doing, whether it is healthy, where activity is flowing, and what deserves attention—then descend to evidence or operations without encountering a second competing machine model.
