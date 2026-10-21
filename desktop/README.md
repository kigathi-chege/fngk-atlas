# Atlas desktop companion

Atlas Desktop packages the existing Atlas workbench with a loopback-only local
server, a Node runtime, and the matching FNGK CLI. It is not a remote web
wrapper: the webview talks only to its own randomly selected `127.0.0.1` port.

## What a packaged build includes

- the compiled Atlas server and web assets;
- the Node runtime used only by that server;
- a checksum-verified, platform-matched FNGK executable;
- a per-launch capability that gates Atlas API and WebSocket requests.

## FNGK on the user's machine

At every launch, a packaged Atlas makes sure there is a stable per-user FNGK and
points `FNGK_BIN` at it, before it starts its server or runs `fngk install`.
This matters because the daemon service records the path of the binary that
installed it, and an AppImage runs from a temporary mount that vanishes when
Atlas quits.

- **Where:** `~/.local/bin/fngk` when that directory is writable (Linux and macOS), otherwise `<app data>/bin/fngk`.
- **When:** the bundled FNGK, checksum-verified against `runtime/fngk.sha256`, is copied there when nothing is installed, or when the bundled version is newer. A newer or user-built FNGK that is already there is kept. A same-version binary is replaced only if Atlas put it there (`<app data>/fngk-install.json` records it). The previous binary is kept as `fngk.atlas-backup`.
- **Explicit install:** onboarding's install action is `POST /api/onboarding/install {scope:"user",confirm:true}`. It runs the same install, then converges the daemon only once the binary is in place and a paired profile is waiting for it.
- **FNGK updates:** these are signed (`https://downloads.signol.org/fngk/latest.json`, Ed25519, pinned key). About Atlas offers them; the routes are `GET`/`POST /api/fngk/signed-update`. An update is downloaded, then size, SHA-256 and signature are verified, then it is installed. If the new binary does not run, Atlas rolls it back, and it re-converges a running daemon. Atlas imports, copies or stores no profile or operator credential, and never installs system-wide.

## Atlas updates

The AppImage (and later macOS) checks `https://downloads.signol.org/atlas/latest.json`
at launch and every six hours. When a newer version exists, a native **Update
available** prompt offers **Restart and update**. The update is verified against
the minisign key pinned in `tauri.conf.json` before it is installed. A `.deb` is
updated by installing the new package. *Atlas: About and updates* in the command
palette shows the Atlas version, the bundled and installed FNGK versions, and
the update state.

## Deep links (`fngk-atlas://`)

Atlas registers the `fngk-atlas` scheme. The `.deb` and macOS bundles declare
it, and an AppImage registers it at runtime. Opening a `fngk-atlas://…` URL
works like this:

1. The URL reaches Atlas. If Atlas is already running, the single-instance plugin hands it to that process.
2. The host focuses the main window.
3. The host POSTs `{"url": …}` to `/api/desktop/deep-link` on the loopback server, with the launch capability. Only `fngk-atlas:` URLs up to 2048 characters are accepted. The server keeps the last 20.
4. The page polls `/api/desktop/deep-links?after=<seq>` and fires a window event for each new one:

   ```js
   window.addEventListener('atlas:deep-link', event => {
     const { url, seq, receivedAt } = event.detail;
   });
   ```

`fngk-atlas://auth/complete?…` is used purely as a "bring Atlas to front" signal
after browser sign-in. It carries no secrets, and Atlas does not treat it as an
authorization result.

## IPC and capabilities

The window loads `http://127.0.0.1:<port>`, so its only capability
(`capabilities/loopback.json`) is a remote one for that origin. It grants only
`opener:allow-open-url` for `https://*`, which the sign-in flow uses to open the
system browser. The app's own commands are declared in `build.rs`, so each one
would need an explicit `allow-*` permission, and none is granted to the page.
Everything else (deep links, updates, FNGK install) runs natively or through the
loopback server.

## Versions

The Atlas version comes from `ATLAS_VERSION`, otherwise from an exact `v*` git
tag, otherwise from `package.json` with `-dev` appended.
`scripts/desktop-config.mjs` writes it into `tauri.generated.conf.json`, which
`desktop:build` merges over `tauri.conf.json`. `Cargo.toml`'s version is not
used. The bundled FNGK version is recorded in `runtime/fngk.version`.

## Signing in and pairing this machine

First launch shows one step, **Sign in to Signal**. Atlas runs
`fngk login --pair --json --client "FNGK Atlas"` and the browser opens Signal's
consent page ("Add <hostname> to your devices as an operator and Device?"),
which shows the Device name, system, requesting app and a code to compare
with the one Atlas displays. While it waits, Atlas shows that code, a copyable
link, **Open browser again** and **Cancel**. After approval FNGK stores the
operator login and the Device pairing in the same profile, Atlas starts the
FNGK daemon (`fngk install`) and returns to the workbench. Steps that are
already done are skipped: an existing operator login is not asked for again,
and a paired Device only needs its daemon started. App connections shows who
is signed in and offers **Sign out** (`fngk logout --operator`, which keeps the
Device pairing).

- **Which Signal.** `https://signal.nipate.africa` by default
  (`src/onboarding/signal-url.ts`, matching the CLI's built-in default).
  `FNGK_SIGNAL_URL` overrides it for Atlas and the fngk it runs (devstack sets
  `http://signal.localhost`). Self-hosters use **Advanced: use a self-hosted
  Signal**; an existing profile keeps the Signal it was created with.
- **Opening the browser.** In the desktop app the Atlas server opens it with
  `xdg-open`/`open` (the loopback page cannot rely on Tauri IPC); the web build
  opens a tab. The link is always shown for copying.
- **Coming back.** The desktop app asks Signal to return through
  `fngk-atlas://auth/complete` (the deep-link scheme the desktop shell
  registers to focus the window); a loopback web build returns to its own
  `http://127.0.0.1:<port>/`. Signal accepts only those forms and ignores
  anything else; Atlas does not depend on the return, because FNGK learns the
  outcome by polling.
- **Older Signal.** A Signal without browser pairing still signs the user in;
  Atlas then asks for a dashboard pairing link (`fngk pair`) or lets the user
  skip. An FNGK older than `login --pair` is reported as needing an update.

## Building locally

The build machine needs Node, Rust/Cargo, and the Tauri platform libraries. On
Debian/Ubuntu Linux, install the documented Tauri build prerequisites once;
they are **build-machine dependencies**, not requirements for people who
install the resulting package.

For the Linux AppImage target, the host also needs `squashfs-tools` (it
provides `mksquashfs`, which turns Tauri's prepared AppDir into the final
`.AppImage`) and `libfuse2` (used by the AppImage builder). A complete
Debian/Ubuntu build-host setup is:

```sh
sudo apt update
sudo apt install -y build-essential curl file libssl-dev libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev squashfs-tools libfuse2
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
source "$HOME/.cargo/env"
rustup component add rustfmt
```

Development builds bundle an exact-head FNGK; releases bundle the tagged FNGK
pinned in `desktop/fngk-release.json`:

```sh
npm run build:fngk-head            # development: output/fngk-head
npm run desktop:build

npm run fetch:fngk-release         # release: output/fngk-release (checksums verified)
FNGK_ARTIFACT_DIR=output/fngk-release ATLAS_VERSION=0.2.0 npm run desktop:build
```

In devstack, `./dev run -- bash -lc 'cd <atlas> && …'` runs these in a fresh
toolbox container (Rust, the Tauri libraries and `xvfb-run` are in the image).
Headless smoke test of a built AppImage:

```sh
APPIMAGE_EXTRACT_AND_RUN=1 xvfb-run -a desktop/src-tauri/target/release/bundle/appimage/Atlas_*_amd64.AppImage
```

Testing the updater locally takes a build with dev keys. Then serve a
`latest.json` signed with the dev key, and run with
`ATLAS_UPDATER_ENDPOINT=http://127.0.0.1:<port>/latest.json`.
`ATLAS_UPDATER_VERIFY_ONLY=1` makes Atlas download and verify an update without
installing it. See `docs/release-and-signing.md` for the dev-key overrides.

To build only the portable Linux artifact, use:

```sh
npm run desktop:build -- --bundles appimage
```

In a container without `/dev/fuse`, prefix the command with
`APPIMAGE_EXTRACT_AND_RUN=1`. A normal desktop Linux build host should not
need that compatibility setting.

`desktop:build` first runs `scripts/prepare-desktop-runtime.sh`. The script
selects the current platform/architecture archive from `output/fngk-head`,
verifies it against `SHA256SUMS`, and stages only generated runtime files under
`desktop/runtime`. That directory and Cargo's `target` directory are ignored;
they may be safely removed after a local build to reclaim disk space.

For source development, point the shell at an existing compatible FNGK:

```sh
FNGK_BIN="$(command -v fngk)" ATLAS_NODE="$(command -v node)" npm run desktop:dev
```

## Release boundary

Local builds are unsigned for distribution, and the dev-key builds above must
never be published. Public releases come only from `.github/workflows/release-desktop.yml`.
It ships Linux now, with macOS and Windows gated by `ENABLE_MACOS` /
`ENABLE_WINDOWS`. See `docs/release-and-signing.md` for keys, secrets, macOS
notarization and the Linux verification story.
