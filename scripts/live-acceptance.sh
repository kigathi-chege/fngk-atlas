#!/usr/bin/env bash
set -euo pipefail
export COMPOSE_ANSI=never BUILDKIT_PROGRESS=plain

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
atlas_root="$(cd -- "$script_dir/.." && pwd)"
signal_root="$(cd -- "${SIGNAL_SOURCE:-$atlas_root/../signal-atlas-fngk}" && pwd)"
if (( EUID != 0 )); then
  echo "Live acceptance requires a disposable root Device so root-visible discovery can be proved." >&2
  exit 1
fi
for command_name in docker curl jq node npm git tar; do command -v "$command_name" >/dev/null || { echo "$command_name is required" >&2; exit 1; }; done

free_port() { node -e "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"; }
free_postgres_adapter_port() { node -e "const net=require('node:net');let port=5432;const probe=()=>{if(port>5440)process.exit(1);const candidate=port++,server=net.createServer();server.once('error',probe);server.listen(candidate,'127.0.0.1',()=>server.close(()=>console.log(candidate))) };probe()"; }
live_postgres_port="$(free_postgres_adapter_port)"; live_redis_port="$(free_port)"; signal_port="$(free_port)"; atlas_port="$(free_port)"
run_root="$(mktemp -d /tmp/fngk-atlas-live.XXXXXX)"
project="fngk-atlas-live-$(basename "$run_root" | tr '[:upper:].' '[:lower:]-')"
evidence_dir="${ATLAS_LIVE_EVIDENCE_DIR:-$atlas_root/output/live-acceptance/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$run_root/bin" "$run_root/fixture" "$evidence_dir"
signal_pid=''; daemon_pid=''; atlas_pid=''; fixture_pid=''
cli_image="${project}-cli"
cleanup() {
  local status=$?
  for pid in "$atlas_pid" "$fixture_pid" "$daemon_pid" "$signal_pid"; do if [[ "$pid" =~ ^[0-9]+$ ]]; then kill "$pid" 2>/dev/null || true; fi; done
  wait 2>/dev/null || true
  LIVE_BIND_HOST="${live_bind_host:-127.0.0.1}" LIVE_POSTGRES_PORT="$live_postgres_port" LIVE_REDIS_PORT="$live_redis_port" docker compose -p "$project" -f "$atlas_root/test/integration/compose.live.yaml" down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker image rm "$cli_image" >/dev/null 2>&1 || true
  if (( status != 0 )) && [[ "${ATLAS_LIVE_KEEP_FAILED:-0}" == 1 ]]; then echo "[live] retained failed workspace: $run_root" >&2; else rm -rf -- "$run_root"; fi
  return "$status"
}
trap cleanup EXIT INT TERM
wait_http() { local url="$1"; for _ in $(seq 1 120); do curl -fsS "$url" >/dev/null 2>&1 && return; sleep .5; done; echo "timed out waiting for $url" >&2; return 1; }
wait_tcp() { local host="$1" port="$2"; for _ in $(seq 1 120); do node -e "const s=require('node:net').connect(Number(process.argv[2]),process.argv[1]);s.once('connect',()=>{s.end();process.exit(0)});s.once('error',()=>process.exit(1))" "$host" "$port" >/dev/null 2>&1 && return; sleep .25; done; echo "timed out waiting for $host:$port" >&2; return 1; }
try_tcp() { node -e "const s=require('node:net').connect(Number(process.argv[2]),process.argv[1]);const t=setTimeout(()=>process.exit(1),500);s.once('connect',()=>{clearTimeout(t);s.end();process.exit(0)});s.once('error',()=>process.exit(1))" "$1" "$2" >/dev/null 2>&1; }

echo "[live] starting disposable PostgreSQL and Redis ($project)"
live_bind_host=0.0.0.0
LIVE_BIND_HOST="$live_bind_host" LIVE_POSTGRES_PORT="$live_postgres_port" LIVE_REDIS_PORT="$live_redis_port" docker compose -p "$project" -f "$atlas_root/test/integration/compose.live.yaml" up -d --wait >"$run_root/compose.log" 2>&1
service_host=127.0.0.1
if ! try_tcp "$service_host" "$live_postgres_port"; then
  service_host="$(node -e "const row=require('node:fs').readFileSync('/proc/net/route','utf8').split(/\n/).map(v=>v.trim().split(/\s+/)).find(v=>v[1]==='00000000');if(!row)process.exit(1);const h=row[2];console.log([6,4,2,0].map(i=>parseInt(h.slice(i,i+2),16)).join('.'))")"
fi
wait_tcp "$service_host" "$live_postgres_port"
wait_tcp "$service_host" "$live_redis_port"

echo "[live] building exact-head FNGK CLI"
docker build --progress=plain --target cli-build -t "$cli_image" "$signal_root" >"$run_root/cli-build.log" 2>&1
cli_container="$(docker create "$cli_image")"; docker cp "$cli_container:/out/." "$run_root/cli-release"; docker rm "$cli_container" >/dev/null
case "$(uname -m)" in x86_64) cli_arch=amd64;; aarch64|arm64) cli_arch=arm64;; *) echo "unsupported live architecture: $(uname -m)" >&2; exit 1;; esac
tar -xzf "$run_root/cli-release/fngk_linux_${cli_arch}.tar.gz" -C "$run_root/bin"
chmod 700 "$run_root/bin/fngk" "$run_root/bin"/signal-adapter-*

signal_database="postgres://postgres:signal-live-test@$service_host:$live_postgres_port/signal"
signal_origin="http://127.0.0.1:$signal_port"
signal_env=(env NODE_ENV=test DATABASE_URL="$signal_database" REDIS_URL="redis://$service_host:$live_redis_port" CONNECTION_BROKER=redis SESSION_SECRET=live-acceptance-session-secret-long-enough SURFACE_DATA_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= TERMINAL_RECORDING_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= PLATFORM_DOMAIN=127.0.0.1 TUNNEL_BASE_DOMAIN=lvh.me APP_ORIGIN="$signal_origin" AGENT_ORIGIN="$signal_origin" PORT="$signal_port" TERMINAL_ENABLED=true PERSISTENT_AGENT_ENABLED=true OPERATOR_TCP_ENABLED=true OPERATOR_TERMINAL_ENABLED=true NESTED_NAVIGATION_ENABLED=true PUBLIC_CONNECTION_WEBSOCKETS_ENABLED=true MANAGED_PROCESSES_ENABLED=true)
echo "[live] building, migrating, and starting Signal"
(cd "$signal_root" && env NODE_ENV=development SESSION_SECRET=build-only-session-secret-long-enough SURFACE_DATA_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= TERMINAL_RECORDING_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= npm run build >"$run_root/signal-build.log" 2>&1 && "${signal_env[@]}" npm run migrate >"$run_root/migrate.log" 2>&1)
(cd "$signal_root" && "${signal_env[@]}" node dist/server.js >"$run_root/signal.log" 2>&1) & signal_pid=$!
wait_http "$signal_origin/api/health"

email='atlas-live@example.test'; password='correct horse battery staple'; cookie_jar="$run_root/cookies.txt"
curl -fsS -c "$cookie_jar" -H 'content-type: application/json' -d "{\"email\":\"$email\",\"password\":\"$password\"}" "$signal_origin/api/auth/register" >/dev/null
docker compose -p "$project" -f "$atlas_root/test/integration/compose.live.yaml" exec -T postgres psql -U postgres -d signal -v ON_ERROR_STOP=1 -c "UPDATE users SET email_verified_at=now() WHERE email='$email'" >/dev/null
session_json="$(curl -fsS -b "$cookie_jar" "$signal_origin/api/workspace/session")"; team_id="$(jq -er '.teams[0].id' <<<"$session_json")"
pair_json="$(curl -fsS -b "$cookie_jar" -H 'content-type: application/json' -d '{"scope":"personal"}' "$signal_origin/api/teams/$team_id/device-pairing-codes")"
config_path="$run_root/fngk-config.json"; SIGNAL_CONFIG_PATH="$config_path" "$run_root/bin/fngk" pair "$(jq -er .pairingUrl <<<"$pair_json")" --profile live >"$run_root/pair.log"

SIGNAL_CONFIG_PATH="$config_path" "$run_root/bin/fngk" login "$signal_origin" --profile live >"$run_root/login.log" 2>&1 & login_pid=$!
user_code=''; for _ in $(seq 1 80); do user_code="$(sed -n 's/^Code: //p' "$run_root/login.log" | tail -1)"; [[ -n "$user_code" ]] && break; sleep .25; done
[[ -n "$user_code" ]] || { echo 'operator login did not emit a user code' >&2; exit 1; }
curl -fsS -b "$cookie_jar" -X POST "$signal_origin/api/operator/authorize/$user_code/approve" >/dev/null
wait "$login_pid"

echo "[live] starting paired root Device daemon"
PATH="$run_root/bin:$PATH" SIGNAL_CONFIG_PATH="$config_path" "$run_root/bin/fngk" daemon --profile live --scope user >"$run_root/daemon.log" 2>&1 & daemon_pid=$!
namespace_json=''; for _ in $(seq 1 120); do namespace_json="$(SIGNAL_CONFIG_PATH="$config_path" "$run_root/bin/fngk" status --json --profile live 2>/dev/null || true)"; jq -e '.devices[]?|select(.online==true)' <<<"$namespace_json" >/dev/null 2>&1 && break; sleep .5; done
device_id="$(jq -er '.devices[]|select(.online==true)|.id' <<<"$namespace_json" | head -1)"
project_id="$(docker compose -p "$project" -f "$atlas_root/test/integration/compose.live.yaml" exec -T postgres psql -U postgres -d signal -Atc "SELECT id FROM projects WHERE team_id='$team_id' ORDER BY created_at LIMIT 1")"
postgres_resource_id=''
for _ in $(seq 1 120); do
  postgres_resource_id="$(docker compose -p "$project" -f "$atlas_root/test/integration/compose.live.yaml" exec -T postgres psql -U postgres -d signal -Atc "SELECT id FROM resources WHERE device_id='$device_id' AND adapter_id='signal.postgres' AND attributes->>'port'='$live_postgres_port' LIMIT 1" 2>/dev/null || true)"
  [[ -n "$postgres_resource_id" ]] && break
  sleep .25
done
[[ -n "$postgres_resource_id" ]] || { echo "PostgreSQL adapter did not discover port $live_postgres_port" >&2; exit 1; }
curl -fsS -b "$cookie_jar" -H 'content-type: application/json' -d "{\"projectId\":\"$project_id\"}" "$signal_origin/api/resources/$postgres_resource_id/adopt" >/dev/null

cp -R "$atlas_root/test/integration/fixture-repo/." "$run_root/fixture/"
git -C "$run_root/fixture" init -q; git -C "$run_root/fixture" -c user.name='Atlas Live' -c user.email='atlas-live@example.test' add .; git -C "$run_root/fixture" -c user.name='Atlas Live' -c user.email='atlas-live@example.test' commit -qm fixture
echo "[live] building and starting Atlas"
(cd "$atlas_root" && npm run build >"$run_root/atlas-build.log" 2>&1)
FNGK_BIN="$run_root/bin/fngk" SIGNAL_CONFIG_PATH="$config_path" ATLAS_DB="$run_root/atlas.db" ATLAS_HOST=127.0.0.1 ATLAS_PORT="$atlas_port" node "$atlas_root/dist/server/index.js" >"$run_root/atlas.log" 2>&1 & atlas_pid=$!
wait_http "http://127.0.0.1:$atlas_port/api/health"

LIVE_ATLAS_URL="http://127.0.0.1:$atlas_port" LIVE_FIXTURE_ROOT="$run_root/fixture" LIVE_POSTGRES_PORT="$live_postgres_port" node --import tsx "$atlas_root/test/integration/live-acceptance.ts" >"$evidence_dir/acceptance.json"
SIGNAL_CONFIG_PATH="$config_path" "$run_root/bin/fngk" version >"$evidence_dir/fngk-version.txt"
git -c "safe.directory=$signal_root" -C "$signal_root" rev-parse HEAD >"$evidence_dir/signal-head.txt"
git -c "safe.directory=$atlas_root" -C "$atlas_root" rev-parse HEAD >"$evidence_dir/atlas-head.txt"
jq -n --arg signalOrigin "$signal_origin" --arg atlasOrigin "http://127.0.0.1:$atlas_port" --arg deviceId "$device_id" --arg project "$project" '{signalOrigin:$signalOrigin,atlasOrigin:$atlasOrigin,deviceId:$deviceId,composeProject:$project,credentialsCaptured:false}' >"$evidence_dir/manifest.json"
for secret in $(jq -r '..|objects|.credential? // empty' "$config_path"); do if grep -R -F "$secret" "$evidence_dir" >/dev/null; then echo 'secret appeared in evidence bundle' >&2; exit 1; fi; done
if find "$run_root/fixture" -maxdepth 2 -type f \( -name '*.b64' -o -name '*.tmp' \) | grep -q .; then echo 'helper artifacts remain in fixture' >&2; exit 1; fi
echo "[live] acceptance passed; sanitized evidence: $evidence_dir"
