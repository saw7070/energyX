# 2026-08-24 生产 Shared Storage 自动备份实施记录

> 对应 Issue：[Zion74/energyiq-datafoundry#150](https://github.com/Zion74/energyiq-datafoundry/issues/150)
>
> 本记录不包含 Secret 值。实现机制和恢复操作见
> [生产 Shared Storage 自动备份与隔离恢复 Runbook](../plans/2026-08-24-生产Shared-Storage自动备份与隔离恢复Runbook.md)。

## 1. 仓库与生产基线

- 实现分支：`codex/production-shared-storage-backup`。
- 生产安装 payload 来源提交：`9b86cd80c35cc93822d695e1011162fb3dd19030`。
- 开工时 `HEAD`、`origin/main` 和生产 physical Release 均为
  `d5a250de0f2ab51303b891fb8c14272b38713da0`。
- 实际 API unit：`energyiq-datafoundry-api.service`，安装前后均为 active；实际 Web unit 同样 active。
- 生产 Storage：`/opt/energyiq-datafoundry/shared/storage`，首次备份前约 2.53 GB。
- 主机时区：`Asia/Shanghai`，NTP synchronized；它与 `Asia/Singapore` 当前同为 UTC+08:00。
- Tuya 应用内调度为新加坡本地 01:00；备份 timer 设为主机本地 02:15。
- 备份前根文件系统约 59 GB，约 9.7 GB 可用；空间门要求
  `2 × sourceBytes + 1 GiB`。
- 敏感生产配置只检查 present/missing；本工具没有读取或复制 `api.env`。

安装前发现 `/var/backups/energyiq` 已有约 8.8 GB 的历史人工/Release 备份，其中部分目录文件名
包含 `api.env`。没有读取其内容，也没有删除或纳入本工具 retention。本工具使用新的
`/var/backups/energyiq/managed-daily` 边界。

## 2. 仓库验证

执行：

```text
npm run test:energyiq:backup
```

结果：6 tests，6 passed，0 failed。覆盖：

- 归档路径穿越/特殊条目拒绝；
- SHA-256 manifest 严格解析；
- Metadata 与 Energy Fact 恢复关键表门；
- Metadata `quick_check` 和 active writer 拒绝；
- Bash 语法及 stop → copy → start → compress 顺序；
- systemd unit、主机时区日历和受限权限配置。

另外通过：

```text
node --check scripts/energyiq/shared-storage-backup-preflight.mjs
node --check scripts/energyiq/verify-shared-storage-backup.mjs
git diff --check
```

目标主机上的 `bash -n`、两个 Node `--check` 通过。`systemd-analyze verify` 对本工具 unit
没有告警；输出仍包含主机既有 `tat_agent.service` legacy PIDFile 和旧 systemd 不认识 snapd
`RestartMode` 的无关告警。

## 3. 安装身份与权限

生产安装文件 SHA-256：

```text
77f9fce6fa0efc8ecc91a0e7b85d3a7bce7a2c03077405d4caa197ba0fede04f  /usr/local/libexec/energyiq/backup-shared-storage.sh
83d6c45dcd166acaeab2e6009997c12484bbf7a1da29c15918ca3211e5ae5984  /usr/local/libexec/energyiq/shared-storage-backup-preflight.mjs
98149ea373adcaed02c2661bbf154d4410d93e879419a21ce54129580367dbd2  /usr/local/libexec/energyiq/verify-shared-storage-backup.mjs
c830c2af0a4b1751d5e20d4c15b58f46f019074eb5802475ed4f4f204a8c9708  /etc/systemd/system/energyiq-shared-storage-backup.service
38970cf9f850976f04652a0fe89fd7c8f10f9bbc2d93ca62b1491bf063916c05  /etc/systemd/system/energyiq-shared-storage-backup.timer
```

- libexec 目录为 `root:root 0750`；主脚本 `0750`，Node 脚本 `0640`。
- unit 为 `root:root 0644`。
- managed backup 根目录和每个完成目录为 `root:root 0700`；文件为 `0600`。
- timer 启用前先手工执行并完成恢复验证。

## 4. 首次生产备份

执行：

```text
sudo systemctl start energyiq-shared-storage-backup.service
```

结果：`Result=success`、`ExecMainStatus=0`。一致性 preflight：

```json
{"metadataQuickCheck":"ok","runningSourceSyncs":0,"runningAgentRuns":0}
```

首次完成目录：

```text
/var/backups/energyiq/managed-daily/backup-20260824T101846Z
```

关键 metadata：

- strategy：`quiesce-copy-compress`；
- release SHA：`d5a250de0f2ab51303b891fb8c14272b38713da0`；
- source：2,649,368,521 bytes，1,390 files；
- API stop：2026-08-24T10:18:46Z；snapshot complete：10:18:58Z，停写复制约 12 秒；
- API ready 后开始压缩；完成时间：10:19:35Z；
- archive：186,028,008 bytes；
- archive SHA-256：`7f9ebbf26a214bdc36c224f9e6f0e18ba88a6db85c1ebecc1f9ad4ad9c932f35`；
- `sha256sum -c archive.sha256`：`storage.tar.zst: OK`。

inventory 显示完整顶层范围：cache、credentials、energy、files、logs、mastra、metadata、skill-cache、
sql-results、workspaces。其中包含：

- `metadata/workbench.sqlite`；
- `energy/default/energy.duckdb` 及 WAL（Ngee Ann 当前逻辑 store）；
- `energy/preschool-demo-org/energy.duckdb` 及 WAL；
- `energy/tuya-office/energy.duckdb` 及 WAL；
- `mastra/agent-state.sqlite` 及 WAL/SHM；
- files 共 616 个、workspace datasource SQLite 及其余 Shared Storage 文件。

没有触发 Tuya Provider，没有手动同步，也没有修改业务数据。API 在复制后恢复为 active/ready。

## 5. 隔离恢复验证

执行对象是上面的首次备份；restore parent 为 `/var/tmp/energyiq-restore-verify`，明确禁止与
`/opt/energyiq-datafoundry`、`/var/backups/energyiq` 重叠，并使用 `--cleanup`。没有覆盖生产 Storage。

结果：

- archive SHA-256、manifest 和恢复后的 1,390/1,390 文件 checksum 全部通过；
- 14 个 SQLite 全部 `integrity_check=ok`；
- Metadata 可打开，79 张表，要求的关键表全部存在；
- Mastra Agent State 可打开，38 张表；
- Ngee Ann、Preschool、Tuya 三个正式 Energy DuckDB 均可打开，且四张关键 Energy Fact 表存在；
- `energy.preschool-test.duckdb` 也可打开；
- 616 个 file assets 可枚举；
- verifier exit code 0；结束后 restore parent 下剩余验证目录数为 0。

## 6. Timer 状态

首次恢复验证通过后执行：

```text
sudo systemctl enable --now energyiq-shared-storage-backup.timer
```

核验结果：

```text
enabled
active / waiting
NextElapseUSecRealtime=Tue 2026-08-25 02:15:00 CST
```

`systemd-analyze calendar '*-*-* 02:15:00 Asia/Shanghai'` 给出同一下一次触发，UTC 为
2026-08-24 18:15:00。默认保留最近 7 个本工具管理的完成目录，未知历史备份不参与清理。

## 7. 尚未完成的证据

- **异地主副本未完成**：当前没有经过授权、核验的对象存储/独立主机凭据。本机备份仍与生产主机
  共享故障域。
- **真实生产接管恢复演练未完成**：已经完成非破坏性解包、checksum 和数据库级恢复验证；没有执行
  覆盖生产 Storage、原子接管新 Storage 或用户业务验收，因此不得宣称真实灾难恢复演练通过。
- 生产当前 physical Release 仍是基线 SHA；备份 payload 以独立 libexec/systemd 文件安装。
  后续应在仓库变更合并并进入正式 immutable Release 后，再核对 installed hash 与 Release 内容一致。

## 8. PR #153 审核阻断修复与二次生产验证

主 Agent 在 [PR #153 审核记录](https://github.com/Zion74/energyiq-datafoundry/pull/153#issuecomment-5395428109)
提出 6 个合并阻断项。修复提交为 `af7734169bcd5f2b0fafbbdd7c5d78093109b6fa`，并已先把
`origin/main` 的 `8e49f339ede5066900a869d4f323285514c4c6c7` 合入工作分支。修复内容包括：

- 在任何 `mkdir`、`chmod` 或 retention 枚举前，以只读方式 canonicalize 并限制
  `managed-daily` 根；独立 `prune` 也必须提供并校验 `--app-root`；
- API 恢复 trap 在 stop 前武装，只有 unit active 且 ready probe 成功后才解除；
- systemd 使用 `AssertPathIsDirectory`，Storage 缺失时启动 job 明确失败；
- restore parent 在任何写入前解析并拒绝与应用、生产 Storage、备份根和附加 forbidden roots 重叠；
- 归档保留 Storage 所有权，并以真实 API systemd User/Group 验证恢复树可读和所有目录可写；
- 新增脚本行为测试，覆盖互斥锁、空间门、retention、原子完成、服务恢复、archive/SHA、路径穿越和禁止根。

仓库执行：

```text
npm run test:energyiq:backup
```

结果：26 tests，26 passed，0 failed，耗时 112601.917 ms。Build and Web Tests、Core Smoke Tests、
Docs 三项 PR CI 同样通过。另通过 `bash -n`、两个 Node `--check` 和 `git diff --check`。

### 8.1 修复版生产安装

安装时间：2026-08-24 23:37:51 Asia/Singapore。安装前重新核验既有文件 hash，均与本记录第 3 节
一致；Metadata `quick_check=ok`，`runningSourceSyncs=0`，`runningAgentRuns=0`，API active。
安装保留了 root-only 回滚副本：

```text
/var/backups/energyiq/tool-install-rollback-20260824T2340Z-af77341
```

该目录为 `root:root 0700`，不属于 `managed-daily` retention。修复版生产 hash：

```text
f484513c0816312d20aafa12358882042677fc6f000576c0a717a32475c2db77  /usr/local/libexec/energyiq/backup-shared-storage.sh
83d6c45dcd166acaeab2e6009997c12484bbf7a1da29c15918ca3211e5ae5984  /usr/local/libexec/energyiq/shared-storage-backup-preflight.mjs
af8d3f39cb4b2d337b211cf7b27b048c6df17a5fd623fab53f9ce6791ae38025  /usr/local/libexec/energyiq/verify-shared-storage-backup.mjs
76336752c7744a5457b5afc09c9a14440f9bcbca00b3fb8a347a0f4eab1a9d1e  /etc/systemd/system/energyiq-shared-storage-backup.service
38970cf9f850976f04652a0fe89fd7c8f10f9bbc2d93ca62b1491bf063916c05  /etc/systemd/system/energyiq-shared-storage-backup.timer
```

目标机 `systemd-analyze verify` 对本工具 unit 无告警；仍只有既有 `tat_agent.service` 和 snapd
兼容性告警。修复过程中没有修改业务 Release；核验时 production `current` 已由独立发布流程指向
`/opt/energyiq-datafoundry/releases/8e49f339ede5066900a869d4f323285514c4c6c7`，因此本节取代第 7 节中
关于 physical Release 仍为旧基线的时点性描述。

### 8.2 第二次生产备份

新完成目录：

```text
/var/backups/energyiq/managed-daily/backup-20260824T153911Z
```

- preflight：`metadataQuickCheck=ok`、source sync 0、Agent run 0；
- API stop：2026-08-24T15:39:11Z；snapshot complete：15:39:24Z，停写复制约 13 秒；
- source：2,554,226,094 bytes、1,398 files、owner `uid=1000 gid=1001 mode=775`；
- archive：186,714,758 bytes；SHA-256
  `94bd7e995953602f1946788719ed722ae62bf2328cd0bcc6a2740b4243ec36d5`；
- `sha256sum -c archive.sha256`：`storage.tar.zst: OK`；
- Metadata、Mastra SQLite、Ngee Ann/default、Preschool、Tuya Office DuckDB 及 WAL 均列入 inventory；
- 完成后 `.partial-backup-*` 为 0，旧备份 `backup-20260824T101846Z` 保留。

备份 service 最终 `Result=success`、`ExecMainStatus=0`。API 恢复为 active/ready；没有触发 Tuya
Provider、没有手动同步或修改业务数据。

### 8.3 修复版隔离恢复验证

对新备份使用必填的 production roots、真实 API service 和三个 expected Energy store，解包到
`/var/tmp/energyiq-restore-verify/energyiq-restore-verify-*` 并启用 `--cleanup`。结果：

- archive SHA 和恢复后的 1,398/1,398 文件 checksum 通过；
- 14 个 SQLite `integrity_check=ok`，其中 canonical Metadata 79 张表、Mastra 38 张表；
- `default`、`preschool-demo-org`、`tuya-office` 三个正式 Energy DuckDB 均可打开且关键表存在；
- 618 个 file assets 可枚举；
- 真实 API 身份 `ubuntu:ubuntu`（uid 1000、gid 1001）对恢复树 readable/writable 均 passed；
- verifier exit code 0；结束后 restore residue 0，未覆盖生产 Storage。

截至 2026-08-24 23:42:51 Asia/Singapore，timer 为 enabled/active，下一次触发为
2026-08-25 02:15:00 CST（UTC+08:00）。**本地自动备份与非破坏性恢复验证已形成新证据；异地主副本和
真实生产接管恢复演练仍未完成**，证据边界与第 7 节一致。

## 9. PR #153 第二轮安全复审修复

主 Agent 针对 exact head `67031e8e14ee2074dfdceecb4a6f6e80d1369dcb` 的
[第二轮复审](https://github.com/Zion74/energyiq-datafoundry/pull/153#issuecomment-5397973861)
确认原 6 项大部分已关闭，但又发现两个安全阻断项。仓库先合入最新 `origin/main`
`2fd4d37f923821676396472a0ddc39be5efd1dba`，随后以提交
`96237f809310345894e0444064c3632dc48132c9` 完成修复：

- `create` 和 `prune` 现在双向拒绝 backup root 与 app root 的任何父子 overlap；检查仍在
  `mkdir`、`chmod` 和 retention 枚举前完成；
- 新行为测试对 overlap 根的完整树指纹做前后比较，覆盖路径、类型、mode、owner 和文件 SHA；
- 失败 cleanup 改用 `systemctl restart`，随后强制检查 active 和同一个 ready endpoint；restart、active、
  ready 任一失败都会输出 `CRITICAL` 并保持失败退出；
- readiness 行为测试先让正常启动后的探针持续失败，只在 cleanup 真正 restart 后返回 ready；断言
  `starts=1`、`restarts=1` 且第二轮 readiness 确实成功。

TDD 红测实际复现了三个旧行为：`create` 把 overlap 根从 0755 改成 0700、`prune` 删除最旧的
managed backup、readiness cleanup 为 `starts=2/restarts=0` 且未再次探测 ready。修复后的最终命令：

```text
npm run test:energyiq:backup
```

结果：28 tests，28 passed，0 failed，耗时 84123.9689 ms。两个 Bash `-n`、两个 Node
`--check` 和 `git diff --check` 同样通过。

本轮没有改动生产安装、业务 Release 或既有备份：实际生产 `/var/backups/energyiq/managed-daily`
与 `/opt/energyiq-datafoundry` 不 overlap，已完成的本机备份及隔离恢复证据仍有效，也无需删除或回滚。
第二轮修复版等待主 Agent 对新 exact head 复审通过后，再进入生产已安装 payload 的后续更新边界。

## 10. PR #153 第三轮安全复审修复

主 Agent 针对 exact head `c01539e8420d26684883b46ad26fb9704689c14e` 的
[第三轮复审](https://github.com/Zion74/energyiq-datafoundry/pull/153#issuecomment-5398351068)
确认普通父目录 overlap 和 active-to-ready 恢复主体已关闭，但发现文件系统根路径、信号退出和持久
unready 行为测试仍有三个阻断项。仓库先合入最新 `origin/main`
`231e0ca726a6230ac6323371873a081b1882a9cd`，随后以提交
`861dd684aeb4d7576ce135e11b2e4bc6548fcdc9` 完成修复：

- `is_within_path` 明确定义 `/` 包含所有绝对路径；`create` 与 `prune` 共用同一个双向
  `require_disjoint_paths` 守卫，在任何写入或 retention 枚举前拒绝 `app-root=/` 等 broad/overlap
  组合；新测试对 backup tree 的路径、类型、mode、owner 和文件 SHA 做前后指纹比较；
- 仅 `EXIT` 执行 cleanup；`INT`、`TERM`、`HUP` 分别映射到 130、143、129 非零退出，再进入同一
  cleanup。trap 在首次 `mkdir`/`chmod` 前安装，信号失败会恢复 API、重新探测 ready 并删除 partial；
- 新行为测试让 API 在 restart 后仍持续 unready，断言脚本输出 `CRITICAL`、非零退出、确实执行第二轮
  readiness 探测、诚实保留 active-but-unready 结果，并清除 partial。

TDD 红测分别复现了旧行为：`prune --app-root /` 删除最旧 managed backup；真实 `SIGTERM`/`SIGHUP`
令脚本以 0 退出且留下 partial；持久 unready 场景在缺少对应 fixture 行为时错误发布完成备份。修复后的
最终命令：

```text
npm run test:energyiq:backup
```

结果：32 tests，32 passed，0 failed，耗时 115851.0147 ms。主脚本、行为 harness、`systemctl`/`curl`
fixture 的 Bash `-n`，两个 Node `--check` 和 `git diff --check` 同样通过。

本轮仍未安装或更新生产 payload，未触发浏览器、Provider、Tuya 同步或业务数据写入，也未改动或删除
既有备份。实际生产路径不属于本轮 root/overlap 复现，现有本地自动备份及隔离恢复证据继续有效；异地主
副本和真实生产接管恢复演练的未完成边界不变。

## 11. #150 clean checkout 与 Release Artifact follow-up

PR #153 已以 merge commit `bd650d3a907d07483c4d1a110d337fa06263f30a` 合入 main；Issue #150
因生产 payload、off-host 副本和真实接管恢复仍未完成而
[重新打开](https://github.com/Zion74/energyiq-datafoundry/issues/150#issuecomment-5398667371)。随后在独立
Windows worktree、系统 Git `core.autocrlf=true` 下发现两个仓库完成性缺口：

- Git blob 为 LF，但仓库没有 EOL attributes，fresh checkout 把 backup shell/harness 转为 CRLF；
  `npm run test:energyiq:backup` 为 5 passed / 27 failed，统一报 `pipefail\r`，直接
  `wsl bash -n scripts/energyiq/backup-shared-storage.sh` 也非零；
- DPL-01 Artifact 只包含 packager 与 deploy entry，未包含生产备份 Runbook 要求从 exact Release
  安装的 backup shell、preflight、verifier、systemd service 和 timer。

独立分支以 `bd650d3a907d07483c4d1a110d337fa06263f30a` 为 base，通过提交 `d59c8be`、`8c53cde`、
`e175860` 完成：

- `.gitattributes` 固定全部 `.sh`、EnergyIQ backup test fixtures 与 systemd units 为 LF；行为测试会
  clone 当前 HEAD、显式设置 `core.autocrlf=true` 并执行 clean checkout，再检查 8 个 Linux payload
  无 CR，且 6 个 Bash 文件全部通过 `bash -n`；
- Release Artifact 把上述 5 个 Runbook 安装源列为 required physical files，任一缺失、symlink 或
  非普通文件均复用既有 fail-closed 门；测试同时核对 verified tar 中的 exact bytes；
- 既有 deploy fixture 同步提供完整 required payload，公开测试入口覆盖 backup、Artifact 与 deploy，
  并接入 GitHub Core Smoke job。

TDD 证据：clean-checkout 新测试先 0/1；Artifact payload focused tests 先 0/6；deploy tests 在 builder
合同扩大后先 2/17。修复后从 exact commit 创建新的 detached checkout，仍使用系统
`core.autocrlf=true`，目标文件均为 `i/lf w/lf attr/text eol=lf`。最终执行：

```text
npm run test:energyiq:backup
```

结果：71 tests，71 passed，0 failed，耗时 108757.3329 ms。4 个相关 Node `--check`、最小 WSL
`bash -n`、`git diff --check`、`npm run smoke:docs`（157 files）和 `npm run docs:build` strict 同样通过。

本 follow-up 没有安装或更新生产 payload，没有运行浏览器、Provider、Tuya 同步或任何服务，也没有改动
生产数据或既有备份。生产 02:15 旧 payload 成功只证明旧安装仍在工作，不能证明新 Release Artifact
合同已安装；生产安装继续留在 merge 后的独立 Release 运维门，off-host 副本与真实接管恢复仍未完成。
