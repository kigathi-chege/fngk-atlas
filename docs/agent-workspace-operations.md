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

## Atlas intelligence (explain this Device)

The **Atlas intelligence** panel (`POST /api/intelligence/analyze`) answers explanation-only questions about the selected semantic context through Nipate Intelligence, not Calculator. Atlas sends the bounded context (at most 64 KiB of JSON; the question at most 4000 characters) to Intelligence's `POST /api/intelligence/exec/analyze` with a service key and returns the answer with citations that Intelligence has checked against the ids in that context. Atlas never writes canonical assertions from an answer.

### Connecting a key

Each person or team uses their own key; there is no shared key.

1. An Intelligence admin creates a **service client** with scope `agents:execute` in the Intelligence console (one per person or team, so a key can be revoked on its own) and gives the person the `isc_...` key.
2. In Atlas, open the **Atlas intelligence** panel, paste the key into **Intelligence key** (a password field), and choose **Connect**. *Show advanced* sets the Intelligence URL (HTTPS; HTTP only for localhost) and the workspace id (`[A-Za-z0-9._-]`, 1 to 64 characters).
3. Atlas first verifies the key with `GET /api/intelligence/exec/models` (no run budget spent) and stores it only if Intelligence accepts it. The panel then shows `Connected, key fingerprint xxxxxxxx` (the first 8 hex characters of the key's SHA-256, never any part of the key). **Disconnect** removes it.

The key is held by Atlas' local service, never by the renderer. It is encrypted with AES-256-GCM in `intelligence-connection.json` in the Atlas data directory (next to the database), using the per-installation owner-only key file `credentials.key` that Calculator's connection also uses (or `ATLAS_CREDENTIAL_KEY` when the host supplies one). Files are mode 0600 and a newly created data directory 0700. Connecting or disconnecting takes effect on the next request without a restart. Local routes (all behind the desktop launch capability): `GET`, `POST` (`{key, origin?, workspaceId?}`, at most 5 attempts per minute) and `DELETE` `/api/intelligence/connection`; responses carry `{configured, source: 'stored'|'environment'|null, origin, workspaceId, keyHint?}` and never the key.

**Never bake a shared key into a build, installer, repository or client-side configuration:** anything shipped to users can be extracted.

### Environment fallback

For headless and development use Atlas reads these in the server process. A stored connection wins over them; they apply when nothing is stored (and after Disconnect):

- `ATLAS_INTELLIGENCE_KEY`: an Intelligence service-client key (`isc_...`) with scope `agents:execute`. The panel says `Using ATLAS_INTELLIGENCE_KEY from the environment` when this is the source.
- `ATLAS_INTELLIGENCE_URL`: the Intelligence origin. Default `https://intelligence.nipate.africa`.
- `ATLAS_INTELLIGENCE_WORKSPACE`: the workspace id analysis runs and billing are attributed to. Default `atlas`.

Future work: sign in with Nipate Accounts and call Intelligence with the user's own token instead of a pasted key. That needs an Intelligence route that accepts user tokens.

The panel's health check calls `GET /api/intelligence/exec/models` with the key (no model run, no budget spent). A 401/403 means the key is wrong, revoked or lacks `agents:execute`; 422 `input_too_large` means the context exceeded 64 KiB. The model is whatever the Intelligence platform task agent `task-analyze` is configured to use; Atlas does not choose it. Calculator is still used for Agent Chat conversations (above) and its connection does not affect analysis.

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
