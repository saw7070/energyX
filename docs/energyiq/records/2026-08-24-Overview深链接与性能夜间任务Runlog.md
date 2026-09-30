---
title: "Overview 深链接恢复与生产性能夜间任务 Runlog"
summary: "记录 2026-08-24 生产验收暴露的跨 Workspace 深链接和首屏性能问题、执行顺序、测试 Seam、发布门与状态。"
doc_type: implementation
tags: [Overview, Workspace, 深链接, 性能, 生产验收]
updated_at: "2026-08-24"
status: accepted
related:
  - "GitHub #107"
  - "GitHub #108"
  - "GitHub #110"
  - "GitHub #102"
  - "GitHub #93"
  - "GitHub #35"
  - "GitHub #80"
---

# 目标

以生产不可变 Release `6950206f14cff11fbbb2c7c47e67c3a5cc8c5374` 为基线，优先关闭真实用户已经遇到的两项问题：

1. 当前 Workspace 与 URL 中 Project 不一致时，合法深链接不能自动恢复上下文。
2. Ngee Ann Overview 冷切换与 Admin Runs & Traces 首屏加载过慢。

本任务不改变 Tuya Office Overview 内容结构，不重新生成 AI Artifact，不扩展 Overview Designer，也不把普通 GET 变成 Provider 触发入口。

# 已验证生产基线

- Release：`6950206f14cff11fbbb2c7c47e67c3a5cc8c5374`
- Ngee Ann 从 Tuya Workspace 直接打开深链接：稳定显示 Project unavailable，手工切换 Workspace 后恢复。
- Ngee Ann 手工切换到 Overview Ready：约 22 秒。
- Runs & Traces 的 100 Run 列表：约 12 秒。
- 认证 HTTP 分解：Access Context 与 Harness Configuration 均约 `0.09–0.11 s`；AI Operations 100 Run 列表约 `4.41–4.75 s`、`56,545 bytes`。
- Ngee Ann 当前 Analysis Resolve 热路径约 `0.60–0.74 s`，但响应仍约 `1.72 MB`；未带精确 Snapshot pin 的 Overview AI 只读约 `3.18–3.51 s`。
- 普通 Overview/Admin 浏览前后：`496 Runs / 128 Overview AI Artifacts`，Provider Run 增量为 0。
- Charles 可访问 Ngee Ann、Preschool、Tuya Office；Ngee Ann 客户访问另外两个 Workspace 返回 403。

# 执行顺序

## Phase 1：#107 深链接上下文恢复

测试 Seam 固定为 EnergyIqAccessProvider 的用户可见路由行为和服务端授权边界：

- accessible Project 位于另一个授权 Workspace 时，只自动切换一次；
- 保留资源、时间、Snapshot、Release、比较参数和锚点；
- inaccessible Project 保持拒绝，不泄漏其他 Workspace/Project；
- 手工 Workspace 切换行为不回归；
- 不出现 unavailable 闪烁或导航循环。

红测通过前不写实现。完成后先提交、推送、PR 和合并，再进入 #108。

当前结果：两个新增场景与九个现有 Workspace/Project 导航回归均已通过。合法跨 Workspace Project 会在加载态内恢复；无权限目标保持原 Workspace，不改写 URL，不越权。

## Phase 2：#108 性能分解与最小修复

先建立生产等价计时，分别测量：

- access-context；
- analysis resolve 的 warm/cold 路径；
- Overview AI Artifact 读取；
- Harness Configuration；
- AI Operations Run 列表；
- 单个 exact Run detail；
- 浏览器 switch-to-ready 与 first meaningful content。

只修最大的已证实瓶颈。优先检查请求 waterfall、未并行的独立读取、Run 列表是否无界、Metadata N+1 和不必要的首屏渲染。不得通过删除 authoritative facts、Evidence、Snapshot pins 或 Run lineage 达成指标。

## 并行 Agent 所有权边界

Harness Agent 正在处理 Harness Evolution。本分支不得修改其独占范围：

- #102：Run Event v1、Project AI Operations 投影、相关 API/Web 测试；
- #103：`pi-ai` Provider Adapter 评估；
- #104：Prompt/Skill/Method/Context 盘点与提升准则；
- #105：Mastra/Pi 固定 parity spike 与 `HarnessRuntime` 候选边界。

因此 Runs 列表的代码不在本分支实现。生产计时和“首屏显式有界/分页、不得静默截断、精确 Run 按需读取、避免 N+1”的验收要求已交给 #102/#110 所有者；#108 继续只处理 Overview 深链接、Snapshot-bound AI 只读和不与 Harness Agent 冲突的前端/HTTP 性能。#103 与 #104 已获限界内继续授权；#105 Runtime parity 仍未授权启动。

## Phase 3：集成与发布

- 运行 Ticket 定向测试、EnergyIQ Seams、根构建和 Next 生产构建；
- 用 Charles 与 Ngee Ann 客户做权限回归；
- 普通 Overview/Admin 读取前后 Provider Run 增量必须为 0；
- 构建新的不可变 Release Artifact；
- 创建独立共享数据备份，原子切换，失败自动回滚；
- 生产浏览器复测深链接、Ngee Ann Ready、Runs 首屏和 Admin Harness truth。

# 发布门

只有以下条件全部满足才部署：

- #107 深链接红测转绿；
- #108 有可重复的基线与修复后数字，或明确记录未达到修复条件而不部署性能猜测；
- 目标 Worktree 干净且提交精确；
- 当前生产 SHA 与回滚 Release、备份仍可用；
- 多账户、零 Provider、API/Web readiness 通过。

# 磁盘策略

生产当前约剩余 13 GB。今晚先审计 Release 和备份占用；仅删除同时满足“不是 current、不是立即回滚点、存在独立备份、路径位于明确 releases/backups 根目录”的旧对象。任何不满足条件的对象保留。

# 生产发布与验收结果

- PR `#109` 以 merge commit `d496d2aeb4c8185cad5a55f307ee5775a84fb9af` 合入 `main`，GitHub Build/Web、Core Smoke 和 Docs 三项 CI 全绿。
- PR `#113` 以 merge commit `02da47166828fcb4b9956c268787f8b1dfeb53d8` 合入 `main`，增加 exact Snapshot/Release/period 的跨进程持久化投影缓存；访问授权仍在缓存读取前重新检查，手工刷新会绕过并替换缓存。
- 当前发布 Artifact 由 Node `v22.23.2` 构建，Artifact SHA256 为 `0ce46f9fc1026d3a44c83b81ee206e630d1b48e5f18583d95520fd54f2e6e76b`。
- 生产 `current` 已原子切换到 `releases/02da47166828fcb4b9956c268787f8b1dfeb53d8`；API、Web、Nginx、HTTPS Login、Ngee Ann 和 Preschool smoke 均通过。
- 发布前共享数据备份为 `/var/backups/energyiq/pre-02da471-20260823T191427Z/storage.tar.zst`，SHA256 为 `a0e2e3d5f7560a35c7d588417a1c801287e4c48636af713a9343d400eeb28c03`。
- 从已登录的 Tuya Office Workspace 直接打开精确 Ngee Ann URL，浏览器全程未渲染 `Requested Project is unavailable`；查询参数、Snapshot 和 Release pins 均保持。
- 首次写入缓存的 Materialization：页面 Ready `16.504 s`、analysis resolve `12.984 s`、Overview AI Artifact `192 ms`。
- API 进程重启后的真实跨进程冷恢复：页面 Ready `2.305 s`、analysis resolve `580 ms`；随后热刷新页面 Ready `2.329 s`、analysis resolve `529 ms`。分别达到 #108 的冷加载 `<= 8 s` 与热加载 `<= 3 s` 门槛。
- 缓存实体约 `3.0 MB`，权限为 `0600`；精确 identity/revision、损坏、过期或不匹配均按 miss 处理，不允许跨 Snapshot/Release 复用。
- Charles 三个 Workspace 均返回 200；Ngee Ann 客户只能访问 Ngee Ann，Preschool 和 Tuya Office 均返回 403。
- 普通 Overview/Admin 读取前后 Run 基线保持 `496 / latest 2026-08-21T17:23:44.448Z`，Provider Run 增量为 0。
- AI Operations 首屏仍为 `10.162 s / 56,545 bytes / 496 Runs`。根因是无界 Project Run 枚举后逐 Run 读取 events 与 artifacts 的 N+1；该项已作为 #102/#110 的合并阻塞交给 Harness 所有者。
- 发布后磁盘剩余约 `6.5 GB`。旧 Release 与备份属于回滚证据，在形成并验证保留策略前不做临时批量删除。

## Runs & Traces 最终发布验收

- PR `#110` 经四路独立审核和 RED→GREEN 修订后，以 merge commit `9c46a97f1170173771cb341f3bacac8d468b7a32` 合入 `main`。最终 GitHub Build/Web、Core Smoke 和 Docs 均通过；CI 仅作为证据，不描述为 GitHub required gate。
- 最终修复保持 20-Run keyset 首屏、按需 exact Run detail 和 Load older 分页；同 Project 相同 `runId` 的 Run detail 与 EnergyIQ Artifact lineage 以 `actorId + runId` 选择 Run，并以 `triggered_by + session_id + run_id` fail closed，避免跨 actor 串线。
- 生产继续只保存 hash-only Provider-boundary request identity；历史 Run 没有 request snapshot 时明确显示 unavailable，未把当前配置或 raw Prompt 冒充历史证据。可重建 raw payload 仍属于 #102 的后续 invariant，不由本次发布声称完成。
- `0040_model_request_payload_retention` 以 `BEGIN IMMEDIATE` 原子完成 check/run/record。相同并发测试下，旧 autocommit 路径 audit=`2`（RED），原子路径 audit=`1`（GREEN）；Node `v22.23.2` clean detached worktree 连续三次并发门通过。
- 主 Agent 在 exact head 上独立运行 10 files / 28 tests 全绿；496 Run 的本地 authenticated HTTP 首屏返回 20 rows、`15.1 ms / 8,266 bytes`。
- 新不可变 Artifact SHA256 为 `96cfb3bc24401503ac5cffdb904ce5f44a0de5ea6b2d10ffd485ab1c819810da`；生产 `current` 已原子切换到 `releases/9c46a97f1170173771cb341f3bacac8d468b7a32`，API、Web、Ngee Ann 与 Preschool smoke 通过，deploy lock 已释放。
- 发布前停止 API 写入后创建一致性备份 `/var/backups/energyiq/pre-9c46a97-20260823T212415Z/storage.tar.zst`，SHA256 为 `8a9bd65c20a036127281b8368f6583747aa49dd3a49da1a16dcb4d4026f389ba`。
- 生产浏览器首次页面：20 Runs，20 个 View trace，Load older 可用；首屏 `1.183 s / 0.674 s`，API 冷进程重启后 `0.893 s`。打开首条 detail 约 `0.602 s`；加载下一页约 `0.668 s`，得到 40 个唯一 Run identity，无重复。
- 首条历史 identity 仍为 Run `ngee-ann-additional-ai-insights-c5228364-d96e-4474-b420-3aa7d41e2f06`、Session `ngee-ann-additional-ai-insights-0a5fd8d2-29f0-461b-9fbb-9559af3bfb9a`、Actor `86250389-a813-41dc-ac40-067b8104a779`；detail 显示 persisted Context、Tool、Token 与 Artifact evidence，缺失 request snapshot 如实 unavailable。
- 发布后的第一次 Preschool 打开出现过一次约 `19.0 s` 的不可重复冷启动；没有据此冒充稳定性能。随后跨 Workspace Ngee Ann / Preschool 为 `2.269 s / 1.978 s`，API 明确重启后的冷进程恢复为 `2.376 s / 1.975 s`，两者均无 Project/Snapshot unavailable；Preschool 热刷新 `1.419–1.568 s`。
- Charles 生产登录为 admin，可遍历 3 个 Workspace 并读取 Ngee Ann、Preschool、Tuya Office 的 published template（均 200）；Ngee Ann Client 01 仅见 Ngee Ann，自有 published template 为 200，Preschool 与 Tuya Office 均为 403。
- 所有 Overview、Admin、分页、detail 与多账户只读验收前后，Run 基线保持 `496 / latest 2026-08-21T17:23:44.448Z`，Provider Run 增量为 0；`model_request_snapshots=0`，证明本次普通读取没有伪造新的 Provider-boundary evidence。
- 发布后服务器剩余约 `4.5 GB`。当前 Release、直接回滚点和一致性备份均保留；未为了短期腾空间批量删除生产回滚证据。

# Stage 4 / Stage 5 启动路线

这里统一使用产品阶段含义，避免和旧文档中的 MVP `M4/M5` 混淆：

- **Stage 4：受控视觉表达与 Finding Canvas**，对应 #35。目标是在稳定数据/Evidence 底座上增加可复跑的组合与视觉表达，不允许模型把任意 HTML/JS 直接注入带登录态的主页面。
- **Stage 5：内部 Overview Designer**，以 #80 的 `Overview Definition Revision`、Catalog、编译器和固定 Snapshot Preview 为底座。Agent 先修改 Definition，而不是 React、SQL 或 Provider 生命周期。

启动门如下：

1. #107 与 #108 的 Overview 用户路径已经达到生产门；Runs & Traces 的有界首屏与 N+1 修复仍是当前发布稳定门，由 #102/#110 所有者完成。
2. Stage 4 的 Definition/红测/最小纵切设计现在即可在不触碰 Harness 文件的独立 Seam 并行启动；其生产发布不得绕过上述 Runs 稳定门。最小纵切为：一个现有 Ngee Ann/Preschool Finding 在 Native Canvas 中选择受控 composition、presentation intent 和 Evidence placement，并能在新 Snapshot 上复跑。
3. 当 #80 打通 `Definition → validate → fixed-Snapshot preview → semantic diff → manual publish → rollback` 后，Stage 5 内部版即可与 Stage 4 后半段并行；不等待 Tuya Overview 内容定稿。
4. Stage 5 第一版只服务内部交付与 Charles 售前：自然语言修改一版、继续迭代、人工发布。多版本自动生成和客户自助编辑后置到 Pilot 证据出现以后。

预计以专注开发日计算：Stage 4 最小纵切约 `2–4` 天；Stage 5 内部可用 MVP 在其底座稳定后约 `5–8` 天。以上是工程估算，不是发布日期承诺；是否进入下一门以固定 Snapshot 预览、数据更新复跑、Diff/回滚和人工验收证据为准。

# 状态

- [x] 生产基线和问题复现
- [x] 创建 #107 与 #108
- [x] #107 红测
- [x] #107 实现与定向回归
- [x] #107 实现、PR、合并与生产浏览器验收
- [x] #108 生产 HTTP 性能分解
- [x] #102–#105 所有权冲突检查与 Runs 性能交接
- [x] #108 跨进程投影缓存、PR、合并与生产计时
- [x] 不可变 Release、多账户、zero-Provider 与生产浏览器验收
- [x] #108 Overview 冷/热加载目标关闭
- [x] #108 剩余：Runs & Traces 显式有界/分页、消除首屏 N+1 并达到 `<= 3 s`
