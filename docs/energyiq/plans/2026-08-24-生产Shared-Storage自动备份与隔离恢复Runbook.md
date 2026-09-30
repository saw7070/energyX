# 生产 Shared Storage 自动备份与隔离恢复 Runbook

> 状态：仓库实现已固化；生产安装与首次恢复证据见
> [2026-08-24 实施记录](../records/2026-08-24-生产Shared-Storage自动备份实施记录.md)，本文不能替代逐次证据。

## 1. 目标与证据边界

本方案备份完整的 `/opt/energyiq-datafoundry/shared/storage`，而不是按 Project 或 Connector
挑选文件。因此当前 Preschool、Ngee Ann、Tuya Office，以及后续落入同一 Shared Storage 的
Project 都在同一个一致性点内。覆盖范围包括：

- Metadata SQLite 主文件及 WAL/SHM；
- 所有 Project DuckDB 主文件及 WAL；
- content-addressed file assets、workspace、SQL result、skill cache；
- Mastra/Agent 状态、日志和 Shared Storage 下未来新增的普通文件或目录。

它不读取或复制 `/opt/energyiq-datafoundry/shared/api.env`、systemd EnvironmentFile、Provider
凭据或其他应用配置。备份根目录和临时目录均为 root 所有、`0700`/`umask 0077`。

必须区分三种证据：

1. **本机备份**：本工具在同一台生产主机、应用根目录外生成并校验的备份。
2. **异地主副本**：需要独立主机或对象存储及独立凭据；当前没有这些凭据时，此项明确为未完成风险。
3. **真实恢复演练**：把备份恢复成可接管的生产实例并执行业务验收。本工具默认只做隔离、非破坏性恢复验证，不能把它表述成真实生产切换演练。

## 2. 一致性模型

普通在线 `tar` 不能保证 SQLite、DuckDB、WAL、assets 和 AI 状态来自同一个时点。本工具采用
**quiesce-copy-compress**：

1. 持有 `/run/lock/energyiq-shared-storage-backup.lock` 排他锁；
2. 用只读 SQLite 连接执行 Metadata `quick_check`，拒绝仍为 `running` 的 Source Sync 或 Agent Run；
3. 确认真实 API unit 正在运行，短暂停止唯一生产写入者；
4. 扫描 `/proc/*/fd`，若仍有进程持有 Shared Storage 文件描述符则失败并恢复 API；
5. 在受限临时目录中用 `cp -a --reflink=auto` 复制完整 Storage；
6. 复制完成后立即启动 API 并检查本机 `/ready`；
7. 在服务恢复后生成文件 inventory、SHA-256 manifest 和压缩归档，再原子发布备份目录。

一致性副本和归档保留源 Storage 的数字 uid/gid/mode；不能把恢复树统一改为 `root:root`。
metadata 同时记录 Storage 顶层身份，隔离验证会从真实 API systemd unit 解析非 root User/Group，
以对应 UID/GID 对整棵恢复树执行可读检查和逐目录写入/删除探针。

因此停写窗口只覆盖本地一致性副本，不覆盖 SHA-256 计算和压缩。任何失败都以非零状态退出；
若 API 已被本工具停止，退出陷阱会优先尝试恢复服务。执行前仍需确认没有未知的独立写入进程，
不能把 `/proc` 检查当成跨主机分布式锁。

## 3. 磁盘门、目录和保留策略

- 正式根目录：`/var/backups/energyiq/managed-daily`，必须位于应用根目录之外且不能是 symlink。
- 完成目录：`backup-<UTC timestamp>`；临时目录以 `.partial-backup-` 开头，成功后同文件系统原子 `mv`。
- 每个完成目录包含 `storage.tar.zst`、`archive.sha256`、`manifest.sha256`、`inventory.tsv`、
  `metadata.json` 和 `.energyiq-managed-backup`。
- 默认空间门：备份卷可用空间至少为 `2 × 当前 Storage 大小 + 1 GiB`。
- 默认只保留最近 7 个**本工具管理**的完成目录。

清理逻辑只接受已验证的 `managed-daily/backup-*` 目录，并要求 marker 和 metadata 中的工具标识
同时匹配。它不会删除 `/var/backups/energyiq` 下历史目录、未知 tar、手工备份或其他工具的文件。
磁盘门失败时先人工判断空间来源；不要为了让任务通过而删除未知备份。

## 4. 安装与调度

安装前核对 physical release、Storage、服务、时区和磁盘；敏感变量只核对 present/missing：

```bash
readlink -f /opt/energyiq-datafoundry/current
systemctl show energyiq-datafoundry-api.service \
  -p LoadState -p ActiveState -p UnitFileState -p User -p FragmentPath -p EnvironmentFiles
timedatectl show -p Timezone -p NTPSynchronized
df -hT /opt/energyiq-datafoundry/shared/storage /var/backups/energyiq
du -sx --block-size=1 /opt/energyiq-datafoundry/shared/storage
```

从已审查的 exact Release 安装；不要从未审查工作树复制：

```bash
RELEASE="$(readlink -f /opt/energyiq-datafoundry/current)"

sudo install -d -o root -g root -m 0750 /usr/local/libexec/energyiq
sudo install -d -o root -g root -m 0700 /var/backups/energyiq/managed-daily
sudo install -o root -g root -m 0750 \
  "${RELEASE}/scripts/energyiq/backup-shared-storage.sh" \
  /usr/local/libexec/energyiq/backup-shared-storage.sh
sudo install -o root -g root -m 0640 \
  "${RELEASE}/scripts/energyiq/shared-storage-backup-preflight.mjs" \
  /usr/local/libexec/energyiq/shared-storage-backup-preflight.mjs
sudo install -o root -g root -m 0640 \
  "${RELEASE}/scripts/energyiq/verify-shared-storage-backup.mjs" \
  /usr/local/libexec/energyiq/verify-shared-storage-backup.mjs
sudo install -o root -g root -m 0644 \
  "${RELEASE}/deploy/systemd/energyiq-shared-storage-backup.service" \
  /etc/systemd/system/energyiq-shared-storage-backup.service
sudo install -o root -g root -m 0644 \
  "${RELEASE}/deploy/systemd/energyiq-shared-storage-backup.timer" \
  /etc/systemd/system/energyiq-shared-storage-backup.timer

sudo systemd-analyze verify \
  /etc/systemd/system/energyiq-shared-storage-backup.service \
  /etc/systemd/system/energyiq-shared-storage-backup.timer
sudo systemctl daemon-reload
```

生产主机核验时区为 `Asia/Shanghai`；它和 `Asia/Singapore` 当前同为 UTC+08:00。Tuya 调度由
应用按新加坡本地时间 01:00 执行，备份 timer 固定为主机 `Asia/Shanghai` 的 02:15。若主机时区、
Tuya schedule 或写入机制改变，必须重新设计日历，不能照抄当前间隔。

首次执行和启用 timer：

```bash
sudo systemctl start energyiq-shared-storage-backup.service
sudo systemctl status --no-pager energyiq-shared-storage-backup.service
sudo systemctl enable --now energyiq-shared-storage-backup.timer
systemctl list-timers --all energyiq-shared-storage-backup.timer
systemd-analyze calendar '*-*-* 02:15:00 Asia/Shanghai'
```

oneshot 完成后 service 显示 `inactive (dead)` 且 `Result=success` 是正常状态；timer 必须为 enabled、
active，并显示下一次触发时间。失败时检查：

```bash
journalctl -u energyiq-shared-storage-backup.service -n 200 --no-pager
systemctl is-active energyiq-datafoundry-api.service
curl -fsS http://127.0.0.1:8787/ready
```

## 5. 完成目录核验

不要只看 systemd exit code。对最新完成目录检查权限、metadata、归档 checksum 和逻辑 inventory：

```bash
BACKUP="$(find /var/backups/energyiq/managed-daily -mindepth 1 -maxdepth 1 \
  -type d -name 'backup-*' -printf '%f\n' | sort | tail -n 1)"
BACKUP="/var/backups/energyiq/managed-daily/${BACKUP}"

sudo stat -c '%U %G %a %n' /var/backups/energyiq/managed-daily "${BACKUP}"
sudo bash -c 'cd "$1" && sha256sum -c archive.sha256' _ "${BACKUP}"
sudo sed -n '1,80p' "${BACKUP}/metadata.json"
sudo grep -E \
  'metadata/workbench\.sqlite|energy/(default|preschool-demo-org|tuya-office)/energy\.duckdb|files/' \
  "${BACKUP}/inventory.tsv"
```

inventory 只用于可读范围证据；恢复可信度以归档 checksum、完整文件 manifest 和数据库检查为准。

## 6. 隔离、非破坏性恢复验证

验证器拒绝把 restore parent 放进生产 Storage、应用根目录或备份根目录。DuckDB 模块从当前已
安装的生产依赖加载；所有恢复都发生在独立临时目录，不能覆盖生产：

```bash
RELEASE="$(readlink -f /opt/energyiq-datafoundry/current)"
BACKUP="/var/backups/energyiq/managed-daily/<verified-backup-directory>"
sudo install -d -o root -g root -m 0700 /var/tmp/energyiq-restore-verify

sudo /opt/energyiq-datafoundry/runtime/node22/bin/node \
  /usr/local/libexec/energyiq/verify-shared-storage-backup.mjs \
  --backup-dir "${BACKUP}" \
  --restore-parent /var/tmp/energyiq-restore-verify \
  --duckdb-module-root "${RELEASE}" \
  --app-root /opt/energyiq-datafoundry \
  --storage-root /opt/energyiq-datafoundry/shared/storage \
  --api-service energyiq-datafoundry-api.service \
  --forbid-root /var/backups/energyiq \
  --expected-energy-store default \
  --expected-energy-store preschool-demo-org \
  --expected-energy-store tuya-office \
  --cleanup
```

成功输出必须同时包含：

- archive checksum 和 manifest 中全部文件的 SHA-256 成功；
- 所有 `.sqlite` 可执行 `integrity_check`，Metadata 关键表存在；
- 所有 `.duckdb` 可打开；标准 Project Energy Fact store 的四张关键表存在；
- 调用者声明的每个 `--expected-energy-store` 均存在并通过关键表门；
- file assets 的恢复文件数量；
- 实际 API service User/Group 对恢复树全部文件可读、全部目录可写；
- 隔离恢复目录已清理。

这里允许 DuckDB 在隔离副本内回放它自己的 WAL；不修改生产文件。若验证失败，保留原备份，
不要重写 manifest 或删除失败备份来制造成功证据。

## 7. 回滚与应急恢复边界

安装回滚只需 disable timer、移除本方案的 unit/libexec 文件并 `daemon-reload`；这不会删除任何
已完成备份：

```bash
sudo systemctl disable --now energyiq-shared-storage-backup.timer
```

真实 Storage 恢复属于单独维护事件：必须先停止全部已核实写入者、保留故障 Storage、把已通过
隔离验证的完整 `storage/` 恢复到新的物理路径、再次核验所有数据库，再以可回滚的原子路径切换
并执行业务验收。本 Runbook 不授权直接覆盖 `/opt/energyiq-datafoundry/shared/storage`。
