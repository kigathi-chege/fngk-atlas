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

Build the exact-head FNGK artifacts and then package Atlas:

```sh
npm run build:fngk-head
npm run desktop:build
```

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
