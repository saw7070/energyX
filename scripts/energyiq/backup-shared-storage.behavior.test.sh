#!/usr/bin/env bash
set -Eeuo pipefail

scenario="${1:?scenario is required}"
backup_script="${2:?backup script is required}"
preflight_script="${3:?preflight script is required}"
service_unit="${4:?service unit is required}"
fixture_bin="$(dirname -- "$backup_script")/test-fixtures/bin"
verify_script="$(dirname -- "$backup_script")/verify-shared-storage-backup.mjs"
module_root="$(realpath -e -- "$(dirname -- "$backup_script")/test-fixtures/duckdb-module")"

fixture="$(mktemp -d /tmp/energyiq-backup-behavior.XXXXXX)"
test_unit=""
lock_pid=""
lock_release=""
cleanup() {
  [[ "$fixture" == /tmp/energyiq-backup-behavior.* ]] || return 1
  if [[ -n "$test_unit" ]]; then
    sudo -n systemctl stop "$test_unit" >/dev/null 2>&1 || true
    sudo -n rm -f -- "/run/systemd/system/$test_unit"
    sudo -n systemctl daemon-reload
    sudo -n systemctl reset-failed "$test_unit" >/dev/null 2>&1 || true
  fi
  if [[ -n "$lock_pid" ]]; then
    [[ -n "$lock_release" ]] && sudo -n touch "$lock_release"
    wait "$lock_pid" >/dev/null 2>&1 || true
  fi
  sudo -n rm -rf --one-file-system -- "$fixture"
}
trap cleanup EXIT

create_idle_storage() {
  local storage_root="$1"
  local node_bin="$2"
  sudo -n install -d -m 0755 "$storage_root/metadata" "$storage_root/files"
  sudo -n touch "$storage_root/files/asset.bin"
  sudo -n env METADATA_PATH="$storage_root/metadata/workbench.sqlite" "$node_bin" \
    --input-type=module -e '
      import { DatabaseSync } from "node:sqlite";
      const database = new DatabaseSync(process.env.METADATA_PATH);
      database.exec(`
        CREATE TABLE energyiq_source_sync_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL);
        CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT NOT NULL);
        CREATE TABLE users (id TEXT PRIMARY KEY);
        CREATE TABLE workspaces (id TEXT PRIMARY KEY);
        CREATE TABLE energyiq_projects (id TEXT PRIMARY KEY);
        CREATE TABLE energyiq_data_snapshots (id TEXT PRIMARY KEY);
        CREATE TABLE file_assets (id TEXT PRIMARY KEY);
        CREATE TABLE artifacts (id TEXT PRIMARY KEY);
        CREATE TABLE energyiq_overview_ai_artifacts (id TEXT PRIMARY KEY);
      `);
      database.close();
    '
}

tree_fingerprint() {
  local root="$1"
  {
    sudo -n find "$root" -printf 'entry\t%P\t%y\t%m\t%U\t%G\n'
    sudo -n find "$root" -type f -exec sha256sum -- {} +
  } | sort
}

create_valid_backup() {
  local scenario_root="$1"
  local energy_store="${2:-}"
  local app_root="$scenario_root/app"
  local storage_root="$app_root/shared/storage"
  local backup_root="$scenario_root/backups/managed-daily"
  local state_dir="$scenario_root/state"
  local node_bin
  node_bin="$(realpath -e -- "$(command -v node)")"
  sudo -n install -d -m 0755 "$app_root" "$(dirname -- "$backup_root")" "$state_dir"
  create_idle_storage "$storage_root" "$node_bin"
  if [[ -n "$energy_store" ]]; then
    sudo -n install -d -m 0775 "$storage_root/energy/$energy_store"
    printf 'duckdb-test-fixture\n' | sudo -n tee "$storage_root/energy/$energy_store/energy.duckdb" >/dev/null
  fi
  sudo -n chown -R "$(id -u):$(id -g)" "$storage_root"
  sudo -n chmod 0755 "$fixture_bin/systemctl" "$fixture_bin/curl" "$fixture_bin/sleep"
  printf 'active\n' | sudo -n tee "$state_dir/api-state" >/dev/null
  printf '0\n' | sudo -n tee "$state_dir/start-count" >/dev/null
  sudo -n env \
    PATH="$fixture_bin:/usr/bin:/bin" \
    ENERGYIQ_BACKUP_TEST_STATE_DIR="$state_dir" \
    bash "$backup_script" create \
    --storage-root "$storage_root" \
    --backup-root "$backup_root" \
    --app-root "$app_root" \
    --api-service energyiq-backup-fixture.service \
    --node-bin "$node_bin" \
    --db-preflight "$preflight_script" \
    --health-url http://127.0.0.1:8787/ready \
    --reserve-bytes 0 | tail -n 1
}

case "$scenario" in
  reject-broad-create-root)
    app_root="$fixture/app"
    storage_root="$app_root/shared/storage"
    broad_root="$fixture/broad-root"
    sudo -n install -d -m 0755 "$storage_root" "$broad_root"
    node_bin="$(realpath -e -- "$(command -v node)")"
    before_mode="$(stat -c %a -- "$broad_root")"

    set +e
    output="$(sudo -n bash "$backup_script" create \
      --storage-root "$storage_root" \
      --backup-root "$broad_root" \
      --app-root "$app_root" \
      --api-service energyiq-backup-fixture.service \
      --node-bin "$node_bin" \
      --db-preflight "$preflight_script" 2>&1)"
    status=$?
    set -e

    after_mode="$(stat -c %a -- "$broad_root")"
    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf 'unsafe backup root unexpectedly succeeded\n' >&2; exit 1; }
    [[ "$before_mode" == "755" && "$after_mode" == "755" ]] \
      || { printf 'broad root permissions changed: before=%s after=%s\n' "$before_mode" "$after_mode" >&2; exit 1; }
    ;;
  reject-create-app-inside-backup-root)
    backup_root="$fixture/managed-daily"
    app_root="$backup_root/app"
    storage_root="$app_root/shared/storage"
    sentinel="$backup_root/do-not-touch"
    node_bin="$(realpath -e -- "$(command -v node)")"
    sudo -n install -d -m 0755 "$storage_root"
    printf 'preserve-me\n' | sudo -n tee "$sentinel" >/dev/null
    before_mode="$(stat -c %a -- "$backup_root")"
    before_tree="$(tree_fingerprint "$backup_root")"

    set +e
    output="$(sudo -n bash "$backup_script" create \
      --storage-root "$storage_root" \
      --backup-root "$backup_root" \
      --app-root "$app_root" \
      --api-service energyiq-backup-fixture.service \
      --node-bin "$node_bin" \
      --db-preflight "$preflight_script" 2>&1)"
    status=$?
    set -e

    after_mode="$(stat -c %a -- "$backup_root")"
    after_tree="$(tree_fingerprint "$backup_root")"
    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf 'app root inside backup root unexpectedly succeeded\n' >&2; exit 1; }
    [[ "$before_mode" == "755" && "$after_mode" == "755" ]] \
      || { printf 'overlapping backup root permissions changed: before=%s after=%s\n' "$before_mode" "$after_mode" >&2; exit 1; }
    [[ "$before_tree" == "$after_tree" ]] \
      || { printf 'overlapping backup root tree changed\n' >&2; exit 1; }
    ;;
  reject-broad-prune-root)
    broad_root="$fixture/broad-root"
    app_root="$fixture/app"
    sentinel="$broad_root/do-not-delete"
    sudo -n install -d -m 0755 "$broad_root" "$app_root"
    sudo -n touch "$sentinel"

    set +e
    output="$(sudo -n bash "$backup_script" prune \
      --backup-root "$broad_root" \
      --app-root "$app_root" \
      --keep-count 1 2>&1)"
    status=$?
    set -e

    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf 'unsafe prune root unexpectedly succeeded\n' >&2; exit 1; }
    [[ -f "$sentinel" ]] || { printf 'prune touched the broad root contents\n' >&2; exit 1; }
    ;;
  reject-prune-inside-app-root)
    app_root="$fixture/app"
    backup_root="$app_root/managed-daily"
    sudo -n install -d -m 0700 "$backup_root"
    for backup_id in 20260101T000000Z 20260102T000000Z; do
      candidate="$backup_root/backup-$backup_id"
      sudo -n install -d -m 0700 "$candidate"
      printf 'energyiq-shared-storage-backup:v1\n' | sudo -n tee "$candidate/.energyiq-managed-backup" >/dev/null
      printf '{\n  "tool": "energyiq-shared-storage-backup"\n}\n' \
        | sudo -n tee "$candidate/metadata.json" >/dev/null
    done

    set +e
    output="$(sudo -n bash "$backup_script" prune \
      --backup-root "$backup_root" \
      --app-root "$app_root" \
      --keep-count 1 2>&1)"
    status=$?
    set -e

    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf 'prune inside app root unexpectedly succeeded\n' >&2; exit 1; }
    sudo -n test -d "$backup_root/backup-20260101T000000Z"
    sudo -n test -d "$backup_root/backup-20260102T000000Z"
    ;;
  reject-prune-app-inside-backup-root)
    backup_root="$fixture/managed-daily"
    app_root="$backup_root/app"
    sentinel="$backup_root/do-not-touch"
    sudo -n install -d -m 0755 "$app_root"
    printf 'preserve-me\n' | sudo -n tee "$sentinel" >/dev/null
    for backup_id in 20260101T000000Z 20260102T000000Z; do
      candidate="$backup_root/backup-$backup_id"
      sudo -n install -d -m 0700 "$candidate"
      printf 'energyiq-shared-storage-backup:v1\n' | sudo -n tee "$candidate/.energyiq-managed-backup" >/dev/null
      printf '{\n  "tool": "energyiq-shared-storage-backup"\n}\n' \
        | sudo -n tee "$candidate/metadata.json" >/dev/null
    done
    before_mode="$(stat -c %a -- "$backup_root")"
    before_tree="$(tree_fingerprint "$backup_root")"

    set +e
    output="$(sudo -n bash "$backup_script" prune \
      --backup-root "$backup_root" \
      --app-root "$app_root" \
      --keep-count 1 2>&1)"
    status=$?
    set -e

    after_mode="$(stat -c %a -- "$backup_root")"
    after_tree="$(tree_fingerprint "$backup_root")"
    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf 'prune with app root inside backup root unexpectedly succeeded\n' >&2; exit 1; }
    [[ "$before_mode" == "755" && "$after_mode" == "755" ]] \
      || { printf 'overlapping prune root permissions changed: before=%s after=%s\n' "$before_mode" "$after_mode" >&2; exit 1; }
    [[ "$before_tree" == "$after_tree" ]] \
      || { printf 'overlapping prune root tree changed\n' >&2; exit 1; }
    sudo -n test -d "$backup_root/backup-20260101T000000Z"
    sudo -n test -d "$backup_root/backup-20260102T000000Z"
    ;;
  reject-prune-filesystem-app-root)
    backup_root="$fixture/managed-daily"
    sentinel="$backup_root/do-not-touch"
    sudo -n install -d -m 0755 "$backup_root"
    printf 'preserve-me\n' | sudo -n tee "$sentinel" >/dev/null
    for backup_id in 20260101T000000Z 20260102T000000Z; do
      candidate="$backup_root/backup-$backup_id"
      sudo -n install -d -m 0700 "$candidate"
      printf 'energyiq-shared-storage-backup:v1\n' | sudo -n tee "$candidate/.energyiq-managed-backup" >/dev/null
      printf '{\n  "tool": "energyiq-shared-storage-backup"\n}\n' \
        | sudo -n tee "$candidate/metadata.json" >/dev/null
    done
    before_tree="$(tree_fingerprint "$backup_root")"

    set +e
    output="$(sudo -n bash "$backup_script" prune \
      --backup-root "$backup_root" \
      --app-root / \
      --keep-count 1 2>&1)"
    status=$?
    set -e

    after_tree="$(tree_fingerprint "$backup_root")"
    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf 'filesystem app root unexpectedly allowed prune\n' >&2; exit 1; }
    [[ "$before_tree" == "$after_tree" ]] \
      || { printf 'filesystem app root prune changed the managed tree\n' >&2; exit 1; }
    ;;
  reject-filesystem-root)
    app_root="$fixture/app"
    storage_root="$app_root/shared/storage"
    node_bin="$(realpath -e -- "$(command -v node)")"
    sudo -n install -d -m 0755 "$storage_root"
    before_mode="$(stat -c %a -- /)"

    set +e
    create_output="$(sudo -n bash "$backup_script" create \
      --storage-root "$storage_root" \
      --backup-root / \
      --app-root "$app_root" \
      --api-service energyiq-backup-fixture.service \
      --node-bin "$node_bin" \
      --db-preflight "$preflight_script" 2>&1)"
    create_status=$?
    prune_output="$(sudo -n bash "$backup_script" prune \
      --backup-root / --app-root "$app_root" --keep-count 1 2>&1)"
    prune_status=$?
    set -e

    after_mode="$(stat -c %a -- /)"
    printf '%s\n%s\n' "$create_output" "$prune_output"
    [[ $create_status -ne 0 && $prune_status -ne 0 ]] \
      || { printf 'filesystem root was not rejected by create and prune\n' >&2; exit 1; }
    [[ "$before_mode" == "$after_mode" ]] \
      || { printf 'filesystem root permissions changed: before=%s after=%s\n' "$before_mode" "$after_mode" >&2; exit 1; }
    ;;
  recover-after-readiness-failure)
    app_root="$fixture/app"
    storage_root="$app_root/shared/storage"
    backup_root="$fixture/backups/managed-daily"
    state_dir="$fixture/state"
    node_bin="$(realpath -e -- "$(command -v node)")"
    sudo -n install -d -m 0755 "$app_root" "$(dirname -- "$backup_root")" "$state_dir"
    create_idle_storage "$storage_root" "$node_bin"
    sudo -n chmod 0755 "$fixture_bin/systemctl" "$fixture_bin/curl" "$fixture_bin/sleep"
    printf 'active\n' | sudo -n tee "$state_dir/api-state" >/dev/null
    printf '0\n' | sudo -n tee "$state_dir/start-count" >/dev/null
    printf '0\n' | sudo -n tee "$state_dir/restart-count" >/dev/null
    printf '0\n' | sudo -n tee "$state_dir/ready-success-count" >/dev/null

    set +e
    output="$(sudo -n env \
      PATH="$fixture_bin:/usr/bin:/bin" \
      ENERGYIQ_BACKUP_TEST_STATE_DIR="$state_dir" \
      ENERGYIQ_BACKUP_TEST_CURL_MODE=fail-until-restart \
      bash "$backup_script" create \
      --storage-root "$storage_root" \
      --backup-root "$backup_root" \
      --app-root "$app_root" \
      --api-service energyiq-backup-fixture.service \
      --node-bin "$node_bin" \
      --db-preflight "$preflight_script" \
      --health-url http://127.0.0.1:8787/ready \
      --reserve-bytes 0 2>&1)"
    status=$?
    set -e

    start_count="$(sudo -n cat "$state_dir/start-count")"
    restart_count="$(sudo -n cat "$state_dir/restart-count")"
    ready_success_count="$(sudo -n cat "$state_dir/ready-success-count")"
    api_state="$(sudo -n cat "$state_dir/api-state")"
    partial_count="$(sudo -n find "$backup_root" -mindepth 1 -maxdepth 1 -name '.partial-backup-*' | wc -l)"
    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf 'readiness failure unexpectedly succeeded\n' >&2; exit 1; }
    [[ "$start_count" == "1" && "$restart_count" == "1" ]] \
      || { printf 'API was not restarted after readiness failure: starts=%s restarts=%s\n' "$start_count" "$restart_count" >&2; exit 1; }
    [[ "$ready_success_count" == "1" ]] \
      || { printf 'API readiness was not rechecked after restart: successes=%s\n' "$ready_success_count" >&2; exit 1; }
    [[ "$api_state" == "active" ]] || { printf 'API did not recover\n' >&2; exit 1; }
    [[ "$partial_count" == "0" ]] || { printf 'failed backup left a partial directory\n' >&2; exit 1; }
    ;;
  persistent-readiness-failure-is-critical)
    app_root="$fixture/app"
    storage_root="$app_root/shared/storage"
    backup_root="$fixture/backups/managed-daily"
    state_dir="$fixture/state"
    node_bin="$(realpath -e -- "$(command -v node)")"
    sudo -n install -d -m 0755 "$app_root" "$(dirname -- "$backup_root")" "$state_dir"
    create_idle_storage "$storage_root" "$node_bin"
    sudo -n chmod 0755 "$fixture_bin/systemctl" "$fixture_bin/curl" "$fixture_bin/sleep"
    printf 'active\n' | sudo -n tee "$state_dir/api-state" >/dev/null
    printf '0\n' | sudo -n tee "$state_dir/start-count" >/dev/null
    printf '0\n' | sudo -n tee "$state_dir/restart-count" >/dev/null
    printf '0\n' | sudo -n tee "$state_dir/post-restart-ready-attempts" >/dev/null

    set +e
    output="$(sudo -n env \
      PATH="$fixture_bin:/usr/bin:/bin" \
      ENERGYIQ_BACKUP_TEST_STATE_DIR="$state_dir" \
      ENERGYIQ_BACKUP_TEST_CURL_MODE=fail-and-count-after-restart \
      bash "$backup_script" create \
      --storage-root "$storage_root" \
      --backup-root "$backup_root" \
      --app-root "$app_root" \
      --api-service energyiq-backup-fixture.service \
      --node-bin "$node_bin" \
      --db-preflight "$preflight_script" \
      --health-url http://127.0.0.1:8787/ready \
      --reserve-bytes 0 2>&1)"
    status=$?
    set -e

    start_count="$(sudo -n cat "$state_dir/start-count")"
    restart_count="$(sudo -n cat "$state_dir/restart-count")"
    post_restart_attempts="$(sudo -n cat "$state_dir/post-restart-ready-attempts")"
    api_state="$(sudo -n cat "$state_dir/api-state")"
    partial_count="$(sudo -n find "$backup_root" -mindepth 1 -maxdepth 1 -name '.partial-backup-*' | wc -l)"
    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf 'persistent readiness failure unexpectedly succeeded\n' >&2; exit 1; }
    [[ "$output" == *"CRITICAL: API service is active but not ready after recovery"* ]] \
      || { printf 'persistent readiness failure was not reported as CRITICAL\n' >&2; exit 1; }
    [[ "$start_count" == "1" && "$restart_count" == "1" && "$post_restart_attempts" -gt 0 ]] \
      || { printf 'persistent readiness recovery was not re-probed: starts=%s restarts=%s post-restart-attempts=%s\n' "$start_count" "$restart_count" "$post_restart_attempts" >&2; exit 1; }
    [[ "$api_state" == "active" ]] \
      || { printf 'persistent readiness fixture lost the active unit state\n' >&2; exit 1; }
    [[ "$partial_count" == "0" ]] \
      || { printf 'persistent readiness failure left a partial backup\n' >&2; exit 1; }
    ;;
  recover-after-stop-failure|recover-after-start-failure)
    app_root="$fixture/app"
    storage_root="$app_root/shared/storage"
    backup_root="$fixture/backups/managed-daily"
    state_dir="$fixture/state"
    node_bin="$(realpath -e -- "$(command -v node)")"
    sudo -n install -d -m 0755 "$app_root" "$(dirname -- "$backup_root")" "$state_dir"
    create_idle_storage "$storage_root" "$node_bin"
    sudo -n chmod 0755 "$fixture_bin/systemctl" "$fixture_bin/curl" "$fixture_bin/sleep"
    printf 'active\n' | sudo -n tee "$state_dir/api-state" >/dev/null
    printf '0\n' | sudo -n tee "$state_dir/start-count" >/dev/null
    printf '0\n' | sudo -n tee "$state_dir/restart-count" >/dev/null
    stop_mode=success
    start_mode=success
    expected_starts=0
    if [[ "$scenario" == "recover-after-stop-failure" ]]; then
      stop_mode=fail-after-stop
    else
      start_mode=fail-once
      expected_starts=1
    fi

    set +e
    output="$(sudo -n env \
      PATH="$fixture_bin:/usr/bin:/bin" \
      ENERGYIQ_BACKUP_TEST_STATE_DIR="$state_dir" \
      ENERGYIQ_BACKUP_TEST_STOP_MODE="$stop_mode" \
      ENERGYIQ_BACKUP_TEST_START_MODE="$start_mode" \
      bash "$backup_script" create \
      --storage-root "$storage_root" \
      --backup-root "$backup_root" \
      --app-root "$app_root" \
      --api-service energyiq-backup-fixture.service \
      --node-bin "$node_bin" \
      --db-preflight "$preflight_script" \
      --health-url http://127.0.0.1:8787/ready \
      --reserve-bytes 0 2>&1)"
    status=$?
    set -e

    start_count="$(sudo -n cat "$state_dir/start-count")"
    restart_count="$(sudo -n cat "$state_dir/restart-count")"
    api_state="$(sudo -n cat "$state_dir/api-state")"
    partial_count="$(sudo -n find "$backup_root" -mindepth 1 -maxdepth 1 -name '.partial-backup-*' | wc -l)"
    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf 'service failure unexpectedly produced a backup\n' >&2; exit 1; }
    [[ "$start_count" == "$expected_starts" && "$restart_count" == "1" ]] \
      || { printf 'unexpected recovery attempts: expected-starts=%s starts=%s restarts=%s\n' "$expected_starts" "$start_count" "$restart_count" >&2; exit 1; }
    [[ "$api_state" == "active" ]] || { printf 'API did not recover after service failure\n' >&2; exit 1; }
    [[ "$partial_count" == "0" ]] || { printf 'service failure left a partial directory\n' >&2; exit 1; }
    ;;
  signal-term-cleans-up|signal-hup-cleans-up)
    app_root="$fixture/app"
    storage_root="$app_root/shared/storage"
    backup_root="$fixture/backups/managed-daily"
    state_dir="$fixture/state"
    node_bin="$(realpath -e -- "$(command -v node)")"
    signal_name=TERM
    [[ "$scenario" == "signal-hup-cleans-up" ]] && signal_name=HUP
    sudo -n install -d -m 0755 "$app_root" "$(dirname -- "$backup_root")" "$state_dir"
    create_idle_storage "$storage_root" "$node_bin"
    sudo -n chmod 0755 "$fixture_bin/systemctl" "$fixture_bin/curl" "$fixture_bin/sleep"
    printf 'active\n' | sudo -n tee "$state_dir/api-state" >/dev/null
    printf '0\n' | sudo -n tee "$state_dir/start-count" >/dev/null
    printf '0\n' | sudo -n tee "$state_dir/restart-count" >/dev/null
    printf '0\n' | sudo -n tee "$state_dir/ready-success-count" >/dev/null

    set +e
    output="$(sudo -n env \
      PATH="$fixture_bin:/usr/bin:/bin" \
      ENERGYIQ_BACKUP_TEST_STATE_DIR="$state_dir" \
      ENERGYIQ_BACKUP_TEST_STOP_MODE=signal-parent \
      ENERGYIQ_BACKUP_TEST_SIGNAL="$signal_name" \
      ENERGYIQ_BACKUP_TEST_CURL_MODE=fail-until-restart \
      bash "$backup_script" create \
      --storage-root "$storage_root" \
      --backup-root "$backup_root" \
      --app-root "$app_root" \
      --api-service energyiq-backup-fixture.service \
      --node-bin "$node_bin" \
      --db-preflight "$preflight_script" \
      --health-url http://127.0.0.1:8787/ready \
      --reserve-bytes 0 2>&1)"
    status=$?
    set -e

    api_state="$(sudo -n cat "$state_dir/api-state")"
    restart_count="$(sudo -n cat "$state_dir/restart-count")"
    ready_success_count="$(sudo -n cat "$state_dir/ready-success-count")"
    partial_count="$(sudo -n find "$backup_root" -mindepth 1 -maxdepth 1 -name '.partial-backup-*' | wc -l)"
    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf '%s signal exited successfully\n' "$signal_name" >&2; exit 1; }
    [[ "$api_state" == "active" && "$restart_count" == "1" && "$ready_success_count" == "1" ]] \
      || { printf '%s signal did not restore a ready API: state=%s restarts=%s ready-successes=%s\n' "$signal_name" "$api_state" "$restart_count" "$ready_success_count" >&2; exit 1; }
    [[ "$partial_count" == "0" ]] \
      || { printf '%s signal left a partial backup\n' "$signal_name" >&2; exit 1; }
    ;;
  lock-contention)
    app_root="$fixture/app"
    storage_root="$app_root/shared/storage"
    backup_root="$fixture/backups/managed-daily"
    ready_file="$fixture/lock-ready"
    lock_release="$fixture/lock-release"
    node_bin="$(realpath -e -- "$(command -v node)")"
    sudo -n install -d -m 0755 "$app_root" "$(dirname -- "$backup_root")"
    create_idle_storage "$storage_root" "$node_bin"
    sudo -n bash -c '
      exec 8>/run/lock/energyiq-shared-storage-backup.lock
      flock 8
      : > "$1"
      while [[ ! -f "$2" ]]; do sleep 0.1; done
    ' energyiq-lock-holder "$ready_file" "$lock_release" &
    lock_pid=$!
    for _ in $(seq 1 50); do
      sudo -n test -f "$ready_file" && break
      sleep 0.1
    done
    sudo -n test -f "$ready_file"

    set +e
    output="$(sudo -n bash "$backup_script" create \
      --storage-root "$storage_root" \
      --backup-root "$backup_root" \
      --app-root "$app_root" \
      --api-service energyiq-backup-fixture.service \
      --node-bin "$node_bin" \
      --db-preflight "$preflight_script" \
      --reserve-bytes 0 2>&1)"
    status=$?
    set -e
    sudo -n touch "$lock_release"
    wait "$lock_pid"
    lock_pid=""

    printf '%s\n' "$output"
    [[ $status -ne 0 && "$output" == *"Another Shared Storage backup is already running"* ]] \
      || { printf 'lock contention was not rejected observably\n' >&2; exit 1; }
    partial_count="$(sudo -n find "$backup_root" -mindepth 1 -maxdepth 1 -name '.partial-backup-*' | wc -l)"
    [[ "$partial_count" == "0" ]] || { printf 'lock contention left a partial directory\n' >&2; exit 1; }
    ;;
  insufficient-space)
    app_root="$fixture/app"
    storage_root="$app_root/shared/storage"
    backup_root="$fixture/backups/managed-daily"
    node_bin="$(realpath -e -- "$(command -v node)")"
    sudo -n install -d -m 0755 "$app_root" "$(dirname -- "$backup_root")"
    create_idle_storage "$storage_root" "$node_bin"
    sudo -n chmod 0755 "$fixture_bin/df"

    set +e
    output="$(sudo -n env \
      PATH="$fixture_bin:/usr/bin:/bin" \
      ENERGYIQ_BACKUP_TEST_AVAILABLE_BYTES=0 \
      bash "$backup_script" create \
      --storage-root "$storage_root" \
      --backup-root "$backup_root" \
      --app-root "$app_root" \
      --api-service energyiq-backup-fixture.service \
      --node-bin "$node_bin" \
      --db-preflight "$preflight_script" \
      --reserve-bytes 0 2>&1)"
    status=$?
    set -e

    printf '%s\n' "$output"
    [[ $status -ne 0 && "$output" == *"Insufficient disk space"* ]] \
      || { printf 'insufficient capacity was not rejected observably\n' >&2; exit 1; }
    partial_count="$(sudo -n find "$backup_root" -mindepth 1 -maxdepth 1 -name '.partial-backup-*' | wc -l)"
    [[ "$partial_count" == "0" ]] || { printf 'space failure left a partial directory\n' >&2; exit 1; }
    ;;
  managed-retention)
    backup_root="$fixture/managed-daily"
    app_root="$fixture/app"
    sudo -n install -d -m 0700 "$backup_root" "$app_root"
    for backup_id in 20260101T000000Z 20260102T000000Z 20260103T000000Z 20260104T000000Z; do
      candidate="$backup_root/backup-$backup_id"
      sudo -n install -d -m 0700 "$candidate"
      printf 'energyiq-shared-storage-backup:v1\n' | sudo -n tee "$candidate/.energyiq-managed-backup" >/dev/null
      printf '{\n  "tool": "energyiq-shared-storage-backup"\n}\n' \
        | sudo -n tee "$candidate/metadata.json" >/dev/null
    done
    unknown="$backup_root/backup-20200101T000000Z"
    sudo -n install -d -m 0755 "$unknown"
    sudo -n touch "$unknown/do-not-delete"

    sudo -n bash "$backup_script" prune \
      --backup-root "$backup_root" --app-root "$app_root" --keep-count 2

    sudo -n test ! -e "$backup_root/backup-20260101T000000Z"
    sudo -n test ! -e "$backup_root/backup-20260102T000000Z"
    sudo -n test -d "$backup_root/backup-20260103T000000Z"
    sudo -n test -d "$backup_root/backup-20260104T000000Z"
    sudo -n test -f "$unknown/do-not-delete"
    ;;
  atomic-completion)
    scenario_root="$fixture/atomic"
    backup_dir="$(create_valid_backup "$scenario_root" default)"
    backup_root="$scenario_root/backups/managed-daily"
    restore_check="$fixture/manifest-check"
    sudo -n test -f "$backup_dir/.energyiq-managed-backup"
    for artifact in metadata.json inventory.tsv manifest.sha256 archive.sha256 storage.tar.zst; do
      sudo -n test -f "$backup_dir/$artifact"
    done
    partial_count="$(sudo -n find "$backup_root" -mindepth 1 -maxdepth 1 -name '.partial-backup-*' | wc -l)"
    final_count="$(sudo -n find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name 'backup-*' | wc -l)"
    [[ "$partial_count" == "0" && "$final_count" == "1" ]] \
      || { printf 'backup publication was not atomic\n' >&2; exit 1; }
    sudo -n sh -c 'cd "$1" && sha256sum -c archive.sha256' energyiq-archive-check "$backup_dir"
    sudo -n install -d -m 0700 "$restore_check"
    sudo -n tar --zstd --same-owner -xf "$backup_dir/storage.tar.zst" -C "$restore_check"
    sudo -n sh -c 'cd "$1" && sha256sum -c "$2"' energyiq-manifest-check "$restore_check" "$backup_dir/manifest.sha256"
    ;;
  restore-refuses-corrupt-archive)
    scenario_root="$fixture/corrupt-archive"
    backup_dir="$(create_valid_backup "$scenario_root" default)"
    restore_parent="$fixture/corrupt-restore"
    node_bin="$(realpath -e -- "$(command -v node)")"
    printf 'tamper\n' | sudo -n tee -a "$backup_dir/storage.tar.zst" >/dev/null

    set +e
    output="$(sudo -n env \
      PATH="$fixture_bin:/usr/sbin:/usr/bin:/bin" \
      ENERGYIQ_BACKUP_TEST_STATE_DIR="$scenario_root/state" \
      ENERGYIQ_BACKUP_TEST_SERVICE_USER="$(id -un)" \
      ENERGYIQ_BACKUP_TEST_SERVICE_GROUP="$(id -gn)" \
      "$node_bin" "$verify_script" \
      --backup-dir "$backup_dir" \
      --restore-parent "$restore_parent" \
      --duckdb-module-root "$module_root" \
      --app-root "$scenario_root/app" \
      --storage-root "$scenario_root/app/shared/storage" \
      --api-service energyiq-backup-fixture.service \
      --expected-energy-store default \
      --cleanup 2>&1)"
    status=$?
    set -e

    printf '%s\n' "$output"
    [[ $status -ne 0 && "$output" == *"archive SHA-256 does not match"* ]] \
      || { printf 'corrupt archive was not rejected by checksum\n' >&2; exit 1; }
    sudo -n test ! -e "$restore_parent"
    ;;
  restore-refuses-traversal-archive)
    scenario_root="$fixture/traversal-archive"
    backup_dir="$(create_valid_backup "$scenario_root" default)"
    malicious_input="$fixture/malicious-input"
    escape_target="$fixture/escape/asset.bin"
    restore_parent="$fixture/traversal-restore"
    node_bin="$(realpath -e -- "$(command -v node)")"
    sudo -n install -d -m 0700 "$malicious_input/storage"
    printf 'malicious\n' | sudo -n tee "$malicious_input/storage/asset.bin" >/dev/null
    sudo -n tar --zstd -cf "$backup_dir/storage.tar.zst.new" \
      --transform='s#^storage#../escape#' -C "$malicious_input" storage
    sudo -n mv "$backup_dir/storage.tar.zst.new" "$backup_dir/storage.tar.zst"
    old_sha="$(sudo -n sed -n 's/.*"archiveSha256": "\([a-f0-9]*\)".*/\1/p' "$backup_dir/metadata.json")"
    new_sha="$(sudo -n sha256sum "$backup_dir/storage.tar.zst" | awk '{print $1}')"
    sudo -n sed -i "s/$old_sha/$new_sha/g" "$backup_dir/metadata.json"
    printf '%s  storage.tar.zst\n' "$new_sha" | sudo -n tee "$backup_dir/archive.sha256" >/dev/null

    set +e
    output="$(sudo -n env \
      PATH="$fixture_bin:/usr/sbin:/usr/bin:/bin" \
      ENERGYIQ_BACKUP_TEST_STATE_DIR="$scenario_root/state" \
      ENERGYIQ_BACKUP_TEST_SERVICE_USER="$(id -un)" \
      ENERGYIQ_BACKUP_TEST_SERVICE_GROUP="$(id -gn)" \
      "$node_bin" "$verify_script" \
      --backup-dir "$backup_dir" \
      --restore-parent "$restore_parent" \
      --duckdb-module-root "$module_root" \
      --app-root "$scenario_root/app" \
      --storage-root "$scenario_root/app/shared/storage" \
      --api-service energyiq-backup-fixture.service \
      --expected-energy-store default \
      --cleanup 2>&1)"
    status=$?
    set -e

    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf 'traversal archive unexpectedly succeeded\n' >&2; exit 1; }
    sudo -n test ! -e "$escape_target"
    sudo -n test ! -e "$restore_parent"
    ;;
  missing-storage-unit-fails)
    test_unit="energyiq-backup-missing-storage-$$.service"
    missing_storage="$fixture/does-not-exist/storage"
    sudo -n sed -E \
      "s#^(ConditionPathIsDirectory|AssertPathIsDirectory)=.*#\\1=$missing_storage#" \
      "$service_unit" | sudo -n tee "/run/systemd/system/$test_unit" >/dev/null
    sudo -n systemctl daemon-reload

    set +e
    output="$(sudo -n systemctl start "$test_unit" 2>&1)"
    status=$?
    set -e
    assert_result="$(systemctl show "$test_unit" -p AssertResult --value)"

    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf 'missing Storage was reported as a successful unit start\n' >&2; exit 1; }
    [[ "$assert_result" == "no" ]] \
      || { printf 'missing Storage did not expose AssertResult=no: %s\n' "$assert_result" >&2; exit 1; }
    ;;
  restore-forbidden-before-write)
    scenario_root="$fixture/valid-backup"
    backup_dir="$(create_valid_backup "$scenario_root" default)"
    forbidden_root="$fixture/forbidden"
    restore_parent="$forbidden_root/new-restore-parent"
    sudo -n install -d -m 0700 "$forbidden_root"
    node_bin="$(realpath -e -- "$(command -v node)")"

    set +e
    output="$(sudo -n "$node_bin" "$verify_script" \
      --backup-dir "$backup_dir" \
      --restore-parent "$restore_parent" \
      --duckdb-module-root "$module_root" \
      --app-root "$scenario_root/app" \
      --storage-root "$scenario_root/app/shared/storage" \
      --api-service energyiq-backup-fixture.service \
      --forbid-root "$forbidden_root" \
      --expected-energy-store default \
      --cleanup 2>&1)"
    status=$?
    set -e

    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf 'forbidden restore unexpectedly succeeded\n' >&2; exit 1; }
    if sudo -n test -e "$restore_parent"; then
      printf 'verifier created the forbidden restore parent before rejecting it\n' >&2
      exit 1
    fi
    ;;
  restore-requires-production-roots)
    scenario_root="$fixture/missing-roots"
    backup_dir="$(create_valid_backup "$scenario_root" default)"
    restore_parent="$fixture/missing-roots-restore"
    node_bin="$(realpath -e -- "$(command -v node)")"

    set +e
    output="$(sudo -n "$node_bin" "$verify_script" \
      --backup-dir "$backup_dir" \
      --restore-parent "$restore_parent" \
      --duckdb-module-root "$module_root" \
      --api-service energyiq-backup-fixture.service \
      --expected-energy-store default \
      --cleanup 2>&1)"
    status=$?
    set -e

    printf '%s\n' "$output"
    [[ $status -ne 0 && "$output" == *"--app-root"* ]] \
      || { printf 'missing production roots were not rejected\n' >&2; exit 1; }
    sudo -n test ! -e "$restore_parent"
    ;;
  restore-requires-canonical-metadata)
    scenario_root="$fixture/missing-metadata"
    backup_dir="$(create_valid_backup "$scenario_root" default)"
    repack_root="$fixture/repack-missing-metadata"
    restore_parent="$fixture/missing-metadata-restore"
    node_bin="$(realpath -e -- "$(command -v node)")"
    sudo -n install -d -m 0700 "$repack_root"
    sudo -n tar --zstd --same-owner -xf "$backup_dir/storage.tar.zst" -C "$repack_root"
    sudo -n rm -f -- "$repack_root/storage/metadata/workbench.sqlite"
    sudo -n bash -c '
      cd "$1"
      while IFS= read -r -d "" file; do sha256sum -- "$file"; done \
        < <(find storage -type f -print0 | sort -z)
    ' energyiq-repack-manifest "$repack_root" | sudo -n tee "$backup_dir/manifest.sha256" >/dev/null
    sudo -n tar --zstd --sort=name --mtime='@0' --numeric-owner \
      -cf "$backup_dir/storage.tar.zst.new" -C "$repack_root" storage
    sudo -n mv "$backup_dir/storage.tar.zst.new" "$backup_dir/storage.tar.zst"
    new_sha="$(sudo -n sha256sum "$backup_dir/storage.tar.zst" | awk '{print $1}')"
    file_count="$(sudo -n find "$repack_root/storage" -type f | wc -l)"
    archive_bytes="$(sudo -n stat -c %s "$backup_dir/storage.tar.zst")"
    printf '%s  storage.tar.zst\n' "$new_sha" | sudo -n tee "$backup_dir/archive.sha256" >/dev/null
    sudo -n env \
      METADATA_JSON="$backup_dir/metadata.json" \
      ARCHIVE_SHA="$new_sha" \
      ARCHIVE_BYTES="$archive_bytes" \
      FILE_COUNT="$file_count" \
      "$node_bin" --input-type=module -e '
        import { readFileSync, writeFileSync } from "node:fs";
        const metadata = JSON.parse(readFileSync(process.env.METADATA_JSON, "utf8"));
        metadata.archiveSha256 = process.env.ARCHIVE_SHA;
        metadata.archiveBytes = Number(process.env.ARCHIVE_BYTES);
        metadata.fileCount = Number(process.env.FILE_COUNT);
        writeFileSync(process.env.METADATA_JSON, `${JSON.stringify(metadata, null, 2)}\n`);
      '

    set +e
    output="$(sudo -n env \
      PATH="$fixture_bin:/usr/sbin:/usr/bin:/bin" \
      ENERGYIQ_BACKUP_TEST_STATE_DIR="$scenario_root/state" \
      ENERGYIQ_BACKUP_TEST_SERVICE_USER="$(id -un)" \
      ENERGYIQ_BACKUP_TEST_SERVICE_GROUP="$(id -gn)" \
      "$node_bin" "$verify_script" \
      --backup-dir "$backup_dir" \
      --restore-parent "$restore_parent" \
      --duckdb-module-root "$module_root" \
      --app-root "$scenario_root/app" \
      --storage-root "$scenario_root/app/shared/storage" \
      --api-service energyiq-backup-fixture.service \
      --expected-energy-store default \
      --cleanup 2>&1)"
    status=$?
    set -e

    printf '%s\n' "$output"
    [[ $status -ne 0 && "$output" == *"Canonical Metadata SQLite is missing"* ]] \
      || { printf 'missing canonical Metadata was not rejected\n' >&2; exit 1; }
    ;;
  restore-requires-canonical-energy-store)
    scenario_root="$fixture/missing-energy"
    backup_dir="$(create_valid_backup "$scenario_root")"
    restore_parent="$fixture/isolated-restore"
    node_bin="$(realpath -e -- "$(command -v node)")"

    set +e
    output="$(sudo -n env \
      PATH="$fixture_bin:/usr/sbin:/usr/bin:/bin" \
      ENERGYIQ_BACKUP_TEST_STATE_DIR="$scenario_root/state" \
      ENERGYIQ_BACKUP_TEST_SERVICE_USER="$(id -un)" \
      ENERGYIQ_BACKUP_TEST_SERVICE_GROUP="$(id -gn)" \
      "$node_bin" "$verify_script" \
      --backup-dir "$backup_dir" \
      --restore-parent "$restore_parent" \
      --duckdb-module-root "$module_root" \
      --app-root "$scenario_root/app" \
      --storage-root "$scenario_root/app/shared/storage" \
      --api-service energyiq-backup-fixture.service \
      --expected-energy-store default \
      --cleanup 2>&1)"
    status=$?
    set -e

    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf 'archive without an Energy fact store unexpectedly passed\n' >&2; exit 1; }
    ;;
  restore-requires-expected-energy-store)
    scenario_root="$fixture/unexpected-energy"
    backup_dir="$(create_valid_backup "$scenario_root" unexpected)"
    restore_parent="$fixture/expected-store-restore"
    node_bin="$(realpath -e -- "$(command -v node)")"

    set +e
    output="$(sudo -n env \
      PATH="$fixture_bin:/usr/sbin:/usr/bin:/bin" \
      ENERGYIQ_BACKUP_TEST_STATE_DIR="$scenario_root/state" \
      ENERGYIQ_BACKUP_TEST_SERVICE_USER="$(id -un)" \
      ENERGYIQ_BACKUP_TEST_SERVICE_GROUP="$(id -gn)" \
      "$node_bin" "$verify_script" \
      --backup-dir "$backup_dir" \
      --restore-parent "$restore_parent" \
      --duckdb-module-root "$module_root" \
      --app-root "$scenario_root/app" \
      --storage-root "$scenario_root/app/shared/storage" \
      --api-service energyiq-backup-fixture.service \
      --expected-energy-store default \
      --cleanup 2>&1)"
    status=$?
    set -e

    printf '%s\n' "$output"
    [[ $status -ne 0 ]] || { printf 'unexpected Energy store satisfied the expected store gate\n' >&2; exit 1; }
    [[ "$output" == *"Expected Energy fact store is missing"* ]] \
      || { printf 'expected store failure was not observable\n' >&2; exit 1; }
    ;;
  restore-proves-api-ownership)
    scenario_root="$fixture/api-ownership"
    backup_dir="$(create_valid_backup "$scenario_root" default)"
    restore_parent="$fixture/ownership-restore"
    state_dir="$scenario_root/state"
    node_bin="$(realpath -e -- "$(command -v node)")"

    set +e
    output="$(sudo -n env \
      PATH="$fixture_bin:/usr/sbin:/usr/bin:/bin" \
      ENERGYIQ_BACKUP_TEST_STATE_DIR="$state_dir" \
      ENERGYIQ_BACKUP_TEST_SERVICE_USER="$(id -un)" \
      ENERGYIQ_BACKUP_TEST_SERVICE_GROUP="$(id -gn)" \
      "$node_bin" "$verify_script" \
      --backup-dir "$backup_dir" \
      --restore-parent "$restore_parent" \
      --duckdb-module-root "$module_root" \
      --app-root "$scenario_root/app" \
      --storage-root "$scenario_root/app/shared/storage" \
      --api-service energyiq-backup-fixture.service \
      --expected-energy-store default \
      --cleanup 2>&1)"
    status=$?
    set -e

    printf '%s\n' "$output"
    [[ $status -eq 0 ]] || { printf 'API ownership verification failed\n' >&2; exit 1; }
    [[ "$output" == *'"serviceAccess"'* && "$output" == *'"writable": "passed"'* ]] \
      || { printf 'API ownership evidence is missing\n' >&2; exit 1; }
    ;;
  *)
    printf 'unknown behavior scenario: %s\n' "$scenario" >&2
    exit 2
    ;;
esac
