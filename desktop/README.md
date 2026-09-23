# Atlas desktop companion

Atlas Desktop packages the existing Atlas workbench with a loopback-only local
server, a Node runtime, and the matching FNGK CLI. It is not a remote web
wrapper: the webview talks only to its own randomly selected `127.0.0.1` port.

## What a packaged build includes

- the compiled Atlas server and web assets;
- the Node runtime used only by that server;
- a checksum-verified, platform-matched FNGK executable;
- a per-launch capability that gates Atlas API and WebSocket requests.

At first launch, the bundled FNGK checks and uses the current user's FNGK
profile. Atlas never imports, copies, or stores that profile or its operator
credential. A user may explicitly install the bundled FNGK under Atlas's
application-data `bin` directory for command-line use; it preserves the prior
binary as an `.atlas-backup`. Atlas never silently performs a system-wide
installation or elevation.

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

Build the exact-head FNGK artifacts and then package Atlas:

```sh
npm run build:fngk-head
npm run desktop:build
```

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

The local Linux build produces an unsigned AppImage/deb for testing. A public
Linux or macOS release must be built in release CI with its platform signing
identity and, on macOS, notarization configured. Do not present an unsigned
local artifact as a public release. FNGK and Atlas updates are independent:
updating Atlas never replaces a user-installed FNGK without the user's explicit
action.
