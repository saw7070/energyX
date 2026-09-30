---
title: "2026-08-04 Published Meter Routing 实施记录"
summary: "GitHub Issue #24：把 Meter identity、导航挂载与官方汇总口径固化为 Mapping schema v2，并让可信分析只读取 Release-pinned route。"
doc_type: implementation
tags: [开发记录, Meter Mapping, Published Route, Release, Golden]
updated_at: "2026-08-04"
status: accepted
---

# Published Meter Routing 实施记录

## 1. 结论

Issue #24 已通过 Integration API 与 Chrome 验收：正式分析不再用 Fact 的 `scope_id + meter_role` 猜测 Meter 归属或汇总成员，而是只读取 Mapping schema v2 中已发布的 attachment 与 `scope + resource + category` routes。Mapping fingerprint 覆盖两类关系，并以 `meter_mapping_revision_id` 进入 Template Revision、Project Release、Analysis provenance 与 Saved analysis 冻结证据。

这项工作服务于 Overview 北极星：先证明 Project、Level 与 Circuit 下钻使用同一组可审计事实且不会 double count，再进入 Tariff/Calendar 与 Overview Renderer 验收。本次只在 Integration 环境完成 Mapping materialization、Project Publish 与验收，没有切换客户环境 Release。

## 2. 权威模型

Mapping schema v2 分开保存三件事：

1. Physical Meter identity：稳定 `meter_point_id` 与来源标签；
2. Published Meter Attachment：`meter_point_id → navigation_scope_id`，决定导航与 own-Circuit 查询；
3. Official Aggregation Route：每个 `scope + resource + category` 显式列出官方 `meter_point_ids`。

确认或运行时遇到旧 schema、缺失 Project/ancestor route、重复 route、同 route 重复 member、跨 category route member overlap、overall 与分类 route 共存、悬空 Meter、跨 Resource/Category/Scope member、非法 resource 或 Release pin mismatch，均拒绝发布或运行。Canonicalization 保留重复 member 供 validation 捕获，不会在校验前静默去重。Datasource 只按已发布 Meter IDs 建立受限 view，并暴露 published attachment 与 `official_aggregation_eligible`；查询路径不会 UPDATE facts，也没有旧 heuristic fallback。

## 3. Ngee Ann 固定口径

- 4 个 total Circuit 均挂在自己的 Circuit Scope，可直接查询；
- 14 个 component Circuit 均可通过 own-Circuit route 查询，但不进入 Level/Project 官方汇总；
- Level 6、Level 7 与 Project 分别使用 light/load 分类 routes，官方成员只有 4 个 totals；
- Virtual `Load 12` 保持可追溯公式，但不进入官方 Project/Level totals；
- 4 个 total Circuit 均参数化固定 raw/API Golden：L6 Light `111.688071 / 111.6881`、L6 Load `365.295756 / 365.2958`、L7 Light `180.056316 / 180.0563`、L7 Load `874.128181 / 874.1282` kWh；四值来自覆盖 `[2026-06-10, 2026-06-17)` 的 Level 6/7 May–Jun 权威 Excel 独立 oracle，不再沿用 legacy mixed evidence；测试分别对 raw 与统一四位 API 输出做精确断言，并显式验证 Project/Level/category reconciliation，不用宽松 tolerance 混淆精度边界；
- Golden fixture 中 14 个 component facts 的 role 与 Published Mapping 一致为 `component`。

## 4. Release 与历史边界

Template Revision 发布时同时 pin：

- `hierarchy_revision_id`；
- `meter_mapping_revision_id`；
- `meter_formula_revision_id`；
- Metric/Rule、Calendar、Tariff 与 Data Snapshot 等既有版本。

运行先校验用户、Workspace 与 Project access，再按 Release-pinned Hierarchy 验证 Scope，随后解析同一个 Mapping Revision。当前 Draft 或当前 Project 指针漂移不能覆盖已发布 Release。Saved analysis GET 只返回已序列化历史结果和当时 Template Revision，不重新计算；rerun 才基于正式 Resolver 创建新记录。

## 5. 验收证据

代码提交：`c1ddf54`（主体实现）与 `8e8d220`（双轴 review 修复），branch `codex/t03b-meter-route`，baseline `d0915f4`。

- `npm run typecheck`：通过；
- affected Vitest：4 files、30 tests 全部通过；
- focused Vitest：7 files、41 tests 全部通过；
- Golden 覆盖 Project、Level、component Circuit、total Circuit；
- Mapping validation 覆盖 attachment/route fingerprint，以及 missing、duplicate、dangling、cross-resource 等 fail-closed 情形；
- `node --check scripts/smoke-energy-trusted-scope.mjs`：通过；
- `git diff --check`：通过。

Integration 发布与事实审计：

- Published Mapping 为 schema v2，包含 `18` 个稳定 source labels，状态为 `confirmed`；
- 共 `24` 条 official routes：`18` 条 own-Circuit、`4` 条 Level、`2` 条 Project；Project routes 的官方成员严格限定为 4 个 total meters；
- Release pins：Data Snapshot `energy-snapshot-c33cc8bb7ba0cfc01c7c2d0a`、Meter Mapping `meter-routing-8006ca893a46dac77957cfe0`、Hierarchy v6、Template v4；
- materialized facts 为 `100205`；invalid、unmapped、duplicate 均为 `0`，`32` 个 overlap warnings 保留为可见质量提示，不改变官方汇总；
- Scope API exact Golden 共 `21/21` 通过：Project `1531.1683` kWh、Level 6 `476.9838` kWh、Level 7 `1054.1845` kWh，并与 4 个 total Circuit 及 14 个 component Circuit 的固定口径对账；
- Chrome UI 回读显示 `18` 个 labels 与 `Confirmed` 状态，控制台无错误。

## 6. 下一步

Issue #24 的 Mapping 实现与 Integration acceptance 已收口，下一执行边界转入 Overview ticket #6。Chrome 验收中发现的 Overview Custom URL 状态恢复问题归属 #6；它不改变已发布 Mapping、Release pins、Scope API Golden 或事实审计结果，因此不是 #24 的 Mapping failure。

当前 resolver 为保证正确性会在同一请求的 Context/route/child scope 链路重复解析 Published hierarchy snapshot；这是已知性能 P2。本轮不引入缓存或扩大架构 seam，后续只在 profiling 证明有实际开销时增加 request-scoped memoization。
