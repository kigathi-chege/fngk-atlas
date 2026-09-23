# Proposed PR — Semantic Atlas: machine model, semantic navigation, and implementation plan

## Suggested title

`docs: define semantic Atlas machine model and navigation redesign`

## Suggested branch

`docs/semantic-atlas-navigation`

## Suggested base

Use `feat/fngk-native-atlas` while PR #1 is still the source of the current implementation. If PR #1 lands first, rebase this docs branch onto `main` and target `main`.

## Files

Place these files in the repository:

```text
docs/superpowers/specs/2026-09-14-semantic-atlas-current-state-audit.md
docs/superpowers/specs/2026-09-14-semantic-atlas-navigation-design.md
docs/superpowers/plans/2026-09-14-semantic-atlas-implementation-plan.md
```

## PR body

### Summary

This docs-only PR re-audits the current FNGK Atlas implementation and defines the architectural pivot from a graph-first technical observatory to a semantic, navigable atlas of a computer.

The current implementation already has strong foundations: FNGK-native context/access, host discovery, repository analysis, runtime/code correlation, filesystem/terminal/database/live-project tooling, Dockview, evidence provenance, and a new `src/world/*` semantic model.

The audit identifies one central mismatch: the semantic world model is currently parallel to, rather than authoritative for, the running application. `src/world/interpreter.ts` and `src/world/projector.ts` define workloads, capabilities, provenance, semantic lenses, breadcrumbs, and expansion levels, but `src/server/app.ts` still serves `/api/graph` by merging raw analysis/runtime/context nodes and calling the older `buildGraphLens` model. The central `GraphPanel` therefore still defaults to a code graph and asks the user to interpret technical categories before Atlas explains what the machine is doing.

This PR specifies a targeted evolution rather than a rewrite.

### Core product decisions

- Make one evidence-backed semantic world the source of truth for all Atlas projections.
- Treat **workload** as the central logical unit of intentional computation.
- Treat **capability** as the primary expression of purpose.
- Keep processes, services, containers, ports, files, repositories, modules, and functions as runtime/implementation/evidence layers rather than top-level navigation categories.
- Add a real entity-resolution stage so a systemd unit, process tree, repository, listener, and data path can resolve to one logical workload when evidence supports it.
- Make canonical containment hierarchical and navigable with cards/boxes, breadcrumbs, Up, browser Back/Forward, and semantic zoom.
- Keep the underlying world graph, but use Cytoscape as a contextual **Relationships** view rooted in the entity the user is currently exploring.
- Make the default screen answer **“What is this computer doing right now?”** through evidence-backed synthesis and workload cards.
- Preserve FNGK's authorization boundary, route-aware evidence, read-only automatic discovery, explicit operation consent, stale/offline semantics, and execution honesty.
- Preserve Dockview and the existing filesystem/editor/terminal/database/live-project/coverage surfaces as expert tools attached to semantic context.
- Enable specialist interpreters (systemd, PostgreSQL, Docker, Node/SvelteKit/Fastify, Signal/FNGK, etc.) to enrich the generic ontology without fragmenting it.
- Treat local/upstream documentation as provenance-bearing enrichment evidence rather than an authority that can silently overwrite observed facts.

### Documents

#### Current-state audit

Maps the current implementation paths and identifies the dual-model problem:

```text
current: ProgramIndex/runtime/context → /api/graph → buildGraphLens → Cytoscape
new prototype: observations → interpreters → semantic entities/assertions → projectWorld
```

It also records what should be preserved and what must change.

#### Design spec

Defines:

- canonical semantic model;
- workload/capability semantics;
- observation/entity/assertion pipeline;
- workload identity resolution;
- provenance/confidence;
- specialist interpreters;
- documentation enrichment;
- semantic zoom;
- machine home and card contract;
- navigation/history/deep linking;
- Device/workload views;
- contextual relationship graphs;
- software/filesystem drill-down;
- deterministic machine synthesis;
- spatial stability;
- semantic API and projector changes;
- workbench/Navigator/Inspector integration;
- security, accessibility, and acceptance scenarios.

#### Implementation plan

Sequences the work so the frontend is not built on the legacy `/api/graph` model:

```text
observations
→ entity/workload resolver
→ semantic world service/store
→ semantic API
→ semantic projector + synthesis
→ navigation state
→ card Atlas UI
→ entity interiors
→ Relationships graph migration
→ software/filesystem integration
→ specialist interpreters/documentation enrichment
→ legacy graph retirement
```

The plan includes proposed files, tests, migration boundaries, verification commands, live acceptance, and recommended PR slicing.

### Why this is necessary

The current graph can answer “how are these technical nodes connected?” but it does not immediately answer “what is this computer doing and why should I care?”

The redesign makes Atlas interpret before it enumerates.

The desired user path becomes:

```text
This computer
→ Signal
→ Agent
→ Software
→ package
→ module
→ function
```

while lateral relationships such as PostgreSQL dependencies, ports, processes, identities, and external systems remain available without destabilizing that path.

### Scope

Docs only. No runtime behavior is changed by this PR.

### Follow-up

Implementation should begin with semantic-world integration and workload entity resolution, not with the card UI. The first implementation milestone should prove that real host evidence can resolve into useful workload cards with provenance before adding broad specialist coverage.
