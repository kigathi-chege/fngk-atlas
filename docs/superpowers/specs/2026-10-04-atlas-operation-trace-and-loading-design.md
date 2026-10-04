# Atlas operation trace, developer tools, and loading design

## Purpose

Atlas must make every user-visible operation understandable while it is running and diagnosable when it fails. A filesystem refresh must never appear frozen: the user must see the current stage, elapsed time, device and session being used, and a safe explanation of the result.

This design addresses the current failure mode where a filesystem operation could show only `Terminal command timed out` after thirty seconds, with neither an in-panel loader nor enough execution context to determine where the work stopped.

## Goals

- Show an active loader anywhere Atlas waits on an operation, including filesystem list/read/search, terminal connection/reconnection, device-session acquisition, mutations, and panel refreshes.
- Give each operation a stable correlation ID and a local timeline from browser action through server execution and terminal completion.
- Show the exact operation stage, elapsed time, route, device, FNGK profile, terminal/session identity, queue state, and outcome in Observability.
- Preserve diagnostic information locally without persisting or exposing secrets, credentials, unbounded command output, or arbitrary terminal history.
- Provide a deliberate desktop developer-tools entry point for browser Console and Network inspection.
- Preserve existing remote events and normal notification behavior; detailed execution tracing is local-first and opt-in.

## Non-goals

- Atlas will not persist raw terminal streams in operation history.
- Atlas will not expose FNGK-owned/internal terminal history in the user terminal navigator.
- Atlas will not enable unrestricted browser developer tools in production without an explicit user action.
- A loader is not proof that a remote device is making progress. It must state the stage and elapsed time rather than imply success.

## Operation model

Every client operation creates a correlation ID before its request is sent. The ID travels in an `x-atlas-operation-id` request header and is returned in response/error bodies where applicable. Server components append trace records under that same ID.

An operation has a terminal state (`success`, `warning`, `error`, `cancelled`) and these ordered stages when relevant:

1. `queued` — user action accepted by the panel.
2. `requesting` — browser request in flight.
3. `route-selection` — Atlas selected a file/terminal route.
4. `session-acquisition` — waiting for or creating the device session.
5. `terminal-ready` — shared terminal is ready for the operation.
6. `command-dispatched` — a bounded framed FNGK terminal command was sent.
7. `response-received` — output or command result frames arrived.
8. `parsing` — Atlas validates and parses the result.
9. terminal state.

Stages not reached are absent. Every record has an ISO timestamp and elapsed duration. Operation tracing uses a bounded local ring buffer with an explicit retention count; it does not silently delete a current or pinned operation.

## Safe diagnostic data

The standard Observability expansion displays:

- correlation ID, operation type, panel, context/device ID, selected FNGK profile;
- route ID/kind/effective identity/privilege;
- device-session ID, terminal ID and ownership/purpose;
- queue depth/position, cache status, timeout budget, elapsed time, and stage timeline;
- result/error code and sanitized message;
- number and kinds of terminal protocol frames observed.

The detailed local Developer Trace may additionally display a redacted command preview, deterministic command digest, byte counts, and bounded redacted stdout/stderr previews. It must redact secret-like assignments, authorization headers, tokens, passwords, cookies, and credentials before display or persistence. The trace explicitly labels output as redacted/truncated.

Normal notifications remain concise and never contain command text or terminal output.

## Filesystem behavior

The Filesystem panel owns one visible operation state per path. Its refresh button starts a new correlation ID and immediately shows an inline spinner and stage text in the panel header and target directory row. The root list shows a skeleton/loader while no prior content is available; when stale content exists, it stays visible with a non-blocking refresh indicator.

The event `filesystem.list` remains pending until the request reaches a terminal state. Its expanded Observability record is updated in place as stages arrive; it is never removed automatically. When a terminal command exceeds its timeout, the panel and event say which stage was last reached and identify the terminal/session, rather than merely saying that a timeout occurred.

User cancellation, supersession, and server/session recovery are separate cancellation causes. They must be represented explicitly.

## Shared loader system

Atlas provides reusable `OperationLoader` and `OperationStatus` components backed by the operation store. They support inline, panel-header, row, button, and empty-content variants. All asynchronous UI flows must use one of these variants instead of feature-specific plain text or a silent disabled control.

Required visual behavior:

- A rotating indicator appears within 150 ms of an operation becoming pending.
- The label names the action and current stage, for example `Listing / — command dispatched · 12.4 s`.
- Controls that initiated the work remain available as `Cancel` when cancellation is safe; otherwise they explain why cancellation is unavailable.
- After a configurable slow threshold, the loader gains a `Slow` state and an `Open trace` action.
- Loading states use accessible live-region announcements without repeating on every timer tick.

## Desktop developer tools

Atlas adds a Developer section accessible from the command palette and an explicit menu/action. It contains:

- **Open Web Inspector** — calls the Tauri WebView developer-tools API for the current window.
- **Copy diagnostics** — copies a redacted operation trace chosen from Observability.
- **Open server logs directory** — opens the local Atlas server log location when available.

The action is available in development builds. In packaged builds, it is present only after the user explicitly enables Developer Mode in local settings; Developer Mode is stored locally and shows a visible warning. Opening the inspector is always an explicit action.

## Error handling

FNGK protocol command errors are command outcomes, not terminal transport failures. They must be returned to the active operation by request ID. Only actual process/socket/terminal lifecycle failure triggers device-session recovery.

When a command timeout occurs, the server records the last known stage, dispatched command digest, terminal/session IDs, timeout budget, and observed frame counts before interrupting the request. This diagnostic record is attached to the operation correlation ID.

## Testing and verification

- Unit tests cover safe trace redaction, ordered stage progression, terminal protocol error handling, timeout trace capture, and cancellation causes.
- Component tests verify an inline loader appears for root filesystem load, refresh, expanded directory load, search, file read, and terminal reconnect.
- Server/API tests verify a correlation ID travels from request header to filesystem diagnostics and error responses.
- Tauri tests verify the Developer Mode gate; desktop manual verification confirms Console and Network are reachable only by explicit action.
- An integration fixture deliberately delays a terminal command. It must show `command-dispatched`, elapsed time, `Slow`, and a useful timeout trace rather than an unexplained frozen filesystem panel.

## Acceptance criteria

For a failed refresh of `/`, a human can open the corresponding Observability record and determine, without terminal access:

1. the selected device/profile/route;
2. whether a reusable device session was acquired;
3. the terminal/session used and its ownership;
4. which operation stage was last completed;
5. elapsed time, timeout budget, queue state, and frame counts;
6. the sanitized FNGK error or timeout details; and
7. how to open browser Console/Network tools or copy a redacted trace for support.

Every operation with a pending UI state presents a visible, accessible loader and no pending operation appears indistinguishable from a frozen panel.
