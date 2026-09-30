---
title: "阶段技术选型：基于 DataFoundry 完成固定分析与 AI 问数"
summary: "首期以 DataFoundry 为产品底座，补充能源数据链和固定分析页面，暂不接入 Superset 或 Rill。"
doc_type: decision
tags: [技术选型, MVP, DataFoundry, AI问数]
updated_at: "2026-08-01"
related:
  - "../product/甲方确认稿-日级能源分析与AI问数MVP.md"
  - "../archive/MVP-产品交互与分析架构.md"
  - "../research/chatbi-dashboard-options-2026-07-27.md"
status: accepted
---

# 阶段技术选型：基于 DataFoundry 二次开发

> 2026-08-01 确认：继续在 DataFoundry 内二次开发，不引入 Superset/Rill 作为 MVP 主底座。当前产品入口为 Overview、Project Explorer、AI Analyst、Data Map；层级采用 Project 外置的动态 Tier Definition。详细设计见[当前共识](当前共识与新会话入口.md)。

> 早期文档中的 Analysis / Ask AI 和自由递归 Project Node 名称仅作历史背景；当前统一使用 Overview / AI Analyst 与 Tier Definition。

## 1. 背景

最新范围已经从“5～10分钟 ChatBI + AI 修改多组件看板”收敛为：

- 每天同步一次 Tuya 数据；
- 用户按时间段运行固定结构化分析；
- 用户独立使用 AI 问数；
- 模板由我方人工维护，未来才允许 AI 提议修改。

因此，首期不再需要成熟的通用 Dashboard Builder。当前最需要复用的是账号、Chat、Session、数据源、只读查询和审计能力。

## 2. 选项

| 选项 | 当前已有 | 首期仍需补 | 判断 |
| --- | --- | --- | --- |
| **基于 DataFoundry 二次开发** | 登录、Chat/Session、数据源、文件、只读 SQL、运行记录、Trace | Workspace 租户边界、每日 Tuya/Excel 数据链、能源事实层、固定分析页 | **首期选择** |
| **继续使用 energyiq-rebuild** | 无；该仓库已废弃 | 会重新引入两套实现与错误基线 | 禁止 |
| **接入 Superset** | 成熟图表与看板 | 集成、权限映射、部署运维 | 客户不能编辑看板时没有必要 |
| **接入 Rill** | SQL/YAML 模板和定时刷新 | Chat、租户、发布链和集成 | 作为未来模板即代码备选 |

## 3. 决定

**所有 EnergyIQ 设计、开发、测试和文档只在 energyiq-datafoundry 进行。energyiq-rebuild 已废弃，不再维护、参考或迁移。首期不接入 Superset、Rill。**

```text
每日 Tuya / Excel
→ Energy Domain Layer
├── Analysis Template → Analysis Run → Report Version
└── DataFoundry Ask → read-only SQL → answer + provenance
```

不得从 energyiq-rebuild 选择性移植代码、合同、Runtime、Receipt 或测试结论。需要的业务能力必须依据当前 accepted 文档和 energyiq-datafoundry 现有代码重新确认。

## 4. 理由

1. DataFoundry 已经覆盖 AI 问数最重的 Chat、Session、数据接入和审计基础。
2. 固定结构报告不需要引入通用 BI 平台。
3. 首期只新增一个确定性的 Analysis 产品面，避免重做整套问数系统。
4. 统一能源事实层后，固定报告与 AI 回答可以共享口径和来源。
5. 将能源能力作为独立领域模块加入 DataFoundry，比合并两个完整应用更容易控制复杂度。

## 5. 必须新增的深模块

- `EnergyIngestionAdapter`：接入 Excel 和 Tuya API，负责增量、限流、幂等和 raw 留存。
- `EnergyFactModule`：处理累计读数差分、设备层级、日级聚合、质量标记和来源回执。
- `AnalysisTemplateModule`：运行模板、提出修改、发布新版本。
- `AnalysisRenderer`：把受控模板 Schema 渲染为 Analysis 页面。
- `WorkspaceAccess`：从认证 Membership 推导 Workspace，不信任任意前端租户参数。

## 6. 复杂度控制

- 不把能源规则塞入通用 Agent Prompt；
- 不让模板保存任意 SQL、React 或 HTML；
- 不为了首期新增多 Agent 编排；
- 不暴露 DataFoundry 通用工作台中的高级配置；
- 不在能源事实层稳定前接入第二套 BI 服务。

## 7. 重新评估条件

| 出现的需求 | 重新考虑 |
| --- | --- |
| 客户需要拖拽、组合和长期维护复杂看板 | Superset |
| 模板必须作为 SQL/YAML 在 Git 中批量部署 | Rill |
| AI 修改模板进入当前交付 | 实现受控 Template Change Proposal |
| 多账号、Partner 后台进入交付 | 强化 Workspace/Membership 和运营后台 |
| 日级同步无法满足运营时效 | 重新设计 Tuya Connector 的同步水位与调度 |

## 8. 当前代码核验

Data Foundry 可以作为 AI 问数基础，但不能直接等同于完整的 EnergyIQ。

| 能力 | 当前状态 | 处理 |
| --- | --- | --- |
| 登录、Chat、Session、Run | 已有 | 直接复用 |
| SQLite、DuckDB、CSV、XLSX 数据源 | 已有 | 直接复用数据源 Adapter |
| read-only SQL、查询历史、审计、Artifact 版本 | 已有 | 作为 AI 问数和溯源基础 |
| Workspace、Membership | 只有 `personal` / `owner` 形态 | 首期保留接口，后续扩展共享账号和角色 |
| Tuya 每日同步 | 缺失 | 新增能源数据接入模块 |
| 累计电表差分与质量检查 | 缺失 | 新增能源事实模块 |
| 结构化模板、不可变版本、复跑 | 缺失 | 新增模板领域模型和运行器 |

现有 XLSX Adapter 适合预览和临时查询，不应作为长期能源存储。试验阶段采用：

```text
storage/metadata/workbench.sqlite
  └── 用户、Workspace、Session、模板、运行、审计等控制数据

storage/energy/<workspace_id>/energy.duckdb
  └── raw readings、标准读数、区间用电、日级事实
```

能源 DuckDB 仍通过 Data Foundry 的 Data Gateway 注册，因此 AI 问数不需要重建一套查询系统。

## 9. 试验规模与存储结论

```text
20 个电表 × 24 小时 × 每小时 4 条 = 1,920 条/天
1,920 × 30 = 57,600 条/月
1,920 × 365 = 700,800 条/年
```

这是读数条数，不等于 Tuya API 调用次数；实际调用量取决于接口的批量、分页和设备维度。

即使 raw 与差分后的 interval facts 各保存一份，也约为 140 万条/年，DuckDB 足够。首期不引入 PostgreSQL、TimescaleDB、Kafka 或独立 BI 服务。

分析库最少包含：

```text
sync_batches
device_mappings
raw_meter_readings
meter_readings
meter_interval_usage
energy_daily_facts
```

所有表保留 `workspace_id`、来源批次和质量状态。累计读数必须先按设备、时间排序并差分；AI 和模板都只查询标准事实，不直接对 `Active Energy` 求和。

## 10. 改造思路 2：共用数据底座，分开两个产品面

```text
Tuya API / Excel
  → EnergyIngestionModule.sync
  → raw 留存、去重、增量水位、设备映射
  → EnergyFactModule.prepare
  → 累计读数差分、异常标记、日级事实、Data Snapshot
       ├── AnalysisTemplateModule.run
       │     → Analysis Run → Report Version
       └── DataFoundry Ask
             → read-only SQL → answer/chart + provenance
```

三个深模块保持小接口、复杂实现：

```ts
interface EnergyIngestionModule {
  sync(input: SyncWorkspaceInput): Promise<SyncBatchResult>;
}

interface EnergyFactModule {
  prepare(input: PrepareEnergySnapshotInput): Promise<EnergySnapshot>;
  execute(input: EnergyQuerySpec): Promise<EnergyQueryResult>;
}

interface AnalysisTemplateModule {
  run(input: RunTemplateInput): Promise<AnalysisRun>;
  proposeChange(input: ProposeTemplateChangeInput): Promise<TemplateChangeProposal>;
  publish(input: PublishTemplateChangeInput): Promise<TemplateRevision>;
}
```

- `EnergyIngestionModule` 内部通过 `ExcelEnergySourceAdapter` 和 `TuyaEnergySourceAdapter` 适配来源差异。
- `EnergyFactModule` 是唯一计算口径入口，隐藏累计差分、重置、缺数、总分表和指标版本。
- `AnalysisTemplateModule` 只接受受控 Schema，不保存任意 SQL、Prompt、HTML 或 React 代码。
- 首期只有一个 React Renderer，不提前为假设中的多个 Renderer 抽象 Adapter。

## 11. 模板编辑与 AI 编辑使用同一条安全链

人工编辑和未来 AI 编辑不能走两套逻辑：

```text
编辑者提出修改
  → Template Change Proposal
  → Schema 校验
  → 指标和维度白名单校验
  → 用固定 Data Snapshot 预览
  → 展示 diff
  → 人工确认
  → 发布新的不可变 Template Revision
```

首期由后台人员创建 Proposal；未来 AI 只是把自然语言转换成同一种结构化 Proposal。AI 不直接改数据库、不直接覆盖已发布模板、不拥有发布权限。

已发布 Revision 只能引用：

- 模块类型；
- 指标 ID 和版本；
- 维度；
- 过滤器；
- 时间参数；
- 排序、阈值和展示配置。

这样现在的人工模板编辑不会成为以后 AI 编辑的技术债。

## 12. 复跑的准确含义

复跑不是“重新问一次 AI”，而是确定性运行：

```text
Analysis Run =
  workspace_id
  + template_revision_id
  + period
  + parameters
  + data_snapshot_id
  + metric_version
```

- 选择新的时间段：使用同一 Template Revision 创建新的 Analysis Run。
- 使用最新数据刷新：创建新 Run 和 Report Version，不覆盖旧结果。
- 精确审计重放：使用相同 Revision、参数和 Data Snapshot，结果指纹应一致。
- 模板修改后：发布新 Revision；旧 Run 永远指向旧 Revision，保证历史可解释。

Data Foundry 现有 Artifact Version 可以承载图表或报告文件版本，但不能代替 `TemplateRevision` 和 `AnalysisRun`；这两个需要独立领域表。

## 13. 实施顺序

1. **能源数据切片**：先用现有 Excel 导入 DuckDB，完成幂等、差分、异常和边界读数测试。
2. **固定模板闭环**：实现一个受控 Template Schema、一个发布版本、运行历史、按时间段复跑和溯源。
3. **接通 AI Analyst**：让 DataFoundry 只查询 Energy Fact Layer，回答携带 SQL、参数、快照和口径版本。
4. **Tuya 每日同步**：增加 Tuya Adapter、每日调度、水位、分页、限流、重试和同步状态。
5. **内部模板后台**：用 Proposal → 校验 → 预览 → 发布链编辑模板。
6. **未来 AI 改模板**：AI 生成 Proposal；继续由人确认发布，不改变运行器。

首期验收闭环是：**每日数据可同步、固定模板可复跑、历史结果可追溯、AI 问数与模板数字一致**。
