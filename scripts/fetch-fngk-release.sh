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
#                         or downloads (https://downloads.signol.org/fngk/<version>/);
#                         downloads also verifies every archive against the signed
#                         latest.json with the manifest key Atlas pins at runtime
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
    curl --proto '=https' --tlsv1.2 -fsSL "$base/latest.json" -o "$output/latest.json"
    # Same payload and key as src/onboarding/{artifacts,manifest-trust}.ts.
    node - "$output" "$version" "$atlas_root/src/onboarding/manifest-trust.ts" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [output,version,trust]=process.argv.slice(2);
const keys=(process.env.ATLAS_FNGK_MANIFEST_PUBLIC_KEY?.split(';').map(x=>x.trim()).filter(Boolean)??[...fs.readFileSync(trust,'utf8').matchAll(/"(-----BEGIN PUBLIC KEY-----\\n[^"]+-----END PUBLIC KEY-----)"/g)].map(m=>m[1].replace(/\\n/g,'\n'))).map(pem=>crypto.createPublicKey(pem));
if(!keys.length)throw new Error('No FNGK manifest public key found.');
const manifest=JSON.parse(fs.readFileSync(path.join(output,'latest.json'),'utf8'));
if(manifest.version!==version)throw new Error(`downloads latest.json is ${manifest.version}, not the pinned ${version}; pin the latest FNGK release.`);
const sums=new Map(fs.readFileSync(path.join(output,'checksums.txt'),'utf8').trim().split('\n').map(line=>{const [sum,name]=line.trim().split(/\s+/);return [name.replace(/^[*.\/]+/,''),sum]}));
for(const a of manifest.artifacts){
  const name=path.basename(new URL(a.url).pathname),payload=Buffer.from(JSON.stringify({protocolVersion:manifest.protocolVersion,version:manifest.version,platform:a.platform,architecture:a.architecture,url:a.url,sha256:a.sha256,bytes:a.bytes}));
  if(!keys.some(key=>crypto.verify(null,payload,key,Buffer.from(a.signature,'base64'))))throw new Error(`Bad manifest signature for ${name}.`);
  if(sums.get(name)!==a.sha256)throw new Error(`${name} in checksums.txt does not match the signed manifest.`);
}
console.log(`Signed manifest verified for ${manifest.artifacts.length} archives.`);
NODE
    rm "$output/latest.json"
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
