# Machine Observatory

The Device home is Atlas's supervisory view. It answers five questions before asking the operator to choose a tool: what Device this is, what is active, whether it appears healthy, where observed activity flows, and what needs attention. It is an interpretation of retained evidence, not a claim that Atlas can observe every action on the machine.

## Reading the home

The identity band names the selected Device and shows its connection state. Stable topology regions group primary workloads into Applications, Data, Infrastructure, Development, System, and External. Inactive system units and unresolved runtime evidence are counted in collapsed regions rather than promoted to a wall of workloads. Each primary workload shows its observed phase, health, purpose, and a few salient facts. Active flows, attention, and recent changes are bounded summaries; selecting one opens the underlying entity and provenance.

Health is derived from available process, service, container, readiness, and resource observations. Unknown is deliberate when measurements are missing. A disconnected Device marks its interpreted state stale; stale does not mean the workload failed. No flow is animated or labeled active solely because a static dependency exists. Refresh is explicit and can take time on large Devices; ordinary reading does not rescan or execute commands.

## Evidence and authority

Atlas retains observation IDs, interpreter IDs and versions, confidence, and classification for every assertion. A primary workload requires strong operational identity such as a managed deployment, running container, recognized database, active long-running service, or a repository correlated with a running process. Technical files and processes remain drill-down evidence, not automatic top-level workloads.

Authorized local README, package, and deployment-manifest text can enrich purpose and declared scripts or ports. Reads are bounded to 64 KiB per document and ten documents per workload; network documentation is not fetched. Sensitive token-shaped text is redacted before it reaches the repository index or world. Presentation authority is `user-defined > observed > declared > derived > inferred`; conflicting assertions remain inspectable.

The Inspector's **Correct Atlas** section permits confirmed rename, purpose, region, ignore, split, merge, and reset actions. Corrections are stored separately, appear as user-defined assertions, and do not rewrite observations or interpreter output. Split requires explicit member entity IDs; merge requires a target workload in the same context. Ignoring hides the selected entity from projection without deleting its evidence.

## Refresh and failure behavior

On a Device's first visit, the UI initializes an absent world once; later ordinary reads use the retained projection and do not rescan. `POST /api/world/refresh` is deduplicated per context and performed in a worker with a 512 MiB old-generation limit and a 60-second default deadline outside test mode. The bounded observation set prioritizes operational identities and retains relationship evidence ahead of bulk files. Only allowlisted operational facts enter world persistence; command arguments and arbitrary metadata do not. Each complete refresh is committed as one SQLite transaction, including observations, resolver entities, assertions, search, and samples. If a worker exits, exceeds its deadline, or interpretation fails, SQLite rolls back the incomplete refresh. The API returns `world_refresh_failed` and `lastGoodAt`; the previous complete Observatory remains readable. Corrections survive refreshes and Atlas restarts. The v2 cutover intentionally discards old derived semantic tables while preserving source evidence and user data.

## Boundaries and deeper work

The Observatory is a front door, not a replacement for Filesystem, editor, terminal, native database, deployments, coverage, or operations. Workflow panels remain in the center; observability panels remain in Operations; Filesystem and Intelligence remain in the left sidebar. Specialist interpreters may recognize domain-specific workloads and views within the same ontology, but cannot silently become a second machine model or claim health without evidence. Deeper network and file activity tracing is future optional adapter work, not present-tense functionality.
