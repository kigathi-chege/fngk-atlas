# FNGK Atlas Semantic Atlas — Implementation Plan

**Date:** 2026-09-14  
**Design:** `docs/superpowers/specs/2026-09-14-semantic-atlas-navigation-design.md`  
**Audit:** `docs/superpowers/specs/2026-09-14-semantic-atlas-current-state-audit.md`  
**Recommended implementation branch:** `feat/semantic-atlas-navigation`  
**Base:** current `feat/fngk-native-atlas` head while PR #1 is open; rebase/retarget to `main` after PR #1 merges.

---

## 0. Implementation strategy

Do not begin with the card UI.

The repository currently has a semantic model in `src/world/*`, but the live application still serves the old `buildGraphLens` path. Building cards on `/api/graph` would reproduce the current architectural mismatch behind a new visual skin.

Implement in this order:

```text
observations
→ semantic identity resolution
→ canonical world service/store
→ semantic API
→ synthesis + semantic projection
→ navigation state
→ card Atlas UI
→ entity interiors
→ contextual Relationships graph
→ deeper software/filesystem integration
→ specialists/documentation enrichment
→ old graph-path retirement
```

Every phase should leave the application runnable and the existing workbench/tools usable.

---

# Phase 1 — Make the semantic world a real backend subsystem

## Task 1.1 — Add observation adapters for current evidence

### Goal

Convert the evidence Atlas already collects into `AtlasObservation` records without changing current discovery behavior.

### Add

- `src/world/observation-adapters.ts`
- `src/world/observation-adapters.test.ts`

### Modify

- `src/world/types.ts` only if missing normalized fields are demonstrably required.
- discovery/server integration sites to call adapters after current evidence is stored.

### Adapter inputs

At minimum:

- runtime evidence-store entities/relationships;
- repository/package/module/function index nodes;
- FNGK context/Device/profile/connection facts;
- database resources when a stable runtime identity is known;
- file/repository facts relevant to workload identity.

### Rules

- Preserve original source ID.
- Preserve context ID.
- Preserve observed timestamp/freshness.
- Preserve route/effective access metadata where available.
- Mark secret-bearing content as `sensitive-reference`; never embed secret values.
- Do not infer workload identity in the adapter.

### Tests first

Cover:

- process → observation;
- service → observation;
- container → observation;
- listener/port → observation;
- repository/package → observation;
- FNGK Device/context → observation;
- stale evidence;
- redaction/sensitivity.

### Verify

```bash
npx vitest run src/world/observation-adapters.test.ts
npm run typecheck
```

Use the repository's actual Vitest invocation syntax if the wrapper does not forward arguments as expected.

---

## Task 1.2 — Introduce semantic world persistence/service boundary

### Goal

Give the semantic layer one authoritative service rather than letting server/UI code call interpreters/projectors ad hoc.

### Add

- `src/world/world-service.ts`
- `src/world/world-service.test.ts`
- persistence additions in the existing store layer, or a dedicated `src/world/world-store.ts` if separation is cleaner.

### Proposed API

```ts
interface WorldService {
  ingest(observations: AtlasObservation[]): Promise<WorldRefreshResult>;
  refreshContext(contextId: string): Promise<WorldRefreshResult>;
  entities(contextId: string): Promise<AtlasEntity[]>;
  assertions(contextId: string): Promise<AtlasAssertion[]>;
  projection(contextId: string, options: ProjectionOptions): Promise<AtlasProjection>;
  entity(contextId: string, id: string): Promise<AtlasEntityDetail | undefined>;
  search(contextId: string, query: string): Promise<AtlasSearchResult[]>;
}
```

Exact async/sync signatures should follow the existing persistence layer.

### Persistence

Persist enough to support:

- stable semantic identity across process restarts;
- stale/offline snapshots;
- evidence provenance;
- incremental refresh;
- user-defined assertions later.

Do not duplicate large raw source payloads already owned by existing stores.

### Tests

- ingest is idempotent for identical observations;
- updated observation refreshes timestamps without duplicating entity identity;
- context isolation;
- stale propagation;
- evidence links survive persistence/reload.

---

# Phase 2 — Resolve logical workloads instead of relabelling technical nodes

## Task 2.1 — Create entity/workload resolver

### Goal

Fuse multiple observations into stable logical entities before specialist interpretation.

### Add

- `src/world/resolver.ts`
- `src/world/resolver.test.ts`
- optionally `src/world/identity-signals.ts`

### Resolver output

Return:

- resolved semantic entities;
- mapping from observation/technical entity IDs to semantic entity IDs;
- confidence/reason for merge decisions;
- unresolved candidates/conflicts;
- assertions linking semantic entities back to runtime/software evidence.

### Strong signals to implement first

1. systemd service/unit ↔ processes through unit/cgroup evidence;
2. container ↔ owned processes through container identity;
3. process ↔ repository/package through cwd/executable/command/runtime-code correlation;
4. listener/socket ↔ owning process/workload;
5. repository/package ↔ declared application identity where manifest evidence exists;
6. database service/process/listener ↔ one database workload where stable identifiers support it.

### Explicit non-merge cases

- two unrelated Node processes with the same executable;
- two repositories with similar names but no runtime link;
- conventional port alone;
- parent process relationship alone when it crosses a clear service/container boundary.

### Stable workload keys

Derive IDs from the strongest available stable identity tuple, with a deterministic fallback.

Examples of anchor families:

```text
systemd:<context>:<unit>
container:<context>:<container-id>
fngk-resource:<context>:<resource-id>
application:<context>:<repo/package-identity>
database:<context>:<engine>:<instance-identity>
```

Process PID must never be the only stable workload identity.

### Tests

Create fixture scenarios:

- Signal systemd unit + Node process + cwd + repository + :4999 → one Signal workload candidate;
- PostgreSQL service + several worker processes + :5432 + data directory → one PostgreSQL workload;
- Docker daemon separate from containers it controls;
- two Node dev servers in different repos remain separate;
- restarted PID retains workload identity;
- ambiguous data remains unresolved rather than fused.

---

## Task 2.2 — Refactor workload interpreter to enrich resolved entities

### Modify

- `src/world/interpreter.ts`
- `src/world/interpreter.test.ts`

### Change

Stop treating every `service|process|container|repository|database` input as an independent workload by default.

Instead:

1. resolver establishes workload candidates/entities;
2. workload/specialist interpreters assign purpose/capabilities and additional relationships;
3. technical entities stay linked via `realized-by`, `implemented-by`, `controlled-by`, `exposes`, etc.

### Keep

- manifest validation;
- deterministic world IDs;
- interpreter budgets;
- classification/confidence/explanation/evidence;
- PostgreSQL/Signal/Docker/HTTP rules as initial enrichment rules, adjusted to consume resolved entity context.

### Add tests

- specialist classification does not duplicate workload;
- capability entity is reused across multiple workloads;
- evidence list contains all relevant observations used by the conclusion;
- low-confidence HTTP inference remains lower confidence than explicit framework/protocol evidence.

---

# Phase 3 — Define canonical containment and semantic relationships

## Task 3.1 — Add semantic relationship helpers/contracts

### Add

- `src/world/relationships.ts`
- `src/world/relationships.test.ts`

### Define core predicates

Start with the minimum useful set:

```text
contains
realized-by
controlled-by
runs-as
implemented-by
provides-capability
consumes-capability
depends-on
exposes
listens-on
connects-to
reads
writes
configured-by
owned-by
imports
calls
```

### Rules

- `parentId` is canonical navigation containment only.
- Do not infer `parentId` from every `contains` edge.
- A technical node can be related to a workload without becoming its navigational child if it belongs in another projection.
- Workload/component/software containment must be deterministic and stable.

### Tests

- breadcrumbs follow parent chain only;
- lateral dependency does not change canonical parent;
- cyclic dependencies do not create breadcrumb cycles;
- orphan entities remain navigable through appropriate aggregate/unknown scopes.

---

## Task 3.2 — Extend semantic kinds only where needed

### Modify

- `src/world/types.ts`

### Candidate addition

- `component`

Do not add dozens of new core kinds. Prefer specialist attributes and view descriptors unless a concept is cross-domain and structurally necessary.

### Versioning

If the serialized world contract changes incompatibly, increment `ATLAS_WORLD_VERSION` deliberately and add migration/rebuild behavior. If the change is additive and old persisted data can be safely rebuilt, document that decision.

---

# Phase 4 — Replace the prototype projector with a navigation-aware semantic projector

## Task 4.1 — Split card projection from relationship graph projection

### Modify

- `src/world/projector.ts`

### Add tests

- `src/world/projector.test.ts`

### Required projector modes

At minimum:

```text
overview
runtime
data
network
resources
security
software
activity
relationships
evidence
```

### Overview behavior

For a root entity:

1. return canonical semantic children/cards;
2. return semantic aggregates with meaningful labels and destinations;
3. return breadcrumbs from `parentId`;
4. return salient summary facts;
5. return available views;
6. do not crawl arbitrary relationship neighborhoods to populate the main card field.

### Relationship behavior

For the same root:

- return bounded semantic relationship neighborhood;
- allow relationship-category filters;
- keep graph budget/pagination independent from card pagination.

### Replace generic aggregates

From:

```ts
{ kind, count }
```

Toward a richer structure such as:

```ts
{
  id,
  label,
  kind,
  count,
  destination,
  summary,
  stale
}
```

Exact schema can be decided during implementation.

---

## Task 4.2 — Add semantic salience

### Add

- `src/world/salience.ts`
- `src/world/salience.test.ts`

### Goal

Choose 2–4 facts per card without frontend heuristics.

Potential priorities:

- state/freshness;
- key capability;
- exposed interface;
- direct dependency count;
- resource summary;
- active component/process count;
- specialist-provided metric.

Salience must be deterministic and should not change card order just because a volatile metric fluctuates.

---

# Phase 5 — Build deterministic machine synthesis

## Task 5.1 — Add synthesis service

### Add

- `src/world/synthesis.ts`
- `src/world/synthesis.test.ts`

### Output

A structured object, not raw prose only:

```ts
interface AtlasSynthesis {
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
```

### Initial synthesis rules

- active workload count;
- running/stopped/stale workload state;
- primary capabilities;
- known client/dependency relationships;
- externally/local exposed interfaces with honest reachability wording;
- development activity when supported by repository + dev-runtime evidence;
- recent failed services/process churn if observed;
- resource attention only when supported by a meaningful threshold/baseline;
- recent Atlas operations.

### Do not

- require an LLM;
- call a process “production” without evidence;
- call a listener publicly reachable when only local listening is known;
- claim a function is executing because its repository process is running.

---

# Phase 6 — Expose the semantic API

## Task 6.1 — Wire WorldService into Fastify

### Modify

- `src/server/app.ts`
- server construction/dependency wiring as needed.

### Add endpoints

#### `GET /api/world/projection`

Supports:

```text
contextId
rootId
view
level
cursor
```

#### `GET /api/world/entities/:id`

#### `GET /api/world/entities/:id/evidence`

#### `GET /api/world/search`

### Discovery integration

After `/api/discovery/scan` batches or completion:

- update world observations;
- refresh affected semantic entities;
- notify UI with a semantic refresh event/message.

After `/api/analysis/repository` completion:

- ingest relevant repository/software observations;
- rerun affected workload resolution;
- invalidate semantic software projection.

### Keep `/api/graph`

Do not delete it yet. Mark it legacy/internal once semantic UI reaches parity.

### Tests

Add Fastify route tests for:

- context isolation;
- Device overview;
- workload projection;
- evidence endpoint;
- search;
- invalid/stale root;
- pagination/budget boundaries;
- no secret values in semantic response fixtures.

---

# Phase 7 — Introduce semantic navigation state in the web app

## Task 7.1 — Add navigation store

### Add

- `src/web/lib/atlas-navigation.ts`
- `src/web/lib/atlas-navigation.test.ts`

### State

At minimum:

```ts
interface AtlasLocation {
  contextId: string;
  rootId?: string;
  view: AtlasView;
  level?: number;
  focusId?: string;
}
```

### Required actions

- `enter(entityId)`;
- `up()`;
- `openView(view)`;
- `home()`;
- `replace(location)`;
- URL serialization/parsing;
- browser `popstate` handling.

### Constraints

- semantic location is separate from Dockview panel state;
- selecting/inspecting an entity does not necessarily navigate;
- context switch resets/rehydrates to that Device home;
- unknown/stale deep link degrades to nearest valid ancestor/home.

### Tests

- enter/up;
- Back/Forward state replay;
- context switch;
- deep-link serialization;
- malformed URL fallback;
- inspect-only state does not push semantic history.

---

# Phase 8 — Build the central Semantic Atlas surface

## Task 8.1 — Add semantic components

### Add

- `src/web/components/SemanticAtlas.svelte`
- `src/web/components/MachineOverview.svelte`
- `src/web/components/SemanticCardGrid.svelte`
- `src/web/components/SemanticCard.svelte`
- `src/web/components/AtlasBreadcrumbs.svelte`
- `src/web/components/AtlasViewTabs.svelte`

### UI responsibilities

`SemanticAtlas.svelte`:

- binds semantic navigation to projection API;
- displays loading/partial/stale/error states;
- renders header synthesis;
- renders cards/aggregates;
- opens contextual tool panels through existing workbench events;
- keeps keyboard focus/history stable.

`SemanticCard.svelte`:

- primary click/Enter = enter semantic entity;
- inspect secondary action = update inspector selection;
- never overload double-click.

### Empty states

Examples:

- “No host census has completed yet — refresh discovery.”
- “Atlas has runtime evidence but cannot yet resolve workloads.”
- “This workload has no mapped software yet — map repository.”
- “Last observed while Device was online …”

---

## Task 8.2 — Make semantic Atlas the default central experience

### Modify

- `src/web/components/Workbench.svelte`
- `src/web/components/PanelHost.svelte`
- panel registry if required.

### Seed layout

Replace default active Architecture graph with Semantic Atlas.

Keep:

- Navigator left;
- Filesystem right;
- Inspector;
- Activity/metrics tools;
- Dockview persistence.

Migration:

- bump workbench layout version if required so stale layouts do not hide the new primary Atlas surface;
- preserve user file buffers/panels where safe.

### Tests/E2E

- initial central panel is semantic Atlas;
- restored layouts still recover required protected panels;
- narrow layout keeps semantic Atlas available;
- opening files/terminal/database remains functional.

---

# Phase 9 — Redesign Navigator and Inspector around semantic context

## Task 9.1 — Navigator

### Modify

- `src/web/components/Navigator.svelte`

### Primary content

- Device/context;
- current semantic path;
- semantic search;
- top-level views;
- pinned/recent workloads if implemented.

### Secondary tools

Move Scan host, Map repository, Terminal, Database, Live project, Diagnostics into a clearly secondary Tools/Actions area.

Do not remove manual refresh/map operations; demote them from the information architecture.

### Search

Use `/api/world/search` first. Show technical matches nested beneath semantic entities.

Fallback to current unified technical search only for unmapped items.

---

## Task 9.2 — Inspector

### Modify

- `src/web/components/DetailsPanel.svelte`

### Add

Structured semantic sections:

- identity/type;
- purpose/capabilities;
- state/freshness;
- salient metrics;
- relationships;
- runtime/software references;
- classification/confidence;
- evidence links.

Use `AtlasViewDescriptor` sections when applicable.

The Inspector remains selection-oriented and does not replace the entity page.

---

# Phase 10 — Convert Cytoscape into Relationships view

## Task 10.1 — Refactor graph component

### Modify or replace

- `src/web/components/GraphPanel.svelte`
- `src/web/lib/graph-model.ts`

Recommended end state:

- rename/refactor to `RelationshipsView.svelte` if this improves clarity;
- consume semantic projection for a specific `rootId`;
- default graph root is current semantic entity;
- use semantic predicates instead of old global technical lens types;
- expansion controls are relationship-category based;
- technical deep graph remains available from Software/Runtime views.

### Keep from current implementation

- Cytoscape;
- fit/focus;
- saved positions where applicable;
- relationship filtering;
- node selection;
- source opening for software nodes.

### Remove as primary concepts

- default `code` graph lens;
- World/Machine/Code/Function/Execution selector as the main Atlas navigation;
- generic `Expand N more` aggregate;
- machine-wide broad layer set enabled before the user has context.

### Compatibility

Keep the old graph model temporarily behind a developer/legacy route until semantic parity tests pass, then delete it.

---

# Phase 11 — Integrate Software and filesystem semantic drill-down

## Task 11.1 — Attach repository analysis to semantic workload

### Modify

- repository analysis completion path;
- resolver/software assertions;
- semantic projection.

### Result

A mapped repository/package should appear under the workload it implements when evidence supports the relationship.

Do not make every repository an active workload merely because it exists on disk.

### Cases

- repository with active runtime → implemented-by link to workload;
- repository not running → Software/project entity under Device or development collection, not falsely “running workload”;
- monorepo → packages/components can map to different workloads if runtime evidence supports it.

---

## Task 11.2 — Preserve semantic context when opening files

### Modify

- file-open event parameters if needed;
- editor/buffer metadata;
- workbench state.

Include optional semantic origin metadata:

```text
root workload/entity
software entity
source symbol
```

This allows “Back to Signal Agent” or breadcrumb context without changing file-service semantics.

---

# Phase 12 — Add specialist interpreters

Implement specialists incrementally; do not block the generic semantic UI on all of them.

## Task 12.1 — systemd specialist

Recognize:

- unit identity;
- state;
- cgroup/process ownership;
- dependencies;
- control relationships;
- restart/failure evidence.

## Task 12.2 — PostgreSQL specialist

Recognize:

- server/instance/cluster identity where available;
- relational-storage capability;
- listener;
- data directory (reference, not secret content);
- clients/connections where observable;
- databases through existing DB integration;
- specialist views.

## Task 12.3 — Docker/containerd specialist

Recognize:

- daemon workload;
- containers as separate workload/runtime boundaries where semantically appropriate;
- networks/volumes;
- image/runtime relationships;
- controlled-by/contains semantics without fusing daemon and containers.

## Task 12.4 — Node/SvelteKit/Fastify specialist

Recognize where evidence supports it:

- runtime framework;
- dev vs built server cautiously;
- HTTP endpoints/routes from existing static/runtime evidence;
- package/workspace implementation;
- worker/server components.

## Task 12.5 — Signal/FNGK specialist

Use explicit Signal/FNGK identities and FNGK resource evidence to identify:

- remote-machine-control;
- terminal/device connectivity;
- agent/runtime components;
- relevant interfaces;
- semantic links to the Device/context being controlled.

Every specialist requires tests that prove both positive recognition and false-positive resistance.

---

# Phase 13 — Documentation enrichment foundation

## Task 13.1 — Add enrichment interface

### Add

- `src/world/enrichment/types.ts`
- `src/world/enrichment/local-docs.ts`
- tests.

### First release

Use only local sources by default:

- package metadata;
- README/docs discovered inside mapped repositories/packages;
- man-page/package metadata where safe and bounded.

### Optional later route

Add explicit upstream official-documentation retrieval behind policy/user action.

### Output

Emit evidence-backed declared/inferred assertions and documentation view references.

Do not store unbounded complete documents or secret-bearing configuration.

---

# Phase 14 — Activity and resource semantics

## Task 14.1 — Resource projection

Add/resource-normalize:

- CPU;
- memory;
- process counts;
- storage if available;
- network if available.

Aggregate technical usage under resolved workload without hiding raw process metrics.

## Task 14.2 — Activity timeline

Normalize meaningful events:

- discovery changes;
- process/service lifecycle;
- Atlas runs;
- file saves;
- repository analysis/coverage operations;
- interface changes;
- specialist events where available.

Keep event volume bounded/aggregated. Atlas is not trying to become a raw log warehouse.

---

# Phase 15 — User-defined semantic corrections

This phase can follow the first usable semantic Atlas release.

## Add support for

- rename workload;
- merge/split workload candidates;
- choose canonical parent;
- pin capability/purpose;
- reject an inference.

Store as `user-defined` assertions or resolver constraints.

Never mutate/delete raw observations to implement a correction.

---

# Phase 16 — Migrate and retire old graph-first architecture

## Preconditions

Do not delete old graph code until:

- semantic Device overview works;
- semantic search works;
- workload/runtime/software navigation works;
- relationship graph supports current important graph operations;
- function/source drill-down works;
- runtime/code evidence remains accessible;
- e2e coverage proves context isolation and navigation.

## Then

- remove old `GraphLens` types where no longer used;
- remove `buildGraphLens` from `/api/graph` consumers;
- remove the machine-wide default graph panel from layout migration;
- preserve any low-level debug graph only behind an explicit developer surface if still useful.

---

# Phase 17 — Test matrix

## Unit

- observation adapters;
- resolver identity/fusion;
- relationship helpers;
- interpreter manifest/classification;
- projector containment/views;
- salience;
- synthesis;
- navigation serialization/history;
- specialist interpreters.

## Server integration

- semantic projection routes;
- search/evidence routes;
- context scoping;
- stale/offline behavior;
- discovery → world refresh;
- repository-analysis → software association.

## Web component

Where current test tooling permits:

- card keyboard interaction;
- breadcrumb/Up behavior;
- loading/stale/empty/error states;
- view switching;
- semantic search result behavior.

## Playwright E2E

Add scenarios:

1. start Atlas on a fixture host/context;
2. Device overview appears without selecting a graph lens;
3. enter workload;
4. navigate to Runtime;
5. navigate to Software/module;
6. browser Back/Forward restores exact semantic state;
7. open Relationships and confirm root is workload;
8. open source file and return to semantic workload;
9. switch context and ensure no cross-context entities leak;
10. stale/offline Device is labelled correctly.

## Live acceptance

Extend existing live acceptance so it proves:

- real FNGK Device discovery populates semantic world;
- Signal/PostgreSQL or equivalent known workloads are grouped rather than duplicated as raw process/service/repo peers;
- evidence links can be inspected;
- existing terminal/file/database operations still work.

---

# Phase 18 — Verification commands

Run throughout implementation:

```bash
npm test
npm run typecheck
npm run check:web
npm run build
npm run test:e2e
```

For integration-ready milestones also run the existing live acceptance script where environment prerequisites are available:

```bash
npm run test:live
```

Do not treat a green semantic unit suite as proof FNGK route integration or real-host entity resolution works.

---

# Phase 19 — Suggested commit/PR slicing

Avoid one massive implementation PR if possible. A safe stack is:

### PR A — Semantic world integration

- observations;
- world service/store;
- resolver;
- interpreter changes;
- semantic API;
- tests.

### PR B — Semantic Atlas navigation/UI

- navigation state;
- Machine overview;
- cards/breadcrumbs/views;
- Workbench default change;
- Navigator/Inspector integration;
- E2E.

### PR C — Relationships migration + software drill-down

- semantic Cytoscape view;
- source/software navigation;
- old graph compatibility/deprecation.

### PR D+ — Specialists

- PostgreSQL/systemd/Docker/Node/Signal interpreters;
- documentation enrichment;
- richer activity/resources.

If the team intentionally wants one implementation sprint, keep these as commit boundaries even within one branch so regressions can be bisected.

---

# Phase 20 — Definition of done

The semantic-atlas implementation is not complete merely when boxes render.

It is complete when all of the following are true:

- Atlas opens to a useful semantic explanation of the selected computer.
- Major logical workloads are not duplicated as independent raw process/service/repository cards.
- Capabilities communicate purpose.
- Semantic cards support reliable enter/up/back/forward navigation.
- Device/workload view state is deep-linkable.
- Files, runtime, data, network, resources, software, and evidence are available as projections of the same world.
- Cytoscape is contextual to a selected semantic root.
- Repository/function depth remains accessible.
- Assertions expose provenance/classification/confidence.
- Unknown/ambiguous entities remain honest.
- FNGK authorization and current operation safety are unchanged.
- Existing file/editor/terminal/database/live-project/coverage functionality remains available.
- Tests and live acceptance prove context isolation and real-host semantic resolution.

---

# First implementation milestone recommendation

The first milestone should deliberately stop before specialist richness and prove the core architecture with only a few recognizable workloads.

Target:

1. local/selected Device semantic home;
2. resolver can fuse at least systemd/process/repository/listener evidence;
3. bundled capabilities identify Signal/FNGK, PostgreSQL, Docker, generic HTTP serving where justified;
4. cards + breadcrumbs + Up + browser history;
5. workload Overview/Runtime/Software/Relationships/Evidence views;
6. Cytoscape relationship graph rooted in the selected workload;
7. existing expert tools still open normally.

If this milestone feels immediately useful on the developer's own computer, the architecture is correct. If it still requires mentally decoding technical categories, stop and fix the semantic model before adding more collectors.
