# Deployments

## Purpose
Deployment workbench builds immutable Device releases, verifies health before publication, records history, and supports governed rollback.

## Before you begin
Confirm the selected Device, deployment target, required secrets, and health checks.

## Normal workflow
Create a release, inspect its retained events and artifacts, wait for health gates, then publish. Use rollback to select a known-good retained release.

## What you will see
The panel distinguishes planning, release execution, health, publication, and rollback rather than treating a deployment as one opaque command.

## Recovery
Do not retry a failed release blindly. Inspect retained events and logs, correct the cause, and create a new immutable release.

See also: [Observability](atlas-doc:observability) and [Recovery](atlas-doc:recovery).
