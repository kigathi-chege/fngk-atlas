#!/usr/bin/env bash
# Publishes a release to downloads.signol.org over SSH (the same VPS and SSH
# credentials as the Signal deploy; nothing is uploaded by any other path).
#
#   publish-downloads.sh PRODUCT VERSION VERSIONED_DIR MANIFEST [TOP_LEVEL_FILE...]
#
# Remote layout under $DOWNLOADS_PATH (repository variable):
#   PRODUCT/VERSION/...         every file in VERSIONED_DIR (swapped in atomically)
#   PRODUCT/<top-level files>   e.g. install.sh, checksums.txt, version.txt
#   PRODUCT/latest.json         MANIFEST, uploaded last via a temp name + mv
#
# Required: SSH_HOST SSH_PORT SSH_USER SSH_PRIVATE_KEY DOWNLOADS_PATH.
# Optional: SSH_KNOWN_HOSTS (pinned host key); without it a single Ed25519
# host-key scan is used, as in deploy.yml.
set -euo pipefail

product="${1:?usage: publish-downloads.sh PRODUCT VERSION VERSIONED_DIR MANIFEST [FILE...]}"
version="${2:?version is required}"
versioned_dir="${3:?versioned directory is required}"
manifest="${4:?manifest is required}"
shift 4

missing=()
for name in SSH_HOST SSH_PORT SSH_USER SSH_PRIVATE_KEY DOWNLOADS_PATH; do
  [[ -n "${!name:-}" ]] || missing+=("$name")
done
if ((${#missing[@]})); then
  echo "::error::Cannot publish to downloads.signol.org: missing ${missing[*]}. Set the SSH_* repository secrets and the DOWNLOADS_PATH repository variable." >&2
  exit 1
fi
[[ "$product" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "Invalid product '$product'." >&2; exit 1; }
[[ "$version" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || { echo "Invalid version '$version'." >&2; exit 1; }
[[ "$DOWNLOADS_PATH" == /* ]] || { echo "DOWNLOADS_PATH must be absolute." >&2; exit 1; }
test -d "$versioned_dir" && test -s "$manifest" || { echo "Nothing to publish: $versioned_dir or $manifest is missing." >&2; exit 1; }
for file in "$@"; do test -f "$file" || { echo "Missing top-level file $file." >&2; exit 1; }; done

ssh_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/downloads-ssh.XXXXXX")"
trap 'remote_close; rm -rf "$ssh_dir"' EXIT
remote_close() { ssh -o ControlPath="$ssh_dir/cm-%C" -O exit -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" 2>/dev/null || true; }
printf '%s\n' "$SSH_PRIVATE_KEY" >"$ssh_dir/id_ed25519"
chmod 600 "$ssh_dir/id_ed25519"
if [[ -n "${SSH_KNOWN_HOSTS:-}" ]]; then
  printf '%s\n' "$SSH_KNOWN_HOSTS" >"$ssh_dir/known_hosts"
else
  echo "::warning::SSH_KNOWN_HOSTS is not configured; falling back to a single Ed25519 host-key scan"
  ssh-keyscan -T 10 -t ed25519 -p "$SSH_PORT" "$SSH_HOST" >"$ssh_dir/known_hosts"
fi
test -s "$ssh_dir/known_hosts" || { echo "SSH known_hosts data is empty" >&2; exit 1; }
# One multiplexed connection for every step: the VPS firewall rate-limits new
# SSH connections (the 6th within 30s is refused).
remote() {
  ssh -i "$ssh_dir/id_ed25519" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$ssh_dir/known_hosts" -o ControlMaster=auto -o ControlPath="$ssh_dir/cm-%C" \
    -o ControlPersist=120 -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" "$1"
}

root="$DOWNLOADS_PATH/$product"
stamp="${GITHUB_RUN_ID:-local}-$$"
q() { printf '%q' "$1"; }

# 0. A published version is immutable: clients and the CDN cache its files, so
# replacing them with different bytes breaks checksum verification. Re-publishing
# identical files is fine; set ALLOW_VERSION_REPLACE=1 only to repair a broken one.
if [[ -f "$versioned_dir/checksums.txt" && "${ALLOW_VERSION_REPLACE:-}" != 1 ]]; then
  existing="$(remote "cat $(q "$root/$version/checksums.txt") 2>/dev/null || true")"
  if [[ -n "$existing" && "$existing" != "$(cat "$versioned_dir/checksums.txt")" ]]; then
    echo "::error::$product $version is already published with different files. Cut a new version instead." >&2
    exit 1
  fi
fi

# 1. Versioned files: upload into a staging directory, then swap it in.
tar -C "$versioned_dir" -cf - . | remote "set -e; mkdir -p $(q "$root/.staging-$stamp"); tar -xf - -C $(q "$root/.staging-$stamp"); \
  if [ -d $(q "$root/$version") ]; then rm -rf $(q "$root/.previous-$version"); mv $(q "$root/$version") $(q "$root/.previous-$version"); fi; \
  mv $(q "$root/.staging-$stamp") $(q "$root/$version"); rm -rf $(q "$root/.previous-$version")"
echo "Uploaded $versioned_dir -> $root/$version"

# 2. Top-level files, each replaced atomically.
for file in "$@"; do
  name="$(basename "$file")"
  remote "cat > $(q "$root/.$name.$stamp") && mv -f $(q "$root/.$name.$stamp") $(q "$root/$name")" <"$file"
  echo "Uploaded $name -> $root/$name"
done

# 3. The manifest last, so clients never see a version whose files are not there yet.
remote "cat > $(q "$root/.latest.json.$stamp") && mv -f $(q "$root/.latest.json.$stamp") $(q "$root/latest.json")" <"$manifest"
echo "Published $root/latest.json ($product $version)"
