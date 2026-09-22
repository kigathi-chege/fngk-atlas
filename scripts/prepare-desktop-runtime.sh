#!/usr/bin/env bash
set -euo pipefail

runtime_root="desktop/runtime"
artifact_root="${FNGK_ARTIFACT_DIR:-output/fngk-head}"
case "$(uname -s)" in Linux) platform=linux;; Darwin) platform=darwin;; *) echo "Unsupported desktop platform: $(uname -s)" >&2; exit 2;; esac
case "$(uname -m)" in x86_64|amd64) architecture=amd64;; arm64|aarch64) architecture=arm64;; *) echo "Unsupported desktop architecture: $(uname -m)" >&2; exit 2;; esac
archive="$artifact_root/fngk_${platform}_${architecture}.tar.gz"
checksums="$artifact_root/SHA256SUMS"
test -f "$archive" && test -f "$checksums" || { echo "Build exact-head FNGK artifacts first (npm run build:fngk-head)." >&2; exit 2; }
expected=$(awk -v file="$(basename "$archive")" '$2==file {print $1}' "$checksums")
actual=$(sha256sum "$archive" | awk '{print $1}')
test -n "$expected" && test "$expected" = "$actual" || { echo "FNGK artifact checksum verification failed." >&2; exit 1; }
rm -rf "$runtime_root"
mkdir -p "$runtime_root"
tar -xzf "$archive" -C "$runtime_root"
test -x "$runtime_root/fngk" || { echo "Verified FNGK archive did not contain an executable." >&2; exit 1; }
printf '%s\n' "$(sha256sum "$runtime_root/fngk" | awk '{print $1}')" >"$runtime_root/fngk.sha256"
node_binary=${ATLAS_NODE_BINARY:-$(command -v node)}
test -x "$node_binary" || { echo "A Node runtime is required to package Atlas." >&2; exit 1; }
cp "$node_binary" "$runtime_root/node"
cp -a dist "$runtime_root/dist"
cp -a web-dist "$runtime_root/web-dist"
cp -a node_modules "$runtime_root/node_modules"
