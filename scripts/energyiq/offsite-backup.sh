#!/usr/bin/env bash
# Offsite, encrypted copy of the newest nightly Shared Storage backup.
#
#   offsite-backup.sh upload  [--config /etc/energyiq/offsite.env]
#   offsite-backup.sh restore --object <name>.tar.enc --to <empty-dir> [--config ...]
#   offsite-backup.sh status  [--config ...]
#
# upload: takes the newest completed backup made by backup-shared-storage.sh, checks its archive checksum, packs the
# backup folder into one file encrypted with AES-256 (key from BACKUP_ENCRYPTION_KEY_FILE, never printed), uploads
# it and its SHA-256 to Alibaba Cloud OSS with the aliyun CLI, confirms the stored size, and records the result in
# the state file. A backup already uploaded is not sent twice. The local backups are left untouched.
# restore: downloads one object, checks its SHA-256, decrypts it into an empty folder and checks the archive
# checksum inside, ready for the Shared Storage restore runbook.
#
# Config file (root-only, mode 600), shell syntax:
#   OFFSITE_BUCKET=energyiq-backups              # OSS bucket
#   OFFSITE_PREFIX=energyiq/production           # folder inside the bucket
#   OFFSITE_ENDPOINT=oss-ap-southeast-3.aliyuncs.com
#   OFFSITE_PROFILE=energyiq-offsite             # aliyun CLI profile; an ECS RAM role keeps keys off the disk
#   BACKUP_ENCRYPTION_KEY_FILE=/etc/energyiq/backup-encryption.key
#   BACKUP_ROOT=/var/backups/energyiq/managed-daily
#   OFFSITE_STATE_FILE=/var/lib/energyiq/offsite-backup.json
#   OFFSITE_WORK_DIR=/var/lib/energyiq/offsite-work
set -euo pipefail
umask 077

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

command_name="${1:-}"; shift || true
config="/etc/energyiq/offsite.env"
object=""; restore_to=""
while (( $# )); do
  case "$1" in
    --config) config="${2:-}"; shift 2 ;;
    --object) object="${2:-}"; shift 2 ;;
    --to) restore_to="${2:-}"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done
[[ "$command_name" =~ ^(upload|restore|status)$ ]] || die "Usage: offsite-backup.sh upload|restore|status [--config FILE]"
[[ -f "$config" ]] || die "Config file not found: $config"
# shellcheck disable=SC1090
source "$config"

: "${OFFSITE_BUCKET:?OFFSITE_BUCKET is required}"
: "${OFFSITE_ENDPOINT:?OFFSITE_ENDPOINT is required}"
OFFSITE_PREFIX="${OFFSITE_PREFIX:-energyiq/production}"
OFFSITE_PREFIX="${OFFSITE_PREFIX%/}"
BACKUP_ENCRYPTION_KEY_FILE="${BACKUP_ENCRYPTION_KEY_FILE:-/etc/energyiq/backup-encryption.key}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/energyiq/managed-daily}"
OFFSITE_STATE_FILE="${OFFSITE_STATE_FILE:-/var/lib/energyiq/offsite-backup.json}"
OFFSITE_WORK_DIR="${OFFSITE_WORK_DIR:-/var/lib/energyiq/offsite-work}"
ALIYUN_BIN="${ALIYUN_BIN:-aliyun}"

aliyun_oss() {
  local profile=()
  [[ -n "${OFFSITE_PROFILE:-}" ]] && profile=(--profile "$OFFSITE_PROFILE")
  "$ALIYUN_BIN" oss "$@" -e "$OFFSITE_ENDPOINT" ${profile[@]+"${profile[@]}"}
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum -- "$1" | awk '{print $1}'; else shasum -a 256 -- "$1" | awk '{print $1}'; fi
}

size_of() { wc -c < "$1" | tr -d ' '; }

require_key() {
  [[ -f "$BACKUP_ENCRYPTION_KEY_FILE" ]] || die "Encryption key not found: $BACKUP_ENCRYPTION_KEY_FILE"
  local mode
  mode="$(stat -c %a -- "$BACKUP_ENCRYPTION_KEY_FILE" 2>/dev/null || stat -f %Lp -- "$BACKUP_ENCRYPTION_KEY_FILE")"
  [[ "$mode" == "600" || "$mode" == "400" ]] || die "Encryption key must be readable by its owner only (mode 600), found $mode."
  (( $(size_of "$BACKUP_ENCRYPTION_KEY_FILE") >= 32 )) || die "Encryption key is too short; use at least 32 random bytes."
}

remote_uri() { printf 'oss://%s/%s/%s' "$OFFSITE_BUCKET" "$OFFSITE_PREFIX" "$1"; }

# Bytes stored for an object, read from `aliyun oss stat`.
remote_size() {
  aliyun_oss stat "$(remote_uri "$1")" 2>/dev/null | awk -F: 'tolower($1) ~ /content-length/ {gsub(/[^0-9]/, "", $2); print $2; exit}'
}

write_state() {
  local status="$1" detail="$2" backup="${3:-}" name="${4:-}" bytes="${5:-0}" sha="${6:-}"
  mkdir -p "$(dirname "$OFFSITE_STATE_FILE")"
  local previous="[]"
  [[ -f "$OFFSITE_STATE_FILE" ]] && previous="$(sed -n 's/^  "uploaded": \(\[.*\]\),\{0,1\}$/\1/p' "$OFFSITE_STATE_FILE" | head -1)"
  [[ -n "$previous" ]] || previous="[]"
  local uploaded="$previous"
  if [[ "$status" == "ok" && -n "$name" ]] && ! grep -q "\"$name\"" <<<"$previous"; then
    uploaded="$(printf '%s' "$previous" | sed -e 's/^\[//' -e 's/\]$//')"
    uploaded="[${uploaded:+$uploaded,}\"$name\"]"
  fi
  cat > "$OFFSITE_STATE_FILE.tmp" <<EOF
{
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "$status",
  "detail": "$(printf '%s' "$detail" | sed 's/["\\]/\\&/g')",
  "lastBackup": "$backup",
  "lastObject": "$name",
  "lastBytes": $bytes,
  "lastSha256": "$sha",
  "uploaded": $uploaded
}
EOF
  mv -f -- "$OFFSITE_STATE_FILE.tmp" "$OFFSITE_STATE_FILE"
}

if [[ "$command_name" == "status" ]]; then
  [[ -f "$OFFSITE_STATE_FILE" ]] && cat "$OFFSITE_STATE_FILE" || echo '{"status":"never-run"}'
  exit 0
fi

if [[ "$command_name" == "upload" ]]; then
  require_key
  latest="$(ls -1d "$BACKUP_ROOT"/backup-* 2>/dev/null | sort | tail -1 || true)"
  [[ -n "$latest" && -f "$latest/storage.tar.zst" && -f "$latest/archive.sha256" && -f "$latest/metadata.json" ]] \
    || { write_state failed "No completed backup found in $BACKUP_ROOT"; die "No completed backup found in $BACKUP_ROOT"; }
  backup_name="$(basename "$latest")"
  object_name="$backup_name.tar.enc"
  if [[ -f "$OFFSITE_STATE_FILE" ]] && grep -q "\"$object_name\"" "$OFFSITE_STATE_FILE" && [[ -n "$(remote_size "$object_name")" ]]; then
    log "Already offsite: $object_name"
    exit 0
  fi
  expected="$(awk '{print $1}' "$latest/archive.sha256")"
  actual="$(sha256_of "$latest/storage.tar.zst")"
  [[ "$expected" == "$actual" ]] || { write_state failed "Archive checksum mismatch in $backup_name" "$backup_name"; die "Archive checksum mismatch in $backup_name"; }

  mkdir -p "$OFFSITE_WORK_DIR"
  work="$(mktemp -d "$OFFSITE_WORK_DIR/upload.XXXXXX")"
  trap 'rm -rf -- "$work"' EXIT
  log "Encrypting $backup_name"
  tar -C "$BACKUP_ROOT" -cf - "$backup_name" \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$BACKUP_ENCRYPTION_KEY_FILE" -out "$work/$object_name"
  encrypted_sha="$(sha256_of "$work/$object_name")"
  encrypted_bytes="$(size_of "$work/$object_name")"
  printf '%s  %s\n' "$encrypted_sha" "$object_name" > "$work/$object_name.sha256"

  log "Uploading $object_name ($encrypted_bytes bytes) to $(remote_uri "")"
  if ! aliyun_oss cp "$work/$object_name" "$(remote_uri "$object_name")" -f >/dev/null \
    || ! aliyun_oss cp "$work/$object_name.sha256" "$(remote_uri "$object_name.sha256")" -f >/dev/null; then
    write_state failed "Upload to OSS failed" "$backup_name" "$object_name"
    die "Upload to OSS failed for $object_name"
  fi
  stored="$(remote_size "$object_name")"
  if [[ "$stored" != "$encrypted_bytes" ]]; then
    write_state failed "Stored size ${stored:-unknown} does not match $encrypted_bytes" "$backup_name" "$object_name"
    die "Stored size ${stored:-unknown} does not match $encrypted_bytes for $object_name"
  fi
  write_state ok "Encrypted copy stored offsite" "$backup_name" "$object_name" "$encrypted_bytes" "$encrypted_sha"
  log "Offsite copy verified: $object_name"
  exit 0
fi

# restore
[[ -n "$object" && -n "$restore_to" ]] || die "restore needs --object <name>.tar.enc and --to <empty-dir>"
[[ "$object" =~ ^backup-[0-9TZ]+\.tar\.enc$ ]] || die "Unexpected object name: $object"
require_key
mkdir -p "$restore_to"
[[ -z "$(ls -A "$restore_to")" ]] || die "Restore folder must be empty: $restore_to"
mkdir -p "$OFFSITE_WORK_DIR"
work="$(mktemp -d "$OFFSITE_WORK_DIR/restore.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
log "Downloading $object"
aliyun_oss cp "$(remote_uri "$object")" "$work/$object" -f >/dev/null || die "Download failed: $object"
aliyun_oss cp "$(remote_uri "$object.sha256")" "$work/$object.sha256" -f >/dev/null || die "Download failed: $object.sha256"
[[ "$(awk '{print $1}' "$work/$object.sha256")" == "$(sha256_of "$work/$object")" ]] || die "Downloaded copy does not match its checksum: $object"
log "Decrypting into $restore_to"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BACKUP_ENCRYPTION_KEY_FILE" -in "$work/$object" | tar -C "$restore_to" -xf -
restored="$restore_to/${object%.tar.enc}"
[[ "$(awk '{print $1}' "$restored/archive.sha256")" == "$(sha256_of "$restored/storage.tar.zst")" ]] || die "Restored archive does not match its checksum."
log "Restored and verified: $restored"
printf '%s\n' "$restored"
