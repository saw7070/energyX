#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly TOOL_ID="energyiq-shared-storage-backup"
readonly TOOL_SCHEMA_VERSION="1"
readonly MANAGED_MARKER_CONTENT="${TOOL_ID}:v${TOOL_SCHEMA_VERSION}"

log() {
  printf '%s %s\n' "$(date --iso-8601=seconds)" "$*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  backup-shared-storage.sh create \
    --storage-root <absolute-directory> \
    --backup-root <absolute-directory-outside-app-root> \
    --app-root <absolute-directory> \
    --api-service <systemd-unit> \
    --node-bin <absolute-node-binary> \
    --db-preflight <absolute-mjs-file> \
    [--health-url <local-ready-url>] \
    [--keep-count <positive-integer>] \
    [--reserve-bytes <non-negative-integer>]

  backup-shared-storage.sh prune \
    --backup-root <absolute-directory> \
    --app-root <absolute-directory> \
    --keep-count <positive-integer>
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command is missing: $1"
}

require_absolute_path() {
  [[ "$2" == /* ]] || die "$1 must be an absolute path."
  [[ "$2" != *$'\n'* && "$2" != *$'\r'* ]] || die "$1 contains a newline."
}

canonical_managed_backup_root() {
  local candidate="$1"
  local require_existing="${2:-0}"
  require_absolute_path "backup-root" "$candidate"
  [[ "$(basename -- "$candidate")" == "managed-daily" ]] \
    || die "backup-root must end in the dedicated managed-daily directory."

  if [[ -e "$candidate" || -L "$candidate" ]]; then
    [[ -d "$candidate" && ! -L "$candidate" ]] || die "backup-root must be a real directory."
    realpath -e -- "$candidate"
    return 0
  fi

  (( require_existing == 0 )) || die "backup-root must already exist."
  local parent
  parent="$(dirname -- "$candidate")"
  [[ -d "$parent" && ! -L "$parent" ]] || die "backup-root parent must be a real directory."
  parent="$(realpath -e -- "$parent")"
  printf '%s/managed-daily\n' "$parent"
}

is_within_path() {
  local parent="$1"
  local candidate="$2"
  if [[ "$parent" == "/" ]]; then
    [[ "$candidate" == /* ]]
    return
  fi
  [[ "$candidate" == "$parent" || "$candidate" == "$parent/"* ]]
}

require_disjoint_paths() {
  local first="$1"
  local second="$2"
  local message="$3"
  if is_within_path "$first" "$second" || is_within_path "$second" "$first"; then
    die "$message"
  fi
}

wait_for_api_readiness() {
  local ready_url="$1"
  [[ -n "$ready_url" ]] || return 0
  local attempt
  for attempt in $(seq 1 30); do
    if curl --silent --show-error --fail --max-time 5 "$ready_url" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

safe_remove_partial() {
  local backup_root="$1"
  local candidate="$2"
  [[ -n "$candidate" && -d "$candidate" && ! -L "$candidate" ]] || return 0
  local resolved
  resolved="$(realpath -e -- "$candidate")"
  is_within_path "$backup_root" "$resolved" || die "Refusing to remove partial outside backup root: $resolved"
  [[ "$(basename -- "$resolved")" == .partial-backup-* ]] \
    || die "Refusing to remove a non-partial directory: $resolved"
  rm -rf --one-file-system -- "$resolved"
}

safe_remove_snapshot() {
  local partial_dir="$1"
  local candidate="$2"
  [[ -d "$partial_dir" && ! -L "$partial_dir" && -d "$candidate" && ! -L "$candidate" ]] \
    || die "Snapshot cleanup paths are invalid."
  local resolved_partial resolved_candidate
  resolved_partial="$(realpath -e -- "$partial_dir")"
  resolved_candidate="$(realpath -e -- "$candidate")"
  is_within_path "$resolved_partial" "$resolved_candidate" \
    || die "Refusing to remove snapshot outside its partial directory."
  [[ "$(basename -- "$resolved_candidate")" == "snapshot" ]] \
    || die "Refusing to remove a non-snapshot directory."
  rm -rf --one-file-system -- "$resolved_candidate"
}

prune_managed_backups() {
  local backup_root="$1"
  local keep_count="$2"
  [[ "$keep_count" =~ ^[1-9][0-9]*$ ]] || die "keep-count must be a positive integer."
  [[ -d "$backup_root" && ! -L "$backup_root" ]] || die "backup-root must be a real directory."
  backup_root="$(realpath -e -- "$backup_root")"

  local -a managed=()
  local candidate resolved marker metadata_tool
  while IFS= read -r -d '' candidate; do
    [[ ! -L "$candidate" ]] || continue
    resolved="$(realpath -e -- "$candidate")"
    is_within_path "$backup_root" "$resolved" || continue
    [[ "$(basename -- "$resolved")" == backup-* ]] || continue
    marker="$resolved/.energyiq-managed-backup"
    [[ -f "$marker" && ! -L "$marker" ]] || continue
    [[ "$(<"$marker")" == "$MANAGED_MARKER_CONTENT" ]] || continue
    [[ -f "$resolved/metadata.json" && ! -L "$resolved/metadata.json" ]] || continue
    metadata_tool="$(sed -n 's/^[[:space:]]*"tool"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$resolved/metadata.json" | head -n 1)"
    [[ "$metadata_tool" == "$TOOL_ID" ]] || continue
    managed+=("$resolved")
  done < <(find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name 'backup-*' -print0 | sort -z)

  local remove_count=$(( ${#managed[@]} - keep_count ))
  (( remove_count > 0 )) || return 0
  local index
  for (( index=0; index<remove_count; index++ )); do
    candidate="${managed[$index]}"
    resolved="$(realpath -e -- "$candidate")"
    is_within_path "$backup_root" "$resolved" || die "Retention target escaped backup root."
    [[ "$(basename -- "$resolved")" == backup-* ]] || die "Retention target has an invalid name."
    [[ "$(<"$resolved/.energyiq-managed-backup")" == "$MANAGED_MARKER_CONTENT" ]] \
      || die "Retention target lost its managed marker."
    log "Pruning tool-managed backup: $resolved"
    rm -rf --one-file-system -- "$resolved"
  done
}

json_escape() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  printf '%s' "$value"
}

write_inventory() {
  local snapshot_root="$1"
  local output="$2"
  {
    printf 'tool\t%s\n' "$TOOL_ID"
    printf 'scope\tcomplete Shared Storage snapshot\n'
    printf 'top_level_component\tbytes\tfiles\n'
    local component relative bytes files
    while IFS= read -r -d '' component; do
      relative="${component#"$snapshot_root/"}"
      bytes="$(du -sb -- "$component" | awk '{print $1}')"
      files="$(find "$component" -type f | wc -l | tr -d ' ')"
      printf '%s\t%s\t%s\n' "$relative" "$bytes" "$files"
    done < <(find "$snapshot_root/storage" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)
    printf 'database_file\tbytes\n'
    while IFS= read -r -d '' component; do
      relative="${component#"$snapshot_root/"}"
      printf '%s\t%s\n' "$relative" "$(stat -c %s -- "$component")"
    done < <(find "$snapshot_root/storage" -type f \
      \( -name '*.sqlite' -o -name '*.sqlite-wal' -o -name '*.sqlite-shm' \
         -o -name '*.duckdb' -o -name '*.duckdb.wal' \) -print0 | sort -z)
  } > "$output"
}

command_name="${1:-}"
[[ -n "$command_name" ]] || { usage; exit 2; }
shift

if [[ "$command_name" == "prune" ]]; then
  backup_root=""
  app_root=""
  keep_count=""
  while (( $# > 0 )); do
    case "$1" in
      --backup-root) backup_root="${2:-}"; shift 2 ;;
      --app-root) app_root="${2:-}"; shift 2 ;;
      --keep-count) keep_count="${2:-}"; shift 2 ;;
      *) die "Unknown prune argument: $1" ;;
    esac
  done
  require_absolute_path "backup-root" "$backup_root"
  require_absolute_path "app-root" "$app_root"
  [[ -d "$app_root" && ! -L "$app_root" ]] || die "app-root must be a real directory."
  app_root="$(realpath -e -- "$app_root")"
  backup_root="$(canonical_managed_backup_root "$backup_root" 1)"
  require_disjoint_paths "$app_root" "$backup_root" "backup-root and app-root must not overlap."
  prune_managed_backups "$backup_root" "$keep_count"
  exit 0
fi

[[ "$command_name" == "create" ]] || { usage; exit 2; }

storage_root=""
backup_root=""
app_root=""
api_service=""
node_bin=""
db_preflight=""
health_url=""
keep_count="7"
reserve_bytes="1073741824"

while (( $# > 0 )); do
  case "$1" in
    --storage-root) storage_root="${2:-}"; shift 2 ;;
    --backup-root) backup_root="${2:-}"; shift 2 ;;
    --app-root) app_root="${2:-}"; shift 2 ;;
    --api-service) api_service="${2:-}"; shift 2 ;;
    --node-bin) node_bin="${2:-}"; shift 2 ;;
    --db-preflight) db_preflight="${2:-}"; shift 2 ;;
    --health-url) health_url="${2:-}"; shift 2 ;;
    --keep-count) keep_count="${2:-}"; shift 2 ;;
    --reserve-bytes) reserve_bytes="${2:-}"; shift 2 ;;
    *) die "Unknown create argument: $1" ;;
  esac
done

(( EUID == 0 )) || die "create must run as root."
require_absolute_path "storage-root" "$storage_root"
require_absolute_path "backup-root" "$backup_root"
require_absolute_path "app-root" "$app_root"
require_absolute_path "node-bin" "$node_bin"
require_absolute_path "db-preflight" "$db_preflight"
[[ "$api_service" =~ ^[A-Za-z0-9_.@-]+\.service$ ]] || die "api-service is invalid."
[[ "$keep_count" =~ ^[1-9][0-9]*$ ]] || die "keep-count must be a positive integer."
[[ "$reserve_bytes" =~ ^[0-9]+$ ]] || die "reserve-bytes must be a non-negative integer."
[[ -z "$health_url" || "$health_url" == http://127.0.0.1:*/* || "$health_url" == http://localhost:*/* ]] \
  || die "health-url must be an explicit local HTTP URL."

for command in awk cp curl date df dirname du find flock head hostname mkdir mv readlink realpath rm sed \
  seq sha256sum sleep sort stat sync systemctl tar timedatectl wc; do
  require_command "$command"
done
[[ -x "$node_bin" && ! -L "$node_bin" ]] || die "node-bin must be an executable regular path."
[[ -f "$db_preflight" && ! -L "$db_preflight" ]] || die "db-preflight must be a regular file."
[[ -d "$storage_root" && ! -L "$storage_root" ]] || die "storage-root must be a real directory."
[[ -d "$app_root" && ! -L "$app_root" ]] || die "app-root must be a real directory."

storage_root="$(realpath -e -- "$storage_root")"
app_root="$(realpath -e -- "$app_root")"
backup_root="$(canonical_managed_backup_root "$backup_root")"
[[ "$storage_root" == "$app_root/shared/storage" ]] \
  || die "storage-root must be the app-root Shared Storage path."
require_disjoint_paths "$app_root" "$backup_root" "backup-root and app-root must not overlap."

partial_dir=""
service_recovery_required=0
cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  if (( service_recovery_required )); then
    log "Restoring API service after backup failure: $api_service"
    if ! systemctl restart "$api_service"; then
      log "CRITICAL: API service restart failed during recovery: $api_service" >&2
      status=1
    elif ! systemctl is-active --quiet "$api_service"; then
      log "CRITICAL: API service is not active after recovery: $api_service" >&2
      status=1
    elif ! wait_for_api_readiness "$health_url"; then
      log "CRITICAL: API service is active but not ready after recovery: $api_service" >&2
      status=1
    fi
  fi
  if (( status != 0 )); then
    safe_remove_partial "$backup_root" "$partial_dir"
  fi
  exit "$status"
}
handle_signal() {
  local status="$1"
  local signal_name="$2"
  trap - INT TERM HUP
  log "Received $signal_name; aborting backup." >&2
  exit "$status"
}
trap cleanup EXIT
trap 'handle_signal 130 INT' INT
trap 'handle_signal 143 TERM' TERM
trap 'handle_signal 129 HUP' HUP

mkdir -p -m 0700 -- "$backup_root"
chmod 0700 -- "$backup_root"

unexpected_source="$(find "$storage_root" -mindepth 1 ! -type f ! -type d -print -quit)"
[[ -z "$unexpected_source" ]] || die "Shared Storage contains an unsupported non-file entry: $unexpected_source"
unsafe_source_path=""
while IFS= read -r -d '' source_path; do
  if [[ "$source_path" == *$'\n'* || "$source_path" == *$'\r'* || "$source_path" == *\\* ]]; then
    unsafe_source_path="$source_path"
    break
  fi
done < <(find "$storage_root" -mindepth 1 -print0)
[[ -z "$unsafe_source_path" ]] \
  || die "Shared Storage has a path that cannot be represented safely in the manifest."

exec 9>/run/lock/energyiq-shared-storage-backup.lock
flock -n 9 || die "Another Shared Storage backup is already running."

source_bytes="$(du -sb -- "$storage_root" | awk '{print $1}')"
source_uid="$(stat -c %u -- "$storage_root")"
source_gid="$(stat -c %g -- "$storage_root")"
source_mode="$(stat -c %a -- "$storage_root")"
available_bytes="$(df -B1 --output=avail "$backup_root" | tail -n 1 | tr -d ' ')"
required_bytes=$(( source_bytes * 2 + reserve_bytes ))
(( available_bytes >= required_bytes )) \
  || die "Insufficient disk space: available=$available_bytes required=$required_bytes source=$source_bytes"

"$node_bin" "$db_preflight" --storage-root "$storage_root"
systemctl is-active --quiet "$api_service" || die "API service is not active: $api_service"

backup_id="$(date -u +%Y%m%dT%H%M%SZ)"
final_dir="$backup_root/backup-$backup_id"
partial_dir="$backup_root/.partial-backup-$backup_id-$$"
[[ ! -e "$final_dir" && ! -e "$partial_dir" ]] || die "Backup target already exists."
mkdir -m 0700 -- "$partial_dir"
printf '%s\n' "$MANAGED_MARKER_CONTENT" > "$partial_dir/.energyiq-managed-backup"

service_stopped_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "Stopping API for the consistency snapshot: $api_service"
service_recovery_required=1
systemctl stop "$api_service"
systemctl is-active --quiet "$api_service" && die "API service remained active after stop."

open_storage_fd=""
for proc_fd_dir in /proc/[0-9]*/fd; do
  [[ -d "$proc_fd_dir" ]] || continue
  for fd in "$proc_fd_dir"/*; do
    target="$(readlink -- "$fd" 2>/dev/null || true)"
    if is_within_path "$storage_root" "$target"; then
      open_storage_fd="$target"
      break 2
    fi
  done
done
[[ -z "$open_storage_fd" ]] || die "A process still holds Shared Storage open: $open_storage_fd"

snapshot_root="$partial_dir/snapshot"
mkdir -m 0700 -p -- "$snapshot_root"
cp -a --reflink=auto -- "$storage_root" "$snapshot_root/storage"
unexpected_snapshot="$(find "$snapshot_root/storage" -mindepth 1 ! -type f ! -type d -print -quit)"
[[ -z "$unexpected_snapshot" ]] || die "Snapshot contains an unsupported entry: $unexpected_snapshot"
snapshot_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log "Restarting API after the quiesced copy."
systemctl start "$api_service"
systemctl is-active --quiet "$api_service" || die "API service failed to restart."
wait_for_api_readiness "$health_url" || die "API readiness check failed after restart."
service_recovery_required=0
service_restarted_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

file_count="$(find "$snapshot_root/storage" -type f | wc -l | tr -d ' ')"
(
  cd "$snapshot_root"
  while IFS= read -r -d '' file; do
    sha256sum -- "$file"
  done < <(find storage -type f -print0 | sort -z)
) > "$partial_dir/manifest.sha256"
write_inventory "$snapshot_root" "$partial_dir/inventory.tsv"

log "Compressing the stable snapshot with zstd after service recovery."
tar --zstd --sort=name --mtime='@0' --numeric-owner \
  -cf "$partial_dir/storage.tar.zst" -C "$snapshot_root" storage
archive_sha256="$(sha256sum -- "$partial_dir/storage.tar.zst" | awk '{print $1}')"
printf '%s  storage.tar.zst\n' "$archive_sha256" > "$partial_dir/archive.sha256"
archive_bytes="$(stat -c %s -- "$partial_dir/storage.tar.zst")"

host_name="$(hostname -f 2>/dev/null || hostname)"
host_timezone="$(timedatectl show -p Timezone --value 2>/dev/null || printf 'unknown')"
release_sha="unknown"
if [[ -f "$app_root/current/RELEASE_SHA" ]]; then
  release_sha="$(<"$app_root/current/RELEASE_SHA")"
elif [[ -f "$app_root/current/.release-sha" ]]; then
  release_sha="$(<"$app_root/current/.release-sha")"
fi
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "$partial_dir/metadata.json" <<EOF
{
  "schemaVersion": $TOOL_SCHEMA_VERSION,
  "tool": "$TOOL_ID",
  "backupId": "$(json_escape "$backup_id")",
  "createdAt": "$(json_escape "$created_at")",
  "host": "$(json_escape "$host_name")",
  "hostTimezone": "$(json_escape "$host_timezone")",
  "releaseSha": "$(json_escape "$release_sha")",
  "storageRoot": "$(json_escape "$storage_root")",
  "consistencyStrategy": "quiesce-copy-compress",
  "quiescedService": "$(json_escape "$api_service")",
  "serviceStoppedAt": "$(json_escape "$service_stopped_at")",
  "snapshotCompletedAt": "$(json_escape "$snapshot_completed_at")",
  "serviceRestartedAt": "$(json_escape "$service_restarted_at")",
  "sourceBytes": $source_bytes,
  "sourceUid": $source_uid,
  "sourceGid": $source_gid,
  "sourceMode": "$(json_escape "$source_mode")",
  "fileCount": $file_count,
  "archive": "storage.tar.zst",
  "archiveBytes": $archive_bytes,
  "archiveSha256": "$archive_sha256",
  "manifest": "manifest.sha256"
}
EOF

safe_remove_snapshot "$partial_dir" "$snapshot_root"
sync -f "$partial_dir"
mv -- "$partial_dir" "$final_dir"
partial_dir=""
sync -f "$backup_root"
log "Backup completed atomically: $final_dir"

prune_managed_backups "$backup_root" "$keep_count"
trap - EXIT INT TERM HUP
printf '%s\n' "$final_dir"
