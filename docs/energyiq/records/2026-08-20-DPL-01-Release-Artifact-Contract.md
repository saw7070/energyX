---
title: "DPL-01 Release Artifact Contract"
summary: "定义由 clean Integration/CI 生成、可重复校验且不携带环境、数据或 secret 的 EnergyIQ 预构建 Release Artifact。"
doc_type: implementation
tags: [deployment, release, artifact, checksum, manifest]
updated_at: "2026-08-21"
related:
  - "2026-08-20-EnergyIQ快速发布Pipeline方案与决策请求.md"
status: implemented
---

# DPL-01 Release Artifact Contract

## 1. 边界

DPL-01 只建立 Build Host 输出合同，不上传或解压服务器文件，不切换
`current`，不重启服务，也不选择 production dependency 策略。DPL-02 只能消费通过本合同
验证的成品；dependency layer、CI、retention、Fast/Data gate 和生产验收仍是独立 Ticket。

构建入口是 exact clean Git checkout。Web release build 必须将
`ENERGYIQ_RELEASE_SHA` 设为当前 40 字符 Git SHA；
`apps/web/next.config.mjs` 随后把 Next `BUILD_ID` 固定为该 SHA。普通本地 Web build 未设置此变量时，
仍使用 Next 默认 BUILD_ID。

## 2. 输出

一次 pack 产生三个不可变同名 sidecar：

```text
energyiq-<SHA>.tar
energyiq-<SHA>.manifest.json
energyiq-<SHA>.sha256
```

Manifest 是 Artifact 的外部 sidecar，不放入被校验的 tar。原因是文件若在自身内部声明
最终文件的 SHA-256，会形成无法按普通 SHA-256 合同求解的自引用。外部 Manifest 才能记录
tar 的真实逐字节 `artifactSha256`；Manifest 内的完整 entry 清单同时逐文件约束 tar 内容。

Manifest v1 精确记录：

- `gitSha`；
- `packageLockHash`，并与 tar 内 `package-lock.json` 重新计算的 SHA-256 比对；
- `builtAt`，取 Git commit time 并归一化为 UTC；
- `nodeVersion`，取 Build Host 的完整 `process.version`；
- `metadataSchemaRevision`，从 metadata migration 顺序机器推导；
- `webBuildId`，必须等于 `gitSha`，并与 tar 内 `.next/BUILD_ID` 比对；
- `artifactSha256`；
- 按路径排序的 entry `path/sha256/size/mode` 清单。

Tar 写入规则固定为路径字节序排序、uid/gid 0、owner/group `root`、mode `0644`、
commit time mtime 和两个结尾 zero blocks。因此同一组预构建字节和输入身份会得到相同 Artifact。
Node 版本仍进入 Manifest；跨 Node/OS 的构建产物不能假装成同一次已验证构建。

## 3. 可运行文件如何确定

Packager 不维护一份会随代码漂移的完整手写文件白名单，而从当前构建事实推导：

1. 从根 `start:api` 和 `start:web` 的 `npm --prefix` 解析两个运行 workspace；
2. 从 workspace `package.json` 递归计算内部 production dependency closure；
3. 对 API 和内部 package 校验 `main` 后收集其 runtime `dist/` 与 package manifest；测试编译物、
   declaration 和 source map 不进入 Release；
4. 收集 API 启动 bootstrap 使用的完整 `packages/skills/builtin/` 物理资源树，包括所有 builtin
   Skill 的 `SKILL.md` 及同目录 package resources；
5. 对 Web 读取 `.next/required-server-files.json`、其中声明的 config/tsconfig 和 runtime files，
   同时收集 production `.next` 内容与 `public/`；
6. 排除 Next build cache、diagnostics、trace 和 generated types；
7. 写入 `.release-sha` 与 `RELEASE_SHA`，二者必须和 Manifest `gitSha` 一致。
8. 收入经过测试的 Artifact verifier/packager 与 deploy entry，使新的 `current` 仍能执行下一次
   prebuilt release；不依赖服务器上漂移的手工脚本副本；
9. 收入生产 Shared Storage 备份 Runbook 从 exact Release 安装的 shell、preflight、verifier、
   systemd service 和 timer；任一文件缺失、是 symlink 或不是普通文件时 pack fail closed。

`required-server-files.json` 中 Build Host 的绝对 `appDir`、tracing root 和 Turbopack root 会改写为
Release 相对路径；其他成品一旦仍包含 Build Host checkout 或 Build Host user profile 的绝对路径，
pack 直接失败。

Next `configFileName` 必须是 production-native `.js`、`.mjs` 或 `.cjs`。Artifact 拒绝
`next.config.ts`，避免 `next start` 在只安装 production dependencies 的 Release Host 上尝试安装
dev-only TypeScript 或访问 package registry。

这解决的是“文件闭包从真实 start/build manifest 推导”，并不宣称已经选择依赖交付方式。
Artifact v1 不含 `node_modules`。DPL-02/03 在依赖边界确定后仍须对解压成品做受控冷启动验收；
DPL-01 不以静态清单冒充冷启动证据。

API bootstrap 同时会尝试 provision DTC Growth demo datasource；其源是 `storage/fixtures/*.sqlite`，
缺失时只告警并跳过。它属于数据/Storage 而非不可变代码资源，继续受下述数据库禁入合同约束，
不因 builtin resource 修复而进入 Artifact。

## 4. 禁止内容与 fail-closed 行为

任何候选 runtime tree 中出现以下路径都会拒绝 pack：

- `.env` 或 `.env.*`；
- `storage/`、SQLite、DuckDB 或通用数据库文件；
- `outputs/`、`acceptance/`、截图、Playwright/test/coverage 输出或中文“验收”目录；
- `.pem`、`.key`、`.p12`、`.pfx`、credentials/password/secret 文件；
- `.git`、`node_modules` 或 symlink；
- Build Host checkout 或当前 Build Host user profile 的绝对路径。

缺少 API/package `main`、Next BUILD_ID、Next 声明的任一 runtime file，或 BUILD_ID 与 Git SHA
不一致时同样 fail closed。目标 Artifact/Manifest/checksum 已存在时拒绝覆盖。

## 5. Build Host 命令

PowerShell：

```powershell
$releaseSha = git rev-parse HEAD
if (git status --porcelain) { throw "Release checkout must be clean" }
$env:ENERGYIQ_RELEASE_SHA = $releaseSha
npm run build -- --force
npm run build:web
node scripts/energyiq/build-release-artifact.mjs `
  --source-dir (Get-Location).Path `
  --output-dir (Join-Path (Get-Location).Path "artifacts/energyiq-releases") `
  --git-sha $releaseSha
```

独立校验：

```powershell
node scripts/energyiq/build-release-artifact.mjs --verify `
  --artifact artifacts/energyiq-releases/energyiq-<SHA>.tar `
  --manifest artifacts/energyiq-releases/energyiq-<SHA>.manifest.json `
  --checksum artifacts/energyiq-releases/energyiq-<SHA>.sha256 `
  --expected-git-sha <SHA> `
  --expected-node-version (node --version)
```

测试入口：

```powershell
npm run test:energyiq:backup
```

该入口同时覆盖 clean checkout 的 Linux payload LF 合同、备份行为和 Release Artifact 的备份安装
payload 合同；CI 从全新 checkout 执行同一命令。

## 6. DPL-02 消费约束

DPL-02 在修改 Release Host 前必须先执行 sidecar 与 tar 验证，并额外比较 Release Host 的 exact
Node version。上传或校验失败不得修改 `current`。DPL-02 不能把 Manifest 字段当作自证声明：
lock hash、Web BUILD_ID、Git marker、entry hashes 和最终 Artifact hash都必须从收到的字节重新计算。
CLI 的 `--expected-git-sha` 与 `--expected-node-version` 是 DPL-02 pre-extract gate；任一不匹配都不得解压或切换。
