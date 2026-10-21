# Atlas desktop and FNGK releases: keys, secrets and signing

This is the owner's runbook for shipping Atlas desktop and FNGK from
`https://downloads.signol.org`. Linux ships first. macOS and Windows are written
into the workflows but skipped until they are enabled.

## What gets published where

| Path on downloads.signol.org | Written by | Contents |
|---|---|---|
| `atlas/<version>/` | fngk-atlas `release-desktop.yml` | `Atlas_<v>_amd64.AppImage`, `Atlas_<v>_aarch64.AppImage`, their `.sig` files, `.deb` packages, (later) `.dmg` and `.app.tar.gz`, `SHA256SUMS`, `latest.json` |
| `atlas/latest.json` | same, **uploaded last** | Tauri updater manifest (`platforms`: `linux-x86_64`, `linux-aarch64`, `darwin-aarch64`, `darwin-x86_64`) |
| `fngk/<version>/` | signal `release-cli.yml` | `fngk_*`/`signal_*` archives, `checksums.txt`, `version.txt`, `install.sh` |
| `fngk/install.sh`, `fngk/checksums.txt`, `fngk/version.txt` | same | the current release's installer and metadata |
| `fngk/latest.json` | same, **uploaded last** | the signed FNGK manifest that Atlas verifies |

On the server these live under the `DOWNLOADS_PATH` repository variable
(`/srv/nipate/apps/downloads`), next to the mobile app's
`downloads/latest.{apk,json}`. Every upload goes to a temporary name first and
is moved into place, and `latest.json` is always written after the files it
points to. Both workflows use the same script, `scripts/publish-downloads.sh`.

Every Atlas and FNGK file is also attached to its GitHub Release, and each one
has a build-provenance attestation (`actions/attest-build-provenance`).

## Repository secrets and variables

### kigathi-chege/fngk-atlas

| Name | Kind | Status | Used for |
|---|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | secret | **set** | Signs the updater bundles (`.AppImage.sig`, `.app.tar.gz.sig`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret | **set** | Password for that key |
| `SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_PRIVATE_KEY` | secrets | **to add** (same values as in NIPATEAFRICA/signal) | Upload to downloads.signol.org. The publish job fails, naming the missing ones, if any is unset |
| `SSH_KNOWN_HOSTS` | secret | optional, recommended | Pinned host key. Without it the job does one Ed25519 `ssh-keyscan`, like Signal's deploy |
| `DOWNLOADS_PATH` | variable | **set** (`/srv/nipate/apps/downloads`) | Web root of downloads.signol.org |
| `FNGK_RELEASE_TOKEN` | secret | optional | A read-only token for NIPATEAFRICA/signal, used to download and verify the bundled FNGK release if `GITHUB_TOKEN` cannot read that repository |
| `ENABLE_MACOS` | variable | unset | `true` turns on the macOS jobs |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` | secrets | later | Developer ID Application certificate (base64 `.p12`), its password, and the identity name |
| `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8` | secrets | later | App Store Connect API key ID, issuer ID, and the `.p8` contents. The workflow writes the contents to a file and sets `APPLE_API_KEY_PATH` |
| `ENABLE_WINDOWS` | variable | unset | `true` turns on the Windows job, which is only a skeleton for now |

The `production` environment gates both publish jobs. Add required reviewers to
it if you want a manual approval before anything reaches downloads.signol.org.

### NIPATEAFRICA/signal

| Name | Kind | Status | Used for |
|---|---|---|---|
| `FNGK_MANIFEST_SIGNING_KEY` | secret | **set** | Ed25519 PKCS#8 PEM that signs `fngk/latest.json` |
| `SIGNAL_EXTENSION_SIGNING_KEY`, `SIGNAL_EXTENSION_REGISTRY_SIGNING_KEY` | secrets | set | Extension registry (unchanged) |
| `SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS` | secrets | set | Reused from `deploy.yml`, same host |
| `DOWNLOADS_PATH` | variable | **set** | as above |

## Keys

### 1. Atlas updater key (minisign, Tauri)

- **What it is.** It signs each Atlas updater bundle. Atlas verifies the signature before installing an update, against the public key pinned in `desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`, key ID `E2643428051530BC`).
- **Where it lives.** The private key and its password are the GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in fngk-atlas. Offline copies are on the owner's machine in `~/.local/share/fngk-release-keys/` (`atlas-updater.key`, `atlas-updater.pub`, `atlas-updater.password`).
- **How it was generated.** `npx tauri signer generate -w ~/.local/share/fngk-release-keys/atlas-updater.key` (prompts for the password). The `.pub` file's base64 content is what goes in `pubkey`.
- **Rotation.** Tauri pins exactly one updater key, so a rotation takes two releases:
  1. Generate the new key pair into `~/.local/share/fngk-release-keys/` under a new name.
  2. Release N, signed with the **old** key, ships the **new** `pubkey`. Existing installs accept N because it is signed with the key they already trust.
  3. Switch the two GitHub secrets to the new key. Release N+1 onward is signed with the new key.
  4. Once nobody is likely to still be on a version before N, archive the old key. An install that skipped N has to reinstall manually.
- **If it leaks.** Revoke it the same way, straight away. Until N ships, anyone holding the key can sign updates that Atlas will accept, so also rotate the SSH deploy key, which is the second barrier.

### 2. FNGK manifest key (Ed25519)

- **What it is.** It signs each artifact entry in `fngk/latest.json`. Atlas verifies these before it downloads, installs and rolls back FNGK. The public key is pinned in `src/onboarding/manifest-trust.ts` (`PINNED_FNGK_MANIFEST_KEYS`):
  ```
  -----BEGIN PUBLIC KEY-----
  MCowBQYDK2VwAyEANXYSaWqiLayYy9a6cMlCnxkjQ3vmno2QnI6rM732P0w=
  -----END PUBLIC KEY-----
  ```
- **The signed payload**, per artifact, is the exact JSON `{"protocolVersion":"atlas.desktop-bootstrap.v1","version","platform","architecture","url","sha256","bytes"}`. Signal's `cli/cmd/fngk-manifest` writes it, and Atlas's `manifestSigningPayload` reproduces it byte for byte.
- **Where it lives.** It is the `FNGK_MANIFEST_SIGNING_KEY` secret in NIPATEAFRICA/signal, in PKCS#8 PEM, the same format as `SIGNAL_EXTENSION_SIGNING_KEY`, parsed by `signingkey.ParsePrivateKey`. The offline copy is `~/.local/share/fngk-release-keys/fngk-manifest.key` / `.pub`.
- **How it was generated.** `openssl genpkey -algorithm ed25519 -out fngk-manifest.key && openssl pkey -in fngk-manifest.key -pubout -out fngk-manifest.pub`.
- **Rotation.** Atlas accepts any key in the pinned list, so a rotation needs no gap:
  1. Generate the new pair next to the old one.
  2. Add the new public key to `PINNED_FNGK_MANIFEST_KEYS`, keeping the old one, and ship an Atlas release.
  3. Once that release is widespread, replace `FNGK_MANIFEST_SIGNING_KEY` with the new private key and cut an FNGK release.
  4. Remove the old public key in a later Atlas release.
- **If it leaks.** Do the same steps, but replace the old key rather than adding to it. An Atlas without the new key then refuses FNGK updates (it fails closed) until it is updated through the Atlas updater, which uses a separate key.

### 3. SSH deploy key

This is the existing Signal deploy key (`SSH_PRIVATE_KEY`), shared by both
repositories. Keep it limited to the deploy user. Rotate it on the server's
`authorized_keys` and in both repositories at the same time. Pinning
`SSH_KNOWN_HOSTS` in both repositories is recommended, so that neither workflow
relies on trust-on-first-use.

### Development keys (never for releases)

Dev-only keys live in the untracked sandbox `fngk/.devlocal/keys/`:
`atlas-updater-dev.key` / `.key.pub` / `.password` and `fngk-manifest-dev.pem` / `.pub`.
A local build opts into them explicitly:

- `ATLAS_UPDATER_PUBKEY="$(cat .devlocal/keys/atlas-updater-dev.key.pub)"` replaces the pinned updater key in that build's generated config. `ATLAS_UPDATER_ALLOW_INSECURE=1` allows an `http://` endpoint. At runtime, `ATLAS_UPDATER_ENDPOINT` points the updater at a local `latest.json`.
- `FNGK_MANIFEST_DEV_PUBLIC_KEY_FILE=.devlocal/keys/fngk-manifest-dev.pub` stages the dev FNGK key into the packaged runtime. A packaged Atlas trusts only that staged file or the pinned key, and ignores the user's environment. A web or dev server reads `ATLAS_FNGK_MANIFEST_PUBLIC_KEY` instead (`;`-separated).

Release CI sets `ATLAS_RELEASE=1`, which makes `desktop-config.mjs` and
`prepare-desktop-runtime.sh` refuse every one of these overrides. The workflow
also checks that no dev key was staged.

## Linux

Users verify a download in two ways:

- **Checksums.** Compare against `SHA256SUMS` in `atlas/<version>/`: `sha256sum -c SHA256SUMS --ignore-missing`.
- **Provenance.** Check the build attestation: `gh attestation verify Atlas_<v>_amd64.AppImage --repo kigathi-chege/fngk-atlas`.

The AppImage updates itself through the Tauri updater, which checks the minisign
signature. A `.deb` install is not self-updated: Atlas reports
`only the AppImage updates itself on Linux`, and users install the new `.deb`.

**Optional GPG.** If a detached `SHA256SUMS.asc` is wanted for distributions,
create a dedicated signing subkey, store it as a secret (for example
`RELEASE_GPG_KEY`), add a `gpg --detach-sign --armor SHA256SUMS` step to the
`release` job, and publish the public key at
`https://downloads.signol.org/atlas/KEYS`. This is not wired up today.

## macOS (when ENABLE_MACOS=true)

1. Join the Apple Developer Program as the organisation, then create a **Developer ID Application** certificate in Certificates, Identifiers & Profiles. Generate the CSR from Keychain Access.
2. Export the certificate together with its private key as a `.p12` with a strong password.
   - `base64 -i cert.p12 | pbcopy` goes in `APPLE_CERTIFICATE`.
   - The password goes in `APPLE_CERTIFICATE_PASSWORD`.
   - The identity goes in `APPLE_SIGNING_IDENTITY`, for example `Developer ID Application: Nipate Africa (TEAMID)`. `security find-identity -v -p codesigning` lists it.
3. In App Store Connect, under Users and Access → Integrations → App Store Connect API, create a key with the Developer role.
   - The key ID goes in `APPLE_API_KEY`.
   - The issuer ID goes in `APPLE_API_ISSUER`.
   - The downloaded `AuthKey_<id>.p8` contents go in `APPLE_API_KEY_P8`.
4. Set the repository variable `ENABLE_MACOS=true`.

The macOS jobs build `app,dmg` on `macos-14` (arm64) and `macos-15-intel` (x64;
GitHub has retired `macos-13`). The Tauri CLI imports the certificate into a
temporary keychain, signs it with the hardened runtime, notarizes it and
staples the ticket. The updater bundle is renamed to `Atlas_<v>_<arch>.app.tar.gz`
and added to `latest.json` as `darwin-aarch64` / `darwin-x86_64`.

## Windows (later)

The `windows` job is only a skeleton, and it fails if it is enabled. To ship Windows:

1. Build FNGK for `windows/amd64` in Signal's release, then extend `fetch-fngk-release.sh`, `prepare-desktop-runtime.sh` (it already recognises Windows hosts) and `fngk_provision.rs` (`fngk.exe`).
2. Choose a signing route:
   - **Azure Trusted Signing**, recommended for cost and no hardware token. Create a Trusted Signing account and certificate profile, then use `azure/trusted-signing-action` with secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and the account and profile names.
   - An **OV/EV code-signing certificate**. EV certificates need a hardware token or a cloud HSM, so in practice that means a cloud signing service (DigiCert KeyLocker, SSL.com eSigner), with its credentials as secrets.
3. Bundle `nsis` and/or `msi`, sign them, and add `windows-x86_64` to `latest.json`.

## Cutting a release

1. **FNGK.** Tag NIPATEAFRICA/signal `vX.Y.Z`. `release-cli.yml` builds, attests, attaches the files to the GitHub Release, and publishes `fngk/`.
2. **Pin it.** Set `desktop/fngk-release.json` in fngk-atlas to that tag.
3. **Atlas.** Tag fngk-atlas `vA.B.C`. `release-desktop.yml` fetches the pinned FNGK release, checks its checksums and attestations, builds and signs the Linux bundles (and macOS, if enabled), writes `SHA256SUMS` and the attestations, assembles `latest.json`, attaches everything to the Release, and publishes `atlas/`.
4. **Repair.** A `workflow_dispatch` run with the same tag rebuilds a release. Set `publish` to also re-upload.
