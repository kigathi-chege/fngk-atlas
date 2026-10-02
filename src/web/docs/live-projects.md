# Live Projects

## Purpose
Live Project starts a confirmed project command in a dedicated Device terminal and can publish one selected HTTP port through FNGK.

## Before you begin
Choose an online Device with terminal support, a repository path, a command, and a port. The installed FNGK version must support port publishing.

## Normal workflow
Select the repository, confirm the command, start it, and publish the selected port. Atlas keeps execution, route, diagnostics, and code evidence associated with the same Device work.

## What you will see
Output is bounded and streamed to the panel. Diagnostics are opt-in. A published URL points through the FNGK route to the Device process.

## Recovery
Restart releases the old target before starting another process. Stop ends the dedicated terminal and unpublishes only that target.

See also: [Terminals](atlas-doc:terminals), [HTTP ports](atlas-doc:deployments), and [Observability](atlas-doc:observability).
