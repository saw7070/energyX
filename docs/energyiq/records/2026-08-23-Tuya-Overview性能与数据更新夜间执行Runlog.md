---
title: "2026-08-23 夜间执行记录：Tuya、Overview 性能与数据更新"
summary: "在隔离集成线收口 Tuya Office 安全接入，随后合入 Overview 载荷优化并建立统一数据更新验收门。"
doc_type: runlog
tags: [Tuya, Overview, performance, data-update]
updated_at: "2026-08-23"
related:
  - "../plans/2026-08-23-Tuya-Office-Source-Connector运行手册.md"
  - "../decisions/2026-08-19-Project通用Report-Time-Context与Overview复用决策.md"
---

## 1. 目标与范围

夜间关键路径按以下顺序执行：

1. 在干净 Worker Worktree 收口 Tuya Office server-owned Connector、自然月至今同步、幂等与关闭恢复；
2. 精准提交 Tuya 增量并完成 Spec/Standards 复审；
3. 合入 #93 Overview 公共 Read Model 载荷压缩；
4. 建立统一“数据更新”门，验证 Previous → Current 的 Snapshot、指标、页面与 AI Artifact 隔离；
5. 仅在受保护配置存在时运行真实 Singapore Provider，同步后再做浏览器、多账户和部署判断。

不在本次 scope：Preschool 改为自然月（GitHub #94）；Tuya 的新 AI Workflow；把长历史回填一次性塞进单个内存任务；无配置时伪造真实 Provider 证据。

## 2. 代码改动

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| Tuya OpenAPI Client | complete locally | 签名、Token 合并刷新、timeout 覆盖响应正文、分页、首错取消并 drain sibling requests；Artifact 不持久化 Device ID。 |
| Project Connector | complete locally | Device Binding 只来自受保护配置；绑定 exact Published hierarchy revision，并用 fingerprint 参与幂等。 |
| Source Sync | complete locally | 首次窗口为新加坡自然月至最新完整日；保留 Current Snapshot sources；旧窗口从该 Run Snapshot 恢复 manifest；Store 深层校验 Workspace/Project/Batch/Snapshot/manifest。 |
| Scheduler/Lifecycle | complete locally | 每次 Run 重新解析 Published Connector；旧 revision 在 Provider 前失败；进程关闭等待 scheduler、Metadata 与 Runtime drain。 |
| Overview #93 | complete locally | 已精准合入 RED/GREEN 两提交。公共载荷只内联 4 条 triggered anomaly detail，其他 detail 可 exact on-demand 获取。 |
| Unified data update | automated gate passed | 真实 Ngee Ann Excel 完成 Previous → Current Snapshot；What Changed 与普通读取零 Provider 门通过。Tuya AI Adapter、人工价值与浏览器验收仍是独立门。 |
| Real Tuya Provider | complete in production | 20 路受保护 Binding 已迁入服务器私有 Environment；Singapore OpenAPI 同步成功并形成 Import Batch 与 Current Snapshot；代码、Release 与日志均未输出或提交 Device ID/Secret。 |
| Tuya cold bootstrap | complete locally | 首次同步后若项目尚无 Template Revision，Bootstrap 会只为 Tuya 从 exact Published mapping 创建初始 Template 并挂接通用 Overview；Preschool/Ngee Ann 的既有发布身份不受影响。 |
| Production release | deployed | 不可变 Release `0c9c67d6f34166c87fac16420364918993f735cb` 已原子切换；API/Web active，`/healthz` 200，公开登录页 200，部署后日志无 error/fatal。 |
| Browser acceptance | production pass for current account model | Ngee Ann 普通账户生产回归通过且访问 Tuya 被拒绝；Charles Admin 可见 3 个 Published Project，并在切换 Workspace 后进入 Tuya、Ngee Ann、Preschool。按 2026-08-23 用户决策，不创建 Tuya-only 账户；Tuya 由现有管理员使用。 |

## 3. 验证证据

当前集成 Worker 已通过：

```text
npx vitest run <Tuya/API/Metadata 12 files> --maxWorkers=2
12 files / 62 tests passed

npx vitest run <Web/Data Gateway 4 files> --maxWorkers=2
4 files / 37 tests passed

npm run test:energyiq:seams
7 files / 107 tests passed

npm run build
passed

npm run build:web
Next production build passed; 17 pages generated
```

#93 合入后回归：4 files / 45 tests 通过；真实 retained fixture 为 `3,038,397 B → 1,645,469 B`，下降 `45.84%`；57 rows 中只内联 4 条 triggered detail，关键业务值保持不变。

统一“数据更新”门：

```text
真实 Ngee Ann Excel：Previous through 19 Aug → Current through 20 Aug
1 focused acceptance passed（108.9s）

What Changed：3 files / 24 tests passed
普通 Overview、刷新、筛选、Evidence 展开零 Provider：3 files / 88 tests passed
```

真实 Tuya Provider 门：

```text
energy-tuya-real-provider.acceptance.test.ts
1 test passed；20 路受保护 Binding；Singapore OpenAPI → Import Batch → Snapshot
```

冷启动与浏览器门：

```text
energy-bootstrap.test.ts + project-analysis-resolver.test.ts
2 files / 17 tests passed；Tuya 初始 Template 自动发布，Preschool legacy identity 保持不变

本地隔离 Overview
Tuya Office；1 Aug 2026–21 Aug 2026；data available 18 Aug–22 Aug
17 usable Meter Points；3 need history；0 no readings；console 0 error/warning
What changed? 无上一版时诚实提示，不启动 Provider
```

生产发布与真实同步证据：

```text
deployed SHA: 0c9c67d6f34166c87fac16420364918993f735cb
release artifact SHA-256: 644053ff729def70d909596d73bc6d21b6e8f38be23f30def8d45b1d2873ba24
API/Web systemd: active / active
GET 127.0.0.1:8787/healthz: 200
public /login: 200
Tuya scheduler: succeeded
Current Snapshot: energy-snapshot-5b7818ea412b05382ca4dc37
```

生产账户与浏览器证据：

```text
Ngee Ann 普通账户：Ngee Ann Overview ready；Tuya 跨 Project 拒绝
Charles Admin：Admin 可见 3/3 Published Projects
Tuya Workspace：Overview ready；约 4 秒；1–21 Aug；Snapshot 5b7818...
Tuya data health：24.7% coverage；17 usable；3 need history；0 no readings
Preschool Workspace：确定性 Overview 约 35 秒；AI Key Findings 随后恢复；Reviewed 4/4 Sections
```

证据边界：生产 Release、真实 Tuya Provider 同步、当前多账户模型、跨 Project 拒绝和 Charles Admin 浏览器验收已通过。Tuya 当前没有正式 AI Adapter，因此不能宣称 Tuya AI 内容价值或 AI 数据更新已经关闭；确定性 Overview 和同步成功不能替代该门。

## 4. 问题与取舍

- 真实 Tuya 配置属于服务器保护信息：代码、文档、Artifact 和测试均不得出现客户 Device ID 或 Secret。
- 普通 Overview 性能先减少序列化/传输/解析成本；14.8 秒冷确定性计算是后续独立性能切片，不能把载荷优化冒充计算优化。
- 普通手动/历史 backfill 尚需有界 chunk/job 设计；当前不接受无上限窗口作为正式运维方式。
- Tuya 通用 Template 当前没有 AI Workflow，因此统一数据更新门先验证确定性 Overview 和 Artifact 身份；AI 数据域更新要等正式 AI Adapter 后单独关闭。
- 受保护 Device Binding 已迁入服务器私有 Environment，并由运行时映射到当前通用 Meter Point；它不在 Git、Release Artifact 或公开日志中。
- 首次浏览器验收暴露并关闭了一个冷启动问题：同步可形成 Snapshot，但没有 Template Revision 时页面会显示 Project analysis not configured。修复严格限定 Tuya，避免改变 Preschool 的 legacy release identity。
- 生产磁盘当前约 59GB 总量、14GB 可用；Releases 约 8.8GB，受保护发布前备份约 4.8GB。当前仍可运行，但后续应按“保留当前、上一版和必要回滚点”的策略审计清理，不能直接批量删除。
- Admin 的 Project 可见性是全局的，但 Overview 读取仍受 active Workspace 约束。当前需要先切换顶部 Workspace；若 Admin 项目入口不携带或切换目标 Workspace，用户会短暂看到 `Requested Project is unavailable`。应从 Workspace-aware navigation 根治，不应放宽数据隔离。

## 5. 复现与排查

- 工作目录：隔离的 `tuya-office-integration` Worktree
- 分支：`codex/89-tuya-office-api-integration`
- 不得在脏主目录 `D:\Projects\energyiq-datafoundry` 合并、清理或发布。
- 运行配置只检查环境变量是否存在，禁止输出变量值；操作步骤见关联 Source Connector 运行手册。

## 6. 后续与关联

1. 修复 Admin Project 入口的 Workspace-aware navigation：选择目标 Project 时同步选择其 Workspace，而不是放宽服务端隔离；
2. 为 Tuya 增加正式 AI Adapter 后，再关闭 AI 数据域更新与人工内容价值门；
3. 将 Preschool 约 35 秒冷确定性计算作为 #93 后续独立性能切片；
4. 制定 Release/Backup 保留策略并只清理经审计确认可回收的旧版本；
5. 未完成门明确保留，不用自动化测试冒充生产或人工验收。

## 7. 发布判断

本夜结论是 **production deployed，受控验收继续**。

已关闭：不可变 Artifact、服务器私有 Connector 配置、原子切换、健康门、真实 Tuya Provider 同步、Ngee Ann 普通账户生产回归、跨 Project 拒绝。

尚未关闭：Admin 跨 Workspace 入口 UX、Tuya 正式 AI Adapter 与 AI 内容价值、冷计算性能、旧 Release/Backup 保留策略。当前账户模型不要求 Tuya-only 账户。这些不阻止确定性 Tuya Overview 上线，但阻止宣称“Tuya AI 与性能优化全部完成”。
