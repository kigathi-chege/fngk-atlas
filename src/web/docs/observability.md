# Observability and logs

## Purpose
Device Atlas, logs, metrics, and activity provide a retained operational view of the selected FNGK context.

## Before you begin
Select the context whose current state you want to understand.

## Normal workflow
Start in Device Atlas, inspect attention items and workload relationships, then open logs or metrics for a targeted question.

## What you will see
Health and freshness describe observed state, not a guarantee that a Device will accept a new operation. Activity records every operation lifecycle: pending, success, warning, error, and cancellation. A cancelled browser request remains visible with its reason; a cancellation reported by FNGK is recorded as an error with its returned diagnostic message.

Operation history is not automatically pruned. Use the event pin, delete, and clear controls deliberately. Atlas retains events produced by compatible older or newer Atlas versions as well; an unrecognised producer state is shown as a warning with its reported state in the event details. Credentials, command text, and command output are redacted from the history.

## Recovery
Use logs and Device lifecycle together when an observed failure might be caused by connectivity, authorization, or runtime readiness.

See also: [Devices](atlas-doc:devices) and [Recovery](atlas-doc:recovery).
