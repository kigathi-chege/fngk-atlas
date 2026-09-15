# FNGK Atlas — Semantic Computer Atlas and Navigable Machine Model Design

**Date:** 2026-09-14  
**Status:** proposed design for implementation planning  
**Repository:** `kigathi-chege/fngk-atlas`  
**Primary base:** `feat/fngk-native-atlas` while PR #1 remains open; retarget to `main` after PR #1 lands.  
**Supersedes:** the graph-primary interaction model in the “Workbench and interaction” section of `docs/superpowers/specs/2026-09-12-fngk-native-atlas-design.md`.  
**Preserves:** that document's trust boundary, FNGK integration model, discovery model, evidence/provenance requirements, lazy analysis, operational safety, terminal/filesystem semantics, and execution honesty.

---

## 1. Product statement

FNGK Atlas is not a graph viewer for operating-system facts and it is not a code browser with runtime decoration.

It is a **semantic atlas of a computer and everything reachable through its FNGK context**.

Its primary responsibility is to answer:

> **What is this computer doing, how is it doing it, what is each part for, how do the parts depend on each other, and what evidence supports that interpretation?**

Atlas should make that answer legible at several scales, from the whole Device down to a workload, runtime component, package, module, function, file, socket, database, operation, or observation.

The user should not need to understand Atlas's internal ontology before Atlas becomes useful.

---

## 2. Design thesis

### 2.1 One world graph, multiple projections

Atlas should maintain one canonical semantic world composed of entities and evidence-backed assertions.

Different views project that same world for different questions:

- Overview — what exists and what matters now;
- Runtime — what is executing;
- Data — where information lives and moves;
- Network — what is exposed and connected;
- Resources — what consumes CPU, memory, disk, GPU, etc.;
- Security — identity, authority, boundaries, exposure, sensitive configuration references;
- Software — repositories, packages, modules, symbols, files;
- Activity — what happened or is happening;
- Relationships — graph topology around a selected semantic entity;
- Evidence — provenance behind Atlas's claims.

These are **projections**, not separate ontologies.

### 2.2 Navigation is hierarchical; reality is graph-shaped

The underlying machine is a graph. Human navigation should not be.

Atlas must distinguish:

- **canonical containment** — used to answer “where am I?”;
- **lateral relationships** — used to answer “how is this connected?”

A canonical path might be:

```text
Computer / Signal / Agent / Software / @signal/agent / runtime/session.ts / startSession
```

The same `Signal Agent` entity can simultaneously be connected to:

```text
PostgreSQL
:4999
systemd unit
user identity
FNGK connection
repository
external APIs
```

Those connections belong in relationship views and entity summaries without destabilizing navigation.

### 2.3 The filesystem is evidence and a drill-down path, not the ontology

Files answer where software and state physically live. They do not reliably answer what the machine is doing.

Atlas may use filesystem structure to descend into software detail, but semantic entities should govern the main model.

### 2.4 Purpose is a first-class property

Knowing a process name is inventory.

Knowing:

> PostgreSQL provides relational storage used by Signal, listens on this interface, persists here, runs under this unit, and is implemented by these binaries/packages

is understanding.

Atlas therefore needs first-class **workload** and **capability** semantics.

---

## 3. Product goals

### 3.1 Immediate orientation

Within one screen, a user should understand the major active purposes of a computer.

### 3.2 Semantic drill-down

Every major card should be a place the user can enter and explore at a lower semantic altitude.

### 3.3 Lossless depth

High-level interpretation must not remove access to raw processes, ports, files, modules, functions, calls, database tables, terminal sessions, or evidence.

### 3.4 Trustworthy interpretation

Atlas must distinguish observations from derived/inferred conclusions and expose supporting evidence.

### 3.5 Generic core, specialized understanding

The core ontology stays small and reusable. Domain specialists enrich it for PostgreSQL, Docker, systemd, Git, Node, SvelteKit, Fastify, Redis, Nginx, Kubernetes, Signal/FNGK, etc.

### 3.6 Stable spatial memory

Major semantic objects should not jump around gratuitously as low-level evidence changes.

### 3.7 Existing tooling remains valuable

Terminal, files, editor, database, coverage, execution, diagnostics, and graph tooling remain part of Atlas.

---

## 4. Non-goals

This design does not require:

- replacing FNGK authorization or transport;
- eagerly parsing every file or symbol on every Device;
- proving semantic purpose from process names alone;
- allowing an LLM to invent machine facts;
- rendering the entire world graph at once;
- removing the Cytoscape graph;
- turning all expert tools into cards;
- embedding full third-party documentation into Atlas storage by default;
- mutating remote hosts during automatic discovery.

---

## 5. Canonical semantic model

The existing `src/world/types.ts` is the starting point. This design strengthens the semantics around those types.

### 5.1 Context / Device

A Device or local Atlas process host is the top navigable machine scope.

It owns or exposes:

- environments;
- identities;
- resources;
- workloads;
- interfaces;
- observations and activity.

A remote Device is not reduced to its filesystem tree.

### 5.2 Environment

An environment establishes an execution boundary or operating context, for example:

- host OS;
- user session;
- container namespace;
- VM;
- runtime environment;
- development environment.

### 5.3 Workload

A workload is a **logical unit of intentional computation** on or through a Device.

Examples:

- Signal Agent;
- PostgreSQL cluster/instance;
- Docker daemon;
- an Atlas development server;
- an Nginx reverse proxy;
- a browser session;
- a build/test job;
- a synchronization agent.

A workload is not synonymous with:

- process;
- service;
- repository;
- container;
- package.

Those are evidence or implementation/runtime components of a workload.

A workload may:

- be realized by several services and processes;
- own or consume interfaces;
- provide capabilities;
- consume capabilities;
- map to one or more repositories/packages;
- read/write data stores;
- run under identities;
- span multiple containers or jobs;
- have specialist semantic views.

### 5.4 Component

Add a semantic `component` kind if implementation proves it useful.

A component is a logical sub-unit of a workload that is meaningful above raw runtime/software artifacts.

Examples:

- Signal `Agent`;
- Signal `FNGK` service;
- web frontend;
- API service;
- worker pool;
- scheduler;
- database writer.

A component should be created only when evidence supports a stable grouping. It must not become a synonym for every package or process.

### 5.5 Capability

A capability answers:

> **What function does this entity provide to the rest of the system?**

Examples:

- relational-storage;
- remote-machine-control;
- HTTP-serving;
- authentication;
- reverse-proxy;
- container-orchestration;
- compilation;
- source-control;
- background-scheduling;
- message-queue;
- AI-inference;
- terminal-access;
- file-synchronization.

Capabilities are reusable semantic nodes.

A workload can provide many capabilities. Other workloads can consume them.

### 5.6 Runtime units

Existing kinds remain concrete runtime evidence:

- service;
- process;
- job;
- container;
- runtime.

They answer **how the workload currently executes**, not **what the workload is**.

### 5.7 Interfaces

Interfaces represent contact surfaces:

- network listener;
- socket;
- port;
- HTTP endpoint;
- RPC surface;
- IPC surface;
- terminal/PTY;
- user-facing UI;
- externally routed domain/URL where known.

### 5.8 Data

Data concepts include:

- data store;
- database;
- table;
- file/state directory;
- queue/topic if later introduced;
- cache;
- external storage.

Data nodes answer where state is persisted, queried, streamed, or transformed.

### 5.9 Software

Existing software kinds remain:

- repository;
- package/workspace;
- module;
- class;
- function/test;
- file/directory;
- dependency;
- configuration.

They become the implementation projection under workloads/components.

### 5.10 Identity and authority

Identity should represent:

- OS users;
- service accounts;
- container identities;
- FNGK/Signal actor context where safe and relevant;
- ownership/control boundaries;
- effective privilege.

Secret values are references, never semantic-summary payloads.

### 5.11 Resource

Resources include host and workload-level consumption/capacity:

- CPU;
- memory;
- storage;
- GPU;
- network;
- file descriptors;
- process/thread counts;
- quotas where known.

### 5.12 Event and operation

Events describe observed changes/activity. Operations represent explicit actions performed through Atlas or FNGK.

They feed the Activity view and temporal explanation.

---

## 6. Relationship vocabulary

The semantic world should use explicit, stable predicates. The exact first release can be small, but predicates must be meaning-based rather than UI-specific.

Recommended core relationships:

```text
contains
belongs-to
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
queries
serves
routes-to
configured-by
owned-by
uses-resource
imports
calls
tests
emits
subscribes-to
observed-as
```

Rules:

1. `parentId` is reserved for canonical navigation containment.
2. Lateral semantic relationships live as assertions.
3. A fact can have multiple competing assertions with different evidence/confidence.
4. UI labels may be friendlier than stored predicates, but stored predicates remain stable.

---

## 7. Observation → entity → assertion pipeline

### 7.1 Observations are immutable evidence records

Every collector should normalize its findings to `AtlasObservation` without requiring the collector to understand the whole semantic world.

Examples:

```text
systemd unit observation
process observation
cgroup observation
port/socket observation
repository observation
package manifest observation
database observation
FNGK context observation
container observation
```

Observations carry:

- context;
- source/source ID;
- timestamp;
- route;
- safe facts;
- stale/fresh state;
- sensitivity classification.

### 7.2 Normalization adapters

Adapters transform current repository/runtime/context models into a uniform observation vocabulary.

They should not prematurely collapse distinct evidence.

### 7.3 Entity resolution

A dedicated resolver groups observations that refer to the same logical entity.

This stage is required before workload interpretation becomes authoritative.

#### Strong identity signals

Examples:

- exact systemd unit + cgroup membership;
- container ID;
- process ownership by a known service unit;
- stable executable/package identity;
- repository/package path tied to process cwd/command;
- explicit FNGK resource identity;
- database server identity/cluster identifier;
- manifest/process metadata that explicitly declares application identity.

#### Supporting signals

Examples:

- labels/process names;
- common cwd;
- socket ownership;
- shared environment markers;
- parent/child process relationship;
- package metadata;
- command line;
- stable data directory;
- executable hash/path.

#### Weak signals

Examples:

- generic process names such as `node`;
- conventional port numbers;
- filename similarity alone.

Weak signals may increase confidence but must not fuse entities on their own.

### 7.4 Stable semantic identity

Workload IDs should derive from stable resolved identity keys, not from one observation ID.

A process restart must not create a new logical workload if Atlas can prove continuity.

### 7.5 Conflicts are retained

If evidence supports two plausible workload interpretations, Atlas may:

- keep the technical entities separate;
- expose alternative assertions;
- lower confidence;
- label a semantic grouping unresolved.

It must not silently merge on insufficient evidence.

---

## 8. Assertions, confidence, and provenance

Retain the existing assertion classes:

- `observed` — directly supported by collected evidence;
- `declared` — explicitly stated by manifest/configuration/documentation;
- `derived` — deterministic conclusion from evidence;
- `inferred` — probabilistic or heuristic interpretation;
- `user-defined` — user-authored semantic correction/label.

Every semantic statement must have:

- subject;
- predicate/value/object;
- class;
- confidence;
- explanation;
- evidence references;
- interpreter/version;
- observation/derivation timestamps;
- stale state.

The UI should collapse this complexity by default but make it inspectable.

Example:

```text
Signal Agent
  provides capability: remote-machine-control
  confidence: 0.96
  classification: derived
  evidence:
    - signal-default-4999.service
    - node process command/cwd
    - package manifest
    - FNGK resource/port evidence
```

---

## 9. Specialist interpreters

The generic ontology must remain stable while specialists provide deep domain knowledge.

### 9.1 Initial specialists

Recommended first specialist set:

- systemd;
- Docker/containerd;
- PostgreSQL;
- Git;
- Node/npm/pnpm;
- SvelteKit/Vite;
- Fastify;
- Signal/FNGK.

Later:

- Redis;
- Nginx/Caddy;
- Python;
- Kubernetes;
- databases supported by the Atlas database workbench;
- Cloudflare-related workload metadata where observable locally.

### 9.2 Specialist responsibilities

A specialist may emit:

- semantic entity classification;
- capabilities;
- specialist relationships;
- view descriptors;
- meaningful metrics;
- relevant documentation references;
- deeper semantic grouping.

It must not bypass provenance.

### 9.3 Specialist UI descriptors

`AtlasViewDescriptor` should become active.

Examples:

A PostgreSQL workload could expose:

- Overview;
- Databases;
- Connections;
- Replication;
- Storage;
- Runtime;
- Configuration;
- Evidence.

A Node/SvelteKit workload could expose:

- Overview;
- Routes;
- Runtime;
- Dependencies;
- Software;
- Activity;
- Evidence.

All specialist views still sit inside the generic semantic navigation model.

---

## 10. Documentation enrichment

Documentation can improve interpretation, but it must be evidence, not an oracle.

### 10.1 Sources

In order of preference:

1. local package metadata;
2. local README/docs/man pages;
3. installed package manager metadata;
4. explicit project documentation referenced by the software;
5. official upstream documentation, fetched only through a controlled enrichment action/policy.

### 10.2 Documentation-derived facts

Documentation may support declared/inferred facts such as:

- software category;
- capability vocabulary;
- configuration semantics;
- known interface types;
- domain concepts for specialist views.

### 10.3 Safety and storage

- Automatic host census remains network-passive unless the user/policy enables external enrichment.
- Do not ingest secret-bearing local configuration values into a documentation index.
- Prefer storing normalized semantic facts, source references, hashes, excerpts within bounded limits, and retrieval metadata rather than mirroring entire documentation corpora.
- Documentation-derived assertions retain source URL/path, version where known, and interpreter/enricher identity.

---

## 11. Semantic zoom

Semantic zoom is the central interaction model.

### Level 0 — Device

The whole computer/context.

Answers:

- what is this machine doing?
- what major workloads exist?
- what needs attention?
- what is exposed?
- what changed?

### Level 1 — Workloads

Major logical units:

- Signal;
- Atlas;
- PostgreSQL;
- Docker;
- browser;
- system infrastructure groups;
- development workloads;
- other inferred/declared workloads.

### Level 2 — Components / capabilities / runtime surfaces

Inside a workload:

- logical components;
- capabilities;
- runtime units;
- interfaces;
- data stores;
- dependencies;
- resource summary.

### Level 3 — Software implementation

- repository;
- package/workspace;
- service implementation;
- configuration;
- module groups.

### Level 4 — Symbols and evidence

- modules;
- classes/functions/tests;
- calls/imports;
- source spans;
- concrete observations;
- run/coverage evidence.

A specialist can add intermediate semantic sections, but it cannot break the global up/down navigation contract.

---

## 12. The machine home screen

The default Atlas surface should no longer be a graph.

It should be a semantic Device overview.

### 12.1 Header synthesis

Example shape:

```text
THIS COMPUTER                                           Healthy

12 active workloads    CPU 27%    RAM 9.3 / 32 GB
4 externally reachable interfaces    2 items need attention

Right now
Atlas appears to be under active development.
Signal/FNGK is providing remote machine control.
PostgreSQL is providing relational storage to two workloads.
Docker is running three containers.
```

Every sentence/chip is backed by semantic assertions and is clickable.

### 12.2 Workload card field

The primary body is a responsive card/box field.

Example:

```text
┌─────────────────────┐  ┌─────────────────────┐
│ SIGNAL              │  │ FNGK ATLAS          │
│ Remote control      │  │ Development         │
│ ● running           │  │ ● running           │
│ 6 processes         │  │ :4173 / API         │
│ PostgreSQL ↓        │  │ Node + Svelte       │
└─────────────────────┘  └─────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐
│ POSTGRESQL          │  │ DOCKER              │
│ Relational storage  │  │ Containers          │
│ ● running           │  │ 3 active            │
│ :5432               │  │ 7 volumes           │
│ Used by Signal      │  │                     │
└─────────────────────┘  └─────────────────────┘
```

Cards show interpretation, not every field.

### 12.3 Card contract

Every semantic card should support:

- title/identity;
- purpose/capability summary;
- state/freshness;
- 2–4 salient metrics/facts;
- attention indicator where warranted;
- count/summary of hidden depth;
- single primary action: **enter**;
- secondary inspect/context actions without making click semantics ambiguous.

### 12.4 Semantic aggregation

Never use an unexplained generic aggregate such as `Expand 90 more` when Atlas knows the category.

Use cards such as:

```text
System services
47 total · 39 running · 3 recently failed
```

or:

```text
Software
12 packages · 163 modules · 1,842 functions
```

Clicking the aggregate enters that semantic scope.

---

## 13. Workload interior

Entering a workload replaces the central semantic surface rather than merely selecting a graph node.

Example:

```text
←  This computer / Workloads / Signal                       ↑

SIGNAL
Remote machine control, authentication, connectivity
Healthy · running 18h · CPU 4% · RAM 612 MB

[Overview] [Runtime] [Interfaces] [Data] [Dependencies]
[Software] [Activity] [Relationships] [Evidence]
```

Overview cards can include:

- components;
- capabilities;
- major dependencies;
- interfaces;
- data stores;
- resource state;
- active/recent activity;
- software summary.

The semantic entity is the stable location; views are projections of it.

---

## 14. Navigation contract

### 14.1 Single-click means enter

A primary semantic card click navigates into that semantic scope.

Do not require double-click to distinguish focus from navigation.

### 14.2 Inspect is secondary

A separate inspect affordance may open/update the Inspector without changing location.

### 14.3 Breadcrumbs

Always show the canonical path when below Device level.

Example:

```text
This computer / Signal / Agent / Software / @signal/agent
```

Every ancestor is clickable.

### 14.4 Up

A visible Up action returns to `parentId`.

### 14.5 Back / forward

Semantic navigation must use browser history semantics.

The implementation does not need a full router dependency. It may encode semantic state in URL/search/hash plus `history.pushState`.

At minimum, deep-linkable state must identify:

- context ID;
- root semantic entity ID;
- view;
- semantic level where relevant;
- optional focused relationship/evidence entity.

### 14.6 Search

Search should return semantic entities first, with underlying technical matches grouped beneath them.

Example search result:

```text
Signal Agent                          Workload
  implemented by /srv/signal         Repository match
  process 18291                      Runtime match
  :4999                              Interface match
```

Selecting the result navigates to the canonical semantic location.

---

## 15. Top-level views

At Device scope, use user-facing views such as:

```text
Overview
Workloads
Activity
Data
Network
Resources
Security
Software
```

Avoid making `World / Machine / Code / Function / Execution` the primary user vocabulary.

At workload/component scope, use:

```text
Overview
Runtime
Interfaces
Data
Dependencies
Software
Activity
Relationships
Evidence
```

Specialists may add views.

---

## 16. Relationships view

Cytoscape remains valuable, but it becomes contextual.

### 16.1 Entry condition

The Relationships view always has a semantic root.

The user is looking at:

> Relationships around Signal Agent

not:

> Architecture graph containing up to 90 nodes.

### 16.2 Default relationship scope

Start with a small meaningful neighborhood:

- parent/contained semantic entities;
- dependencies;
- capabilities provided/consumed;
- interfaces;
- important data stores;
- optionally implementation/runtime edges depending on active filters.

### 16.3 Expansion

Expansion must be by semantic relationship category, not just node budget.

Examples:

- show runtime units;
- show software implementation;
- show network neighbors;
- show callers/callees;
- show all evidence.

### 16.4 Graph stability

Preserve saved positions per semantic root/view where feasible. Avoid large relayouts caused by unrelated evidence elsewhere on the machine.

---

## 17. Software and filesystem drill-down

### 17.1 Software projection

From a workload:

```text
Workload
  → component
      → repository
          → package
              → module
                  → symbol
```

This path can leverage the existing repository analyzer.

### 17.2 Filesystem projection

The filesystem remains available:

- as the right-side expert explorer;
- as a Software/Data detail view;
- as source/evidence links;
- as an entry for unmapped files.

When Atlas can map a file to a semantic workload/package/module, the UI should show that semantic context.

### 17.3 Unknown files remain legitimate

Not everything must belong to a workload. The system must be able to say:

> Unclassified filesystem content

without inventing ownership.

---

## 18. Machine synthesis — “What is happening?”

This is a first-class backend projection, not free-form marketing copy.

### 18.1 Deterministic first implementation

The first release should generate synthesis from explicit semantic rules and evidence, not require an LLM.

Possible synthesis facts:

- N active workloads;
- workload currently under development based on changed repository files + dev runtime evidence;
- workload serving external/local interfaces;
- workload using unusually high resources relative to its recent baseline if baseline exists;
- dependency unavailable/stale;
- process/service failures;
- recent Atlas/FNGK operations;
- database/client relationships;
- active container counts;
- newly changed exposure.

### 18.2 Language contract

Synthesis copy must encode epistemic strength.

Use:

- “is” for observed/strongly derived facts;
- “appears to be” for inferred purpose/activity;
- “last observed” for stale/offline evidence;
- “Atlas cannot yet determine” when unresolved.

### 18.3 Attention is not alarmism

An attention item should be grounded in a specific condition:

- failed service;
- new external exposure;
- stale dependency;
- high resource use against a known baseline;
- repeated crash/restart;
- unresolved identity that affects interpretation;
- security boundary issue Atlas can actually demonstrate.

Do not manufacture generic warnings.

---

## 19. Spatial organization

The semantic card field should be stable enough for spatial memory.

### 19.1 Deterministic groups

Group major cards by meaningful categories when evidence supports them, for example:

- Development;
- Applications;
- Data;
- Infrastructure;
- System;
- User applications.

These labels are presentation groups, not ontology kinds.

### 19.2 Stable ordering

Within a group, use stable sort keys such as:

1. pinned/user-defined order;
2. semantic importance/salience;
3. stable label/ID fallback.

Do not re-sort the entire screen every refresh based on volatile CPU values.

### 19.3 Activity accents

Use subtle state/activity indicators without physically relocating the card.

---

## 20. User corrections and semantic learning

Atlas will sometimes resolve entities incorrectly or fail to group them.

Support user-defined corrections eventually:

- rename workload;
- merge workload candidates;
- split incorrectly fused workload;
- pin a capability/purpose;
- assign a canonical parent;
- mark an inference as wrong.

These changes become `user-defined` assertions, never destructive edits to raw observations.

The automatic resolver should honor them as high-authority constraints on future refreshes.

This does **not** need to be in the first implementation milestone, but the model should not make it impossible.

---

## 21. Semantic API design

Introduce a semantic API rather than extending `/api/graph` into another overloaded endpoint.

Recommended initial endpoints:

### `GET /api/world/projection`

Query:

```text
contextId
rootId?
view=overview|runtime|data|network|resources|security|software|activity|relationships|evidence
level?
cursor?
```

Returns:

- root semantic entity;
- breadcrumbs;
- semantic cards/entities;
- semantic relationships required by the view;
- semantic aggregates;
- summary/synthesis;
- attention items;
- available views;
- specialist view descriptors;
- cursor/freshness/errors.

### `GET /api/world/entities/:id`

Returns semantic entity detail and available views.

### `GET /api/world/entities/:id/evidence`

Returns assertions and evidence references, paginated/bounded.

### `GET /api/world/search`

Returns semantic results with grouped technical evidence matches.

The existing discovery/repository-analysis WebSocket routes remain valid and should trigger semantic-world refresh/invalidation.

---

## 22. Projector changes

`src/world/projector.ts` should evolve from a kind-filtered graph projection into a navigation-aware semantic projection.

Required changes:

1. canonical child selection should primarily follow semantic containment (`parentId`) for overview/card navigation;
2. lateral assertion traversal should be view-specific;
3. semantic aggregate objects need label, count, purpose, child scope, and destination—not just `kind,count`;
4. view descriptors should control specialist sections;
5. projection should provide salient metrics and summary facts without requiring the frontend to re-interpret raw attributes;
6. `resources` should become a first-class lens/view if resource observations are available;
7. relationship projection should remain bounded independently from card projection.

---

## 23. Interpreter and resolver changes

`src/world/interpreter.ts` should remain useful, but interpretation must happen **after or alongside identity resolution**.

The existing generic rule:

> service/process/container/repository/database → workload

is insufficient as an authoritative model because it can produce several workload entities for one logical application.

Required architecture:

```text
observations
  ↓
technical entity normalization
  ↓
identity correlation / workload candidate clustering
  ↓
resolved semantic entity
  ↓
specialist interpretation / capabilities / view descriptors
```

The manifest engine remains valuable for deterministic classification and enrichment.

---

## 24. Workbench integration

Keep the Dockview shell.

Change the seeded central experience:

```text
OLD
Navigator | Architecture graph | Filesystem
          | Metrics            | Inspector

NEW
Navigator | Semantic Atlas     | Filesystem
          | Activity/Tools     | Inspector
```

The semantic Atlas surface should be the protected workspace anchor or active central panel.

`Relationships`, `Metrics`, files, terminals, DBs, etc. open as contextual dockable surfaces from it.

On narrow/mobile layouts, the semantic atlas remains primary and side tools minimize as they do today.

---

## 25. Navigator redesign

The left Navigator should become a semantic/context navigation companion, not primarily a command launcher.

Recommended contents:

1. current FNGK context/Device;
2. semantic breadcrumb/current location;
3. global semantic search;
4. major top-level views;
5. recently visited or pinned workloads;
6. tools/actions in a secondary section:
   - Refresh/scan;
   - Map repository;
   - Terminal;
   - Database;
   - Live project;
   - Diagnostics.

Discovery controls remain available but no longer define the product hierarchy.

---

## 26. Inspector redesign

The Inspector becomes the “why / details” surface for the current selection without forcing navigation.

Sections may include:

- identity;
- purpose/capabilities;
- state/freshness;
- important relationships;
- key metrics;
- source/software/runtime references;
- confidence/classification;
- evidence.

Specialist `AtlasViewDescriptor` sections can contribute structured details.

---

## 27. Performance and scaling

### 27.1 Do not render the whole world

Semantic card navigation is naturally bounded by containment scope.

### 27.2 Lazy depth

Do not materialize full symbol/function detail until the user enters Software/code depth or repository analysis has already produced it.

### 27.3 Incremental recomputation

Re-resolve only semantic entities affected by changed observations where practical.

### 27.4 Stable caches

Cache semantic world snapshots by context plus observation revision/freshness markers.

### 27.5 Separate graph budgets

Relationship graph budgets remain useful, but no longer control semantic navigation.

---

## 28. Security and privacy

The redesign must preserve the existing trust model.

Additionally:

- synthesis must never surface secret values;
- documentation enrichment must not upload arbitrary local source/configuration without explicit policy;
- evidence excerpts are bounded and redacted;
- user-defined semantic corrections stay local to the Atlas data store unless explicitly synchronized in the future;
- remote/offline facts clearly show stale state;
- inferred external exposure must distinguish local listener evidence from verified public reachability.

---

## 29. Accessibility and interaction requirements

The semantic Atlas must not rely solely on spatial placement or color.

- Cards are keyboard focusable.
- Enter/Space performs the primary “enter” action.
- Breadcrumbs and Up are keyboard accessible.
- Status is represented in text and semantics, not just color.
- Relationship graph has a textual/list fallback or companion summary.
- Reduced-motion settings suppress large navigation animations.
- Focus returns predictably after Back/Up.

---

## 30. Acceptance scenarios

### Scenario A — first launch

Given a Device with Signal, PostgreSQL, Docker, a browser, and Atlas running, the user can open Atlas and understand those major workloads and their purposes without selecting a graph lens.

### Scenario B — descend from machine to function

The user can navigate:

```text
This computer
→ Signal
→ Agent
→ Software
→ package
→ module
→ function
```

and use Up/Back to return exactly along the path.

### Scenario C — understand PostgreSQL

Atlas groups PostgreSQL service/process/listener/data evidence into one workload, shows relational-storage capability, shows clients/dependencies, and exposes supporting evidence.

### Scenario D — relationship graph

From Signal, the user opens Relationships and sees a bounded graph centered on Signal rather than an unrelated machine-wide graph.

### Scenario E — unknown process

Atlas does not invent a workload purpose. It presents an unresolved runtime item, available evidence, and low-confidence interpretations if any.

### Scenario F — stale remote Device

The semantic home can display last-observed workload state, clearly marked stale/offline, without claiming it is currently running.

### Scenario G — specialist view

A PostgreSQL or Signal specialist can add structured sections without changing the global semantic navigation contract.

### Scenario H — file drill-down

Opening a source file from a workload retains semantic context and allows the user to return to the workload without reconstructing the path manually.

---

## 31. Product invariants

These are the design rules implementation should treat as non-negotiable:

1. **Atlas explains before it enumerates.**
2. **Workload is logical; process/service/container/repository are evidence or implementation.**
3. **Capability expresses purpose.**
4. **Containment governs navigation; graph edges govern relationships.**
5. **Files are a projection, not the world model.**
6. **Every semantic claim can be traced to evidence.**
7. **Unknown is preferable to fabricated certainty.**
8. **Semantic zoom controls depth; node budgets only control graphs.**
9. **The first screen answers what the machine is doing.**
10. **Expert tools remain accessible without becoming the primary ontology.**
11. **FNGK remains the access and authorization boundary.**
12. **One canonical world model feeds every view.**

---

## 32. Design decision summary

The redesign is not “replace circles with boxes.”

It is:

> Replace graph-first technical navigation with a semantic, evidence-backed model of the machine; use boxes/cards for canonical containment and semantic zoom; use graphs for contextual relationships; preserve all existing low-level evidence and expert tooling beneath the new front door.
