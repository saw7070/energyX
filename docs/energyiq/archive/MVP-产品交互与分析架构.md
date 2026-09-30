---
title: "MVP 产品交互与分析架构"
summary: "定义决策看板、项目浏览器和 AI 问数的页面流程、每日计量数据链、模板运行与未来 AI 修改接缝。"
doc_type: decision
tags: [产品交互, 前端架构, 能源数据, 模板, AI问数]
updated_at: "2026-08-01"
related:
  - "../product/PRD-EnergyIQ-MVP.md"
  - "../product/甲方确认稿-日级能源分析与AI问数MVP.md"
  - "../decisions/阶段技术选型-基于DataFoundry二次开发.md"
  - "../product/领域模型.md"
status: superseded
---

# MVP 产品交互与分析架构

> **历史文档。** 本文保留早期交互与数据链讨论，不再作为当前实现基准。当前结论见[新会话入口](../decisions/当前共识与新会话入口.md)、[最新 PRD](../product/PRD-EnergyIQ-MVP.md)和[开发计划](../plans/开发计划-Admin与模板运行闭环.md)。本文中的 Analysis / Ask AI、固定 Site / Space、三个入口和任意递归 Project Node 已被最新决策替代。

> 本文是 [EnergyIQ MVP PRD](../product/PRD-EnergyIQ-MVP.md) 的技术架构补充。产品范围、页面行为和验收口径以 PRD 为主。
>
> 2026-07-30 修订：本文后续仍出现的 `Site / Space` 仅代表历史示例，不再是强制数据层级。实现以[灵活项目结构与计量点模型](../decisions/灵活项目结构与计量点模型.md)中的递归 Project Node 为准；模板以[项目专属模板与决策型分析](../decisions/决策-项目专属模板与决策型分析.md)为准。

## 1. 决定

客户进入 Workspace 后只看到三个主要入口：

1. **决策看板（Analysis）**：选择时间段，运行当前 Project 已发布的专属模板。
2. **项目浏览器（Project Explorer）**：按实际项目结构下钻节点和计量点，查看趋势、构成、异常和证据。
3. **AI 问数（Ask AI）**：针对 Workspace 和当前 Project 数据自由提问，获得带图表和来源的回答。

三个入口在交互上独立，在数据、指标和溯源上共用同一事实层。首期不向客户暴露模板编辑、Agent 管理、数据上传、Memory、Trace、Ontology 或系统配置。

## 2. 信息架构

```text
Workspace Switcher
├── Analysis
├── Project Explorer
└── Ask AI
```

客户导航隐藏：

- Briefs、Apps、Insights；
- Data 上传和 Data Check；
- Agents、Memory、Traces、Ontology；
- Agent Catalog、Skill Library、System Agents；
- 模板编辑和定时 Agent。

后台未来可增加 Data Status、Workspace Health 和账号管理，但不进入客户首屏。

## 3. Analysis 页面

### 3.1 页面线框

```text
┌──────────────────────────────────────────────────────────┐
│ ABC Preschool                         Data through 28 Jul │
│ Energy Analysis                       Sync: Successful    │
├──────────────────────────────────────────────────────────┤
│ Scope [All projects > Site > Space]                      │
│ Period  [Yesterday] [7 days] [30 days] [Custom] [Run]    │
├──────────────────────────────────────────────────────────┤
│ Total energy │ Daily average │ Peak power │ Completeness  │
├──────────────────────────────────────────────────────────┤
│ Daily energy trend                                       │
├─────────────────────────────┬────────────────────────────┤
│ Level 6 vs Level 7          │ Circuit composition        │
├─────────────────────────────┴────────────────────────────┤
│ Data gaps and unusual readings                           │
├──────────────────────────────────────────────────────────┤
│ Analysis history                    [Calculation details] │
└──────────────────────────────────────────────────────────┘
```

### 3.2 用户操作

| 控件 | 用户得到什么 | 首期行为 |
| --- | --- | --- |
| Yesterday / 7 days / 30 days | 快速选择完整自然日 | 默认 Yesterday |
| Custom | 选择起止日期 | 结束日期在界面中包含，后端使用次日00:00作为开区间 |
| Scope | 选择整体、项目、场地、空间、计量点组或单个计量点 | 默认当前 Workspace；只展示有权限的节点 |
| Run analysis | 生成新分析 | 自动创建 Analysis Run，不再要求另点保存 |
| Analysis history | 打开历史运行 | 可查看结果和使用新时间段复跑 |
| Calculation details | 查看依据 | 展示模板版本、数据快照、指标、时间范围和关键查询 |

如果只有一个模板，不显示“模板选择器”。出现第二个真实模板后再增加“Analysis type”。

### 3.3 固定报告内容

- 总耗电量；
- 日均耗电量；
- 峰值平均功率；
- 数据完整率；
- 每日能耗趋势；
- Project / Site / Space 对比；
- 单个 Site 或 Space 内的回路构成；
- 工作日/周末或营业/非营业时段对比；
- 负差值、重复时间、数据缺口和异常跳变。

Total 与分回路不能进入同一个求和结果。总量比较只用 Total；构成分析只用 submeter。

## 4. Ask AI 页面

### 4.1 页面线框

```text
┌──────────────────────────────────────────────────────────┐
│ Ask your energy data               Context: Last 7 days  │
├──────────────────────────────────────────────────────────┤
│ Suggested:                                              │
│ [Which floor used more?] [Night usage?] [Top circuits?] │
│                                                        │
│ User question                                          │
│ AI answer + KPI / table / chart                        │
│ [Sources and calculation]                              │
│                                                        │
├──────────────────────────────────────────────────────────┤
│ Ask about energy use, floors, circuits or anomalies…    │
└──────────────────────────────────────────────────────────┘
```

### 4.2 用户操作

- 新建或打开个人 Chat Session；
- 可选择问题使用的时间段，也可在问题里直接描述；
- 获取文字、KPI、表格或图表；
- 继续追问；
- 展开 SQL、指标、参数、数据时间和设备范围。

首期不显示：

- Add to dashboard；
- Save as template；
- Promote to scheduled agent；
- Run daily/weekly/monthly；
- AI 修改 Analysis 页面。

## 5. 页面状态

| 状态 | 页面行为 |
| --- | --- |
| 无数据 | 告知尚未完成首次同步；客户不可见上传按钮 |
| 正在同步 | 保留最近成功结果，展示同步进行中 |
| 数据过期 | 黄色提示“数据仅更新至…” |
| 同步失败 | 展示错误状态，不把旧数据标成最新 |
| 时间段不完整 | 允许用户返回修改时间，或明确标记部分数据 |
| 分析运行中 | 使用分区 Skeleton，禁用重复提交 |
| 分析失败 | 保留上一次成功结果，提供重试 |
| AI 无法可靠回答 | 说明缺少字段或数据，不生成数字 |

## 6. 每日数据架构

```text
Tuya API / Excel 文件
        ↓ Source Adapter 输出统一 Raw Reading
Import Batch + 原始文件/响应留存
        ↓
raw_meter_readings
        ↓ 去重、时区、设备映射、读数质量检查
normalized_meter_readings
        ↓ 按设备排序并计算相邻差值
meter_interval_usage
        ↓ 实体区间事实完成后运行虚拟计量点公式
meter_interval_facts
        ↓ 日、Project、Site、Space、Meter Group 聚合
energy_facts
        ├── Analysis Template Module
        └── Ask Query Module
```

### 6.1 Excel 的使用方式

Excel 是 Tuya API 的备用输入 Adapter，不是另一套数据链：

1. 上传后将原文件作为不可变 File Asset 保存，以 SHA-256 去重；
2. 创建 Import Batch，记录 Workspace、文件、Sheet、上传人、状态和质量摘要；
3. 识别 `Device Name`、`Time`、`Active Energy`，保存原始行号和原值；
4. 将 `Device Name` 通过有效期映射到正式 `meter_point_id`；
5. 以 `(source, external_meter_key, event_time, metric)` 生成规范唯一键；
6. 与历史文件重叠的时间段执行幂等 upsert；值冲突时记录 conflict，不静默覆盖；
7. 校验通过后才发布新的 Data Snapshot，失败批次不能污染已发布分析。

Data Foundry 当前本地文件服务已经支持内容哈希和文件去重，原始 Excel 使用：

```text
storage/files/<sha256 分片路径>
```

解析和计算后的数据使用：

```text
storage/energy/<workspace_id>/energy.duckdb
```

控制数据保存在 metadata SQLite：

```text
import_batches
projects
sites
spaces
meter_points
meter_source_bindings
meter_groups
meter_group_members
meter_formula_revisions
```

分析数据保存在 Workspace DuckDB：

```text
raw_meter_readings
normalized_meter_readings
meter_interval_facts
energy_daily_facts
```

Excel 和 API Adapter 都必须输出同一个规范输入：

```text
workspace_id
source_type
source_record_id
external_meter_key
event_time
cumulative_energy
unit
ingestion_batch_id
raw_payload
```

因此将来从 Excel 切换到 API 时，只替换输入 Adapter，不修改差分、虚拟计量点、模板或 AI 问数。

### 6.2 规范字段

```text
workspace_id
source_file / source_event_id
sheet_name / source_row
project_id / site_id / space_id
meter_point_id
external_meter_key / meter_name
meter_point_kind: physical | virtual
meter_role: total | submeter | unknown
event_time
active_energy_kwh
interval_energy_kwh
elapsed_hours
average_power_kw
value_origin: measured | calculated
formula_revision_id
quality_flag
```

### 6.3 累计电能计算

对同一个设备按时间排序：

```text
interval_energy_kwh = current.active_energy - previous.active_energy
average_power_kw = interval_energy_kwh / elapsed_hours
```

`interval_energy × 4` 只适用于时间差严格为15分钟。遇到30分钟缺口必须除以0.5小时。

### 6.4 数据质量规则

- `(device_id, event_time)` 重复：去重并记录；
- 负差值：标记 reset/invalid，不直接求和；
- 时间不递增：拒绝进入 interval 表；
- 间隔大于预期：能耗可保留但标记 gap，平均功率按真实时长计算；
- 异常跳变：标记但保留 raw；
- 每个分析期间必须有开始边界前的上一条读数；
- 日级分析需要次日00:00附近的边界读数；
- Sheet 只作为楼层来源，正式计算使用规范 `floor_id`；
- 无 DB schedule 时，未知回路不得被 AI 猜成具体设备。

### 6.5 虚拟计量点

虚拟计量点在实体计量点完成累计差分后计算，首期只支持可审计的线性加减：

```json
{
  "virtualMeterPointId": "unmetered-load",
  "terms": [
    { "meterPointId": "total-load", "coefficient": 1 },
    { "meterPointId": "connected-load-a", "coefficient": -1 },
    { "meterPointId": "connected-load-b", "coefficient": -1 }
  ],
  "unit": "kWh"
}
```

即：

```text
未接入负荷 = 总回路 - 已接入回路 A - 已接入回路 B
```

规则：

- 公式引用稳定 ID，不引用可变设备名称；
- 输入必须属于同一 Workspace、同一时间区间和兼容单位；
- 公式依赖必须形成无环图，禁止循环计算；
- 任一输入缺失时，输出标记 `incomplete`，不偷偷补零；
- 结果为负时标记异常，不自动截断为零；
- 保存 `formula_revision_id`、所有输入计量点和数据快照；
- 总表、分表关系必须人工确认，不能仅凭名称自动生成；
- 实体表本应上传但临时缺数时，默认标记缺失；只有显式配置 fallback policy 才能用公式替代，并把 `value_origin` 标为 `calculated`。

公式有生效时间和不可变版本。配电关系改变时发布新 Meter Formula Revision，历史 Analysis Run 继续使用旧版本。

### 6.6 时间段语义

Workspace 保存业务时区。用户选择“2026-07-01 至 2026-07-20”时，内部统一为：

```text
[2026-07-01 00:00, 2026-07-21 00:00)
```

所有模板、AI 查询和溯源使用同一解释，避免结束日期少算一天。

## 7. 模板运行架构

```text
Analysis Template
  └── Template Revision
       └── Analysis Run
            └── Brief Version
```

### 7.1 Template Revision

模板使用受控 Schema，而不是把结构写死在页面或保存一段 Prompt：

```json
{
  "id": "energy-period-analysis",
  "schemaVersion": 1,
  "sections": [
    {
      "id": "total-energy",
      "type": "kpi",
      "metric": "energy.total"
    },
    {
      "id": "daily-trend",
      "type": "line-chart",
      "metric": "energy.consumption",
      "grain": "day"
    }
  ]
}
```

模板只能引用受 Energy Fact Layer 管理的 metric、dimension 和 section type；不能携带任意 raw SQL。

### 7.2 深模块接口

`AnalysisTemplateModule` 的外部接口保持小而稳定：

```ts
interface AnalysisTemplateModule {
  run(input: RunTemplateInput): Promise<AnalysisRun>;
  proposeChange(input: ProposeTemplateChangeInput): Promise<TemplateChangeProposal>;
  publish(input: PublishTemplateChangeInput): Promise<TemplateRevision>;
}
```

首期页面只调用 `run`。人工调整模板可直接创建受校验的 Template Revision；`proposeChange` 和 `publish` 为未来 AI 修改使用。

### 7.3 未来 AI 修改流程

```text
用户：“增加工作日和周末对比”
→ AI 生成 Template Change Proposal
→ 校验允许的指标、维度、组件和 Workspace
→ 使用同一数据快照生成预览
→ 展示修改 Diff 和结果变化
→ 人工确认
→ 创建新的 Template Revision
```

AI 不得直接：

- 修改 React/HTML 源码；
- 写任意 SQL；
- 覆盖已发布版本；
- 未经确认发布；
- 引用不存在的字段、指标或其他 Workspace 数据。

## 8. AI 问数架构

AI 问数和模板运行共用：

- Energy Fact Layer；
- Workspace 时间和设备范围；
- metric/dimension catalog；
- read-only query；
- Data Snapshot 和 provenance。

回答保存：

```text
workspace_id
user_id
session_id
question
confirmed_interpretation
sql
parameters
metric_version
data_snapshot_id
result_fingerprint
chart_spec
```

这保证固定报告和 AI 对同一口径给出一致数字。

## 9. 多租户最小预留

第一阶段页面仍可一单位一个账号，但数据模型从第一天区分：

```text
Partner
  └── Workspace
       └── Membership
```

- 所有能源数据、模板运行和同步记录必须带 `workspace_id`；
- 已发布报告属于 Workspace；
- Chat Session 和草稿默认私有；
- API 从已认证 Membership 推导 Workspace，不信任任意前端参数；
- Partner 管理后台、复杂角色和跨 Workspace 监控后续实现；
- 现在必须保存同步状态和审计事件，为未来后台提供历史数据。

### 9.1 Workspace 内的业务层级

首期推荐：

```text
Workspace（物业管理组织）
└── Project（建筑群 / 园区）
    └── Site（单栋建筑）
        └── Space（楼层 / 区域，可嵌套）
            └── Meter Point（计量点）
```

但空间树与电气拓扑分开保存：

- Space 回答“它在哪里”；
- Meter Point 回答“测量什么”；
- Meter Relation 回答“总表和分表怎样连接”；
- Meter Group 回答“分析时如何分组”。

同一个物业管理团队默认可以查看所有建筑群时，多个 Project 放在同一个 Workspace，才能直接做整体分析。若不同项目存在独立合同、独立人员或互相不可见，则拆成不同 Workspace。

### 9.2 从简单到复杂的演进

| 阶段 | 权限模型 | 好处 | 何时升级 |
| --- | --- | --- | --- |
| 1. 单账号 Workspace | 一个物业一个账号，多个 Project | 最快交付，整体分析天然可用 | 出现第二个真实用户 |
| 2. Workspace 多账号 | Admin / Member，报告共享、Chat 私有 | 支持物业团队协作 | 不同人员只能看部分项目 |
| 3. Project 范围授权 | Membership 增加 Project scope | 建筑团队互相隔离 | Tuya 需要批量运营客户 |
| 4. Partner 运营后台 | 管 Workspace 健康、账号和模板分配 | 便于规模化销售和运维 | 出现跨 Workspace 汇总需求 |
| 5. Portfolio 聚合 | 经明确授权跨 Workspace 汇总 | 集团级组合分析 | 真实客户提出且合规边界明确 |

现在只实现第 1 阶段，但所有事实、模板运行和层级对象从第一天保存 `workspace_id`，避免以后迁移数据边界。

## 10. 对 DataFoundry 现有页面的映射

| 当前位置或能力 | MVP 处理 |
| --- | --- |
| `/data-tasks` | 复用其 Chat、Session 和结果展示能力，产品化为 Ask AI |
| Data source / file upload | 从客户主导航隐藏，保留为内部实施和数据诊断能力 |
| Task Console / Trace | 默认折叠；通过 Sources and calculation 按需展开 |
| Workspace 配置 | 补充客户单位、时区、Tuya 数据源和 Membership 边界 |
| Analysis | 新增 Workspace 默认页，运行固定 Analysis Template |
| 根路由 | 登录后进入当前 Workspace 的 Analysis，而不是直接进入通用 workbench |
| 通用 Agent 配置 | 首期不向客户展示 |

## 11. 明日前端确认场景

1. 用户进入 Workspace，默认看到 Analysis。
2. 页面显示数据更新至何时以及是否完整。
3. 用户选择“最近7天”，点击 Run analysis。
4. 页面展示固定报告结构和 Calculation details。
5. 用户切换到 Ask AI，询问“最近7天哪个楼层耗电更多？”。
6. AI 返回对比图和文字结论，来源可展开。
7. 页面中看不到模板编辑、Agent、Memory、Trace、Data 上传或系统配置。

## 12. 失效条件

出现以下任一条件时重新评估首期架构：

- 客户明确要求自行编辑、拖拽和组合复杂看板；
- 需要多个模板跨大量 Workspace 批量部署；
- AI 修改模板进入当前交付范围；
- 同一 Workspace 多账号和 Partner 管理后台进入验收；
- 每日同步无法满足新的运营时效要求。
