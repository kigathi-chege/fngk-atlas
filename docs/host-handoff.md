# Host handoff

Atlas must run in the same operating-system context as the installed FNGK CLI and its current user profile. A development container does not inherit the host executable, profile, process namespace, or loopback network merely because the project directory is mounted.

## Build the enhanced FNGK

From the Atlas repository, build the reviewed Signal worktree without installing anything:

```bash
npm run build:fngk-head
```

The host-compatible archive and checksums are written under `output/fngk-head`. Extract the archive matching the host architecture into a temporary directory, verify it, and preserve the current installation before replacing it:

The build also writes `output/fngk-head/manifest.json` with the exact Signal commit, creation time, archive sizes, and checksums. Atlas uses this manifest contract for remote handoff; rebuild whenever the Signal checkout changes.

```bash
mkdir -p /tmp/fngk-atlas-update
tar -xzf output/fngk-head/fngk_linux_amd64.tar.gz -C /tmp/fngk-atlas-update fngk
/tmp/fngk-atlas-update/fngk version
sudo cp "$(command -v fngk)" /usr/local/bin/fngk.atlas-backup
sudo install -m 0755 /tmp/fngk-atlas-update/fngk /usr/local/bin/fngk
fngk install
fngk status --json | jq '{protocolVersion, profile, devices, connections}'
```

Use `fngk_linux_arm64.tar.gz` on an ARM64 Linux host. `fngk install` converges the resident daemon onto the newly installed executable. If the profile is paired but has no operator login, run the normal `fngk login <signal-origin>` flow once; Atlas does not own or copy that credential.

Rollback is explicit:

```bash
sudo install -m 0755 /usr/local/bin/fngk.atlas-backup /usr/local/bin/fngk
fngk install
fngk status --verbose
```

## Run Atlas beside FNGK

Run these commands on the host, not inside the generic workspace container:

```bash
npm install
npm run build
npm run start:host
```

Open <http://127.0.0.1:4317>. The footer must say **FNGK connected**, and the context list must contain the authorized Devices. A fresh Atlas state selects the first online FNGK Device; selecting **Atlas process host** is an explicit switch to direct local access.

After updating Atlas source, stop and rerun `npm run start:host`; the already-running Node process does not reload server changes. Existing repository indexes remain selectable, but remap repositories once after this release to remove previously indexed build bundles and add test/data-flow evidence.

Container deployment is possible only when the FNGK executable, the correct user's profile, and a working network route to the profile's Signal origin are deliberately provided. Host-side launch is the canonical path because it naturally inherits all three.

For a remote Device that already has terminal connectivity, Atlas can perform this same verified backup/install/converge flow from **Device actions → FNGK**. See [HTTP port sharing and exact-head handoff](http-port-sharing.md). This is explicit and does not replace the manual rollback path above.
