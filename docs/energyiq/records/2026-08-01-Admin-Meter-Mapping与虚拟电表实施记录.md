---
title: "2026-08-01 开发记录：Admin Meter Mapping 与虚拟电表"
summary: "正式 Admin 已接入物理表映射、官方汇总审查、可选加减法虚拟电表及可持久化 Draft。"
doc_type: runlog
tags: [Admin, Meter Mapping, Virtual Meter, Project Draft]
updated_at: "2026-08-01"
related:
  - "../decisions/灵活项目结构与计量点模型.md"
  - "../plans/流程-项目配置与模板发布.md"
---

# 2026-08-01 开发记录：Admin Meter Mapping 与虚拟电表

## 1. 目标与范围

本批次落实五阶段流程中的 `Data & Meters`：管理员只能把数据源标签映射到 Structure 已存在的 Scope，不能在 Mapping 中临时创建 Floor、Room 或 Circuit。完成物理表映射后，管理员审查官方汇总路径，并可选创建 Virtual Meter。

本批次不实现 Excel 文件上传、Tuya 拉取、Virtual Meter 事实计算或 Stage 5 正式发布；当前源标签仍由 Ngee Ann 项目样板生成，并在界面标记为 Fixture labels。

## 2. 已实现行为

### 2.1 物理表 Mapping

- 每个源标签配置：`Scope`、显示名、`resource`、`category`、`coverage`、`meter_role`、`aggregation_usage`。
- `Scope` 只能从 Structure 的既有节点中选择；缺少节点时返回 Structure。
- 同名 Circuit 使用完整路径区分，例如 `Level 6 / Office Load 1` 与 `Level 7 / Office Load 1`。
- `Meter Role` 与官方汇总分开表达：表可以是 Total、Component 或 Standalone，同时明确 Included 或 Excluded。
- 同一 `Scope + resource + category` 最多只能有一个 Included Total。
- `overall` 与 `load/light/aircon/other` 分组审查，避免把总表与分类表重复相加。

### 2.2 Virtual Meter

- Virtual Meter 是 Mapping Review 内的 optional 配置，不设独立 Tab。
- 当前公式支持多个物理表输入，每项系数为 `+1` 或 `-1`。
- 已用 `Load 12 = Load 1 + Load 2` 完成浏览器验收。
- MVP 固定为 `Standalone · Excluded`，不进入上级或官方汇总，避免重复计算。
- 一个公式至少需要两个唯一物理表输入，且所有输入必须与 Virtual Meter 使用同一 resource。

### 2.3 Draft 与发布语义

- `Mark Mapping Confirmed` 只标记当前 Mapping checkpoint。
- 管理员随后点击页头 `Save draft`，配置才写入 Project Draft。
- 客户页面保持不变；正式生效仍由 Stage 5 `Review & Publish` 承担。

## 3. 代码改动

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/app/energyiq/admin/project-setup-workbench.tsx` | Mapping 列表、编辑器、汇总审查、Virtual Meter 编辑和 Draft 操作 |
| `apps/web/src/app/energyiq/admin/project-setup-model.ts` | 初始映射、完整 Scope 路径、汇总分组与冲突识别 |
| `apps/web/src/lib/config-api/types.ts` | Mapping 与 Virtual Meter DTO |
| `apps/api/src/energy/energy-api.ts` | Project Setup Draft 的 Mapping/Virtual Meter 请求解析 |
| `packages/metadata/src/energyiq-project-setup-store.ts` | Canonicalization、Scope/汇总/公式校验与持久化 |
| `apps/api/src/server.ts` | CORS preflight 增加 `PUT`，恢复浏览器保存 Draft |

对应提交：

- `69c3551 feat(energyiq): add guided physical meter mapping`
- `32cbc7a fix(api): allow PUT requests in CORS preflight`
- `30250b9 feat(energyiq): add optional virtual meter formulas`

## 4. 验证证据

```powershell
cd D:\Projects\energyiq-datafoundry\apps\web
npx vitest run src/app/energyiq/admin/project-setup-model.test.ts

cd D:\Projects\energyiq-datafoundry\packages\metadata
npx vitest run src/energyiq-project-setup-store.test.ts
npm run build
```

结果：Web 模型 6 项通过，metadata 5 项通过，metadata 构建通过；EnergyIQ 相关 TypeScript 检查无错误。全 Web TypeScript 仍存在既有 Data Tasks 测试类型错误，本批次没有把它描述为全仓通过。

浏览器手工验收：

1. 进入 `Admin → Meter Mapping`；
2. 检查 Level 6/7 同名源标签和 Scope 完整路径；
3. 进入 Aggregation Review；
4. 创建 `Load 12 = Level 6 Office Load 1 + Level 6 Office Load 2`；
5. 标记 Mapping Confirmed 并保存 Draft；
6. 刷新后重新进入 Review，`Load 12` 仍存在，并显示 `Standalone · Excluded`。

## 5. 问题与取舍

- 现象：浏览器保存 Draft 返回 `Failed to fetch`。根因：CORS 方法白名单遗漏 `PUT`。处理：加入 `PUT` 并重新完成跨刷新验收。
- 当前不自动推断复杂 Meter Role 或 Virtual Meter 公式。管理员只需完成一次人工确认，后续 Excel/API 批次复用同一配置。
- 当前 Virtual Meter 只进入 Setup Draft，尚未物化到能源 Fact 计算；接入计算时必须继续遵守默认排重规则。

## 6. 后续

下一批应连接真实 Excel Import Batch：读取源标签和字段预览，复用已确认 Mapping，生成 Raw Reading、15 分钟增量 Fact、质量报告和 Data Snapshot。Tuya API 后续只替换输入 Adapter，不改变 Mapping、Fact 与下游分析契约。
