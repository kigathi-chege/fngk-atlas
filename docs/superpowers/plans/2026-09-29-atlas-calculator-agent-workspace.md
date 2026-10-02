# Atlas Calculator Agent Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a durable Calculator-backed agent chat inside Atlas whose governed tools operate quickly through persistent FNGK device sessions.

**Architecture:** Calculator remains the conversation, engine, MCP orchestration, and audit authority. Atlas owns scoped persistent Device Sessions, FNGK operation execution, policy decisions, workspace presentation, and audit. A published transport-neutral contract package and a single Atlas capability registry prevent conversation UI, slash commands, MCP tools, and approval behavior from drifting.

**Tech Stack:** Calculator Node.js ESM workspaces, MCP SDK 2.0, existing Calculator engine/session routes; Atlas Fastify/TypeScript, Svelte 5, Dockview, FNGK JSONL terminal protocol, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-atlas-calculator-agent-workspace-design.md`

## Global Constraints

- Calculator is the only owner of persisted conversations, engine sessions, streamed turns, and model-provider dispatch.
- Atlas executes `atlas.*` tools only through existing guarded Atlas/FNGK services; a model must never receive raw backend credentials or an unbounded shell.
- A Device Session is scoped to exactly one profile, team/project access context, and device; it may never be reused across scope.
- Use structured filesystem RPC/transport operations for files, not terminal text as a filesystem API.
- All mutations require a recorded policy decision: deny, ask, conversation grant, durable scoped grant, or explicit full-access grant.
- Full access is visible, scope-bound, expiring by default, revocable, and still subject to FNGK/backend authorization.
- Reconnect must resume streams by cursor and must never silently replay a mutation or terminal command.
- Preserve panel/terminal continuity when a chat, terminal, or inspector is moved, minimized, or restored.
- Do not introduce Tailwind. Extend existing Atlas tokenized CSS and share framework-neutral tokens/contracts.
- Keep `src/deployments/project-manifest.ts` formatting work outside this program unless separately reviewed and committed.

## Review Focus

- A stale or cross-profile Device Session must be rejected before any filesystem, terminal, or tool operation; covered in Tasks 2 and 3.
- A network drop after a mutation request must show an unknown/outcome-reconciliation state, never auto-retry; covered in Tasks 2, 6, and 12.
- A full-access grant must expire/revoke correctly and never bypass project/team/device authorization; covered in Task 7.
- A model-provided tool name, parameter, reference, or documentation target must be schema-validated and bounded; covered in Tasks 5 and 8.
- Calculator and Atlas must render the same fixture stream—including tool approval and reconnection events—without duplicate messages; covered in Tasks 9 and 10.

---

## Planned file structure

### Calculator

- `packages/agent-conversation-contract/`: publishable ESM package containing event/tool/policy schemas, protocol constants, reducer, and fixture builders.
- `web/platform/reference-api.mjs`: versioned conversation endpoints and cursor-based event stream adapter over existing session/engine services.
- `web/integrations/atlas-tools-mcp.mjs`: trusted MCP/function-facing Atlas tool bridge, built from contract descriptors.
- `web/public/conversation-client.js`: Calculator renderer adapter over the shared reducer/stream client.
- `web/tests/agent-conversation-contract.test.mjs`, `web/tests/atlas-tools-mcp.test.mjs`, `web/tests/conversation-stream-contract.test.mjs`: contract and integration coverage.

### Atlas

- `src/device-sessions/`: scoped session manager, status model, filesystem cache, grant policy store, and Atlas tool executor.
- `src/agent-contract/`: Atlas implementation of the published client transport adapter, not a duplicate schema.
- `src/server/app.ts`: Device Session, tool gateway, policy, and conversation-proxy endpoints.
- `src/web/components/AgentChatPanel.svelte`, `DeviceSessionsPanel.svelte`, `ToolApprovalCard.svelte`: native Svelte workspace surfaces.
- `src/web/lib/agent-chat.ts`, `device-session-store.ts`, `atlas-capabilities.ts`: frontend state, capability-to-command projection, and session telemetry.
- `test/device-sessions/`, `test/agent-tools/`, `test/web/agent-chat.test.ts`, `e2e/agent-workspace.spec.ts`: server, UI, and continuity acceptance coverage.

## Task 1: Recover and consolidate Calculator worktrees

**Files:**
- Create: `calculator/docs/recovery/2026-09-29-agent-workspace-worktree-audit.md`
- Modify: only files proven to belong to the selected Calculator integration branch
- Test: existing diagnostics and agent-workbench transport tests

**Interfaces:**
- Consumes: Calculator base checkout and `calculator-hardening-ui-storage` worktree.
- Produces: one clean Calculator integration branch with an audit record; no active hardening worktree.

- [ ] **Step 1: Record the baseline before changing Calculator**

Capture branch, head SHA, `git status --short`, worktree list, unmerged commits, and untracked/generated paths for both Calculator checkouts. The audit must classify each item as `merge`, `preserve separately`, `generated`, or `discardable` with evidence.

- [ ] **Step 2: Run focused baseline checks**

Run: `node --test web/tests/agent-workbench-transport.test.mjs web/tests/diagnostics-auth.test.mjs web/tests/diagnostics-store.test.mjs web/tests/diagnostics-ui.test.mjs`

Expected: establish the exact pre-merge pass/failure state in the audit; do not merge a failing behavior change.

- [ ] **Step 3: Create failing recovery assertions when the audit exposes a missing invariant**

Add the smallest test to the owning `web/tests/` file for each actual regression uncovered by the hardening worktree. Do not convert formatting or generated files into product changes.

- [ ] **Step 4: Integrate only verified worktree commits and necessary uncommitted fixes**

Commit each coherent recovery unit on the Calculator integration branch. Preserve unrelated base-checkout work on its own branch; remove only reproducible ignored artifacts.

- [ ] **Step 5: Verify and clean up**

Run the focused tests from Step 2 plus `npm run check:web`. After a clean base checkout is confirmed, remove `calculator-hardening-ui-storage`, prune worktree metadata, and delete its merged branch.

- [ ] **Step 6: Commit**

```bash
git add docs/recovery/2026-09-29-agent-workspace-worktree-audit.md
git commit -m "docs(calculator): record agent workspace recovery audit"
```

## Task 2: Add the scoped Atlas Device Session Manager

**Files:**
- Create: `src/device-sessions/types.ts`, `src/device-sessions/manager.ts`, `src/device-sessions/manager.test.ts`
- Modify: `src/server/app.ts`, `src/fngk/terminal-session.ts`, `test/transports/terminal.test.ts`

**Interfaces:**
- Consumes: `TerminalSession`, existing FNGK context/profile resolution, and `TerminalFileTransport`/`FngkTerminalCommandExecutor`.
- Produces: `DeviceSessionManager.acquire(scope: DeviceScope): Promise<DeviceSessionLease>`, `release`, `revoke`, `snapshot`, and typed `DeviceSessionState` events.

- [ ] **Step 1: Write failing manager tests**

Create tests asserting: same scope deduplicates one live connection; different profile/device/project scopes never share it; released idle leases close after TTL; revocation closes every child stream; a connection failure moves `ready → reconnecting → failed/offline` without replaying work.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `npm exec vitest run test/device-sessions/manager.test.ts`

Expected: FAIL because the manager and types do not exist.

- [ ] **Step 3: Implement the stateful lease manager**

Define `DeviceScope = { profile: string; teamId?: string; projectId?: string; deviceId: string }` and an opaque `DeviceSessionLease`. The manager owns the live `TerminalSession` factory, reference count, reconnect policy, health measurements, event emitter, cancellation registry, and explicit revocation. It must compare canonical scope keys exactly.

- [ ] **Step 4: Expose scoped session diagnostics**

Add authenticated endpoints in `src/server/app.ts` for listing session snapshots, reconnecting a matching scope, revoking it, and clearing only its cache. Each request must resolve profile/team/project/device access before calling the manager.

- [ ] **Step 5: Verify**

Run: `npm exec vitest run test/device-sessions/manager.test.ts test/transports/terminal.test.ts`

Expected: PASS with explicit no-cross-scope and no-replay assertions.

- [ ] **Step 6: Commit**

```bash
git add src/device-sessions src/fngk/terminal-session.ts src/server/app.ts test/device-sessions test/transports/terminal.test.ts
git commit -m "feat(atlas): add scoped persistent device sessions"
```

## Task 3: Migrate filesystem and terminal consumers to Device Sessions

**Files:**
- Create: `src/device-sessions/filesystem-cache.ts`, `test/device-sessions/filesystem-cache.test.ts`
- Modify: `src/files/file-service.ts`, `src/transports/terminal-file.ts`, `src/transports/terminal-command.ts`, `src/web/components/FilesystemTree.svelte`, `src/web/components/TerminalPanel.svelte`
- Test: `test/transports/terminal.test.ts`, `test/web/filesystem-tree.test.ts` (new)

**Interfaces:**
- Consumes: `DeviceSessionLease.commandExecutor()` and `DeviceSessionLease.subscribe()` from Task 2.
- Produces: revision-aware `FilesystemCache.list(scope, path, options)` and `read(scope, path, options)` with `AbortSignal`, plus terminal panels that attach to leased sessions.

- [ ] **Step 1: Write failing cache and UI tests**

Test a warm directory visit uses the same session ID and one transport list request; a superseded navigation aborts the first request; cache entries never serve a different profile/device; a file read performs no new session handshake; terminal minimize/restore keeps its leased stream open.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm exec vitest run test/device-sessions/filesystem-cache.test.ts test/web/filesystem-tree.test.ts`

Expected: FAIL because no cache or lease-aware browser contract exists.

- [ ] **Step 3: Implement structured cache-backed filesystem reads**

Keep `FileService` as the policy/path validation boundary. Add `knownRevision`, bounded pages, in-flight deduplication by scope/path/options, abort propagation, and cache invalidation from device events. Do not route `FilesystemTree` through terminal UI output.

- [ ] **Step 4: Attach terminal panels through leases**

Change terminal creation/restore to acquire the current scope lease and preserve a stable terminal stream ID. Closing a panel releases only its terminal substream; it must not revoke shared filesystem/deployment streams.

- [ ] **Step 5: Add session metrics and verify warm behavior**

Expose `sessionId`, `handshakeCount`, request count, cache hit/miss, and latency in non-secret diagnostics. Run the tests from Step 2 and a Playwright workflow opening a directory twice then a file.

- [ ] **Step 6: Commit**

```bash
git add src/device-sessions src/files src/transports src/web/components/FilesystemTree.svelte src/web/components/TerminalPanel.svelte test e2e
git commit -m "feat(atlas): reuse device sessions for files and terminals"
```

## Task 4: Add the Atlas Device Sessions workspace surface

**Files:**
- Create: `src/web/components/DeviceSessionsPanel.svelte`, `src/web/lib/device-session-store.ts`, `src/web/components/DeviceSessionsPanel.css`, `test/web/device-sessions.test.ts`
- Modify: `src/web/components/ActivityRail.svelte`, `src/web/components/PanelHost.svelte`, `src/web/components/Workbench.svelte`, `src/web/lib/command-registry.ts`
- Test: `e2e/device-sessions.spec.ts` (new)

**Interfaces:**
- Consumes: Task 2 session endpoints and `DeviceSessionSnapshot`.
- Produces: an independently minimizable Atlas panel and `atlas:open-device-sessions` command/event.

- [ ] **Step 1: Write failing UI and e2e tests**

Assert a session card shows profile, device, state, RTT, active streams, and grant summary; reconnect/revoke/cache-clear controls target the selected scope; revocation updates open filesystem/terminal state without cross-device effects.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm exec vitest run test/web/device-sessions.test.ts && npm run test:e2e -- --grep "Device Sessions"`

Expected: FAIL because the panel and activity-rail integration are absent.

- [ ] **Step 3: Implement the panel and lifecycle controls**

Use existing Atlas panel conventions and token CSS. The panel must keep sidebars/minimized terminal behavior intact and offer reconnect, revoke, clear cache, and terminate-terminal actions with confirmation for destructive actions.

- [ ] **Step 4: Verify**

Run the Step 2 commands. Confirm keyboard navigation and no session loss after panel minimize/restore.

- [ ] **Step 5: Commit**

```bash
git add src/web/components src/web/lib test/web e2e/device-sessions.spec.ts
git commit -m "feat(atlas): manage persistent device sessions"
```

## Task 5: Publish the shared conversation and tool contract from Calculator

**Files:**
- Create: `calculator/packages/agent-conversation-contract/package.json`, `src/protocol.js`, `src/reducer.js`, `src/fixtures.js`, `test/protocol.test.mjs`
- Modify: `calculator/package.json`, `calculator/packages/agent-workbench-core/src/index.js`, `calculator/scripts/test-orchestration.sh`
- Test: `calculator/web/tests/agent-conversation-contract.test.mjs`

**Interfaces:**
- Consumes: Calculator's existing portable session/message records and MCP tool descriptors.
- Produces: `@nipateafrica/agent-conversation-contract` exports: `CONVERSATION_PROTOCOL`, `parseStreamEvent`, `reduceConversation`, `parseToolDescriptor`, `parseApprovalDecision`, and deterministic event fixtures.

- [ ] **Step 1: Write failing contract tests**

Cover valid/invalid message, stream cursor, tool call/progress/result, approval request/decision, reference, and reconnect events. Assert unknown fields are rejected or preserved only in a declared extension bag; assert event reduction is idempotent by event ID.

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test web/tests/agent-conversation-contract.test.mjs`

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement the versioned package**

Use Zod 4 schemas already present in Calculator. Export plain data/reducer functions with no DOM, server, provider, or credential dependency. Version the envelope as `agent.conversation.v1` and use bounded strings/arrays throughout.

- [ ] **Step 4: Add package release verification**

Extend the existing package-release test/script to import the package through its declared export, verify package metadata, and ensure browser-safe modules do not import Node-only APIs.

- [ ] **Step 5: Verify and commit**

Run: `node --test web/tests/agent-conversation-contract.test.mjs web/tests/agent-workbench-package-release.test.mjs`

```bash
git add packages/agent-conversation-contract package.json scripts web/tests
git commit -m "feat(calculator): publish conversation tool contract"
```

## Task 6: Version Calculator conversation streaming and resume APIs

**Files:**
- Create: `calculator/web/platform/conversation-stream.mjs`, `calculator/web/tests/conversation-stream-contract.test.mjs`
- Modify: `calculator/web/platform/reference-api.mjs`, `calculator/web/platform-engine-account-runtime.mjs`, `calculator/web/platform/session-routes.mjs`, `calculator/web/public/conversation-feed.js`

**Interfaces:**
- Consumes: Task 5 schemas/reducer and current `conversationAccess`/engine session services.
- Produces: versioned `GET /api/conversations/:id/events?cursor=` SSE endpoint and normalized create/list/send/steer/cancel payloads.

- [ ] **Step 1: Write failing stream tests**

Assert a principal can only subscribe to authorized sessions; resume from cursor returns only subsequent ordered events; duplicate source events map to one event ID; a disconnected mutation reports `outcome_unknown` rather than dispatching again; secret-looking fields are absent from events.

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test web/tests/conversation-stream-contract.test.mjs web/tests/conversation-parity-p*.test.mjs`

Expected: FAIL because the endpoint/event projection does not satisfy the v1 contract.

- [ ] **Step 3: Implement normalized event projection and SSE replay**

Persist/recover an event cursor using existing session/ledger storage. Convert engine-specific events to Task 5 envelopes at the boundary, keep Calculator's existing authorization checks, send heartbeats, and close with a typed terminal event rather than an ambiguous socket failure.

- [ ] **Step 4: Update Calculator's current renderer adapter**

Move `conversation-feed.js` to consume the common reducer/client semantics while retaining its existing DOM shell. Do not change the visual design during this transport task.

- [ ] **Step 5: Verify and commit**

Run the Step 2 suite plus `npm run check:web`.

```bash
git add web/platform web/public web/tests
git commit -m "feat(calculator): stream resumable conversation events"
```

## Task 7: Build Atlas capability registry and guarded execution gateway

**Files:**
- Create: `src/agent-tools/contracts.ts`, `src/agent-tools/registry.ts`, `src/agent-tools/executor.ts`, `test/agent-tools/registry.test.ts`, `test/agent-tools/executor.test.ts`
- Modify: `src/server/app.ts`, `src/intelligence/service.ts`, `src/web/lib/command-registry.ts`, `src/web/lib/context-actions.ts`

**Interfaces:**
- Consumes: Task 2 `DeviceSessionManager`, Task 5 `ToolDescriptor`, existing `FileService`, terminal, deployment, ports, lifecycle, and live-project services.
- Produces: `AtlasToolRegistry.list(scope)`, `describe(id)`, and `AtlasToolExecutor.execute(request, principal)` for the `atlas.*` namespace.

- [ ] **Step 1: Write failing registry/executor tests**

Test that a descriptor appears once and generates an MCP/function definition, slash action, command-palette entry, documentation target, risk classification, and JSON Schema validation. Test invalid tool IDs/parameters, offline device, cross-project scope, denied policy, and a successful read-only filesystem action.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm exec vitest run test/agent-tools/registry.test.ts test/agent-tools/executor.test.ts`

Expected: FAIL because no unified registry exists.

- [ ] **Step 3: Implement descriptors and execution adapters**

Start with `atlas.files.list`, `atlas.files.read`, `atlas.terminal.open`, `atlas.terminal.command`, `atlas.deployment.inspect`, `atlas.ports.list`, and `atlas.device.inspect`. Each adapter validates input, resolves scope, acquires a typed session substream, invokes an existing service, redacts output, and returns normalized progress/result events.

- [ ] **Step 4: Expose trusted server endpoints**

Add authenticated endpoints for capability discovery, tool execution, and tool-event streaming. Do not expose FNGK delegation secrets or raw session internals to the browser.

- [ ] **Step 5: Verify and commit**

Run the Step 2 suite plus existing intelligence/context-action tests.

```bash
git add src/agent-tools src/server/app.ts src/intelligence src/web/lib test/agent-tools test/web
git commit -m "feat(atlas): expose governed workspace capabilities"
```

## Task 8: Add Atlas policy grants, approvals, and full-access controls

**Files:**
- Create: `src/agent-tools/policy.ts`, `src/agent-tools/grants.ts`, `src/agent-tools/audit.ts`, `test/agent-tools/policy.test.ts`, `test/agent-tools/grants.test.ts`
- Modify: `src/agent-tools/executor.ts`, `src/server/app.ts`, `src/web/lib/atlas-capabilities.ts` (new)

**Interfaces:**
- Consumes: Task 7 `ToolDescriptor`/executor and Task 2 scope identity.
- Produces: `evaluateToolPolicy(request): PolicyDecision`, `createGrant(input): Grant`, `revokeGrant(id)`, and immutable audit entries.

- [ ] **Step 1: Write failing policy tests**

Cover `deny`, `ask`, conversation grant, durable scoped grant, expiry, revocation, and full access. Assert full access never permits a different profile/team/project/device; an expired/revoked grant cannot execute; a missing backend authorization remains denied.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm exec vitest run test/agent-tools/policy.test.ts test/agent-tools/grants.test.ts`

Expected: FAIL because policy/grant records do not exist.

- [ ] **Step 3: Implement policy and durable storage**

Persist grants/audit using the existing Atlas application data pattern. Store scope, allowed descriptor IDs, conversation binding if applicable, actor, creation/expiry/revocation metadata, and redacted parameter digest—not secrets or terminal output.

- [ ] **Step 4: Add approval and grant API contracts**

Implement create/decide/list/revoke endpoints. A mutation execution must return `approval_required` with a complete redacted approval request until a matching policy allows it.

- [ ] **Step 5: Verify and commit**

Run the Step 2 suite and a route-level integration test proving a revoked full-access grant cannot execute `atlas.terminal.command`.

```bash
git add src/agent-tools src/server/app.ts src/web/lib test/agent-tools
git commit -m "feat(atlas): govern agent tool approvals and grants"
```

## Task 9: Connect Calculator engines to Atlas through MCP/function tools

**Files:**
- Create: `calculator/web/integrations/atlas-tools-mcp.mjs`, `calculator/web/tests/atlas-tools-mcp.test.mjs`
- Modify: `calculator/web/integrations/signal-tools-mcp.mjs`, `calculator/web/runtime/mcp-server.mjs`, `calculator/web/runtime/context.mjs`, `calculator/web/platform/engines.mjs`

**Interfaces:**
- Consumes: Task 5 contract and Atlas capability/discovery/approval endpoints.
- Produces: a trusted Calculator Atlas-tool bridge usable by MCP-capable engines and native function-calling adapters.

- [ ] **Step 1: Write failing bridge tests**

Test descriptor enumeration, schema propagation, request identity/scope forwarding, progress forwarding, approval-required response normalization, tool-result redaction, and rejection of unknown `atlas.*` names.

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test web/tests/atlas-tools-mcp.test.mjs web/tests/agent-workbench-mcp-gateway.test.mjs`

Expected: FAIL because the Atlas bridge is absent.

- [ ] **Step 3: Implement the trusted bridge**

Use Calculator's server-side credentials only. Map MCP `tools/list` and `tools/call` plus native-function adapter calls to the same contract. Send short-lived principal/scope delegation; do not relay browser credentials or permit generic outbound URLs.

- [ ] **Step 4: Register provider capability matrices**

Update Codex, Claude, OpenCode, and one local/free adapter so their advertised tool support matches actual MCP/native-function behavior. Unsupported engines must receive readable non-tool fallback status, not malformed calls.

- [ ] **Step 5: Verify and commit**

Run Step 2 plus the applicable engine-account session transition suite.

```bash
git add web/integrations web/runtime web/platform web/tests
git commit -m "feat(calculator): connect agents to governed Atlas tools"
```

## Task 10: Extract the framework-neutral conversation client and refit Calculator UI

**Files:**
- Create: `calculator/packages/agent-conversation-contract/src/client.js`, `calculator/packages/agent-conversation-contract/test/client.test.mjs`
- Modify: `calculator/web/public/conversation-feed.js`, `calculator/web/public/conversation-actions.js`, `calculator/packages/agent-workbench-ui/src/shells.js`, `calculator/web/tests/conversation-parity-p1-surface.test.mjs`

**Interfaces:**
- Consumes: Task 5 reducer and Task 6 stream API.
- Produces: `createConversationClient({ transport, onState })` with `open`, `send`, `steer`, `cancel`, `resume`, `dispose`, `suggestSlashCommands`.

- [ ] **Step 1: Write failing client tests**

Use Task 5 fixtures to assert streaming token accumulation, duplicate event idempotence, cursor resume, tool progress replacement, approval request persistence, cancellation, and terminal/disconnect states.

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test packages/agent-conversation-contract/test/client.test.mjs web/tests/conversation-parity-p1-surface.test.mjs`

Expected: FAIL because the client API is absent.

- [ ] **Step 3: Implement the DOM-free client and Calculator adapter**

The client must own no storage beyond explicit resume metadata passed by the host. The Calculator renderer maps state to its existing message bubbles, controls, and session selector without changing its visual identity.

- [ ] **Step 4: Verify and commit**

Run Step 2 and `node --test web/tests/conversation-parity-p*.test.mjs`.

```bash
git add packages/agent-conversation-contract web/public packages/agent-workbench-ui web/tests
git commit -m "refactor(calculator): share conversation client behavior"
```

## Task 11: Implement native Atlas Agent Chat, tool cards, and slash commands

**Files:**
- Create: `src/web/components/AgentChatPanel.svelte`, `ToolApprovalCard.svelte`, `AgentChatPanel.css`, `src/web/lib/agent-chat.ts`, `src/web/lib/atlas-capabilities.ts`, `test/web/agent-chat.test.ts`
- Modify: `src/web/components/ActivityRail.svelte`, `AtlasMenu.svelte`, `PanelHost.svelte`, `Workbench.svelte`, `DetailsPanel.svelte`, `src/web/lib/command-registry.ts`, `src/web/workspace.css`
- Test: `e2e/agent-workspace.spec.ts`

**Interfaces:**
- Consumes: Tasks 5, 6, 7, 8, and 10; Calculator's documented conversation API; Atlas session snapshots.
- Produces: dockable `agent-chat` panel, `atlas:open-agent-chat` event, command/slash projections, reference attachments, approval cards, and inspector links.

- [ ] **Step 1: Write failing component and browser tests**

Assert chat opens from the activity rail and command palette; a selected device/file/terminal becomes a visible removable reference; streamed fixture events render identical message/tool states to Calculator; slash commands list only descriptors authorized for the active scope; minimizing/restoring chat preserves its stream and a live terminal; an approval card can allow once, allow for conversation, grant full access with expiry, deny, and revoke.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm exec vitest run test/web/agent-chat.test.ts && npm run test:e2e -- --grep "Agent Chat"`

Expected: FAIL because no native Agent Chat panel or commands exist.

- [ ] **Step 3: Implement Atlas conversation transport and state store**

Implement a `ConversationTransport` adapter that calls Calculator APIs, resumes with last cursor, and turns tool/approval events into shared client events. Persist only selected conversation ID and safe cursor under the active workspace scope; do not persist credentials or hidden context.

- [ ] **Step 4: Implement the Svelte panel and approval cards**

Use Atlas token CSS and existing Dockview lifecycle conventions. Render explicit context references, markdown/code safely, streaming indicator, cancel/steer, citations, tool timeline, errors, and approval controls. Link every tool card to the registered documentation topic and relevant Atlas panel.

- [ ] **Step 5: Wire command palette, slash commands, and contextual launchers**

Generate `atlas.*` command entries from the Task 7 registry. Add contextual launch actions from terminal/filesystem/deployment/ports/lifecycle panels without opening duplicate chat panels.

- [ ] **Step 6: Verify and commit**

Run the Step 2 suite, `npm run check:web`, and existing terminal continuity tests.

```bash
git add src/web/components src/web/lib src/web/workspace.css test/web e2e/agent-workspace.spec.ts
git commit -m "feat(atlas): add native governed agent chat"
```

## Task 12: Add cross-system recovery, performance, and security acceptance

**Files:**
- Create: `e2e/agent-workspace-recovery.spec.ts`, `test/device-sessions/performance.test.ts`, `docs/agent-workspace-operations.md`
- Modify: Calculator and Atlas CI scripts/workflows that run relevant existing suites

**Interfaces:**
- Consumes: all prior tasks.
- Produces: repeatable acceptance reports for warm-device performance, replay safety, authorization, engine compatibility, and operator recovery.

- [ ] **Step 1: Write failing end-to-end acceptance tests**

Cover: cold then warm directory/file action with same session ID and no second handshake; a mid-tool disconnect resumes display without duplicate mutation; revoked session/full-access grant blocks subsequent actions; profile switch invalidates previous cache/lease; Codex, Claude, and one local/free fixture enumerate the same approved tools; Calculator-unavailable Atlas remains usable and shows recovery guidance.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm run test:e2e -- --grep "agent workspace recovery"` in Atlas and the Calculator bridge suite.

Expected: FAIL until all cross-system behaviors are integrated.

- [ ] **Step 3: Add bounded latency instrumentation and operations documentation**

Record cold/warm operation timing, handshake count, session ID, request count, cache hit/miss, reconnect count, and stream resume outcome. Document how operators inspect/reconnect/revoke/purge a Device Session and manage grants. Do not record secrets, source content, or raw command output in aggregate metrics.

- [ ] **Step 4: Run final verification**

Run Atlas `npm run build`, `npm run check:web`, focused unit suites, and all new e2e suites; run Calculator `npm run check:web` plus all contract/bridge/conversation suites. Record pre-existing failures separately; do not mask them.

- [ ] **Step 5: Commit**

```bash
git add e2e test/device-sessions docs .github scripts
git commit -m "test(atlas): verify agent workspace recovery and performance"
```

## Plan self-review

- **Coverage:** Tasks 1–4 cover Calculator recovery and persistent device sessions; 5–6 cover shared protocol and durable Calculator conversation streams; 7–9 cover Atlas capabilities, authorization, and provider/MCP integration; 10–11 cover shared conversation behavior and native Atlas UI; Task 12 covers recovery, performance, and security acceptance.
- **Type consistency:** `DeviceScope`/`DeviceSessionLease` originate in Task 2 and are consumed by later Atlas tasks. `ToolDescriptor` and event envelopes originate in Task 5 and are consumed by Calculator bridge, Atlas executor, client, and UI tasks. `ConversationTransport` is an Atlas adapter over Task 10's `createConversationClient`.
- **Review focus coverage:** The five risks in Review Focus are pinned respectively to Tasks 2/3, 2/6/12, 8, 7/9, and 10/11.
- **Scope:** The plan explicitly excludes a Spindle runtime dependency, a copied UI, Tailwind introduction, direct raw-shell tool access, and unrelated deployment-manifest formatting.
