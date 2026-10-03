# Devices and contexts

## Purpose
A context identifies the FNGK Device or working scope Atlas is currently reading and operating on.

## Before you begin
The Device must be paired and visible through the selected FNGK profile. Offline Devices remain visible but cannot accept live actions.

## Normal workflow
Select a context in the left rail, then open Device Atlas to inspect workloads, resources, relationships, and evidence. Open a specific tool only after confirming its Device supports the required capability.

## What you will see
Context indicators show availability. You can assign a local Atlas color to a Device; its rail icon and Device-scoped tabs use that color to make concurrent work easy to distinguish. Device Atlas summarizes current health and links to deeper details.

## Recovery
Use Device lifecycle when Atlas reports missing login, daemon, pairing, or authorization requirements. Disconnect releases only Atlas’s local route and does not unpair or delete the Device. Retire and permanent delete remain disabled until FNGK provides an audited control-plane capability; Atlas never attempts either through a shell command.

See also: [Recovery](atlas-doc:recovery), [Terminals](atlas-doc:terminals), and [Observability](atlas-doc:observability).
