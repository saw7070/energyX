---
title: "Preschool Overview AI 路线 B 集成记录"
summary: "记录两阶段 AI Artifact、服务端可信提交、失败重试边界及 Benchmark/Standby 薄适配的 Integration 证据与未完成验收。"
doc_type: implementation-record
tags: [Overview, Preschool, AI-Insight, Artifact]
updated_at: "2026-08-09"
---

# Preschool Overview AI 路线 B 集成记录

## 本次完成

- 当前 Integration 已包含路线 A `7a3295a`，因此没有重复合并；路线 B `81c03ee` 已精确集成。
- Metadata 与 API 已在 Integration 依赖环境重建；此前受跨工作树 Junction 影响的 failed-retry API 测试已通过。
- 同一 Artifact 最多执行两次：首次执行失败后允许一次显式重试；并发 claim 仍只有一个 owner，错误 lease token 不能 complete/fail，`available` 结果继续不可变。
- 新增薄适配，将与当前 Project、Scope、Snapshot、Release、Period 和输出合同完全一致的 `preschool.benchmark`、`preschool.standby` Finding 映射到路线 A 的 Key Recommendation / Next Step。
- 适配只复用 AI Artifact 已接受的标题、解释、行动和验证方式，不生成第二套固定 AI 文案；旧 Snapshot、不匹配合同和没有章节 Finding 的结果均 fail closed。
- `verified`、`hypothesis`、`exploration-idea` 在章节解释中保留可见状态；Standby Finding 不再重复进入 Operating-hours 的旧 Slot。
- 后续服务端可信闭环第一版 `52b183a` 已在基于 Integration `2395bc5` 的独立分支完成；独立复核后的 correction 进一步把 GET 收紧为 pure read/no-store，新增 CSRF POST ensure，补齐 typed Evidence/SQL 同行 Validator、模型与 Method Skill revision fail-closed、retry 缓存恢复，并删除浏览器直接 `/agent/run` 双栈。两次提交均待主 Agent窄合并到当前 Integration `cd97827`；细节见[服务端可信闭环合并交接](../handoff/agent/2026-08-09-Preschool-Overview-AI-服务端可信闭环合并交接.md)。

## 自动化证据

- Metadata/API build：通过。
- failed-retry API + Store 聚焦测试：`4/4` 通过。
- 路线 A/B 及薄适配聚焦回归：`13 files / 140 tests` 通过。
- 服务端可信闭环 correction 聚焦回归：`13 files / 143 tests` 通过；EnergyIQ seams：`7 files / 89 tests` 通过（本机休眠后的性能抖动通过单 worker、60 秒测试阈值复核，未修改仓库配置）。
- 全仓 `npm run typecheck`：通过。

以上均为本地自动化证据，不等于真实 Provider、Chrome 或 Charles 产品验收。

## 明确未完成

- 固定 Preschool Snapshot 的真实 Provider 三次验收（至少 `2/3 useful`）。
- 1440/1920 Chrome 章节位置、恢复、无旧 Snapshot 混入的视觉验收。
- Charles 人工产品验收。

## 后续顺序

1. 将服务端可信闭环提交窄合并回权威 Integration，并复跑 API/Store/恢复/并发测试。
2. 跑真实 Provider 三次，再做 Chrome 与人工验收；各层证据分开记录。
3. Preschool 完成产品验收后再讨论 Ngee Ann，不在当前切片横向扩建。
