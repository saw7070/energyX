import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = join(dirname(fileURLToPath(import.meta.url)), "offsite-backup.sh");

// Stands in for `aliyun oss cp|stat`, keeping "OSS" objects under FAKE_OSS_ROOT.
const FAKE_ALIYUN = `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == "oss" ]] || exit 2
shift
op="$1"; shift
local_path() { local uri="$1"; printf '%s/%s' "$FAKE_OSS_ROOT" "\${uri#oss://}"; }
case "$op" in
  cp)
    src="$1"; dst="$2"
    if [[ "$dst" == oss://* ]]; then target="$(local_path "$dst")"; mkdir -p "$(dirname "$target")"; cp "$src" "$target";
    else cp "$(local_path "$src")" "$dst"; fi ;;
  stat)
    target="$(local_path "$1")"
    [[ -f "$target" ]] || { echo "NoSuchKey" >&2; exit 1; }
    printf 'Content-Length      : %s\\n' "$(wc -c < "$target" | tr -d ' ')" ;;
  *) exit 2 ;;
esac
`;

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "offsite-backup-"));
  const backups = join(root, "managed-daily");
  const backup = join(backups, "backup-20261009T021500Z");
  mkdirSync(backup, { recursive: true });
  writeFileSync(join(backup, "storage.tar.zst"), randomBytes(4096));
  writeFileSync(join(backup, "archive.sha256"), `${sha256(join(backup, "storage.tar.zst"))}  storage.tar.zst\n`);
  writeFileSync(join(backup, "metadata.json"), "{}\n");
  const key = join(root, "backup.key");
  writeFileSync(key, randomBytes(48).toString("base64"));
  chmodSync(key, 0o600);
  const fake = join(root, "aliyun");
  writeFileSync(fake, FAKE_ALIYUN);
  chmodSync(fake, 0o755);
  const oss = join(root, "oss");
  const config = join(root, "offsite.env");
  writeFileSync(config, [
    "OFFSITE_BUCKET=energyiq-backups",
    "OFFSITE_PREFIX=energyiq/production",
    "OFFSITE_ENDPOINT=oss-ap-southeast-3.aliyuncs.com",
    `BACKUP_ENCRYPTION_KEY_FILE=${key}`,
    `BACKUP_ROOT=${backups}`,
    `OFFSITE_STATE_FILE=${join(root, "state", "offsite-backup.json")}`,
    `OFFSITE_WORK_DIR=${join(root, "work")}`,
    `ALIYUN_BIN=${fake}`,
  ].join("\n"));
  const env = { ...process.env, FAKE_OSS_ROOT: oss };
  const run = (...args) => spawnSync("bash", [script, ...args, "--config", config], { env, encoding: "utf8" });
  return { root, backup, key, oss, run, state: join(root, "state", "offsite-backup.json") };
};

test("uploads the newest backup encrypted, verifies it, and never sends the same one twice", () => {
  const { root, backup, oss, run, state } = setup();
  try {
    const first = run("upload");
    assert.equal(first.status, 0, first.stderr);
    const stored = join(oss, "energyiq-backups/energyiq/production/backup-20261009T021500Z.tar.enc");
    assert.ok(existsSync(stored));
    assert.ok(existsSync(`${stored}.sha256`));
    // The stored copy is encrypted: the backup's bytes do not appear in it.
    assert.ok(!readFileSync(stored).includes(readFileSync(join(backup, "storage.tar.zst")).subarray(0, 64)));
    const status = JSON.parse(readFileSync(state, "utf8"));
    assert.equal(status.status, "ok");
    assert.deepEqual(status.uploaded, ["backup-20261009T021500Z.tar.enc"]);
    const second = run("upload");
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Already offsite/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restores and checks a copy, and refuses a tampered one", () => {
  const { root, backup, oss, run } = setup();
  try {
    assert.equal(run("upload").status, 0);
    const target = join(root, "restore");
    const restored = run("restore", "--object", "backup-20261009T021500Z.tar.enc", "--to", target);
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(sha256(join(target, "backup-20261009T021500Z", "storage.tar.zst")), sha256(join(backup, "storage.tar.zst")));

    const stored = join(oss, "energyiq-backups/energyiq/production/backup-20261009T021500Z.tar.enc");
    const bytes = readFileSync(stored);
    bytes[bytes.length - 20] ^= 0xff;
    writeFileSync(stored, bytes);
    const tampered = run("restore", "--object", "backup-20261009T021500Z.tar.enc", "--to", join(root, "restore-2"));
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr, /does not match its checksum/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("will not run with a key anyone else can read", () => {
  const { root, key, run } = setup();
  try {
    chmodSync(key, 0o644);
    const result = run("upload");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /mode 600/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("is valid bash", () => {
  execFileSync("bash", ["-n", script]);
});
