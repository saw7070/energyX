# 原型验证首次数据源配置流程

Type: prototype
Status: resolved
Blocked by: 02
Label: ready-for-agent

## Question

管理员从 `Connect Data Source` 进入后，怎样用最少步骤完成 Excel 导入、字段映射、Meter 绑定、`Virtual Load 12` 配置、质量检查、Project Setup 发布，并让后续导入直接复用已确认配置？

## Expected evidence

- 英文 Admin 交互原型，覆盖首次导入和后续复用两条路径。
- 每一步只要求管理员确认机器无法安全确定的信息。
- 明确 Draft、Validation Warning、Published 与 Failed 状态。
- 证明流程能容纳未来 Tuya API，但不提前实现 API 专属复杂度。

## Prototype evidence

- A · Guided setup：`http://127.0.0.1:3001/energyiq/admin?variant=A`
- B · Control room：`http://127.0.0.1:3001/energyiq/admin?variant=B`
- C · Release review：`http://127.0.0.1:3001/energyiq/admin?variant=C`
- 已走通首次配置、重复导入与缺少 `Time` 字段的失败恢复；原型状态只存在于浏览器内存。
- 定向类型检查通过，最终浏览器控制台无 error/warn；详见 `docs/energyiq/2026-08-01-Admin-首次数据源配置交互原型记录.md`。

## Pending decision

用户未接受 A/B/C 作为正式 Admin 信息架构，已确认回到五阶段项目交付流程：

1. `Basics → Structure → Data & Meters → Analysis → Review & Publish`；
2. Structure 分为 `Tier Setup → Hierarchy Builder`，Tier Lock 只是 Draft 检查点；
3. Mapping 只能选择已有 Scope，缺节点时返回 Structure；
4. 每个 Label 配置 Scope、Resource、Category 与 Coverage，再统一复核 Official Aggregation Route；
5. Category 预留 Overall；Meter Kind、Meter Role 与 Official Route 正交；
6. Virtual Meter 在 Confirm Mapping 中可选创建，不单设 Tab；
7. 正式发布统一位于第五阶段。

## Formal implementation evidence

- 正式路径已落为 `Project Overview → Structure → Data Sources → Meter Mapping`，不再使用 A/B/C 作为产品信息架构；
- 真实 Ngee Ann `.xlsx` 已验证为 25,919/25,919 有效行、9 个精确标签、15 分钟典型间隔；
- 原文件按 SHA 保存，重复上传复用同一 Import Batch；
- 9 个标签均可建议到 Structure 已有 Scope，管理员保存后刷新仍为 9 个 Mapped、0 个 Needs Scope；
- Virtual Meter 保留在 Mapping 内作为可选能力；
- 自动化验证为 3 个测试文件、12 项通过，根 TypeScript build 通过；
- 详细证据见 `docs/energyiq/2026-08-01-Admin-Excel-Import-Batch实施记录.md`。

本票解决的是首次数据源配置的正式路径与交互可行性。上传批次物化为 Raw Reading / Interval Fact / Quality Event 属于后续实现票，不在本票中冒充完成。
