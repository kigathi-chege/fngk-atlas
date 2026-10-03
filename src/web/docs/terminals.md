# Terminals and sessions

## Purpose
Atlas opens interactive FNGK terminal sessions on a capable Device. Terminal work runs on that Device, not on the Atlas host.

## Before you begin
Select an online Device with terminal capability. Atlas may ask for a local approval when an action requires confirmation.

## Normal workflow
Open Terminal to create an interactive session, then use it normally. Atlas lists and manages only interactive terminals it created. Persistent FNGK connections used for filesystem, discovery, deployments, and other internal work are never shown as terminal history; Device Sessions shows only their safe connection telemetry.

## What you will see
Live means Atlas has a current WebSocket connection. Detached means the remote session still exists but this panel is not attached. Exited means the remote process ended. Approval required means an authorized person must choose approve or deny.

## Minimize, close, and recovery
Minimize hides the panel in the terminal dock but keeps the xterm renderer and WebSocket alive. It does not stop the remote session. Closing a terminal panel detaches its local view. If a connection is interrupted, Atlas retries a bounded number of times and you can use Reconnect.

See also: [Workspace](atlas-doc:workspace), [Recovery](atlas-doc:recovery), and [Live Projects](atlas-doc:live-projects).
