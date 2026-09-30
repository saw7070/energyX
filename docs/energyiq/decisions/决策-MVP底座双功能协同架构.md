---
title: "决策：MVP 采用底座 + 双功能 + 协同架构"
summary: "数据底座支撑结构化模板和 AI Analyst；结构化模板是核心产品，AI 是增强，二者分别跑通后再协同。"
doc_type: decision
tags: [MVP, 数据底座, 结构化模板, AI Analyst, 三Agent]
updated_at: "2026-08-03"
related:
  - "决策-NgeeAnn首个试点路线与页面边界.md"
  - "../plans/2026-08-03-三Agent-MVP执行手册.md"
  - "说明-DataFoundry-Agent-Harness与EnergyIQ复用边界.md"
status: accepted
---

# 决策：MVP 采用底座 + 双功能 + 协同架构

## 1. 背景

EnergyIQ 的首要目标不是建设通用数据平台或复杂 Agent 系统，而是尽快用 Ngee Ann 真实案例跑通一个客户可以理解和验收的 MVP。

产品核心是结构化模板：它面向 Boss/FM，主动给出结论、证据和行动建议。AI Analyst 是增强能力，用于模板之外的追问、探索和解释。数据底座只负责把两种功能需要的数据处理正确，不作为独立产品无限扩张。

正式仓库只有：

    D:\Projects\energyiq-datafoundry

energyiq-rebuild 已废弃，不维护、不参考、不迁移。

## 2. 选项

| 选项 | 做法 | 结论 |
| --- | --- | --- |
| A. 先扩建完整平台 | 先做通用指标、完整 Snapshot、Receipt、多 Agent 等平台能力 | 拒绝；不能快速形成案例闭环 |
| B. 三个平级产品线 | 数据、模板、AI 各自发展后再集成 | 拒绝；容易重复建设和数字不一致 |
| C. 底座 + 双功能 + 协同 | 底座按需支撑；模板优先；AI 并行增强；最后协同 | 采用 |

## 3. 决定

产品架构：

    Energy Data Foundation
       ├─ Structured Template / Overview（核心）
       └─ AI Analyst（增强）
                     ↓
              Context / Evidence 协同

开发原则：

1. 首个案例固定为 Ngee Ann；
2. 结构化模板是产品主线和最终集成入口；
3. 数据底座只建设当前案例真正需要的数据能力；
4. AI 复用 DataFoundry 原生 Runtime、Harness 和界面；
5. 两个功能分别跑通后，再做上下文协同；
6. Preschool、Tuya、Water 和 AI 修改模板后置；
7. 不以“技术平台更完整”代替“客户流程可以跑通”。

## 4. 当前真实进度

### 数据底座：基本可用，尚需封口

已经存在：

- Excel 导入和不可变 Import Batch；
- 累计读数差分为 15 分钟 usage_kwh 和 average_kw；
- Project/Tier/Meter Mapping、总表/分表和 Virtual Meter 基础；
- Workspace DuckDB；
- Ngee Ann 已物化真实 Excel 批次；
- Energy Query Context 和 Scope 只读数据源；
- 总览、小时曲线、Circuit Breakdown 和确定性 Attention；
- 相关定向测试大部分通过。

尚需完成：

- 固定 Ngee Ann MVP 时间范围和 golden 结果；
- 保证运行中 API 场景下测试和查询稳定；
- 补最小 Data Health；
- 向结构化模板和 AI 提供同一份稳定分析结果。

### 结构化模板：实现较多，但正式案例尚未发布

已经存在：

- Template Schema、Catalog、Draft、Preview 和发布代码；
- Admin Preview 与客户 Overview 的共享 Render Plan/Renderer；
- 时间范围和真实 Energy Analysis 接入基础；
- 相关 31 项定向测试通过。

尚需完成：

- 当前 Ngee Ann 和 Preschool 都没有正式 Template Revision；
- Ngee Ann Overview 仍需完成正式发布和真实案例验收；
- Save Analysis、History 和 Rerun 尚未实现；
- Explorer 仍含硬编码结构、成本、比较和建议，需要收窄。

### AI Analyst：平台链路存在，Energy 案例尚未证明

已经存在：

- EnergyIQ AI 页面复用 DataTasksApp；
- CopilotKit/AG-UI；
- Mastra Agent Runtime；
- 服务端可信 Energy Query Context；
- 当前 Scope 的只读 datasource；
- inspect schema、preview、readonly SQL；
- Task Console、Run Event、Artifact、Evidence、Knowledge、MCP、Skills 和模型配置基础；
- Context 相关定向测试通过。

尚需完成：

- 确认真实模型 Provider 可调用；
- 用 Ngee Ann 跑通一次真实问题；
- 补最小 Energy 语义说明，优先使用原生 Scoped Datasource、只读 SQL、验证和 Evidence；只有实测无法稳定对齐的确定性指标才增加薄 Tool；
- 验证答案、数据、图表和 Evidence 一致；
- 用十个 Boss 核心问题完成案例验收。

## 5. MVP 产品里程碑

### M1：Ngee Ann 可交互 Overview

- 真实数据可稳定分析；
- 管理员正式发布 Ngee Ann Template Revision；
- Boss/FM 可选择时间查看结构化结论；
- Overview 展示 Action、Data Status、Overview、Level Comparison、Day Profile、Exceptions 和 Actions。

### M2：保存、复跑与数据核查

- Save Analysis；
- Saved Analysis；
- Runs History；
- Rerun 使用最新数据创建新结果；
- Explorer 只保留层级、读数、用量、功率、来源和 Data Health。

### M3：AI Analyst 可信问数

- 使用同一 Ngee Ann 数据和范围；
- 回答总量/历史、Level 与 Circuit、分类构成、峰值、非营业浪费、归一化表现、数据质量和行动优先级；
- 返回解释、表格或受控图表；
- Task Console 展示真实查询过程。

M1、M2、M3 全部通过才算第一版 MVP 完成。M1 可以作为阶段演示，但不能单独宣称 MVP 完成。

### M4：结构化模板与 AI 协同

- Overview/Explorer 跳转 AI 并携带 Project、Scope 和 Period；
- AI Evidence 可回到相同 Overview/Explorer 范围；
- AI 修改模板仍后置，只允许未来生成受控 Proposal。

M4 紧随第一版 MVP 开始，但不阻塞 M1–M3 的首次验收。

### M5：泛化和外部接入

- Preschool 三层结构；
- Tuya API；
- Water；
- 更复杂图表；
- AI Template Proposal。

## 6. 明确不新增的平台

MVP 不新增：

- Agent Runtime；
- Task Console；
- Knowledge/MCP/模型管理；
- Deep Agents；
- 多 Agent 编排；
- Query Receipt 系统；
- 通用低代码指标平台；
- 任意历史 Snapshot 重放；
- 第二套 DuckDB；
- 第二套账户或 Session。

这些不是产品缺口。DataFoundry 已有的能力直接复用。

## 7. 数据追溯和历史结果

普通 Interactive Analysis 和 AI 问数使用现有：

- Run/Session；
- Tool Call；
- SQL Audit；
- Artifact；
- Evidence Binding；
- Task Console 和 Trace。

不为每次普通查询建立新的 Query Receipt 领域对象。

用户保存分析时，Analysis Run 保存当时的结果、数据批次、模板和规则版本。打开历史记录直接读取保存结果；Rerun 使用最新 Available 数据创建新结果，不要求未来重放旧数据库状态。

## 8. 图表生成

允许 AI 根据查询结果选择图表并生成 DataFoundry 受控 Chart Artifact。

MVP 直接使用现有：

- bar；
- line；
- pie；
- 多 series；
- Artifact Preview；
- Recharts 展示。

不允许 AI 输出并执行任意 React、JavaScript 或 ECharts 代码。Heatmap、Quadrant 等复杂图表在有真实需求时增加受控类型。

## 9. 复审条件

只有出现以下情况才考虑增加复杂度：

- 真实项目无法用现有 Metric/Rule 表达；
- 单机 DuckDB 无法满足客户规模；
- Tuya 明确要求亚日或流式处理；
- 现有 Mastra/AG-UI 或原生可信查询链路无法完成必要 Energy 问题；
- 客户明确要求自由拖拽 BI；
- 单 Agent 无法稳定完成真实问题。
