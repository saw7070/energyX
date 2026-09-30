---
title: "Managed Overview 不可变投影与冷加载性能 Tracer 实施记录"
summary: "把确定性 Overview 从用户读取时计算改为 exact identity 变化后预物化，并记录 Issue #172 的实现、证据与未完成边界。"
doc_type: implementation
tags: [Overview, Performance, Materialization, Snapshot, Cache]
updated_at: "2026-08-27"
related:
  - "../CONTEXT.md"
  - "2026-08-25-Current-Overview-Minimum恢复与身份门实施记录.md"
status: in-review
---

# Managed Overview 不可变投影与冷加载性能 Tracer 实施记录

## 1. 问题与结论

生产 Release `197f1d8...` 的一次强制冷加载从 `08:17:58` 开始，`overview-minimum` 约在
`08:18:06` 返回 1,325 B，完整 `analysis/resolve` 约在 `08:18:39` 返回 73,430 B，页面完整约需
44.9 秒；相同 exact identity 的热加载约 3.6 秒。普通 Overview 读取没有 Provider 调用，瓶颈是
读取时执行完整 DuckDB 分析、Preschool planning 和 operational projections，不是 AI。

因此 Issue [#172](https://github.com/Zion74/energyiq-datafoundry/issues/172) 不把
`minimum → full` 串行或增加 DuckDB 并发作为主方案。根方案是：

```text
Snapshot candidate / Project publish
  → 解析 exact Managed Overview identity
  → 复用 ProjectAnalysisResolver 计算一次
  → 写入并复读校验 immutable projection
  → 重新确认 candidate identity 没有过期
  → 原子切换 Project current Overview pointer
  → 普通 GET 只读 projection
```

这与领域中的 Managed Overview 定义一致：页面是持续物化的已发布报告，不是每次打开都重新执行的
临时 BI 查询。

## 2. 单一 Store 与 exact identity

本切片深化已有 `ProjectAnalysisResultCache`，没有新建平行 Store 或第二套计算逻辑：

- 原有带 TTL 的 read-through cache 继续服务非 Managed 查询；
- Managed projection 使用独立、无 TTL 的 immutable 文件；
- current pointer 与 projection 位于同一 shared-storage 目录，均使用 temporary file + atomic rename；
- 原 read-through LRU prune 只允许删除 64-hex cache 文件，不能删除 `managed-*` 或 `current-*`；
- 同一 projection identity 的并发 materialization 共用一个 in-flight promise；
- projection 写入、复读和完整 identity 校验成功后才能切 pointer；
- current pointer 的 compare-and-switch 在进程间排他锁内完成；candidate 在计算期间过期时返回
  `ENERGYIQ_OVERVIEW_PROJECTION_STALE`，旧 pointer 保持不变；
- projection 与 pointer 写入在 rename 前 fsync 文件；Linux Release Host 还会 fsync 所在目录；
- pointer lock 持久化 PID / 创建时间；进程崩溃留下的过期死锁可在确认 owner 已不存在后原子隔离并恢复；
- 普通读取在权限校验后直接读取已发布 pointer，并校验其完整 identity、payload 与当前 resolver / 事实库边界；
  新 candidate 失败时不会因为 Project 已指向 B 而遮蔽仍可用的 pointer A。

actor-free identity 在完成权限校验之后建立，至少包含：

- Workspace、Project、Scope、Resource 与自然月 Report Window；
- Data Snapshot、Project Release、Report-Time Policy；
- Hierarchy、Meter Mapping、Meter Formula；
- Calendar、Tariff、Metric、Rule；
- Overview Definition fingerprint、Renderer、Recipe；
- resolver revision 与事实库绝对路径。

同一 exact identity 对 Charles、管理员或其他已授权用户只保存一份结果；`userId` 不进入 Managed
projection key。权限仍在读取 projection 之前由服务端校验。

## 3. 触发与读取

当前 tracer 已接入以下发布成功路径：

1. Excel/Tuya Import Batch materialization 产生新的 Snapshot candidate 后；
2. Project Setup / Template publish 产生新的 Project Release 后；
3. Tuya 手动或定时同步的 Fact materialization 后、Source Sync 标记成功前；
4. 管理员可调用 `POST /api/v1/energy/projects/:projectId/overview-projection` 做显式 deterministic
   Recompute 或同身份损坏修复。

Release 切流前另有显式、鉴权的批量核验入口：

```http
POST /api/v1/energy/admin/overview-projections/prewarm
```

它只接受已通过 `resolveEnergyAccessContext` 验证的管理员，并且只读取请求中**显式选中的 active
Workspace** 内的 Published Project；普通 admin 不获得跨 Workspace 的 Platform Operator 能力。部署方必须
对发布清单中的每个授权 Workspace 分别调用，全部成功才可切流。该路由使用 `rolePersistence=read-only`
鉴权，缺失/陈旧的持久化 role 不会在 gate 内被自动写回。它不会在 API startup 或普通 GET 内执行，也不会补跑 DuckDB /
`ProjectAnalysis`；只允许用完整 current identity（根 Scope、主 Report Window、Snapshot、Release、全部
revision、renderer/recipe 和数据库身份）恢复已经存在且校验通过的 immutable projection pointer。任一配置了
Overview 的 Published Project 缺少 exact immutable payload、校验失败或无法恢复时，整个 release gate 返回
`409 ENERGYIQ_PUBLISHED_OVERVIEW_PREWARM_NOT_READY`，部署不得切换 `current`。

自动触发器在 identity 没有变化时是 strict no-op：不执行 full compute，也不重复写 pointer。管理员显式
Recompute 会绕过 read-through cache 真正重算；事实相同则保留原不可变文件，事实不一致则以
`ENERGYIQ_OVERVIEW_PROJECTION_NONDETERMINISTIC` fail closed，损坏的同身份文件只能通过该显式操作修复。数据不足以形成
Current Overview 时，Import/Scheduler 可以诚实完成数据接入，但不切换 Overview pointer；管理员预热接口
仍会返回明确错误，便于运维发现问题。

普通 Web `current-project-overview` 改读：

```http
GET /api/v1/energy/projects/:projectId/overview-projection
```

可选本地日期范围、Snapshot / Release pin 不一致时 fail closed。缺少已发布 projection 返回 409
`ENERGYIQ_OVERVIEW_PROJECTION_NOT_MATERIALIZED`，不会退回 read-time full compute。响应为
`private, no-store`；浏览器只收到一次 compact Overview read model 和轻量 context reference，不重复传输
完整 Snapshot。

`GET /projects/:projectId/overview-minimum` 也从**同一个 current pointer** 的 projection 派生 headline，
不再单独查询 DuckDB。这样 candidate Snapshot 计算失败时，minimum 和 full 都继续指向旧的已验证
Overview；不会出现“首屏是新 Snapshot、完整报告是旧 Snapshot”的混合版本。

## 4. OverviewContextPackage

服务端 materialization/read Interface 同时产出 `energyiq-overview-context-package@1`：

- actor-free exact identity；
- 已物化的确定性 ProjectAnalysisSnapshot；
- Evidence refs。

这个 Package 已被 Ngee Ann / Preschool 的 Overview AI workflow、页面级 AI workflow 和 Additional Insight
Evidence Catalog 直接读取，取消这些路径原先的 `bypassCache` full compute。浏览器 Overview 响应只返回
identity/evidence reference，避免把同一 Snapshot 发送两遍。Overview AI Artifact 的 queue 与 current identity
解析也改为读取该 Package，不再从旁路调用 full `resolveProjectAnalysis`。

Package 与持久化 projection 均排除 Saved Analysis / Planning 等可变 lifecycle；普通 GET 不再为了补 lifecycle
执行 DuckDB 或改写 cache。Web 在 immutable Overview 完整渲染后，才通过
`GET /projects/:projectId/overview-lifecycle?expectedProjectionRef=...` 异步读取 lifecycle。该接口先授权并校验
完整 projection ref，错误 ref 在 targeted SQL 前返回 409；返回值携带 `projectionRef`、`observedAt` 和 Saved
input fingerprint。浏览器仅合并仍与当前 projection ref 相同且请求代际最新的结果，失败不会清空或阻塞
Overview；用户 Refresh 只有在新 immutable full 被接受后才重新读取 lifecycle。Ngee Ann / Preschool 的 AI
section workflow 通过统一的 lifecycle-aware Snapshot reader 复用同一 targeted seam；主 projection/minimum
接口仍不调用它。

通用 AI Analysis 对话的 `all-available` 范围可能宽于 current Overview（例如 Preschool 61 天对 30 天），
因此本切片没有把较窄的 Overview Package 冒充为对话的完整上下文。后续必须按 AI Analysis 自己的 exact
all-available identity 物化独立 `AnalysisContextPackage`，或者只在问题超出 Overview Package 时执行 targeted
read-only query；不得继续把 full `resolveProjectAnalysis` 作为每条消息的固定前置步骤。

## 5. TDD 与本地证据

RED 曾证明：

- 没有 durable materialize/read Interface；
- 相同 identity 并发会重复计算；
- read-through prune 会删除 Managed projection/pointer；
- stale candidate 可以在计算完成后覆盖 current；
- Project 已指向失败 candidate B 时，GET 会把仍可用的 pointer A 错判为 unavailable；
- 进程崩溃遗留 `.lock` 会永久阻断后续 materialization；
- 进程在 lock owner JSON 落盘前崩溃会留下空/半写锁，多个 recovery 竞争者可能错误处理新锁；
- 管理员 Recompute 被同身份 fast path 吞掉，且损坏同身份文件无法修复；
- 自动 materialization 与管理员 Recompute 可对同一 identity 并发执行并覆盖同一不可变文件；
- 两个 API 进程可对同一 identity 同时 full compute，且强制重算可能覆盖不同结果；
- stale `.recovery` lock 自身无法恢复，会把 publication 再次永久阻断；
- 持久化 JSON 的 summary/finding 等值即使被篡改，旧校验仍可能只凭 identity 关系接受；
- 并列峰值使用浮点 `ARG_MAX`，同一事实重算可能随机选择不同 `peakAt`；
- Web 仍对 current Overview POST full `analysis/resolve`；
- API read/prewarm route 与 Tuya post-materialization hook 不存在；
- read route 重复序列化一次完整 Snapshot。

当前 GREEN 证据（Node `v22.23.2`，单 Worker；均为本地自动化，不是浏览器或生产证据）：

- `project-analysis-result-cache.test.ts`：59/59，含 compare-and-switch、空/半写残锁与 recovery lock 恢复、
  同 identity 独立 cache 实例自动与强制重算串行化、payload SHA-256 完整性、nondeterminism guard 与同身份损坏修复；
- `project-analysis-resolver-cache.test.ts`：4/4，含 actor-free materialization、授权读取时 actor rebind、process-restart、
  失败 candidate 保留旧 pointer、普通读取 0 SQL/0 Metadata mutation、深层 payload shape、exact-ref targeted lifecycle、
  自然日 pin 和动态 Saved lifecycle；
- `energy-scoped-datasource.test.ts`：12/12，peak 数值与确定性最早时刻共用 9 位 canonical 精度；
- `energy-api-analysis-cache.test.ts`：12/12，含显式 active-Workspace release prewarm 的 admin 拒绝、
  `not_ready` release 阻断与 ready response；普通 member 只允许以 canonical `project / electricity`
  身份读取 current Overview，crafted child Scope / water 请求在 compute、Provider 与 Metadata mutation 前 fail closed；
- `published-project-overview-prewarm.test.ts`：2/2，证明 non-admin 在枚举前拒绝，admin 只核验显式 active
  Workspace 内的全部 configured Published Projects，跨 Workspace Project 不被读取，且 0 full SQL / 0 Metadata mutation；
- `project-analysis-resolver.test.ts` 的 Ngee pointer recovery + Ngee current reuse 两条真实 fixture named gate：
  exact full identity 才能恢复 pointer，错误 Scope 的唯一 immutable candidate 保持 `not_ready`；恢复后的 full/minimum
  endpoint 身份一致且 0 SQL / 0 Provider / 0 Metadata mutation；
- `server.overview-ai-stage.test.ts`：32/32，其中真实 Preschool Section stage 在消费 external immutable
  `OverviewContextPackage` 时为 0 Snapshot read session、0 full SQL，同时保留问题所需的 targeted
  `analysisContractGrounder`；
- lifecycle 并发回归证明同一请求只读取一次 Saved Analysis 权威状态；即使另一条 Saved lifecycle 在读取期间发布，
  fingerprint 与 hydration 仍来自同一版本，不再产生 A/B 混合；
- Preschool authenticated minimum HTTP：1/1，已发布 projection 的 read-side 两次为 33.7–38.3 ms、4,526 B、
  0 full SQL、0 Provider、0 mutation；
- Overview materialization-before-AI publish seams：targeted 3/3；
- Tuya runner post-materialization seam：targeted 1/1；
- Tuya Import API regression：targeted 1/1；
- Web config client：6/6；Dashboard：80/80；
- 最新 `main@2877743c` 选择性重放后的最终关键组合：4 files / 103 tests；
- 最终 resolver / role focused：3 files / 31 tests；
- EnergyIQ 三层组合 seams：7 files / 140 tests；
- API、Data Gateway 与 root TypeScript build：PASS；
- Web production build：17/17 static pages；
- docs link smoke：172 files；MkDocs strict：PASS；
- `git diff --check`：PASS。

历次独立复审提出的 stale pointer TOCTOU、compare-and-switch、failed-candidate availability、完整 payload
integrity/深层 shape、actor-free persisted projection、mutable Saved lifecycle targeted seam、crash/recovery lock、
同 identity 独立 cache 实例并发、live-owner recovery-lock storm、显式 Recompute、普通成员与浏览器 bypass、
read-side 角色写入、旧 pin read-time recompute、旧 minimum SQL 旁路、Overview AI 旁路 full compute、
Saved lifecycle 双读竞态、同身份损坏自动修复和深层 Report-Time / Decision Priority payload 接受漏洞已完成 TDD 修订；当前修订仍需 fresh Standards + Spec
双轴复审和远端 CI，不能把本地 GREEN 升级为 merge 或部署证据。

## 6. 边界与后续

本切片没有启动共享服务、没有浏览器验收、没有 Provider 调用、没有部署、没有改生产 current pointer。
正式发布还需要：

1. 在新 Release 切流前，对现有 Ngee Ann、Preschool 和 Tuya current identity 执行管理员 prewarm；
2. 验证 prewarm 的 projection 文件、pointer、Snapshot/Release pin 与 0 Provider；
3. 切流后用 Charles/admin 做冷加载与多账户读取，目标是 full Overview 不再出现 30–45 秒 full compute；
4. 建立 Managed projection 的历史保留/容量策略，只清理确认未被 current 或 Saved evidence 引用的文件；
5. 为通用 AI Analysis 物化与其 all-available exact identity 一致的 `AnalysisContextPackage`；Overview Package
   可作为已验证子集，只有包外问题才执行 targeted query；
6. 将确定性 projection readiness 与 AI Artifact readiness 分开展示，AI 失败不能回滚正确的确定性 Overview。

API 进程启动只负责自身 health/readiness，不自动扫描所有客户 Workspace，也不把缺失 projection 隐藏成启动时
full compute。首次引入本批量门的 Release 可先使用已经存在的单 Project 管理员 Recompute 入口生成 immutable
payload，再调用批量入口核对；后续 Release 一律以批量入口的 `ready` 结果作为切流前证据。

单独的 fallback commit 只把普通 `Refresh` 与管理员 `Recompute overview` 分开；它不替代本物化方案，
也不应被当成 44.9 秒瓶颈已根治的证据。
