#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
atlas_root="$(cd -- "$script_dir/.." && pwd)"
fngk_bin="${FNGK_BIN:-$(command -v fngk || true)}"
if [[ -z "$fngk_bin" || ! -x "$fngk_bin" ]]; then
  echo 'FNGK is not installed in this host context. Build/install the exact-head CLI first.' >&2
  echo "See $atlas_root/docs/host-handoff.md" >&2
  exit 1
fi
if ! namespace="$($fngk_bin status --json 2>&1)"; then
  echo 'The installed FNGK cannot provide its authenticated namespace.' >&2
  echo "$namespace" >&2
  echo "See $atlas_root/docs/host-handoff.md for update and login steps." >&2
  exit 1
fi
if ! node -e "const v=JSON.parse(process.argv[1]);if(v.protocolVersion!=='fngk.namespace.v1')process.exit(1)" "$namespace"; then
  echo 'The installed FNGK does not support fngk.namespace.v1. Install the exact-head build first.' >&2
  exit 1
fi
[[ -f "$atlas_root/dist/server/index.js" && -d "$atlas_root/web-dist" ]] || { echo 'Atlas is not built. Run npm install && npm run build first.' >&2; exit 1; }
echo "Using FNGK: $fngk_bin"
echo "Atlas: http://127.0.0.1:${ATLAS_PORT:-4317}"
cd "$atlas_root"
exec env FNGK_BIN="$fngk_bin" ATLAS_HOST="${ATLAS_HOST:-127.0.0.1}" ATLAS_PORT="${ATLAS_PORT:-4317}" node dist/server/index.js
