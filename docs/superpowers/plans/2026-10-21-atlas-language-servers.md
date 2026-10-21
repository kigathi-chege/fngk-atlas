# Atlas language servers (planned, postponed)

Status: approved direction, postponed until find/replace and git land
(2026-10-21). Find/replace and Source Control are tracked on their own branches.

## Goal

Diagnostics, hover, completion, go-to-definition, rename and signature help in
the Atlas editor, for local folders and remote Devices alike. Users can add
their own language servers; Atlas never installs them silently.

## Transport: a dedicated exec stream (approved)

Language servers speak JSON-RPC over stdio with `Content-Length` framing.
Running them inside a PTY corrupts the framing (echo, CRLF, ^C), and loopback
TCP only suits the few servers with a TCP mode. So Signal gains a new stream
kind:

- Agent message `exec_open {executable, args, cwd, env}` spawns the process
  with its own stdin/stdout pipes, carried by the existing `tcp_frame` /
  `tcp_close` machinery; stderr is a separate frame type. The process is killed
  when the stream closes.
- Server: stream kind `exec` in `signal/src/operator-access.ts`, authorised
  like PTY access and audited in `connection_stream_audits` as `kind='exec'`.
- CLI: `fngk exec <target> [--cwd DIR] -- cmd args`, with raw stdin/stdout
  like `fngk nc`.
- Security review required before release: it grants command execution
  equivalent to terminal access.

Atlas then uses one code path everywhere: locally it spawns
`typescript-language-server --stdio`; remotely
`fngk exec <device> -- typescript-language-server --stdio`.

Stopgap if the Signal release is blocked: TCP-capable servers only
(e.g. `gopls -listen=127.0.0.1:0`) via a managed process and
`fngk tcp --stdio-json`.

## Atlas server (`src/lsp/`)

- `LspProcessManager`: one server per (contextId, workspaceRoot, languageId),
  reference-counted, stopped after 5 minutes idle, restarted with backoff after
  a crash, killed when the Device Session lease is revoked.
- A `Content-Length` framing parser (fuzz-tested).
- WebSocket route `GET /api/lsp?contextId&root&language`, one per workspace,
  one JSON-RPC message per text frame. The server rewrites `initialize`
  (`rootUri`, `processId: null`).

## Adding language servers (owner requirement)

- Built-in catalogue probed with `command -v` on the target machine:
  typescript-language-server, pyright-langserver, gopls, rust-analyzer, clangd.
- Users add or override servers in Settings (language id, file globs, command,
  args, env, init options), per machine or per workspace via
  `.atlas/lsp.json`.
- Atlas shows a server's status and stderr log, and offers the install command
  for a missing server, which the user runs (no silent installs).

## Browser

- `@codemirror/lsp-client` with a custom transport over the WebSocket and a
  custom `Workspace` on the buffer store (verify its API first; fallback:
  `codemirror-languageserver`).
- Go-to-definition opens or reveals a FilePanel.
- `workspace/applyEdit` (rename) edits open buffers, including unsaved ones,
  and writes closed files through the find/replace apply endpoint with
  fingerprints, so versions rotate and the edit can be undone.
- `didSave` / `didChangeWatchedFiles` after Atlas writes and git operations.

## Tests and acceptance

- Go tests for `exec_open`: stdin EOF, kill on stream close, stderr separation.
- Fake stdio language server fixture for manager lifecycle tests.
- Playwright with the fake server: hover, completion, diagnostics, rename
  across two files.
- Live on a remote TypeScript project: diagnostics within 3s of typing,
  correct go-to-definition, undoable cross-file rename, and the remote process
  gone (`ps`) after the last tab closes.

## Risks

Language-server memory on small Devices; large workspaces; `@codemirror/lsp-client`
API details.
