# Databases

## Purpose
The database workbench uses a selected Device's adopted, capability-scoped database surface. Atlas does not create an unrestricted TCP relay or sidecar.

## Before you begin
The database resource must be visible and authorized in the current context.

## Normal workflow
Inspect schema and permitted data operations from the database panel. Treat exports, backups, and restores as explicit operational actions.

## What you will see
Availability and errors come from the Device capability surface and are retained in the operational audit.

## Recovery
If the database is unavailable, return to Device Atlas or logs to verify resource health and authorization.

See also: [Observability](atlas-doc:observability) and [Recovery](atlas-doc:recovery).
