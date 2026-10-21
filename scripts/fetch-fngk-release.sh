#!/usr/bin/env bash
# Fetches a tagged FNGK release for bundling into Atlas desktop and verifies it.
#
#   scripts/fetch-fngk-release.sh [VERSION]
#
# VERSION defaults to desktop/fngk-release.json. Files land in
# output/fngk-release (FNGK_RELEASE_OUTPUT), which prepare-desktop-runtime.sh
# reads with FNGK_ARTIFACT_DIR=output/fngk-release.
#
#   FNGK_RELEASE_SOURCE   github (default; needs `gh` and GH_TOKEN for a private repo)
#                         or downloads (https://downloads.signol.org/fngk/<version>/)
#   FNGK_DOWNLOADS_BASE   base URL for the downloads source
#   FNGK_VERIFY_ATTESTATION=1  also run `gh attestation verify` on every archive
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
atlas_root="$(cd -- "$script_dir/.." && pwd)"
pin="$atlas_root/desktop/fngk-release.json"
repository="${FNGK_RELEASE_REPOSITORY:-$(node -p "require('$pin').repository")}"
version="${1:-${FNGK_VERSION:-$(node -p "require('$pin').version")}}"
output="${FNGK_RELEASE_OUTPUT:-$atlas_root/output/fngk-release}"
source="${FNGK_RELEASE_SOURCE:-github}"
base="${FNGK_DOWNLOADS_BASE:-https://downloads.signol.org/fngk}"

[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || { echo "FNGK release version must look like v0.1.0 (got '$version')." >&2; exit 2; }
archives=(fngk_linux_amd64.tar.gz fngk_linux_arm64.tar.gz fngk_darwin_amd64.tar.gz fngk_darwin_arm64.tar.gz)

rm -rf "$output"
mkdir -p "$output"
case "$source" in
  github)
    command -v gh >/dev/null || { echo "gh is required for FNGK_RELEASE_SOURCE=github." >&2; exit 2; }
    patterns=()
    for file in "${archives[@]}" checksums.txt version.txt; do patterns+=(--pattern "$file"); done
    gh release download "$version" --repo "$repository" --dir "$output" "${patterns[@]}"
    ;;
  downloads)
    for file in "${archives[@]}" checksums.txt version.txt; do
      curl --proto '=https' --tlsv1.2 -fsSL "$base/$version/$file" -o "$output/$file"
    done
    ;;
  *) echo "Unknown FNGK_RELEASE_SOURCE '$source' (github or downloads)." >&2; exit 2 ;;
esac

test "$(tr -d '[:space:]' <"$output/version.txt")" = "$version" || { echo "version.txt does not match $version." >&2; exit 1; }
for file in "${archives[@]}"; do
  expected=$(awk -v file="$file" '$2==file || $2=="*"file {print $1}' "$output/checksums.txt")
  actual=$(sha256sum "$output/$file" | awk '{print $1}')
  test -n "$expected" && test "$expected" = "$actual" || { echo "Checksum verification failed for $file." >&2; exit 1; }
done
if [[ "${FNGK_VERIFY_ATTESTATION:-0}" == 1 ]]; then
  for file in "${archives[@]}"; do gh attestation verify "$output/$file" --repo "$repository" >/dev/null; done
  echo "Build-provenance attestations verified for ${#archives[@]} archives."
fi
(cd "$output" && sha256sum "${archives[@]}" >SHA256SUMS)
echo "FNGK $version from $repository ($source) verified in $output"
