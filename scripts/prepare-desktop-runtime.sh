#!/usr/bin/env bash
set -euo pipefail

# Stages desktop/runtime: the platform's verified FNGK, the Node runtime and the
# compiled Atlas server/web. FNGK_ARTIFACT_DIR picks the FNGK source:
#   output/fngk-head     development builds (npm run build:fngk-head, the default)
#   output/fngk-release  release builds (npm run fetch:fngk-release)
runtime_root="desktop/runtime"
artifact_root="${FNGK_ARTIFACT_DIR:-output/fngk-head}"
case "$(uname -s)" in Linux) platform=linux;; Darwin) platform=darwin;; MINGW*|MSYS*|CYGWIN*) platform=windows;; *) echo "Unsupported desktop platform: $(uname -s)" >&2; exit 2;; esac
case "$(uname -m)" in x86_64|amd64) architecture=amd64;; arm64|aarch64) architecture=arm64;; *) echo "Unsupported desktop architecture: $(uname -m)" >&2; exit 2;; esac
archive="$artifact_root/fngk_${platform}_${architecture}.tar.gz"
checksums="$artifact_root/SHA256SUMS"
test -f "$checksums" || checksums="$artifact_root/checksums.txt"
test -f "$archive" && test -f "$checksums" || { echo "Build exact-head FNGK artifacts (npm run build:fngk-head) or fetch a release (npm run fetch:fngk-release) first." >&2; exit 2; }
expected=$(awk -v file="$(basename "$archive")" '$2==file || $2=="*"file {print $1}' "$checksums")
actual=$(sha256sum "$archive" | awk '{print $1}')
test -n "$expected" && test "$expected" = "$actual" || { echo "FNGK artifact checksum verification failed." >&2; exit 1; }
version="${FNGK_BUNDLED_VERSION:-}"
if [[ -z "$version" && -f "$artifact_root/version.txt" ]]; then version="$(tr -d '[:space:]' <"$artifact_root/version.txt")"; fi
rm -rf "$runtime_root"
mkdir -p "$runtime_root"
tar -xzf "$archive" -C "$runtime_root"
test -x "$runtime_root/fngk" || { echo "Verified FNGK archive did not contain an executable." >&2; exit 1; }
if [[ -z "$version" ]]; then version="$("$runtime_root/fngk" version 2>/dev/null | awk '{print $NF}')" || true; fi
printf '%s\n' "$(sha256sum "$runtime_root/fngk" | awk '{print $1}')" >"$runtime_root/fngk.sha256"
printf '%s\n' "${version:-unknown}" >"$runtime_root/fngk.version"
# Development only: trust a dev FNGK manifest key instead of the pinned one.
if [[ -n "${FNGK_MANIFEST_DEV_PUBLIC_KEY_FILE:-}" ]]; then
  test "${ATLAS_RELEASE:-0}" != 1 || { echo "Refusing to stage a dev FNGK manifest key into a release build." >&2; exit 1; }
  cp "$FNGK_MANIFEST_DEV_PUBLIC_KEY_FILE" "$runtime_root/fngk-manifest-dev.pub"
  echo "WARNING: this build trusts the dev FNGK manifest key in $FNGK_MANIFEST_DEV_PUBLIC_KEY_FILE" >&2
fi
node_binary=${ATLAS_NODE_BINARY:-$(command -v node)}
test -x "$node_binary" || { echo "A Node runtime is required to package Atlas." >&2; exit 1; }
cp "$node_binary" "$runtime_root/node"
cp -a dist "$runtime_root/dist"
cp -a web-dist "$runtime_root/web-dist"
cp package.json package-lock.json "$runtime_root/"
(cd "$runtime_root" && npm ci --omit=dev --ignore-scripts)
rm "$runtime_root/package.json" "$runtime_root/package-lock.json"
echo "Desktop runtime staged with FNGK ${version:-unknown} ($platform/$architecture) from $artifact_root"
