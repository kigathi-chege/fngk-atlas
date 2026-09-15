# FNGK Atlas Semantic Atlas — Current-State Audit

**Date:** 2026-09-14  
**Repository:** `kigathi-chege/fngk-atlas`  
**Reviewed branch:** `feat/fngk-native-atlas`  
**Related open work:** PR #1 (`feat/fngk-native-atlas` → `main`)  
**Purpose of this document:** establish the implementation reality that the semantic-atlas redesign must build on. This is an audit, not an implementation specification.

---

## 1. Executive conclusion

FNGK Atlas already has most of the difficult low-level machinery required to become a genuine atlas of a computer:

- FNGK-native context discovery and authorized Device access;
- local and remote filesystem access;
- terminal-backed host discovery;
- repository and symbol analysis;
- runtime/process evidence and runtime-to-code correlation;
- databases, live projects, diagnostics, coverage, execution evidence, and activity;
- Dockview-based composable workbench surfaces;
- a new semantic world vocabulary with provenance-aware assertions;
- a semantic interpreter and semantic projector prototype.

The primary problem is therefore **not insufficient data collection**. It is that the application's authoritative presentation path still exposes the implementation inventory before Atlas has interpreted the machine for the user.

Today, the main visual architecture is:

```text
raw runtime/repository/context facts
        ↓
/api/graph
        ↓
buildGraphLens(world | machine | code | function | execution)
        ↓
GraphPanel / Cytoscape
        ↓
user interprets technical nodes and relationships
```

At the same time, a second architecture now exists under `src/world/`:

```text
observations
    ↓
interpreters
    ↓
semantic entities + assertions + provenance
    ↓
projectWorld(overview | runtime | code | data | network | security | activity)
```

The second architecture is conceptually much closer to the product Atlas wants to become, but it is not wired into `src/server/app.ts` and does not currently govern the main UI.

The redesign should therefore **reconcile the two models instead of adding a third one**.

The intended end state is:

> Atlas observes technical facts, resolves them into semantic entities such as workloads and capabilities, synthesizes what the computer is doing, and presents a navigable semantic hierarchy first. Graphs, files, processes, ports, symbols, databases, and raw evidence remain available as progressively deeper or relational views.

---

## 2. Product question the current implementation does not answer quickly enough

A first-time user should be able to open Atlas and answer, within seconds:

1. What is this computer doing right now?
2. What are the major workloads on it?
3. What capabilities do those workloads provide?
4. Which things are active, exposed, unhealthy, resource-heavy, or otherwise worth attention?
5. What depends on what?
6. How does a workload map down to runtime processes, services, interfaces, data, files, packages, modules, and functions?
7. Why does Atlas believe each semantic claim?

The current graph makes questions 5–7 possible for a technically motivated user, but it does not make questions 1–4 the natural entrance to the system.

That is why the implementation feels useful only after the user already knows what they are looking for.

---

## 3. Current architecture inventory

### 3.1 Access and context boundary

The original design correctly establishes FNGK as Atlas's authorization and transport boundary.

Relevant implementation areas:

- `src/fngk/*`
- `src/server/context-service.ts`
- `src/domain/access.ts`
- `src/transports/*`
- `src/files/file-service.ts`
- `src/web/components/Navigator.svelte`

The design principle should remain:

- Atlas does not become a second identity system.
- FNGK determines the effective authorized namespace.
- Atlas may use structured adapters, local access, or terminal-backed access according to the route available to the current context.
- Facts retain route, identity/privilege, freshness, and provenance.

This is strong infrastructure and should not be disturbed by the semantic UI redesign.

### 3.2 Host discovery

The host-discovery path gathers operational facts about a selected context. The browser initiates this through the Navigator and `/api/discovery/scan`.

In `src/web/components/Navigator.svelte`, the current user flow is explicitly operational:

- choose context;
- Scan host;
- Map repository;
- open Architecture;
- open Database;
- open Live project;
- use search.

The scan route stores runtime entities in the evidence store. Once discovery completes, `src/server/app.ts` correlates runtime evidence with any repository index already known for the context.

This is useful, but scanning is currently presented as a tool operation rather than as the mechanism continuously feeding the semantic model.

### 3.3 Repository analysis

Repository analysis is a distinct path, initiated with a repository path and streamed through `/api/analysis/repository`.

Relevant implementation areas include:

- `src/analysis/repository-analyzer.ts`
- `src/correlation/runtime-code.ts`
- coverage services;
- `src/server/app.ts`;
- graph and metrics surfaces.

The analyzer creates repository/package/module/function/test and relationship evidence, while runtime correlation associates code with processes or other runtime facts when evidence supports that relationship.

This should remain lazy and context-first. It should become a deeper semantic drill-down from a workload or software component instead of being one of the first concepts the user must manually operate.

### 3.4 Evidence store and persistence

`src/store/evidence-store.ts` stores observed runtime entities and relationships. The repository also persists analysis indexes, layouts, run summaries, coverage, and related data through its current storage abstractions.

The semantic redesign needs to preserve the crucial distinction between:

- raw observations;
- normalized facts;
- semantic entities;
- assertions derived from those observations;
- user-authored interpretations.

Do not overwrite raw evidence with semantic conclusions.

### 3.5 Server graph path

The current canonical visual path is `GET /api/graph` in `src/server/app.ts`.

It currently:

1. resolves a selected repository index if one exists;
2. merges repository nodes with runtime evidence-store entities;
3. when the requested lens is `world`, injects FNGK profile/context/connection nodes;
4. filters generated paths;
5. computes visible matching nodes/edges;
6. invokes `buildGraphLens(...)` if a lens is requested;
7. returns nodes, edges, counts, minimal breadcrumbs, saved layout, and errors.

This is the key architectural fact for the redesign:

> `src/server/app.ts` does not call `projectWorld`, does not call `workloadInterpreter`, and exposes no `/api/world` semantic endpoint.

The semantic `src/world/*` layer is therefore not the application's source of truth today.

### 3.6 Old graph projection model

`src/web/lib/graph-model.ts` defines the currently active graph lenses:

- `world`
- `machine`
- `code`
- `function`
- `execution`

Each is principally a set of technical node types plus relationship filters and a visible node budget. The graph-model implementation also adds an aggregate node when the budget is exceeded, rendered with text such as:

```text
Expand N more
```

This makes the graph computationally bounded, but the aggregation is not semantic. It controls density rather than explaining complexity.

### 3.7 Graph UI

`src/web/components/GraphPanel.svelte` confirms that the old graph model remains the default architecture surface.

Current behavior includes:

- default lens: `code`;
- default budget: 90;
- broad relationship-layer set enabled;
- Cytoscape graph rendering;
- raw technical node-type coloring;
- count text such as `N nodes · M links`;
- grid or breadth-first layout;
- single-click selection;
- double-click drill-down for repository/package/module/function;
- aggregate click increases the node budget;
- lens selector for World / Machine / Code / Function / Execution.

This explains the user's reported problem. Atlas opens with the representation an engineer might use to inspect its internal evidence graph, rather than the representation a human would use to understand a machine.

### 3.8 Dockview workbench

`src/web/components/Workbench.svelte` is strong and worth preserving.

The default seeded desktop composition is approximately:

```text
Navigator | Workspace / Architecture | Filesystem
          | Functions & Coverage     | Inspector
          | Activity & Runs          |
```

The `Architecture` graph is created in the center and activated by default.

The shell already provides:

- persistent panels;
- movable/minimizable tools;
- an anchor workspace;
- file/editor/terminal/database/live-project surfaces;
- responsive behavior;
- state persistence and recovery.

The redesign should not replace Dockview. It should replace **what the central Atlas surface means**.

### 3.9 Navigator

`src/web/components/Navigator.svelte` is mostly an operation launcher and context selector today.

Its concepts are:

- FNGK context;
- host scan;
- repository map;
- search functions/modules/processes;
- terminal;
- filesystem;
- database;
- live project;
- architecture.

There is no first-class semantic path such as:

```text
Computer / Signal / Agent / Software / Module
```

and no canonical semantic back/up/deeper model.

### 3.10 Inspector

The inspector currently reacts to a selected graph/file/process/function entity and mainly exposes available fields or operational actions.

It is not yet a semantic object page that can say, for example:

> Signal Agent — provides remote-machine-control, runs as `signal-default-4999.service`, currently owns these processes and interfaces, is implemented by this repository/package, depends on PostgreSQL, and has these supporting observations.

The new `AtlasViewDescriptor` type points toward this future but is not yet used as the UI's governing model.

---

## 4. The semantic world prototype already in the repository

The most important finding from the re-audit is that the repository has already begun solving the ontology problem.

### 4.1 `src/world/types.ts`

This file defines a significantly better core vocabulary.

`CoreKind` includes:

- device;
- environment;
- identity;
- workload;
- capability;
- service;
- process;
- job;
- container;
- runtime;
- interface;
- port;
- socket;
- HTTP endpoint;
- external system;
- repository/package/module/class/function/test;
- file/directory;
- data store/database/table;
- configuration/dependency/resource/event/operation.

It also defines:

- `AtlasObservation`;
- `AtlasEntity`;
- `AtlasAssertion`;
- assertion classes `observed | declared | derived | inferred | user-defined`;
- evidence references;
- confidence;
- interpreter identity/version;
- `AtlasViewDescriptor`;
- `AtlasProjection`;
- breadcrumbs;
- semantic expansion levels.

This is substantially closer to the desired product ontology than the old graph-type lens model.

### 4.2 `src/world/interpreter.ts`

The interpreter system introduces a manifest-driven way to derive semantic entities and assertions from technical inputs.

The bundled `workloadInterpreter` currently recognizes generic workload-like inputs and special cases for:

- PostgreSQL → relational storage;
- Signal/FNGK → remote machine control;
- Docker/containerd → container orchestration;
- conventional HTTP listeners → HTTP serving.

This is the correct direction, but the implementation is not yet true entity resolution.

The generic workload rule maps each matching input independently into a workload-like semantic entity. It does not yet prove that:

```text
systemd unit
+ process tree
+ cgroup
+ repository
+ package
+ listener
+ data directory
```

are evidence about **one logical workload**.

That workload-fusion/resolution stage is the most important semantic backend work still missing.

### 4.3 `src/world/projector.ts`

The newer projector defines user-meaningful lenses:

- overview;
- runtime;
- code;
- data;
- network;
- security;
- activity.

It also:

- picks a semantic root;
- filters semantic kinds per lens;
- walks related assertions;
- follows `parentId` for breadcrumbs;
- returns semantic aggregates by kind;
- exposes expansion levels labelled Workloads, Runtime and interfaces, Software components, Functions and evidence.

This is closer to the desired semantic zoom model.

However, its current traversal remains relationship-neighborhood-oriented rather than a fully defined canonical navigation hierarchy, and it is not connected to the server/UI.

---

## 5. The central architectural conflict

There are currently two competing models:

### Model A — current production path

```text
ProgramIndex + runtime nodes + context nodes
        ↓
old GraphLens
        ↓
Cytoscape
```

Its organizing concepts are technical types and relationship layers.

### Model B — semantic prototype

```text
observations
    ↓
interpreters
    ↓
semantic entities/assertions
    ↓
semantic projection
```

Its organizing concepts are workload, capability, identity, interfaces, data, runtime, code, and provenance.

The redesign must make Model B authoritative and then adapt the existing graph to consume Model B when a relationship graph is actually useful.

Do **not** add semantic cards directly on top of `/api/graph`. That would preserve the wrong source of truth and force the frontend to re-infer meaning from raw technical nodes.

---

## 6. What is already correct and should be preserved

### 6.1 FNGK authorization boundary

Atlas should continue to consume the effective FNGK context rather than duplicate credentials, teams, root grants, or Signal auth state.

### 6.2 Route-aware evidence

Direct access, adapters, and terminal routes may all contribute facts. The semantic layer must retain where each fact came from.

### 6.3 Read-only automatic discovery

Semantic understanding should not turn discovery into an invasive agent installation or mutation step.

### 6.4 Lazy code analysis

The machine view should not eagerly expand every repository down to every function. Existing lazy repository analysis is exactly the right foundation for semantic zoom.

### 6.5 Honest execution evidence

The current design correctly refuses to treat “process associated with repository” as proof every function is currently running. Keep that distinction in every semantic summary.

### 6.6 Explicit consent for execution/mutation

Running functions, tests, process controls, file writes, elevation, and other mutations remain explicit operations.

### 6.7 Dockable expert tools

Filesystem, editor, terminal, DB workbench, coverage, output, diagnostics, and graph surfaces remain valuable. The semantic atlas becomes their organizing context, not their replacement.

### 6.8 Context scoping

Every semantic entity and observation remains tied to a context/device boundary.

### 6.9 Staleness

Last observed is not current. Semantic entities must carry freshness and stale state, especially for offline Devices.

---

## 7. What is structurally wrong today

### 7.1 The user sees ontology before meaning

Technical types are presented before Atlas explains their purpose.

### 7.2 Graph topology is doing two jobs

The graph is simultaneously expected to answer:

- where am I in the machine?
- how is this connected to something else?

Those should be separate interactions.

Canonical containment/navigation should answer the first. Relationship graphs should answer the second.

### 7.3 The default lens is code

The default `GraphPanel` lens is `code`, which biases Atlas toward “repository observatory” instead of “computer atlas.”

### 7.4 Node budgets are technical rather than semantic

`Expand N more` protects rendering performance but does not summarize what is hidden.

The semantic equivalent should be:

```text
32 system services
14 modules
3 databases
6 background jobs
```

with each aggregate itself navigable.

### 7.5 Workload identity is not actually resolved

Current interpreter rules can classify an input as workload-like, but they do not yet correlate multiple observations into a stable logical workload.

### 7.6 The semantic world is disconnected from the actual server

`src/world/*` currently does not govern `/api/graph` or the central workbench.

### 7.7 The UI requires operation knowledge

The user must understand what “Scan host” or “Map repository” means before Atlas can become useful. Discovery should feed the model; the semantic atlas should be the thing the user browses.

### 7.8 Search is object-type-first

Searching “functions, modules, processes” reinforces implementation categories rather than allowing questions such as “PostgreSQL”, “what is serving port 4999”, or “what uses this database” to land on a semantic entity.

### 7.9 The Inspector lacks semantic narrative

Selection mostly produces facts. Atlas needs entity-specific summaries, sections, evidence, relationships, and specialist views.

### 7.10 There is no “machine synthesis” layer

Atlas does not yet compute the high-level first-screen statement:

> Here is what this computer appears to be doing right now.

This is a product-level capability, not merely copywriting.

### 7.11 File structure is too close to the primary navigation model

The filesystem is important evidence and an excellent tool surface, but it should not be the ontology that governs workloads or application structure.

### 7.12 Spatial layout is not semantic geography

Cytoscape layouts may rearrange as nodes/edges change. A navigational atlas needs a stable placement strategy for major semantic regions and workload cards so the user develops spatial memory.

---

## 8. Required conceptual split

The redesign should make four concepts explicit:

### 8.1 Containment

Answers:

> Where am I?

Examples:

```text
Computer / Signal / Agent / Software / @signal/agent / module
```

This path is stable, navigable, and history-aware.

### 8.2 Relationships

Answers:

> How is this connected?

Examples:

- depends on;
- provides capability;
- consumes capability;
- implemented by;
- runs as;
- exposes;
- connects to;
- calls;
- imports;
- reads/writes.

Cytoscape is appropriate here.

### 8.3 Activity

Answers:

> What is happening now or what changed?

Examples:

- processes started/stopped;
- request/activity rates;
- CPU/memory pressure;
- connections;
- files changed;
- tests/commands/runs;
- semantic status changes.

### 8.4 Evidence

Answers:

> Why does Atlas believe this?

Every semantic statement should resolve back to observations and provenance.

---

## 9. Desired canonical data flow

The target architecture should become:

```text
FNGK / local OS / filesystem / repository / runtime / adapters
                           │
                           ▼
                    AtlasObservation
                           │
                           ▼
                  normalization adapters
                           │
                           ▼
                 identity / entity resolver
                           │
                  ┌────────┴────────┐
                  ▼                 ▼
             AtlasEntity      AtlasAssertion
                  │                 │
                  └────────┬────────┘
                           ▼
               specialist interpreters
                           │
                           ▼
                 semantic world store
                           │
               ┌───────────┼────────────┐
               ▼           ▼            ▼
           synthesis   projection   relationships
               │           │            │
               ▼           ▼            ▼
          machine home  box navigation  Cytoscape
```

The current repository analyzer, runtime evidence, filesystem, databases, terminal, coverage, and execution tools all remain sources or deeper surfaces attached to this world.

---

## 10. Migration implications

This should be treated as a front-door and source-of-truth migration, not a visual redesign.

The safest sequence is:

1. connect existing raw evidence to `AtlasObservation`;
2. implement stable semantic entity resolution;
3. persist/rebuild semantic entities and assertions;
4. expose a semantic projection API;
5. create a semantic Atlas central surface;
6. make it the default workspace;
7. convert GraphPanel into a contextual Relationships surface backed by semantic IDs;
8. make files/code/runtime/db/terminal tools open from semantic entities;
9. remove or quarantine the old graph-lens path once feature parity is proven.

The UI should not be switched first.

---

## 11. Repository areas the implementation plan must touch

### Semantic backend

- `src/world/types.ts`
- `src/world/interpreter.ts`
- `src/world/projector.ts`
- new resolver/world-service modules
- evidence/persistence layer
- `src/server/app.ts`

### Discovery and normalization

- `src/discovery/host-discovery.ts`
- `src/discovery/runtime-discovery.ts`
- `src/analysis/repository-analyzer.ts`
- `src/correlation/runtime-code.ts`
- FNGK context/resource normalization
- database/live-project evidence adapters where useful

### Web state and navigation

- `src/web/lib/workbench-state.ts`
- new semantic navigation store/history module
- `src/web/components/Workbench.svelte`
- `src/web/components/Navigator.svelte`
- `src/web/components/PanelHost.svelte`

### New primary Atlas UI

Proposed new components:

- `SemanticAtlas.svelte`
- `MachineOverview.svelte`
- `SemanticCardGrid.svelte`
- `SemanticCard.svelte`
- `AtlasBreadcrumbs.svelte`
- `EntityOverview.svelte`
- `EntityViewTabs.svelte`
- `EvidenceView.svelte`
- `RelationshipsView.svelte` (or refactored `GraphPanel.svelte`)

### Existing expert surfaces to retain

- Filesystem
- file/editor panels
- terminal
- database workbench
- live project
- metrics/coverage
- activity/output
- diagnostics

---

## 12. Audit acceptance: what must be true before implementation starts

The design and implementation plan that follow this audit should explicitly satisfy all of these conclusions:

- There is one canonical semantic world model, not separate old/new ontologies.
- Workloads are resolved from multiple observations, not simple aliases of processes/services/repos.
- Capabilities answer “what is this for?”
- The filesystem remains a physical/software projection, not the governing ontology.
- The opening screen explains the machine before requiring user interpretation.
- Box/card navigation represents containment and semantic zoom.
- Back, forward, breadcrumbs, up, and deep links are first-class.
- Cytoscape is retained for relationships, not as the default mental model.
- Raw technical evidence remains accessible and traceable.
- Specialist interpreters enrich the generic ontology without fragmenting it.
- Existing FNGK access/safety boundaries remain unchanged.
- Existing workbench/editor/terminal/database investment is preserved.

---

## 13. One-sentence diagnosis

**Atlas already knows a great deal about the computer, but today it shows the user the evidence graph before it has turned that evidence into an understandable model of what the computer is doing.**
