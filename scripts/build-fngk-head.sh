#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
atlas_root="$(cd -- "$script_dir/.." && pwd)"
signal_root="$(cd -- "${SIGNAL_SOURCE:-$atlas_root/../signal}" && pwd)"
output_dir="${FNGK_HEAD_OUTPUT:-$atlas_root/output/fngk-head}"
image="fngk-atlas-cli-head"
container=''
cleanup() {
  [[ -n "$container" ]] && docker rm "$container" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

command -v docker >/dev/null || { echo 'Docker is required to build the cross-platform FNGK artifacts.' >&2; exit 1; }
[[ -f "$signal_root/Dockerfile" ]] || { echo "Signal checkout not found at $signal_root" >&2; exit 1; }
mkdir -p "$output_dir"
build_log="$output_dir/build.log"
echo "Building FNGK from $signal_root"
docker build --progress=plain --target cli-build -t "$image" "$signal_root" >"$build_log" 2>&1
container="$(docker create "$image")"
docker cp "$container:/out/." "$output_dir"
(cd "$output_dir" && sha256sum fngk_*.tar.gz >SHA256SUMS)
SIGNAL_COMMIT="$(git -c safe.directory="$signal_root" -C "$signal_root" rev-parse HEAD)" OUTPUT_DIR="$output_dir" node -e '
const fs=require("node:fs"),path=require("node:path"),root=process.env.OUTPUT_DIR;
const sums=fs.readFileSync(path.join(root,"SHA256SUMS"),"utf8").trim().split(/\r?\n/).map(line=>{const [checksum,name]=line.trim().split(/\s+/);return{name,checksum,size:fs.statSync(path.join(root,name)).size}});
fs.writeFileSync(path.join(root,"manifest.json"),JSON.stringify({protocolVersion:"atlas.fngk-head.v1",commit:process.env.SIGNAL_COMMIT,createdAt:new Date().toISOString(),artifacts:sums},null,2)+"\n");'
echo "Exact-head artifacts: $output_dir"
echo "Build log: $build_log"
