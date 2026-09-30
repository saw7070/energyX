---
title: "说明：DataFoundry Agent Runtime、Harness 与 EnergyIQ 复用边界"
summary: "解释 DataFoundry 已有 Agent 架构、Task Console、Evidence、图表和协作能力，以及 EnergyIQ 只需补什么。"
doc_type: concept
tags: [DataFoundry, Agent Runtime, Harness, Task Console, Artifact]
updated_at: "2026-08-03"
related:
  - "决策-MVP底座双功能协同架构.md"
  - "../plans/2026-08-03-三Agent-MVP执行手册.md"
---

# 说明：DataFoundry Agent Runtime、Harness 与 EnergyIQ 复用边界

## 1. 先用人话理解

Runtime 是真正驱动模型“读问题、调用工具、查看结果、继续分析、返回答案”的核心循环。

Harness 是 Runtime 外围的运行保障，包括身份、Workspace、Session、Memory、Context、工具权限、Knowledge、MCP、Skills、文件、Artifact、人工确认、Task Console 和 Trace。

EnergyIQ 不需要重新建设它们，只需要把能源数据、范围和分析规则接进现有 Harness。

## 2. 当前架构

    EnergyIQ AI page
        ↓
    DataTasksApp / CopilotKit
        ↓
    AG-UI event protocol
        ↓
    DataFoundry Run Harness
        ↓
    Mastra Agent Runtime
        ↓
    Governed Tools
        ├─ Data source / readonly SQL
        ├─ Workspace / Files
        ├─ Knowledge
        ├─ MCP
        ├─ Skills
        ├─ Task / Plan
        └─ Artifact
        ↓
    Run Events / Evidence / Artifact
        ↓
    Task Console and final answer

关键代码入口：

- apps/api/src/run-agent-assembly.ts；
- apps/api/src/server.ts；
- packages/agent-runtime/src/index.ts；
- packages/agent-runtime/src/tools/data-tools.ts；
- apps/web/src/app/data-tasks；
- apps/web/src/app/energyiq/_components/energy-analysis-workbench.tsx。

## 3. DataFoundry 已经有的能力

- Mastra Runtime；
- AG-UI 前后端事件；
- CopilotKit/DataTasksApp；
- Session、Memory、Checkpoint 和 Resume；
- Workspace 和文件；
- Knowledge；
- MCP；
- Skills；
- 模型配置和运行选择；
- Tool allowlist 和只读 SQL；
- Run Event、SQL Audit、Artifact 和 Evidence Binding；
- Task Console；
- 人工确认工具；
- chart/csv/report/file Artifact。

EnergyIQ 不重新开发这些能力。

## 4. Task Console、Receipt 和 Evidence

Task Console 是用户看到的过程界面，展示 Agent 调用了什么工具、执行了什么查询、产生了什么 Artifact。

所谓 Query Receipt 是“一次查询的正式小票”，可能记录范围、数据版本、SQL、行数和结果 hash。但 DataFoundry 已有 SQL Audit、Artifact、Evidence Binding、Verified Values 和 Trace，因此普通问数不需要再建立一套 Receipt。

Saved Analysis 只需冻结：

- Analysis Result；
- Project/Scope/Period；
- 数据批次；
- Template/Metric/Rule 版本；
- 相关 Artifact 和 Evidence reference。

## 5. Snapshot 与 Rerun

Snapshot 是分析时所见数据状态的标识。

完整 Snapshot 重放意味着未来仍能恢复旧数据状态并重新执行旧查询。这需要历史版本仓库，MVP 不做。

MVP：

- 历史分析直接读取保存结果；
- Rerun 使用最新数据创建新结果；
- 原结果不覆盖；
- 保存数据批次和版本，保证可说明来源。

## 6. 图表生成

DataFoundry 已支持结构化 Chart Artifact：

- bar；
- line；
- pie；
- points 和多 series；
- Artifact Preview；
- Recharts Renderer。

AI 可以自由决定使用哪种已支持图表，但图表数据必须来自 Tool/SQL Result。AI 不输出并执行任意前端代码。

## 7. Collaboration 与 Multi-Agent

DataFoundry 当前的 Collaboration 主要是：

- ask_user；
- submit_plan；
- 人工确认、暂停和恢复。

它不是完整的多 Agent 编排系统。EnergyIQ MVP 使用一个 Agent 加多个受控 Tool，不新增多个专业 Agent 协作。

## 8. EnergyIQ 只需要补什么

1. 服务端可信的 Project、Scope、Resource 和 Period；
2. 当前范围的能源数据源；
3. Energy 专属分析 instructions；
4. 复用确定性 Energy Analysis 的 Tool；
5. 与结果绑定的受控 Chart Artifact；
6. Ngee Ann 真实端到端测试。

## 9. 小结

- Runtime 不换；
- Harness 不重建；
- Task Console 直接复用；
- Knowledge、MCP、Skills 和模型管理直接复用；
- 普通查询不建新 Receipt；
- AI 可以生成受控图表；
- 多 Agent 和 AI 改模板后置。
