# Atlas Calculator Agent Workspace Design

## Goal

Make Calculator the durable conversation and agent-runtime authority while making FNGK Atlas its native, fast, device-aware workspace. Atlas must expose its real capabilities to agents as governed tools, retain responsive device connections, and present the same conversation experience as Calculator without copying a second UI implementation.

## Scope and ownership

Calculator owns persisted conversations, messages, streaming turn events, provider selection, native engine sessions, subagents, model usage, and conversation audit/history. It remains the one place where an agent run is created and resumed.

Atlas owns the selected FNGK profile, team/project/device scope, workspace and panel lifecycle, direct device connectivity, terminal/filesystem/deployment presentation, operator authorization, and final execution of Atlas capabilities. FNGK remains authoritative for device identity, authentication, access control, and structured device operations.

Spindle is not a runtime dependency for this work. Its incomplete migration is a source of historical lessons only; no current Spindle UI or state contract may become an Atlas/Calculator dependency.

## Existing-state recovery gate

Before shared-agent work begins, recover Calculator deliberately:

1. Inventory the base Calculator checkout and `calculator-hardening-ui-storage` worktree, including uncommitted files, generated artifacts, commits, and focused tests.
2. Classify each change as verified feature work, independent local work, generated output, or obsolete migration residue.
3. Commit or preserve legitimate independent local work on an explicit branch; remove only generated artifacts that are reproducible and ignored.
4. Run focused diagnostics/transport/UI tests for the hardening worktree.
5. Merge only a clean, reviewed, passing branch into the selected Calculator integration branch.
6. Verify the base checkout, remove the merged worktree, prune worktree metadata, and delete the merged feature branch only after it is no longer needed.

No Atlas feature is allowed to rely on a partially merged Calculator worktree.

## Persistent device sessions

Atlas introduces a Device Session Manager. It owns one authenticated, multiplexed FNGK device channel per `(profile, team/project scope, device)` tuple. A session never crosses identity, profile, team, or project boundaries.

The session state machine is `idle`, `connecting`, `ready`, `degraded`, `reconnecting`, `revoked`, `offline`, and `failed`. It exposes connection age, last successful operation, round-trip estimate, reconnect attempts, active stream count, capability revision, and current authorization grants.

The shared channel provides independently cancellable typed substreams:

- terminal session streams;
- filesystem list/read/write streams;
- discovery/resource observation streams;
- deployment and live-project streams;
- route/port-forward streams;
- database and diagnostic streams;
- agent tool invocation streams.

An interactive terminal is a durable substream, not the implementation transport for other features. Filesystem browsing uses structured FNGK RPCs such as `filesystem.list(path, cursor, sort, knownRevision)` and `filesystem.read(path, range, knownRevision)`. This preserves precise access control, cancellation, pagination, and error handling while avoiding reconnect/authentication overhead on each operation.

The manager keeps a bounded revision-aware directory cache keyed by scope/device/path. It deduplicates in-flight reads, cancels superseded navigation, invalidates on device events, and prefetches only cheap adjacent metadata. It must not cache secret file content, cross profile boundaries, or replay mutation requests after reconnect.

Operators can inspect, reconnect, revoke, clear local cache, terminate terminal streams, and reactivate a device session from one Atlas Device Sessions surface. Session revocation closes every owned substream and invalidates authorization grants.

## Agent capability contract

Introduce a versioned, transport-neutral protocol package shared by Calculator and Atlas. It defines:

- `Conversation`, `Message`, `Turn`, `StreamEvent`, `Citation`, `Reference`, and resumable cursor records;
- `AgentDescriptor` for Codex, Claude, OpenCode, local/free engines, and future adapters;
- `ToolDescriptor` with stable ID, JSON Schema input/output, risk level, required FNGK scope, confirmation policy, documentation link, and audit fields;
- `ToolCall`, `ToolProgress`, `ToolResult`, `ApprovalRequest`, `ApprovalDecision`, and normalized error shapes;
- slash-command suggestions generated from the same capability registry.

Atlas capability IDs use the `atlas.*` namespace. The registry is the only source for MCP tool definitions, Calculator function actions, Atlas command-palette actions, slash-command suggestions, approval cards, and user documentation links. A tool cannot appear in one surface without being present in the registry.

Existing Atlas backend routes remain the execution boundary. New tool handlers are thin adapters which validate schema, resolve scope, acquire a Device Session Manager substream, invoke the existing guarded operation, redact results, and emit auditable progress. Tools must not invoke shell text or bypass Atlas/FNGK authorization directly.

Read-only tools may execute under the active scoped policy. Mutation tools include terminal command execution, filesystem writes/deletes, port publication, deployment, recovery, and device lifecycle actions. They require a policy decision before execution.

## Authorization and full access

Atlas evaluates every tool request. Calculator and model output are untrusted requests, not authority.

For a tool invocation Atlas validates, in order:

1. authenticated user and active profile;
2. device/team/project scope and current device availability;
3. JSON Schema and bounded input size;
4. current tool policy and any matching grant;
5. explicit operator decision when required;
6. backend/FNGK authorization at the existing guarded operation;
7. audit emission and redacted result delivery.

The policy choices are `deny`, `ask`, `allow for this conversation`, `allow for this profile/device scope`, and `full access`. Full access is explicitly entered, visibly indicated, time-limited by default, revocable from Atlas, and fully audited. It grants only eligible registered tools in the selected scope. It cannot cross identity/project boundaries, create authority without FNGK login, reveal credentials, override device-side checks, or replay operations after reconnect.

An approval card must display the exact tool, target profile/device/project, parameters with secrets redacted, impact/risk, expiry, and allow/deny choices. Durable grants are visible and removable in the Device Sessions/permissions surface.

## Shared chat experience

Replace Atlas's one-shot read-only Intelligence panel with a dockable Agent Chat panel. The panel supports session selection, user/assistant bubbles, markdown and code, streaming response state, tool timeline, citations, attached workspace references, agent/model selection, cancel/steer, reconnect/resume, and recoverable errors.

The same conversation behavior is shared without an iframe or copied application. A framework-neutral client package provides protocol reducer, transport/reconnect client, slash-command parser, action model, accessibility behavior, markup contracts, and design tokens. Calculator keeps a native web renderer; Atlas implements a Svelte renderer. Atlas retains its current tokenized CSS architecture; Tailwind is not introduced as a second styling system.

Chat receives explicit references to current profile, team/project, device, selection, file, terminal, deployment, and route context. These references are inspectable and removable before sending. Hidden prompt injection of workspace state is forbidden.

In Atlas, Agent Chat is opened/restored from a new activity-rail icon and can be invoked from relevant panels with contextual references. It is dockable and minimizable. Moving or hiding it must not close a conversation stream, terminal stream, or device channel. The inspector can display selected message metadata, citations, tool audit information, and active grants.

## Transport and engine integration

Calculator's existing conversation API remains the public runtime transport. It must gain a documented versioned contract for session list/create/resume, send/steer/cancel, streamed events, cursor-based resumption, reference attachments, available agents/models, and tool events.

Calculator invokes Atlas tools through a trusted, authenticated tool gateway. The gateway may be surfaced as MCP to engines that support MCP and as function/tool actions to engines with native tool calling. Both forms use the same `ToolDescriptor` schema and Atlas execution service. Codex, Claude, OpenCode, and compatible local/free providers are adapters over this common contract, not bespoke Atlas integrations.

The browser never receives delegation credentials for the Calculator-to-Atlas or Atlas-to-FNGK path. Tokens are scoped, short lived, redacted from events/logs, and rejected on scope/profile mismatch.

## Failure handling and recovery

Every stream event has a stable turn/tool ID and resumable cursor. On disconnect, Atlas marks the affected stream as reconnecting, retains rendered content, resumes from the cursor, and reconciles idempotently. It never silently resends a mutation or terminal command. Unknown final state is reported with a link to inspection/audit, not guessed.

Cold, offline, revoked, authorization-required, capability-changed, timeout, and policy-denied states must have distinct operator-visible guidance. Session recovery controls are available without leaving the active workspace.

## Performance and accessibility

Performance is measured before and after migration for:

- cold and warm directory navigation;
- cold and warm file opening;
- repeated terminal attach;
- device channel reconnect/resume;
- chat first event and streamed-token latency;
- large directory and conversation rendering.

Acceptance is not a fixed latency number because network distance differs. A warm operation must avoid a new device authentication/connection handshake; metrics must show its reused session ID and the number of remote requests. Large lists are paginated/virtualized where appropriate and all in-flight navigation is cancellable.

The chat and approval UI must be keyboard navigable, screen-reader labeled, focus-safe across dock/minimize/restore, and usable with dark and light themes.

## Delivery order

1. Calculator recovery and worktree consolidation.
2. Device Session Manager foundation, observability, filesystem migration, and terminal session lifecycle.
3. Versioned capability registry and Atlas execution gateway.
4. Shared conversation protocol/client extracted from Calculator with compatibility tests.
5. Native Atlas Agent Chat surface and contextual workspace references.
6. Slash commands, approvals, durable grants, and full-access session controls.
7. Codex, Claude, OpenCode, and local/free adapter verification.
8. End-to-end security, recovery, performance, continuity, and multi-profile acceptance.

## Acceptance criteria

- A warm filesystem operation reuses an existing scoped device channel; no new connection/authentication handshake occurs.
- Terminal, file, deployment, and agent tool streams are independently cancellable and survive unrelated panel minimize/restore.
- Every exposed Atlas capability is represented once in the registry and available consistently to MCP, function calling, slash commands, documentation, and approved UI actions.
- Every mutation has a recorded scope and policy/approval decision; denied, revoked, and expired grants cannot execute it.
- Full access is scoped, visible, expiring, revocable, and cannot bypass FNGK/backend authorization.
- Conversations and tool events resume without duplicate mutations after transient disconnect.
- Calculator and Atlas render equivalent conversation states from the same event fixtures.
- Codex, Claude, and one compatible local/free engine can enumerate and execute authorized tools through the common contract.
- Existing Atlas operational workflows continue to work without Calculator configured; Agent Chat reports a recoverable unavailable state.
