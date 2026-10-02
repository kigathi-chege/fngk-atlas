# Terminals and sessions

## Purpose
Atlas opens retained FNGK terminal sessions on a capable Device. Terminal work runs on that Device, not on the Atlas host.

## Before you begin
Select an online Device with terminal capability. Atlas may ask for a local approval when an action requires confirmation.

## Normal workflow
Open Terminal, select an existing session or create one, then use the terminal normally. The session rail lets you reconnect, rename, terminate, archive, or restore sessions.

## What you will see
Live means Atlas has a current WebSocket connection. Detached means the remote session still exists but this panel is not attached. Exited means the remote process ended. Approval required means an authorized person must choose approve or deny.

## Minimize, close, and recovery
Minimize hides the panel in the terminal dock but keeps the xterm renderer and WebSocket alive. It does not stop the remote session. Closing a terminal panel detaches its local view; terminate explicitly stops the remote session. If a connection is interrupted, Atlas retries a bounded number of times and you can use Reconnect. Archive is reversible through Restore.

See also: [Workspace](atlas-doc:workspace), [Recovery](atlas-doc:recovery), and [Live Projects](atlas-doc:live-projects).
