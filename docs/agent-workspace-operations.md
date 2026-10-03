# Atlas agent workspace operations

Atlas keeps a **Device Session** per `(profile, team, project, device)` scope. It is a persistent, server-owned FNGK terminal connection. Filesystem browsing, file reads, terminals, and governed tools borrow leases from that one session; moving, minimizing, or restoring a panel never closes it.

## Inspect and recover a Device Session

Open **Device Sessions** from the left activity rail. Each card shows the scoped device, state, session ID prefix, active stream count, handshake count, and filesystem cache revision.

- **Reconnect** closes and re-establishes the scoped FNGK connection. Use it after a remote network change or an explicit connection failure.
- **Clear cache** removes cached directory listings for that scope only. File bodies are never retained in this cache.
- **Revoke** immediately ends all leases and streams for that scope. Atlas asks for confirmation. The next action must establish a fresh connection.

Switching FNGK profiles selects a different scope, so no directory cache or persistent session is reused across profiles. A revoked or disconnected session cannot execute a deferred action: the caller receives a clear failure or `outcome_unknown`, never an automatic mutation retry.

## Agent Chat and Calculator recovery

Open **Agent Chat** from the activity rail or the command palette. The panel stores only its selected conversation ID, stream cursor, and explicit context references under the active workspace scope. It does not store credentials, hidden prompt context, raw terminal output, or file bodies.

If Calculator is unavailable, the chat panel reports the reason and leaves the rest of Atlas usable. Open or continue a terminal, filesystem, deployment, or Device Session panel while Calculator is repaired. When Calculator is back, select **Resume** in the chat panel; Atlas reconnects using the stored cursor, so display events may replay but no tool mutation is replayed.

Atlas reads `ATLAS_CALCULATOR_URL`, `ATLAS_CALCULATOR_TOKEN`, and optionally `ATLAS_CALCULATOR_ENGINE` only in the server process. `ATLAS_CALCULATOR_TOKEN` must be a scoped, expiring Calculator integration credential created at Calculator's `/integrations` page, never an administrator, engine, connector, or Signal token. The renderer talks only to same-origin `/api/agent-chat/*` endpoints. Never place the Calculator token in browser storage, a workspace snapshot, or a client-side configuration file.

## Tool approvals and grants

Read-only tools are offered as scoped slash commands. Higher-risk actions require an approval card before execution. The card supports:

- **Allow once** — reserves one execution of the exact scoped tool. Atlas consumes it atomically when that execution begins and discards it if Atlas restarts first.
- **Allow conversation** — permits the matching tools for the current conversation scope.
- **Remember** — creates a durable scoped grant.
- **Grant full access** — creates a full-access scoped grant with a one-hour expiry.
- **Deny** or **Revoke** — block the pending action or remove matching conversation grants.

Use **Revoke** in the approval card or Device Sessions to stop work immediately. A grant is scoped to the resolved FNGK device authorization; changing profile, team, project, or device does not carry it across.

The approval card tells Calculator whether the action was approved or denied. On approval, Calculator may retry only the exact requested tool call; Atlas remains the enforcement point and will reject a call whose grant, scope, or one-time reservation no longer matches. Terminal commands run through the same persistent scoped Device Session as Atlas terminals and have a 30-second limit; their returned text is redacted and bounded before it reaches Calculator.

## Performance and privacy telemetry

The filesystem cache reports bounded aggregate telemetry per scope:

| Field | Meaning |
| --- | --- |
| `sessionId` | Current FNGK session identifier, used only for correlation. |
| `handshakeCount` | Connections established for the scoped session. Warm actions should not increase it. |
| `requests` | Cache-miss filesystem transport requests. |
| `cacheHits` / `cacheMisses` | Directory-cache efficiency. |
| `latencyMs` | Aggregate elapsed milliseconds for cache misses. |

This telemetry deliberately excludes secrets, command text, terminal output, file contents, and prompt text. The acceptance tests verify a cold directory visit, warm revisit, and file read all reuse one session and one handshake.

## Escalation checklist

1. Confirm the selected profile and Device are correct in the activity rail.
2. Open Device Sessions and inspect state, failure reason, and handshake count.
3. Reconnect once; do not repeatedly reconnect or rerun a mutation with an unknown outcome.
4. Clear only the affected scope's filesystem cache if listings are stale.
5. Revoke the session if the device was deauthorized, replaced, or compromised.
6. For Calculator failures, keep working in Atlas, repair the server-side Calculator configuration, then resume the chat stream.
