# Atlas Device Lifecycle and Recovery

## Intent

Atlas must be the operator-facing place to discover, select, authorize,
pair, update, repair, retire, and permanently delete FNGK Devices. An
operator must not need an SSH session or a copied shell command for a normal
device lifecycle. The immediate incident exposed four gaps: profile selection
was assumed instead of discovered, a copied CLI binary was treated as a
verified Device-agent update, remote commands relied on `PATH`, and a legacy
agent could fail terminal attach before Atlas could explain or repair it.

The device rail remains the fast context switcher. A new **Device lifecycle**
icon is placed immediately above its context list and opens the lifecycle
workbench. It does not replace the existing device icons.

## Goals and boundaries

- Atlas discovers safe profile metadata through FNGK, never reads its config
  files or credentials directly.
- If exactly one usable profile exists, Atlas selects it. If several exist,
  the operator chooses an explicit profile before a mutating action.
- A successful update means the target Device reconnects with the expected
  binary/version, selected profile, and healthy machine daemon; copying an
  archive alone is not success.
- Atlas can start a browser-mediated operator authorization and Device pairing
  flow, but never handles operator secrets or Device credentials as raw text.
- The lifecycle UI offers both **Retire** and **Permanently delete**, each with
  precise impact disclosure and separate confirmations.
- Existing old agents are recoverable through a control-plane bootstrap when
  their terminal protocol is unusable. If the installed agent predates that
  bootstrap capability, Atlas reports the one unavoidable out-of-band update
  step honestly; it must not report the Device as repaired.
- Every remote command resolves an executable from a discovered absolute path;
  no lifecycle operation depends on an interactive shell `PATH`.
- Notifications are dismissible, deduplicated, and bottom-right. Readiness is
  not a persistent toast.
- The change must preserve explicit approval for pairing, updating, routing,
  retiring, and deletion.

## Product model

Atlas introduces the following safe, credential-free status model:

```ts
type FngkProfileSummary = {
  name: string;
  current: boolean;
  mode: 'device' | 'operator' | 'unknown';
  paired: boolean;
  operatorAuthorized: boolean;
  daemon: 'running' | 'stopped' | 'unknown';
};

type DeviceReadiness = {
  deviceId?: string;
  state: 'ready' | 'needs-profile' | 'needs-login' | 'needs-pairing' |
         'needs-daemon' | 'needs-update' | 'legacy-recovery' | 'offline';
  activeAgentVersion?: string;
  expectedVersion?: string;
  executable?: string;
  profile?: FngkProfileSummary;
  terminal: 'usable' | 'unsupported' | 'frame-limit' | 'unavailable';
  diagnostics: Array<{ code: string; message: string }>;
};
```

`FngkProfileSummary` is emitted by FNGK commands/protocols. It contains no
token, pairing URL, config path, or secret. Atlas stores only the selected
profile name and bounded readiness evidence.

## Architecture

### 1. Safe profile discovery

Signal/FNGK adds a versioned `fngk.profiles.v1` command. Locally Atlas invokes
its configured FNGK binary. For an online Device, Atlas uses a Device control
request; the response is produced by the Device agent, not by reading remote
files from Atlas. The response includes profile summaries, absolute executable
candidates, daemon health, and agent version.

The context catalog continues to contain all Devices. The lifecycle service
chooses the only ready profile automatically. With zero or multiple candidates
it returns a readiness state and requires an operator selection. Selection is
per Device context, rather than assuming Atlas host profile `local` applies to
a remote Device.

### 2. Lifecycle control plane

Signal exposes authenticated operator actions for the selected Device:

- inspect lifecycle/readiness;
- prepare operator authorization or Device pairing;
- complete approved authorization/pairing;
- install an approved exact-head artifact and restart/converge the Device
  daemon;
- report the installed binary digest and post-restart heartbeat version;
- retire or permanently delete a Device, and list/release stale connections.

Commands travel through a versioned Device-control protocol with bounded
output/chunks. Terminal execution remains a useful implementation route only
when readiness says it is usable. It is never the only recovery mechanism.
The control protocol performs its own executable discovery and runs absolute
paths; Atlas does not inject `$HOME/.local/bin` into arbitrary shell commands.

For an update, the artifact service retains the existing checksum and
architecture validation. The Device downloads/receives the approved artifact,
preserves a rollback binary, installs the selected scope, and restarts the
matching daemon. Atlas then waits for a heartbeat from the intended Device
identity (or a newly paired identity) with the expected version/digest. A
timeout, stale heartbeat, old agent version, or daemon failure leaves status
as `needs-update` or `legacy-recovery`, never `ready`.

### 3. Authorization, pairing, and recovery

When a chosen profile lacks operator authorization, Atlas starts the remote
login operation and shows the returned authorization URL/code in its normal
browser flow. The operator approves it in Signal; Atlas polls only operation
state. When no paired Device profile exists, Atlas offers **Pair new Device**.
Pairing is explicit, displays the prospective Device name/scope, and returns a
new Device identity only after confirmation.

Legacy recovery uses the agent-control update action first. The known 32 KiB
frame-limit terminal failure is classified as `terminal: 'frame-limit'`; it is
not shown as a generic terminal timeout. If the target agent lacks the control
update protocol too, Atlas presents one limited recovery card explaining that
the Device cannot execute a remote update. It records no false success and
offers re-pairing after the user completes the necessary bootstrap outside
Atlas.

### 4. Retirement, deletion, and stale connections

The lifecycle panel presents two non-default destructive operations:

| Operation | Effect | Confirmation |
|---|---|---|
| Retire Device | Revoke Device access, stop its active routes/sessions, archive it from normal context selection, retain audit/history. | Device name + `RETIRE` |
| Permanently delete | Revoke access, release/removes eligible connections and Device-owned removable records, then delete the Device. Immutable audit records are retained only where policy requires them. | Device name + `DELETE` + impact count |

Before either action, Atlas asks Signal for a bounded impact summary: active
sessions, published routes, managed processes, adopted resources, and stale
connections. Stale connections have an independent release action; a user can
clean them without deleting a Device.

### 5. Atlas UI

- Add the Device lifecycle icon above `.rail-contexts` in `ActivityRail`.
- Make `.rail-contexts` consume remaining vertical space and scroll visibly or
  with an accessible scroll affordance; it must never clip lower Device icons.
- Add a `DeviceLifecyclePanel` with: profile selector, readiness timeline,
  update/recovery actions, pairing/login browser state, connections/routes,
  retire, and permanent deletion flows.
- Replace the persistent onboarding-ready presentation with a toast manager.
  Success toasts auto-dismiss, errors remain until dismissed, and the stack is
  fixed at bottom-right with an accessible dismissal button.

## APIs and protocols

Atlas adds narrow API endpoints behind the lifecycle service:

```text
GET  /api/device-lifecycle?contextId=...
POST /api/device-lifecycle/:contextId/profile       { profile }
POST /api/device-lifecycle/:contextId/login/begin   { profile }
POST /api/device-lifecycle/:contextId/pair/begin    { profile, name?, scope? }
POST /api/device-lifecycle/:contextId/update        { profile, scope, confirm:true }
POST /api/device-lifecycle/:contextId/recover       { profile, confirm:true }
GET  /api/device-lifecycle/:contextId/connections
POST /api/device-lifecycle/:contextId/retire        { confirm:true, phrase:'RETIRE' }
POST /api/device-lifecycle/:contextId/delete        { confirm:true, phrase:'DELETE' }
POST /api/device-lifecycle/connections/:id/release  { confirm:true }
```

Signal owns authorization, Device access checks, pairing, route/session
cleanup, and durable lifecycle audit records. Atlas owns user intent, bounded
presentation state, diagnostics, and UI orchestration. All mutating requests
are idempotent by operation ID and require current Device authorization.

## Failure handling and security

- Never expose credentials, pairing payloads, raw config contents, artifact
  bytes, or authorization tokens in Atlas storage, logs, or browser URLs.
- Require explicit confirmation before update, pair, re-pair, route release,
  retirement, and deletion.
- Reject a profile selection that is absent from the safe discovery response.
- Treat a terminal frame limit, missing binary, missing daemon, login absence,
  and offline Device as distinct actionable failures.
- Preserve a rollback binary during update; failure does not remove the
  existing Device or its routes.
- Do not automatically delete stale connections. Show their owner/age/impact
  and require explicit release.

## Verification

Tests must cover:

1. zero, one, and multiple usable profiles; only the one-profile case
   auto-selects;
2. a remote user-scope binary absent from `PATH`, proving lifecycle actions use
   its discovered absolute path;
3. a copied artifact with an unchanged old heartbeat, proving the handoff is
   not marked verified;
4. login-required, unpaired, daemon-stopped, frame-limit, and unsupported
   legacy-agent readiness states;
5. successful pairing of a new Device identity and re-selection in the device
   rail;
6. retire versus delete impact, confirmation, route/session cleanup, and audit
   retention;
7. all device icons reachable through the rail at a constrained viewport;
8. readiness success toast auto-dismissal, error toast dismissal, and
   bottom-right placement;
9. end-to-end disposable Device update/reconnect at expected version before
   Atlas enables publishing or terminal operations.

## Success criteria

An operator can manage normal Device setup and recovery through Atlas without
server shell commands. Atlas makes profile ambiguity explicit, refuses false
readiness, verifies the active agent after an update, offers safe lifecycle
destructive choices, and always exposes every Device in the rail. A legacy
agent that cannot be repaired remotely produces an honest, bounded bootstrap
instruction rather than misleading status or a hanging terminal.
