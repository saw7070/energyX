---
title: "Overview 与 AI Analyst 新主 Agent 编排交接"
summary: "把已确认的 Spec、20 个 GitHub Tickets、最多三个 Worker、Worktree 生命周期和 Smart Zone 上下文规则交给一个全新主 Agent。"
doc_type: handoff
tags: [Overview, AI Analyst, Orchestrator, GitHub Issues, Worktree]
updated_at: "2026-08-04"
status: ready-for-handoff
---

# Overview 与 AI Analyst 新主 Agent 编排交接

## 1. 交接目的

后续开发由一个**全新上下文的主 Agent**负责。当前会话已经完成需求讨论、风险复核、Spec 和 Ticket 拆分，但上下文过长，不应继续担任 Orchestrator。

新主 Agent 的职责不是独自实现全部功能，而是：

1. 维护 Parent Spec、Ticket 依赖和执行 Frontier；
2. 保护现有未提交工作；
3. 管理 Integration Worktree 和最多三个 Worker Worktree；
4. 为每个 Worker 生成最小 Context Pack；
5. 审查 Interface 变化、Commit、测试证据和产品行为；
6. 只有在 Acceptance Criteria 真正满足后才关闭 Ticket。

## 2. 唯一正确仓库

- 正确仓库：`D:\Projects\energyiq-datafoundry`
- GitHub：`Zion74/energyiq-datafoundry`
- `energyiq-rebuild` 已废弃，不维护、不回写、不作为实现参考源。
- 所有 `gh` 命令必须显式带 `--repo Zion74/energyiq-datafoundry`。根 `package.json` 仍包含上游 DataFoundry 仓库信息，依赖隐式推断可能把操作指向错误仓库。

## 3. 已完成的规划资产

- Parent Spec：[GitHub #1](https://github.com/Zion74/energyiq-datafoundry/issues/1)
- 执行 Tickets：GitHub #2 至 #21
- 所有 Tickets 已应用 `ready-for-agent`。
- GitHub 原生 `Blocked by` 关系已经创建并抽查通过。
- 当前唯一无阻塞的执行 Ticket 是 [#2 T01 稳定 EnergyIQ 集成基线与 Worktree 池](https://github.com/Zion74/energyiq-datafoundry/issues/2)。

Ticket 编号映射：

| Ticket | GitHub |
| --- | --- |
| T01 集成基线与 Worktree 池 | #2 |
| T02 Project Analysis Resolver / Renderer Registry | #3 |
| T03 Tariff / Operating Hours | #4 |
| T04 Area / Headcount | #5 |
| T05 Ngee Ann 核心 Overview | #6 |
| T06 Ngee Ann Level/Circuit/Category | #7 |
| T07 Ngee Ann 时间与异常 | #8 |
| T08 Ngee Ann 决策页面 | #9 |
| T09 Preschool Benchmark | #10 |
| T10 Preschool 分布与四象限 | #11 |
| T11 Preschool 运营分析 | #12 |
| T12 Preschool 决策与 Forecast | #13 |
| T13 DataFoundry 可信文本问数 | #14 |
| T14 受控图表与异步 Run | #15 |
| T15 Overview → AI Analyst | #16 |
| T16 Ngee Ann AI Slot | #17 |
| T17 Preschool AI Slot | #18 |
| T18 Project Release | #19 |
| T19 Saved Analysis / Rerun / Export | #20 |
| T20 产品验收与试点发布 | #21 |

## 4. 新主 Agent 启动顺序

### Step 1：只恢复事实，不立即开发

完整阅读：

1. 根 `AGENTS.md`；
2. 根 `CONTEXT.md`；
3. `docs/energyiq/CONTEXT.md`；
4. GitHub Spec #1；
5. GitHub Ticket #2 及评论；
6. 与 #2 Acceptance Criteria 直接相关的当前代码、测试和 Git 状态。

不要读取整个旧聊天作为主要上下文。已确认结论以 Spec #1、GitHub Tickets、领域文档和当前代码为准。

### Step 2：主 Agent 亲自控制 T01

当前工作区包含大量来自不同 Agent 的未提交和未跟踪修改。T01 完成前：

- 不得 reset、clean、checkout 覆盖或批量移动现有修改；
- 不得让多个 Worker 同时写当前主工作区；
- 不得先启动 T03、T04 或 T13；
- 先完成变更归属、基线测试、Integration Worktree 和 Worker 池设计。

T01 可以使用只读子 Agent 做代码/测试审计，但主 Agent必须拥有最终整合决策。

### Step 3：按 Frontier 启动 Worker

T01 关闭后执行 T02。T02 关闭后，第一批推荐并行 Frontier 正好是三张：

- #4 / T03：Tariff 与 Operating Hours；
- #5 / T04：Area 与 Headcount；
- #14 / T13：DataFoundry 可信文本问数。

之后始终通过 GitHub 原生 `blocked_by` 查询 Frontier，不凭记忆手工猜依赖。

## 5. Agent 拓扑与并发上限

采用：**一个 Orchestrator + 最多三个执行 Worker**。

- Orchestrator 负责调度、Interface、审查、集成、完整测试和关闭 Ticket；不长期占用一个 Feature Worktree 写大功能。
- Worker 一次只拥有一张 ready Ticket 和一个独立分支/Worktree。
- 最多三个执行 Worker，不得因为有更多可用 Agent 就扩大并发。
- 如果多个 Ticket 会修改同一个深层 Module，由 Orchestrator 串行化或重新划分所有权。

## 6. Smart Zone Context Pack

新 Worker 默认使用干净上下文，不继承主 Agent 的完整历史。每次只发送：

1. 正确仓库和禁止触碰 `energyiq-rebuild`；
2. Parent Spec #1；
3. 当前 Ticket 完整正文与评论；
4. 当前 Ticket 的直接 blockers 及其已完成 Interface；
5. 必读领域术语和相关决策文档；
6. Worker 拥有的 Module 与禁止修改范围；
7. Acceptance Criteria 和必跑测试；
8. Worktree/分支位置；
9. 完成交接格式。

不要把 20 张 Tickets、全部源模板和整个会话一次性塞给 Worker。若 Ticket 开始要求第二个独立目标，停止并回报 Orchestrator，由 Orchestrator 拆分或重新排依赖。

## 7. Agent 通信协议

主 Agent可以直接给子 Agent发送消息、补充约束、要求审计或中断偏航工作。子 Agent也可以回报问题和结果。但即时对话不是长期真相来源。

必须持久化到 GitHub Ticket 评论的内容：

- 新增或改变的 Interface；
- 与 Spec/领域文档的冲突；
- 测试结果和复现命令；
- 阻塞原因和需要谁决定；
- Commit SHA；
- 未完成项和后续 Ticket 建议。

Worker 之间不允许只靠私聊改变共同 Interface。涉及其他 Ticket 的变化必须先通知 Orchestrator，并在相关 Issue 留下可追溯说明。

## 8. Worker 完成交接格式

每个 Worker 结束时必须提供：

```text
Ticket:
Branch / Worktree:
Commit SHA:
Delivered behaviour:
Interfaces changed:
Tests run and results:
Acceptance criteria status:
Known gaps / risks:
Recommended next frontier:
```

“代码写完”“测试大部分通过”或“页面看起来可以”都不等于完成。

## 9. Worktree 与环境纪律

- 保持一个稳定 Integration Worktree，只有这里运行长期 Web、API 和 DuckDB 服务。
- 最多维护三个 Worker Worktree，优先复用安全且干净的 Worktree。
- 每张 Ticket 使用独立 `codex/` 分支。
- 合并后先确认无未提交修改，再复用或安全删除 Worktree。
- 不复制能源 DuckDB、模板数据、模型缓存或长期运行环境到每个 Worker。
- 可以共享 npm 下载缓存；不要盲目让多个 npm Workspace 共用同一个 `node_modules`，Workspace 链接可能指向错误源码。
- 完整构建、浏览器测试和跨 Ticket 集成验证统一在 Integration Worktree 执行。

## 10. 不可突破的产品边界

- Overview 的权威数值来自 Energy Data Foundation + Project Recipe，不来自 Agent 临场 SQL。
- Project Renderer 不直接打开 DuckDB，不计算 Metric，不发明 Recommendation。
- DataFoundry 是可替换的 Energy Analyst Adapter，不是整个 EnergyIQ 数据底座。
- 不新建 Agent Runtime、Task Console、Knowledge/MCP/Skills 管理系统。
- 不做低代码 BI、任意 React/HTML/JavaScript 图表生成或 AI 自动发布模板。
- Ngee Ann 与 Preschool 先做项目专属 Renderer；第三、第四个真实 Renderer 后再提取共性。
- Overview 少废话，但支撑决策、Evidence、影响和行动的描述必须保留。

## 11. 新主 Agent 可直接使用的启动 Prompt

```text
你是 EnergyIQ Overview + AI Analyst 项目的新主 Orchestrator。

只在 D:\Projects\energyiq-datafoundry 工作；energyiq-rebuild 已废弃，禁止修改或引用为当前实现。

首先完整阅读：
1. 根 AGENTS.md 和 CONTEXT.md；
2. docs/energyiq/CONTEXT.md；
3. docs/energyiq/2026-08-04-Overview-AI-New-Orchestrator-Handoff.md；
4. GitHub Spec #1；
5. 当前唯一 Frontier Ticket #2 及评论。

你是 Orchestrator，不要立即启动全部开发。先亲自控制 #2：审计并保护当前脏工作区，建立 Integration Worktree、最多三个可复用 Worker Worktree、三个测试 Seam 和可复现基线。#2 关闭前不要启动下游写入任务。

之后按 GitHub 原生 blocked_by 关系选择 Frontier。采用一个 Orchestrator + 最多三个执行 Worker。每个 Worker 使用干净上下文、独立 Worktree/分支和最小 Context Pack。你可以直接给 Worker 发消息，但所有 Interface 变化、Commit、测试证据和阻塞必须写回对应 GitHub Issue。

任何 Ticket 只有在 Acceptance Criteria、集成测试和可观察产品行为全部满足后才能关闭。不要用 provider connected、流程 completed、局部单测或 Worker 自报完成代替产品验收。
```

## 12. 当前交接状态

- 规划完成；
- Spec 已发布；
- 20 个 Tickets 已发布；
- 原生依赖已建立；
- 没有启动后续实现 Worker；
- 下一步由新主 Agent从 #2 开始。
