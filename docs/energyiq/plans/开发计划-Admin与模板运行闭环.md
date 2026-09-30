---
title: "EnergyIQ 开发计划：Admin 与模板运行闭环"
summary: "在 DataFoundry 现有代码上分批完成 Tier、计量映射、Excel 数据、项目模板、复跑和客户页面贯通。"
doc_type: playbook
tags: [开发计划, Admin, Tier, Excel, Template Revision, Analysis Run]
updated_at: "2026-08-26"
related:
  - "../decisions/当前共识与新会话入口.md"
  - "../product/领域模型.md"
  - "流程-项目配置与模板发布.md"
  - "../decisions/决策-NgeeAnn首个试点路线与页面边界.md"
status: in_progress
---

# EnergyIQ 开发计划：Admin 与模板运行闭环

> 状态：**数据事实、Admin 配置、Template Draft/Revision 代码和双端 Renderer 已有较完整基础；当前不再横向扩建，转为完成 Ngee Ann 真实 MVP。**

> 2026-08-03 路线修正：以[底座 + 双功能 + 协同](../decisions/决策-MVP底座双功能协同架构.md)为最高优先级。Data Foundation 封口 Ngee Ann golden result；Structured Template 先发布正式 Revision 并验收 Interactive Overview，再补 Save/History/Rerun 与精简 Explorer；AI Analyst 并行复用 DataFoundry 原生能力完成可信问数；最后才做二者协同。

实施证据见：[2026-08-01 Admin 与 Tier 批次 0–1 实施记录](../records/2026-08-01-Admin-Tier-批次0-1实施记录.md)、[Admin Meter Mapping 与虚拟电表实施记录](../records/2026-08-01-Admin-Meter-Mapping与虚拟电表实施记录.md)、[Admin Excel Import Batch 实施记录](../records/2026-08-01-Admin-Excel-Import-Batch实施记录.md)、[Admin Metric/Rule Registry 实施记录](../records/2026-08-02-Admin-Metric-Rule-Registry实施记录.md)和 [Admin Component Catalog 与 Template Draft 实施记录](../records/2026-08-02-Admin-Component-Catalog与Template-Draft实施记录.md)。

## 1. 目标

在现有 energyiq-datafoundry 上二次开发，不重做账户、聊天、技术配置和 Preview。先把 Admin 做成可完成一个项目交付的工具，再让 Overview、Explorer 和 AI Analyst 只消费已发布配置。

最终 MVP 闭环：

~~~text
admin creates Project
→ configures Tiers/Nodes
→ imports Excel
→ confirms Meter Mapping
→ validates facts and quality
→ configures metrics/rules/templates
→ previews and publishes
→ user selects Project/time/scope
→ reruns Overview
→ drills into Explorer
→ continues in AI Analyst with the same trusted context
~~~

## 1.1 2026-08-15 Admin Overview 与 AI Readiness 执行方案

### 背景与目标

Preschool Overview 已形成三层客户价值输出：

1. **Layer 1 · Key Findings**：跨 Section 的简洁总结；
2. **Layer 2 · Section AI Interpretation**：本 Section 的 Summary 与可继续深挖的 Insights；
3. **Layer 3 · Additional AI Insights**：由受治理的 Method、SOP 或模型新角度产生的额外发现。

Admin 当前仍主要表达确定性配置和模板发布，无法直接回答三个交付问题：客户现在能看到什么、Overview 与三层 AI 是否就绪、管理员下一步应该做什么。本批次不扩建通用运维平台，而是补齐一个项目级 **Overview & AI Readiness** 闭环。

### 产品边界

- 客户 Overview 继续只读取已保存的分析结果，打开或刷新页面不得启动 Provider；
- Admin 可以读取当前 Project 的确定性 Overview、Layer 1–3 和精确的当前/过期状态；
- `Generate missing analysis` 只生成当前 Snapshot/Release 下尚未成功保存的分析，不强制覆盖已有成功结果；
- 涂鸦管理员可以对自己有权管理的 Project 触发 `Generate missing analysis`；MVP 继续使用现有 `admin` 角色，不新增未经验证的 `partner_admin` 角色；
- 权限、Project/Workspace 归属、当前 Snapshot/Release/Profile 和允许动作全部由服务端解析，浏览器不提交权威身份；
- 普通 `user`、跨 Workspace 管理员和无权 Project 均不能触发生成；
- 本批不开放模型切换、Method 发布、全量强制重跑、跨 Project 批量生成或任意 Provider 参数。

### 深模块接口

Admin 页面只依赖一个项目级 Readiness Module，而不直接解释多个底层 Artifact/Run：

~~~ts
readProjectOverviewAdminState(projectId)

requestProjectOverviewAdminAction({
  projectId,
  action,
  target?
})
~~~

`readProjectOverviewAdminState` 返回：

- Project 发布状态和客户 Overview 入口；
- 当前 Data Snapshot / Project Release 的人类可读摘要；
- 确定性 Overview 是否可用；
- Layer 1 Key Findings 状态；
- Layer 2 各 Section 的独立状态与覆盖数；
- Layer 3 Additional AI Insights 状态；
- 最后成功生成时间、局部失败与是否过期；
- 服务端计算的 `allowedActions` 和唯一 `recommendedNextAction`。

动作合同按能力逐步开放：

- 本批：`generate-missing`；
- 后续：`retry-section`、`regenerate-key-findings`、`regenerate-additional`。

同一 Project、Snapshot、Release 和动作的重复请求必须幂等；浏览器双击不得制造重复 Provider Run。

### Admin 信息架构与语言

Project Admin 围绕“客户体验”重新组织，但不在第一批大规模移动旧页面：

- `Overview Setup` 改为 **Overview Design**，只负责确定性页面、Metric、Rule、Layout 与发布配置；
- 新增 **AI Analysis**，负责 Layer 1–3 状态、生成缺失结果和局部失败定位；
- **Knowledge** 只表示 AI 可引用的文档与引用；
- Additional Insight Method Proposal 从 Knowledge 中拆出为 **Methods & SOP**；
- Project Overview 增加一个紧凑的 **Overview & AI readiness** 摘要，显示当前客户可见状态和唯一下一步。

Admin 面向 Charles、涂鸦管理员和实施人员使用业务语言；技术字段只放在 `Technical details`：

| 内部术语 | Admin 文案 |
| --- | --- |
| Artifact | Saved analysis result |
| ensure/materialize | Generate missing analysis |
| retry target | Retry failed item |
| Executive synthesis | Key Findings |
| Section Interpreter | Section analysis |
| empty | No new insight for this data update |
| identity mismatch | Out of date for current data |
| Method proposal | Analysis method proposal |

统一状态：`Ready`、`Generating`、`Not generated`、`Needs attention`、`No new insight`、`Out of date`。

### Tickets 与执行顺序

1. **Admin Readiness contract and read model**：先固定状态语义、项目能力和只读接口；
2. **Project-scoped Generate missing analysis**：补授权、幂等和成本边界；
3. **Admin navigation and terminology**：拆分 Overview Design、AI Analysis、Knowledge、Methods & SOP；
4. **AI Analysis and Project Overview UI**：实现 readiness 摘要、状态表、唯一下一步和操作反馈；
5. **Cross-project and multi-account acceptance**：Preschool 与 Ngee Ann 使用各自能力适配，验证 Charles、涂鸦管理员和普通用户。

前一个 Ticket 的公开合同和红测通过后，后一个 Ticket 才可开始。不得把 Preschool 的四个 Section 写成所有 Project 的通用事实；Readiness Module 必须根据 Project Renderer/AI capability 返回可用层级。

执行跟踪：

| Ticket | 状态 | 结果 |
| --- | --- | --- |
| [#49 Admin Readiness](https://github.com/Zion74/energyiq-datafoundry/issues/49) | automated complete | 项目级只读状态、当前身份、Layer 1–3 独立状态和过期判断已实现 |
| [#50 Generate missing analysis](https://github.com/Zion74/energyiq-datafoundry/issues/50) | automated complete | 仅授权 Admin 可触发；复用现有 current identity、成功 Artifact 和运行幂等边界 |
| [#51 Admin IA](https://github.com/Zion74/energyiq-datafoundry/issues/51) | automated complete | Overview Design、AI Analysis、Knowledge、Methods & SOP 已分工 |
| [#52 Admin UI](https://github.com/Zion74/energyiq-datafoundry/issues/52) | automated complete | Project Overview 摘要、完整 Readiness、单一 AI 主动作和 Technical details 已实现 |
| [#53 Acceptance](https://github.com/Zion74/energyiq-datafoundry/issues/53) | ready for human | 等待浏览器、多账户、真实 Provider 与部署环境验收 |

### 验收门

- Admin 普通 GET、客户 Overview 打开与刷新均不增加 Provider Run；
- 有缺失分析时，授权管理员看到一个明确的 `Generate missing analysis` 主动作；全部就绪时不显示误导性生成动作；
- 涂鸦管理员只能对有权 Project 操作，Charles 管理员可查看全部 Project，普通用户不能进入 Admin 或调用生成接口；
- 部分 Section 失败不会隐藏成功 sibling，Layer 1/3 状态独立显示；
- 过期结果不能冒充当前结果，必须显示 `Out of date for current data`；
- Preschool 显示 Layer 1–3；Ngee Ann 只显示其已接入的能力，不伪造 Preschool Section；
- 页面首先显示结论与下一步，原始 Artifact/Run/Revision 仅在 Technical details 中出现；
- Web focused tests、API authorization/idempotency tests、build/typecheck、1440px/1920px 浏览器检查和多账户人工验收通过。

### 风险控制

| 风险 | 控制 |
| --- | --- |
| 发布已成功但 AI 部分失败 | 确定性 Overview 与三层 AI 分开显示状态，局部失败不阻断客户事实 |
| 新数据后恢复旧结果 | Readiness 绑定服务端当前 Snapshot/Release，旧结果显示 Out of date |
| 双击或多人同时生成造成成本 | server-owned idempotency key、current identity 和 existing-success reuse |
| 涂鸦管理员越权 | 现有 `admin` 角色 + Workspace/Project 精确归属校验；拒绝浏览器提供的 Workspace 权威值 |
| Admin 退化成技术监控台 | 默认只显示客户可见状态、覆盖数、最后生成和唯一下一步；技术身份折叠 |
| 把 Preschool 结构写死 | Project capability adapter 决定层级、Section 和可用动作 |
| Knowledge 与 Method 混淆 | Knowledge 只管理来源资料；Methods & SOP 管理分析方法和提案 |

## 1.2 2026-08-15 Preschool Stage 1–3 可用化、A→B 与发布跟踪

### 当前判断

本节是当前执行入口，避免把任务状态只保存在聊天上下文中。GitHub [#47](https://github.com/Zion74/energyiq-datafoundry/issues/47) 继续作为 Preschool Stage 3 父 Ticket；本节只记录依赖顺序、完成定义、当前证据和预计时间。代码测试、真实 Provider、浏览器、人工价值判断和生产部署必须分开报告。

截至 2026-08-15，本地权威 Integration Metadata 显示：

- Layer 1 Key Findings 与 Layer 2 Section Interpretation 已有可用 `v4` Artifact；
- Layer 3 Additional AI Insights 只有历史 `additional-insights-v8` 可用 Artifact；
- 当前实现已旋转到 `additional-insights-v12`，因此旧 v8 只能历史只读，不能冒充当前结果；
- 普通 Overview 打开或刷新只读取已保存 Artifact，不自动启动 Provider；
- 因此当前页面的 Layer 3 `Unavailable` 是“当前 v12 尚未生成/发布”的诚实状态，不是 dev mode 自动造成，也不能仅靠刷新恢复。

本地 v12 改造把每条 Additional Insight 分成两个表达层：

1. `Evidence signal`：数字、日期、Centre、事件和其他硬事实必须可追溯；
2. `AI angle`：允许模型提出关系、反例、假设、可能原因和低风险实验，只要使用 `inferred` / `speculative` 等诚实状态，不把猜想写成确认事实。

这不是固定 What/Why/How 模板，也不限定分析主题。Evidence 是事实底座，AI angle 是 Agent 的发散空间。

### 关键路径与 Ticket 拆分

| 顺序 | 优先级 | Ticket / 工作包 | 完成定义 | 依赖 | 预计净耗时 |
| --- | --- | --- | --- | --- | --- |
| 1 | P0 | [#58 Stage 3 v12 本地收口与 Provider pass@3](https://github.com/Zion74/energyiq-datafoundry/issues/58) | focused tests、Contracts/Metadata/API/Web build、diff review、clean commit 全绿；部署后完成三次真实 attempt | 无 | 本地 0.5–1 小时；Provider 1–2 小时 |
| 2 | P0 | #58 v12 不可变部署 | 服务器运行精确 commit；Metadata migration、API ready、Web health 和数据库路径核对通过 | #58 本地门 | 0.5–1 小时 |
| 3 | P0 | #58 当前 Snapshot 真实 Provider pass@3 | 同一 Snapshot/Profile 三次独立 attempt；坏候选局部拒绝；至少两次进入可人工审核状态 | 部署、Provider/Profile/Secret 正常 | 1–2 小时 |
| 4 | P0 | [#59 人工盲审与正式 Overview 发布](https://github.com/Zion74/energyiq-datafoundry/issues/59) | 管理员能看盲审包、评分、批准；批准结果产生 current v12 Overview Artifact，而不只停留在 `publication-candidate-only` | #58 | 2–4 小时（含缺失发布 seam） |
| 5 | P0 | Preschool Stage 1–3 浏览器价值验收 | Key Findings、Section Summary/Insights、Additional 的 Evidence signal/AI angle 可见；语句自然、重点明确、Evidence 可读、无 console/overflow | 4 | 1–2 小时 |
| 6 | P1 | [#60 Preschool 真实 Snapshot A→B](https://github.com/Zion74/energyiq-datafoundry/issues/60) | A 严格早于 B；指标、Key Findings、Section、Additional、AI Analysis 数据域同步变化；旧结论被保留/更新/淘汰；普通刷新 Run 数不增 | #59、受控 B 数据 | 0.5–1 工作日 |
| 7 | P1 | 生产多账户验收 | Charles 管理员看全部项目；Ngee Ann 普通账号只见 Ngee Ann；两个项目 Overview 和 AI Analysis 可用 | 5，最好完成 6 | 1–2 小时 |
| 8 | P1 | Ngee Ann 通用 AI Slot | 实现 Ngee Ann 自己的 Pack、Key Findings、Section Interpretation、Additional 与 Readiness Adapter，不复制 Preschool 四 Section | 5–7 | 2–4 工作日 |
| 9 | P1 | AI 质量反馈与 Method/SOP 沉淀 | 记录 usefulness、复述、清晰度、Explore 行为；用户认可的 Insight 生成 Proposal，人工批准后进入复跑方法库 | 6、8 | 1–2 工作日 MVP |

### “真正可用”的时间定义

- **Preschool Stage 1–3 本地可用**：完成 1、3、4、5。若 Provider 与本地数据库正常，预计还需 **4–8 小时**；自动测试通过不能替代真实 Provider 和人工价值验收。
- **Preschool 生产可交给 Charles 测试**：完成 1–5，并通过生产部署与账号 smoke，预计 **同一工作日内**；如果正式发布 seam 或 Provider 出现新阻塞，按 Ticket 单独报告。
- **连续数据 A→B 与多账户达到客户验收状态**：完成 6–7，预计再需 **0.5–1 工作日**。
- **Ngee Ann 也进入公共 Layer 1–3 产品流程**：完成 8，预计 **2–4 工作日**，不应为了赶进度复制 Preschool 业务 Pack。
- **质量反馈与 SOP Library MVP**：完成 9，预计 **1–2 工作日**；不会自动批准或发布客户方法。

### 硬验收门

1. 当前 Snapshot/Release/Profile/identity 必须 exact；旧 Artifact 只能历史只读。
2. 打开、刷新、展开 Evidence 和 Saved restore 的 Provider Run 增量必须为 0。
3. 硬事实必须有当前 Evidence；发散角度可以超出证明范围，但必须诚实标注不确定性，不能添加无来源的精确数字、日期、Centre 或事件。
4. 一个坏候选只淘汰自己；不得吞掉其他有价值候选或确定性 Overview。
5. 人工批准必须明确区分“候选通过评估”与“已经进入客户 Overview”；两者之间需要可审计的发布动作。
6. A→B 必须同时切换确定性 Overview、三层 AI Artifact 和 AI Analysis context；只比较 Additional 不算整页 A→B。
7. 多账户、真实 Provider、浏览器、数据库和部署分别保存证据，任何一项不能替代其他项。

### 后续 GitHub 关系

- [#47](https://github.com/Zion74/energyiq-datafoundry/issues/47)：Preschool Stage 3 父 Ticket；
- [#58](https://github.com/Zion74/energyiq-datafoundry/issues/58)：v12 Evidence signal / AI angle、部署与真实 Provider pass@3；
- [#59](https://github.com/Zion74/energyiq-datafoundry/issues/59)：已批准候选发布到 current Overview；
- [#60](https://github.com/Zion74/energyiq-datafoundry/issues/60)：Preschool 整页与 AI 数据域 A→B；
- [#39](https://github.com/Zion74/energyiq-datafoundry/issues/39)：新 Snapshot 后预生成 current Overview Artifact；
- [#53](https://github.com/Zion74/energyiq-datafoundry/issues/53)：生产浏览器与多账户验收；
- [#55](https://github.com/Zion74/energyiq-datafoundry/issues/55)：Ngee Ann 接入公共 Layer 1–3；
- [#56](https://github.com/Zion74/energyiq-datafoundry/issues/56)：Ngee Ann 真实 A→B；
- [#57](https://github.com/Zion74/energyiq-datafoundry/issues/57)：AI 质量反馈与 Method/SOP 沉淀。

## 1.3 2026-08-15 Admin AI 可解释性 tracer bullet

本节记录 [#61](https://github.com/Zion74/energyiq-datafoundry/issues/61) 的正式执行边界。目标不是新增通用 AI 配置台，而是在现有 Project Admin `AI Analysis` 与 `Methods & SOP` 中回答两个交付问题：当前 Project/Layer 声明允许什么，以及一个 exact saved Finding 实际用了什么。

### 深模块与读取边界

扩展现有 `readProjectOverviewAdminState(projectId)`，由服务端从 current Project identity、已验证的 Overview Read Model、Method Governance Store 和 Artifact provenance 组合 explainability projection。普通 Admin GET 继续保持 `private, no-store`，不调用 Provider、不执行 Tool、不 ensure、不 queue。Workspace、Project、Artifact、Finding、Method 和 Snapshot/Release/Period identity 均由服务端解析；跨租户、错 Project 或不完整 provenance fail closed，单条 trace 不可用时只把该项标为 `Unavailable`。

Read Model 必须显式区分：

1. **Declared available**：当前 Project/Layer 合同声明可用的 Skill、Harness/Pack、Method 与 Tool；
2. **Actually loaded**：该 Artifact 的 Run 实际加载并被 exact revision/content SHA 固定的 Method；
3. **Finding attributed**：该 Finding `origin` 实际引用的 core/direction Method，以及 hybrid 的 novel contribution；
4. **Tool succeeded**：该 Finding 引用且对应 audit 状态为 succeeded 的 Tool call。

允许但未调用、Run 加载但 Finding 未引用、被拒绝的 Tool audit 均不得显示为“已使用”。技术 ID、revision、SHA、fingerprint、Run/Artifact identity 默认折叠；Admin 默认看到人类可读的 Evidence signal、AI angle、origin 与范围摘要。

### Method/SOP 与评论治理

- builtin core Method 以 builtin 范围显示；published Workspace Method 对该 Workspace 的共享 Overview 可见，来源 Project 与运行可见范围分开表达；
- provisional、in-review、approved、published 状态继续来自现有 Method Proposal/Governance Store，不建立第二套 Store；
- Useful / Not useful 继续绑定 exact Finding；
- Finding comment 作为同一 Governance Store 内的 exact Finding append-only audit，保留 actor/time，不修改 Artifact；
- 历史 Artifact 只读。评论、反馈和 Proposal 是独立治理记录，不回写历史输出；
- 对分析方法的任何修改只形成 Proposal。评论、反馈、点击或票数都不能自动 approve/publish Skill、Method 或 SOP。

### TDD 与验收门

按一个公开 seam、一个 RED、一个最小 GREEN 的 vertical slices 执行：

1. Admin state/API：tenant exact、`private, no-store`、普通 GET 0 Provider、available-vs-used、historical read-only、局部 unavailable；
2. Governance：exact Finding append-only comment、跨 Workspace/Project/Artifact/Finding 拒绝、Artifact 不变、Proposal 状态不自动推进；
3. Web：AI Analysis 显示 exact Finding trace，Methods & SOP 显示生命周期与真实可见范围，技术 identity 折叠。

focused API/Web tests、相关 Contracts/Metadata/API/Web builds 与 `git diff --check` 为自动化工程门。真实 Provider、浏览器/设备、部署、多账户和人工价值验收继续分别报告，不能由自动化结果替代。

冲突边界：本 Ticket 不修改 Stage 3 discovery、identity、Artifact/evaluation mutation、正式发布或 A→B compare 实现；优先只读消费已有 provenance。若必须触碰这些文件，先停线协调。

### 2026-08-15 实现状态

- 已完成 `overview-admin-state` explainability 深读模型：分别表达 declared available、actually loaded、Finding attributed 与 tool succeeded；被拒绝或只声明未调用的 Tool 不计为已使用。
- 已完成同一 Method Governance Store 内的 exact Finding append-only comment；评论、反馈和 Proposal 不回写 Artifact，也不自动 approve/publish Method 或 SOP。
- 已完成 Admin `AI Analysis` 的人类可读 trace、折叠技术 identity 和 exact Finding 治理操作；`Methods & SOP` 同步展示 published catalog、范围、revision 与 Proposal 生命周期。
- 自动化证据：focused API/Web/Metadata 共 37 tests 通过；Metadata、API 和 Web production build 通过；`git diff --check` 通过；受保护的 Stage 3 discovery/identity/artifact/evaluation/A→B compare 文件无 diff。
- 尚未执行：真实 Provider、真实浏览器/设备、部署与人工产品验收。它们不得由上述自动化结果替代。

## 1.4 2026-08-16 Admin Harness Configuration 与 AI Operations 修订路线

本节记录 [#62](https://github.com/Zion74/energyiq-datafoundry/issues/62) 的正式路线。原“AI Configuration 直接挂接 Models/Skills/Tools/MCP”设想不足以表达当前 Runtime：generic AI Analyst、Overview Key Findings、Section Analysis 与 Additional Insights 使用不同的模型绑定、Context、Skill/Method 与 Tool seam；配置存在也不代表某个 Harness 声明可用，更不代表某次 Run 实际使用。因此 Admin 分组改为 **Harness Configuration**，先建设解释性的只读配置，再在同一 identity 上建设 AI Operations。

### 审查后必须修正的假设

1. **Skill selection 可能依赖用户输入。** generic Analyst 的 auto selection 只能在 Run 或显式 preview POST 中解析；普通配置 GET 只显示候选、默认与 policy，并标为 `Resolved per run`，不能预演成 exact selected set。
2. **Config Resource 当前物理 owner 是 `workspace_id + user_id`。** payload 中声明 `scope=workspace` 不能单独证明真正 Workspace 共享。Read Model 同时显示 physical owner 与 declared scope；不一致、无法证明或跨 actor 的资源 fail closed，不在本批次做隐式迁移。
3. **MCP manifest 与连接状态是持久化快照，不是 live health。** GET 只显示 persisted status、manifest revision 与 as-of；连接/模型测试只能由显式、可审计 POST 触发。
4. **Context capacity 是规划合同。** `contextWindow` 必须同时显示 `explicit-profile / verified-model-default / conservative-fallback` 来源，不能把 fallback 当作 Provider 保证。
5. **Configuration 不等于 historical execution。** current Store revision 不可反查并冒充历史 Run；历史只读取当时 Run event、Context Package/Plan、Artifact provenance 与 audit。缺失 Run-captured MCP server→tool mapping 时显示 `Unavailable`，不能套用 current manifest。
6. **System Prompt 不是单一可编辑字符串。** Platform instruction、Workflow/Stage Prompt、Skill/Method instruction、Context source 与 Output Contract 分层展示。首批只返回脱敏摘要、revision/content hash 与静态模板预览；动态 tenant Prompt/Context 留给 AI Operations，并继续做会话可见性与审计。
7. **当前 admin 不自动等于 platform operator。** secret、headers、MCP command、内部路径、平台私有 policy 与动态客户内容不因 admin GET 直接下发。

### 深模块与状态语言

第一条公开 seam 固定为：

```ts
readProjectHarnessConfiguration(projectId)
```

调用方只传 Project id；服务端解析 actor、Workspace、Project、Release、system-owned model binding、Workspace Analyst defaults、Project capability、Config Resource、Method Governance 与 Runtime registry。返回按 Harness/Stage 分组的 Models、Skills/Methods、Tools/MCP、Context 与 Instructions，以及局部 `Unavailable`。普通 GET 保持 `private, no-store`、0 Provider、0 model probe、0 MCP connect、0 Tool、0 ensure/queue。

统一状态链：

```text
registered/configured
→ declared eligible for this Harness
→ resolved/selected/materialized in one Run
→ actually loaded/read or called
→ succeeded and/or attributed by one Finding
```

前一状态不得自动推导后一状态。AI Analysis 继续回答“当前客户结果与 exact Finding 为什么出现”；Methods & SOP 继续治理 Proposal；Harness Configuration 回答“当前允许如何运行”；AI Operations 回答“历史上实际怎样运行”。

### Tickets 与执行顺序

1. [#63 HCFG-1](https://github.com/Zion74/energyiq-datafoundry/issues/63)：server-owned Project Harness Configuration read model；
2. [#64 HCFG-2](https://github.com/Zion74/energyiq-datafoundry/issues/64)：Admin Harness Configuration interface；
3. [#65 AIOPS-1](https://github.com/Zion74/energyiq-datafoundry/issues/65)：Project AI Run configuration and execution trace；
4. [#66 HCFG-3](https://github.com/Zion74/energyiq-datafoundry/issues/66)：只有 immutable revision/history 合同充分后才开放 Project Harness Policy Draft/Validate/Diff/Publish。

#63 是首个 `ready-for-agent` tracer。#64 blocked by #63；#65 blocked by #63/#64；#66 blocked by #63/#64。#30、#54、#57、#61 作为 Harness Eval、跨项目 AI、质量治理与 Finding explainability 的相关前置，不把整个 Configuration/Operations 路线错误挂在 #57 之下。

### TDD 与验收门

- API seam：admin-only、tenant/Project exact、system model 与 Workspace default 不混淆、run-dependent selection、persisted-not-live MCP、owner/scope mismatch、secret redaction、partial unavailable、historical current-vs-snapshot 分离；
- Web seam：Harness Configuration 导航与五类摘要、available-vs-used copy、技术 identity 折叠、空/局部不可用与 responsive；
- 不修改 Stage 3 discovery/identity/artifact/evaluation/A→B 文件；优先只读消费 #61 与既有 provenance；
- focused API/Web tests、相关 package builds 与 `git diff --check` 是自动化门；真实 Provider、真实 MCP、浏览器、多账户、部署和人工验收分别报告。

### 2026-08-16 Worker 实现状态

- [#63](https://github.com/Zion74/energyiq-datafoundry/issues/63) 的只读 seam 已在独立分支 `codex/admin-harness-configuration` 完成：`GET /api/v1/energy/projects/:projectId/harness-configuration` 只接受服务端解析的 Admin/Workspace/Project identity，响应 `private, no-store`，不调用 Provider、model probe、MCP connect、Tool 或 Overview ensure/queue。实现提交为 `7e2daaafddb90f43c1fc1eb00d8689502a90f679`，system binding 与 Analyst current-resource routing 隔离修正为 `719ca243ee31b40310801e65b1d9cc48560d3b6e`。
- Read Model 已明确区分 current catalog 与 Harness declaration：generic Analyst 标为 `Resolved per run`；Preschool Key Findings、Section Analysis 与 Additional Insights 标为 `Fixed stage contract`；Ngee Ann 不伪造 Preschool Stages。system-owned model binding 只进入 Overview Stages，当前 Admin model resource 只作为 Analyst candidate；context capacity 复用 Run planning 的同一纯 resolver。
- Skill 同时返回 physical owner、declared scope、revision、enabled/status 与 scope verification；`scope=workspace` 但仍为 user-owned 的资源 fail closed 为 `Unavailable`。MCP 只返回 persisted status、as-of 与 last-tested manifest 名称，不返回 URL、headers、secret、command 或内部文件引用，也不做 live health 推断。
- [#64](https://github.com/Zion74/energyiq-datafoundry/issues/64) 的 Admin 界面已在 `3d12738fee7b28885da4f62e3ce786895d65a4b1` 完成：侧栏分组由 `AI Configuration` 改为 `Harness Configuration`，单一 Project-exact 页面展示 Harness overview、Models & Routing、Skills & Methods、Tools & MCP、Context & Instructions 五类摘要；技术 ID/revision/SHA 默认折叠，空与局部 unavailable 显式显示。
- UI copy 固定 `Configured / Declared for this Harness / Resolved per run` 与历史 `selected/loaded/succeeded` 的边界：当前配置不冒充 historical Run evidence，registered Tool 不冒充 called/succeeded，persisted MCP snapshot 不冒充 live connection；System Prompt 以 Platform、Workflow/Stage、Skill/Method、Context 与 Output Contract 分层摘要表达，不开放任意 Prompt/MCP/Tool 编辑器。
- [#65](https://github.com/Zion74/energyiq-datafoundry/issues/65) 的 Project-scoped list/detail 已在 `ac6b2292b62875f8a391444dccd186d072ea8a2d` 完成：`GET /api/v1/energy/projects/:projectId/ai-operations` 与 `GET /api/v1/energy/projects/:projectId/ai-operations/runs/:runId` 只读取 exact Project 的 immutable Session/Run/Event、Context Plan、Artifact provenance 与 Finding identity，响应 `private, no-store`，不调用 Provider、MCP 或 Tool。历史 `run.config.resolved` 缺失时返回 `Unavailable`，不反查 current model、Skill 或 MCP manifest。
- 新 Run 从 `ac6b2292b62875f8a391444dccd186d072ea8a2d` 起固化 secret-free `resource_revisions`、MCP server→tool mapping 和实际 `skill.materialized` identity；旧 Run 只有 `skill.selection` 时只显示 `Selected for Run`，不得标为 `Actually materialized`。Tool trace 只暴露 called/succeeded/rejected/failed 与时间，不返回参数、结果、Prompt、会话正文、存储路径或 Finding 正文。
- [#65](https://github.com/Zion74/energyiq-datafoundry/issues/65) 的 Admin `Runs & Traces` 页面已在 `7488b8c3a56741d33586f808ca2c1acd0d554170` 完成：首次只请求 Project Run 列表，管理员显式打开 Run 后才读取 detail；历史配置、selected/materialized Skills、MCP mapping、Context selected/omitted/truncation、Tool outcomes、Tokens 与 Artifact/Finding lineage 分区展示，技术 ID 默认折叠，局部缺证据显式 unavailable。
- 当前自动化证据：API focused 11 tests、Web focused 12 tests 通过；`@datafoundry/metadata`、`@datafoundry/api` TypeScript build 与 `@datafoundry/web` production build 通过；`git diff --check` 通过；受保护的 Stage 3 discovery/identity/artifact/evaluation/A→B 文件无 diff。真实 Provider、真实 MCP、真实浏览器/设备、多账户部署与人工产品验收尚未执行，不能由这些自动化结果替代。
- [#66](https://github.com/Zion74/energyiq-datafoundry/issues/66) governed Harness Policy revision 仍未实现。只有 immutable Draft/Validate/Diff/Publish 与权限合同充分后才可进入；不得把评论、Proposal 或当前配置页面升级为直接编辑 published revision。

### 2026-08-23 Code Drift 复核与 Truth Alignment 批次

初始复核基线为 `main@0fce1a5157a053b5b353e4c49236f4d9086f36ce`；实现完成前已 rebase 并重新验收到 `main@b0a2e4261c26a56408a7bdfdb721d28fc5b172fa`。正式 Skill package、Config Resource、Method Governance 以及现有 Harness/Operations UI 基本未变，但 Managed Overview、Report Time Context 和 Ngee Ann AI Stages 已显著演进。原“Ngee Ann 不继承 Preschool-only Stages”的验收仍必要，却已不足够：旧 `overviewHarnesses(...)` 对非 Preschool renderer 返回空数组，导致 Ngee Ann 自身的 Section Interpretation、Executive Synthesis 与 Additional Insights Harness 也不可见。最新 main 另新增 `energy-template-overview`（Tuya）；它应展示自身 published Definition/Policy，但在没有对应 AI Stage contract 时不得套用 Preschool/Ngee stages。

本批次继续归属 #63/#65，不新建 Store 或平行路线图，工作分支为 `codex/admin-harness-truth-alignment`，交付 PR 为 [#99](https://github.com/Zion74/energyiq-datafoundry/pull/99)。执行顺序固定为：

1. **Harness truth**：在既有 `readProjectHarnessConfiguration(projectId)` 中枚举 exact Project 当前真实 Stages，并投影 published Overview Definition revision/fingerprint、Report Time Policy revision、named window/Section binding，以及 code-owned Prompt、Validator 与 Output Contract revision；
2. **Resource-specific evidence states**：Skill 使用 `configured/declared/selected/materialized/loaded`，Method 使用 `published/declared/injected/attributed`，Tool 使用 `registered/declared/called/succeeded|rejected|failed`；缺少持久证据不得推导后一状态；
3. **Operations truth**：`skill.materialized` 只能显示 `materialized`，不能继续命名为 `loadedSkills`；真实 load/read 未持久化时显示 `Unavailable`；历史 Run 不以 current config 回填；
4. **GET purity**：普通 Harness/Operations GET 的自动化门扩展为 0 Provider、0 MCP connect/probe、0 Tool、0 ensure/materialize write、0 queue/rebuild；
5. **UI truth**：保留 list-first/detail-on-demand、技术 identity 折叠和局部 unavailable；不返回 raw Prompt、动态客户 Context、Tool args/results、secret 或内部路径；
6. **Skill extraction 后置**：Section Interpretation、Executive Synthesis 和 Open Discovery 只抽取稳定 SOP；字段语义、单位、Report Time、Schema、Evidence binding、tenant exactness 与审批继续留在 Contract/Validator/Governance。

本批次以 API/Web 公共 seam 做纵向 TDD tracer：先让 Ngee Ann 当前 Stage catalog RED，再最小 GREEN；随后分别覆盖 Definition/Policy identity、materialized-vs-loaded、GET 0 ensure 和历史 unavailable。受保护的 Stage 3 discovery、Artifact identity/evaluation/mutation、Change Review 及正在进行的 Ngee AI quality 路径只读消费；如必须修改，先停线协调 owner。

详细证据、备选路线及可推翻条件见 [2026-08-23 Admin Harness Truth 与 Skill 演进复核交接](../handoff/agent/2026-08-23-Admin-Harness-Truth与Skill演进复核交接.md)。

## 1.5 2026-08-24 PR #99 后 Harness Evolution 路线

[PR #99](https://github.com/Zion74/energyiq-datafoundry/pull/99) 已合入 `main@6950206f14cff11fbbb2c7c47e67c3a5cc8c5374`，建立了可信的只读 Harness Configuration 与 AI Operations 基线。其 GitHub Build and Web Tests、Core Smoke Tests 和 Docs checks 通过；#61/#63/#64/#65 仍保留 `ready-for-human`，直到集成、浏览器、多账户和产品验收 Owner 记录剩余证据。合并与 CI 不替代这些验收。

从此节点起，执行顺序不再是“先开放 Configuration 写入，再补 Operations”。历史事件和不可变 revision 尚不足时开放编辑，会使管理员无法解释某次 Run 使用了什么，也无法安全回滚。因此后续顺序固定为：

```text
PR #99 read-only truth baseline
├─ #102 Run Event v1 / reconstructable request
│  ├─ PR #110 hash-only event tracer + bounded Runs slice (merged)
│  ├─ #122 protected payload envelope + exact reconstruction
│  ├─ #123 retention / deletion / audited access, blocked by #122
│  └─ #66 editable policy prerequisite
│     ├─ #124 Models & Routing
│     ├─ #125 Skill Library / Prompt-to-Skill Proposal
│     ├─ #126 Tools & MCP
│     └─ #127 Context & Instructions
├─ #103 pi-ai target Model Gateway feasibility -> PR #120 accepted as isolated evaluation only
├─ #104 inventory (closed via PR #115)
│  └─ #114 data-analysis governed actual-load vertical
└─ #105 Mastra/Pi Agent Core parity, still blocked by complete #102 + accepted #103
```

### 1.5.1 唯一 Ticket 树

1. [#102 AIOPS-2](https://github.com/Zion74/energyiq-datafoundry/issues/102)：PR #110 已合入 typed event、hash-only request identity 与 bounded Runs slice；可重建 Payload 仍拆为 [#122](https://github.com/Zion74/energyiq-datafoundry/issues/122) protected envelope 和 [#123](https://github.com/Zion74/energyiq-datafoundry/issues/123) retention/deletion/audit；
2. [#103 MODEL-1](https://github.com/Zion74/energyiq-datafoundry/issues/103)：PR #120 的内容已按隔离 evaluation 接受，但任何合并仍需 fresh CI 和主 Agent 排程；它不能成为生产依赖、adapter、默认 Runtime 或 #105 授权；
3. [#104 SKILLMAP-1](https://github.com/Zion74/energyiq-datafoundry/issues/104)：已随 PR #115 合并关闭，固定 Protocol/Validator、Stage Prompt、Skill、Method/SOP 与动态 Context 的职责边界；
4. [#105 RUNTIME-1](https://github.com/Zion74/energyiq-datafoundry/issues/105)：只有完整 #102 与被接受并完成 disposition 的 #103 均满足、且再次获主 Agent 授权后，才以固定任务、模型行为、Context、Tools 和预算做 Mastra/Pi Agent Core parity spike；
5. [#66 HCFG-3](https://github.com/Zion74/energyiq-datafoundry/issues/66)：只有 #102 和 Config Resource immutable revision/history audit 充分后，才开放单一 Draft → Validate → Diff/Preview → human Publish；资源产品路线为 [#124 Models](https://github.com/Zion74/energyiq-datafoundry/issues/124)、[#125 Skills](https://github.com/Zion74/energyiq-datafoundry/issues/125)、[#126 Tools/MCP](https://github.com/Zion74/energyiq-datafoundry/issues/126) 与 [#127 Context/Instructions](https://github.com/Zion74/energyiq-datafoundry/issues/127)，不是四套 Store；
6. [#114 SKILL-1](https://github.com/Zion74/energyiq-datafoundry/issues/114) 是 #104 产生的第一条 Skill 实现票：深化现有 `data-analysis`，复用 PR #110 的 forward event 基础记录 actual-load；它不替代 #122/#123，也不预先把 Section Interpretation、Executive Synthesis 或 Open Discovery 发布为 formal Skill，易变状态以 GitHub Issue 为准。

Pi Coding Agent 暂不建票。只有出现明确的 Template/Renderer Build/Review consumer、短生命周期 Worker/Sandbox、脱敏 fixture 和无 `publish()` 能力合同后，才评估隔离 Coding Runtime；不得把它作为 EnergyIQ 分析 Runtime 或 Skill Store。

### 1.5.2 Run Event v1 的第一条纵向切片

- 复用既有 Metadata Session/Run/Event 与 AI Operations read projection，不建立第二套 Trace Store；
- 固化 exact Workspace/Project/Session/Run、sequence、schema revision、causation/correlation、payload ref 和 content fingerprint；
- 第一批状态至少覆盖 `config.resolved`、`prompt.materialized`、`skill.selected/materialized/loaded`、`method.injected`、`model.request.prepared`、`tool.called/rejected/succeeded/failed` 与 terminal state；
- “模型可见即可重建”的边界是 EnergyIQ Provider adapter 收到的应用级请求，不包含 Provider 内部变换或隐藏思维链；
- secret、credential、private header、内部路径和不应由 Admin 读取的动态客户内容不得进入公开投影；
- 历史 Run 缺新事件时局部 `Unavailable`，不从 current configuration 回填；
- live AG-UI/SSE 是 derived transport，不是 durable truth；
- 普通 Harness/Operations GET 继续保持 `private, no-store` 与 0 Provider/MCP/Tool/ensure/write/queue。

### 1.5.3 Runtime 与 Skill 决策门

- Mastra 继续是唯一生产 Runtime；Pi Agent Core 只是 challenger。只有安全、正确性、事件、终态、清理、Evidence/Artifact 与维护成本硬门全部通过，才讨论后续采用；
- `pi-ai` 可以成为 Model Gateway 候选，但不能取代 EnergyIQ 的 Model Profile revision、Workspace visibility、secret reference、Context planning、capability verification 和 Run snapshot；
- Prompt 是一次 Stage 的动态装配；Skill 是可复用、版本化、可治理的稳定 SOP；Method 是分析角度及其治理身份；Protocol 是 phase/action/transition/terminal 状态机；Schema、单位、Report Time、Evidence binding、tenant exactness 和发布权限继续属于 Validator/Output Contract/Governance；
- Pi Tool calling 不等于 MCP。MCP server identity、manifest snapshot、Workspace visibility、connection audit 与 Tool outcome 继续由 EnergyIQ 管理。

长期边界见[《Harness 逻辑控制面、Run Event 与可替换 Runtime 边界》](../decisions/决策-Harness逻辑控制面、Run-Event与可替换Runtime边界.md)；外部框架的时点证据与选择性吸收矩阵见[《Pi 三层与 DeepSeek Harness 选择性吸收评估》](../research/2026-08-24-Pi三层与DeepSeek-Harness选择性吸收评估.md)。

### 1.5.4 2026-08-24 主 Agent 复审门

- PR #106 的架构决策已于 2026-08-24 由主 Agent 接受：逻辑控制面复用既有 Store/contract，Protocol/Validator 独立，Model Gateway 仍只是 #103 待证明的目标 seam；接受不代表 #102/#103/#105 的实现门已通过。
- PR #110 已在完整终审后合并为 `9c46a97f1170173771cb341f3bacac8d468b7a32`。被接受的是 **hash-only request identity/event tracer + bounded Runs slice**，不是 reconstructable raw request；#102 invariant 3、at-rest protection、retention/deletion 与 exact access audit 继续 open。Saved Analysis 仅携带 runId 的历史合同缺口仍由 [#117](https://github.com/Zion74/energyiq-datafoundry/issues/117) 跟踪。
- #104 已随 PR #115 合并；#114 因此可沿独立 Skill actual-load 纵切推进，但其易变状态以 GitHub 为准。PR #120 的内容仅作为隔离 evaluation 接受；在合并与 Issue disposition 完成前不构成生产 Model Gateway。
- #105 必须同时等待完整 #102 与完成 disposition 的 #103，并再次获得授权；任何 PR 合并或 CI green 都不能自行启动。

### 1.5.5 #102 protected request 决策门

长期建议与备选项见[《受保护模型请求 Payload、保留与重建权限边界》](../decisions/决策-受保护模型请求Payload与重建权限边界.md)。该文档已按 **proposed design only** 完成内容审核，但 `status` 仍是 `proposed`：生产继续默认 hash-only；不得用 plaintext SQLite、测试 SQL `retained` 行或“Admin DTO 不展示 raw Prompt”冒充 at-rest protection。内容接受不等于实现授权，也不表示 #102 完成。

在新的显式实现授权前，只允许文档和 Ticket 细化，不实现 [#122](https://github.com/Zion74/energyiq-datafoundry/issues/122)/[#123](https://github.com/Zion74/energyiq-datafoundry/issues/123)。候选合同固定为独立 model-request key ring（active-write + retired-read，key material 不进 SQLite、不复用 credential key）、7 天默认/30 天 hard max、旧 key 覆盖 envelope/WAL/backup retention ceiling，以及 canonical payload v1 的 count/byte limits；这些仍是 proposed target，不是生产事实。普通 GET 始终 zero-decrypt/zero-write；任何显式 reconstruction 必须分开 server-authenticated requester capability 与 exact target identity，并按 durable audit intent → exact authorization → decrypt/verify → terminal outcome CAS 的顺序执行，任一 audit 写失败均不得释放 plaintext。

#122/#123 的硬门包括：canonical schema/count/byte over-limit 必须 hash-only 且不截断冒充 exact；authenticated manifest 必须覆盖 capture mode、policy revision、createdAt 与 expiresAt；envelope 与 event ref 原子提交；legacy migration 与双连接 once-only；key rotation/missing-key；cleanup/reconstruct race；expiry/delete tombstone 与 ciphertext 清除同事务；删除后 resurrection 拒绝；每个 `accessAttemptId` 只有一个 durable audit/terminal outcome，同 attempt retry 只返回状态且不二次释放 plaintext。这里不宣称跨进程 exactly-once plaintext delivery。Internal reconstruct/verify 与 Runtime/Provider replay/eval 是两项授权；#105 继续只允许 synthetic/de-identified fixtures，不能因 Payload 可解密就外发客户数据。若后续获实现授权，顺序固定为先实现并独立验收 #122，再单独裁决是否授权 #123；两票不并行实现。

### 1.5.6 Harness Configuration 四条产品路线

Harness Configuration 不是可任意编辑 Prompt/HTML/SQL/Tool 的 Studio。四条路线共用 #66 的一个 Harness Policy revision lifecycle：

| 路线 | 当前配置回答 | 历史 Operations 回答 | Ticket |
| --- | --- | --- | --- |
| Models & Routing | Profile、Provider/model、visibility、revision、capacity source、fallback | exact selected Profile/adapter/request identity | [#124](https://github.com/Zion74/energyiq-datafoundry/issues/124) |
| Skill Library | formal Skill owner/scope/version/hash/lifecycle 与 Prompt-to-Skill Proposal | selected/materialized/actually loaded，actual-load 由 #114 提供 | [#125](https://github.com/Zion74/energyiq-datafoundry/issues/125) |
| Tools & MCP | registered/declared/local availability/persisted last-test | resolved/offered/called/rejected/failed/succeeded | [#126](https://github.com/Zion74/energyiq-datafoundry/issues/126) |
| Context & Instructions | capacity、五层组成、revision/fingerprint、redacted manifest | exact Context Package/request capture 状态，不以 current 回填 | [#127](https://github.com/Zion74/energyiq-datafoundry/issues/127) |

四票复用现有 Config/Skill/Method/Tool/MCP/Context/Run Event Store；任何写能力都要 Draft → Validate → Diff/Preview → human Publish，历史 Run/Artifact 永不原地改写，具体授权状态以 GitHub Issue 为准。

### 1.5.7 2026-09-02 #114 current-main 窄实现候选

Issue [#114](https://github.com/Zion74/energyiq-datafoundry/issues/114) 已从 `main@f13c20ca0b568b991d435d6744975cb25a337918` 建立新的独立实现候选；初始纵切为 `15567444ba6b70a4f35defb314617c667035373b`，fresh review 修订后的代码 checkpoint 为 `722105707f8896d0472989087e0a04048ce89bfd`。旧 PR #135 与 dev #193 只作为历史证据，没有 cherry-pick 或整支重放。该候选只覆盖 `data-analysis` governed actual-load 纵切：

- 复用现有 Config Resource、Skill package、Run Event 与 AI Operations Store；没有新增第二套 Skill/Trace Store；
- server exact resolve/selection 后先物化 package，再由 Runtime 的单一 reader 读取 exact entry、核对 owner/scope/config revision/package ref/content SHA，并把正文只装入本次模型 instructions；
- `skill.materialized` 保存可信 package identity，`skill.loaded` 只从 reader 成功输出生成确定性、secret-free、forward-only event；正文、动态 Context、Tool 参数/结果与 secret 不进入事件；
- Tool 候选与 MCP 候选先合并，再执行 server policy 与 Skill allowlist 的严格交集；trusted Overview Stage capability 仍走独立强校验，普通 AI Analysis 不获得 implicit Skill；
- Admin detail 只读取 exact historical Run event，并分别展示 selected/materialized/loaded；坏的 load sibling 局部 `unavailable`，有效 sibling 保留，current Config 不回填历史；
- Admin list/detail GET 继续使用 exact Project/Workspace/actor/Run 授权、`private, no-store`，不触发 Provider、MCP、Tool、builtin prepare/ensure、materialize 或 queue。
- 只有 `valid` revision 可进入 Runtime；actual-load v1 只接受 exact builtin `data-analysis`，最多一项、entry 上限 256 KiB。其他 selected Skill 不会被本票隐式加载；nested ZIP entry 使用规范化 materialized path，缺失 entry 只返回不含服务器绝对路径的稳定错误码；
- selection/materialization/load prerequisite 均要求同一 Session，identity 首尾空白不被 trim 改写；selected/materialized 但缺少 loaded event 的 Skill 仍作为局部 `unavailable` 展示，不从列表消失；
- 真实 builtin package 已通过 production assembly/audit seam 写入 canonical Run store；materialized 与 loaded event 均使用确定性 eventId，重放不重复追加，ordinary Run 保持 actual-load default-off；上述 focused API 文件已加入 CI 明确 gate。

修订后本地自动化候选证据：Skills/Runtime/API/Web focused `12 files / 39 tests`；server/AI Slot/Operations `3 files / 77 tests`；authenticated GET 与 Saved Analysis `2 files / 5 tests`；EnergyIQ 三大 seams `7 files / 157 tests`；均通过。root、Skills、Agent Runtime、API 与 Web production build 通过，496 Run 本地 authenticated HTTP 首屏为 `12.4 ms / 8,266 bytes`，`git diff --check` 通过。server 回归中的既有 synthetic `provider.invalid` 用例产生一次无凭据失败连接，只是测试噪声，不是 Provider 验收；本候选没有真实 Provider/MCP、浏览器、人工、部署或生产证据。候选尚未 push、未开 PR、未合并、未部署；fresh Standards/Spec 与远端 CI 仍必须以最终 exact head 独立记录。

## 2. 当前代码基线

开发应直接演进现有模块：

- Metadata：packages/metadata/src/energyiq-store.ts；
- 模板草稿：packages/metadata/src/energyiq-template-store.ts；
- 样板：apps/api/src/energy/energy-bootstrap.ts；
- Query Context：apps/api/src/energy/energy-query-context.ts；
- 确定性分析：apps/api/src/energy/energy-analysis.ts；
- 事实范围：packages/data-gateway/src/energy-scoped-datasource.ts；
- Admin：apps/web/src/app/energyiq/admin；
- 客户页面：apps/web/src/app/energyiq/_components；
- AI 工作台：现有 DataTasksApp。

现状限制：

- Preschool 现有可运行事实仍是 Project → Centre → Circuit，Block → Room → Circuit 目标映射等待客户输入；
- Tariff/Operating Calendar 的不可变持久化、Project/Scope 生效解析、active/Release-pinned 来源和显式 Unavailable 深模块已完成；`energy-analysis.ts` 的 0.2727 仍待 Orchestrator 通过现有 Resolver/Recipe seam 替换，客户 API/Web 尚未打通；
- Metric/Rule Revision 已持久化并驱动确定性计算；Review & Publish 可将 Hierarchy、Formula、Metric/Rule 选择和 Template 一次冻结为 Published Revision；
- Component Catalog、Project/Tier Template Draft、真实 Project/Scope/Period Draft Preview、不可变 Template Revision 存储、Schema v2 和共享 Render Plan 已实现；Analysis Run 与 Rerun 尚未实现；
- 客户 Overview 已通过 Published Template endpoint 与 Admin Preview 共用 Renderer；本地历史 Ngee Ann/Preschool 尚未重新发布 Template Revision，当前使用明确标记的 `compatibility-default`；Explorer 仍需补发布版本上下文。

## 3. 实施原则

1. **在现有 DataFoundry 深模块上增加 EnergyIQ 能力**，不复制 Auth、DataTasksApp、Knowledge 或模型配置。
2. **先做可用的 2–4 Tier**，仅在数据库/API 预留 5–7；不开发跳 Tier。
3. **采用可变 Draft + 不可变 Published Snapshot**。编辑时不为每次输入制造 Revision；发布时一次性冻结 Hierarchy、Formula、Metric/Rule 和 Template 引用。
4. **Excel 先跑通，API 复用同一 Adapter 合同**。
5. **运行时 Excel 解析优先使用现有 Node/TypeScript 技术栈**，减少部署环境；uv/pandas 只做离线复算和 golden validation，不成为生产服务依赖。
6. **先写不变量与合同测试，再迁移样板**。
7. **UI 全英文，文档可中文**。
8. **缺数据就隐藏/降级，不用 mock 伪装正式事实**。

## 4. 批次 0：冻结基线与迁移护栏

### 工作

- 给当前 Ngee Ann 与 Preschool 查询结果建立 golden fixture；
- 固定现有 Energy Query Context 和 Project Access 合同测试；
- 记录现有 SQLite/DuckDB schema、样板 SHA 和可回滚快照；
- 给后续 schema 变更建立明确 migration，不依赖 bootstrap upsert 偷改历史；
- 为旧 node_type API 定义兼容读取窗口，避免一次改坏所有页面。

### 验收

- 现有两个 Project 的总量、Scope 总量、峰值和事实行数可重复验证；
- typecheck、API energy tests、web energy tests 通过；
- 迁移前后可以回到同一数据快照；
- 未触碰无关 DataFoundry 功能。

## 5. 批次 1：Admin Project、Tier 与 Node

这是建议批准后最先开发的可见批次。

### 后端

- 增加 Tier Definition；
- Project Node 改为引用 tier_definition_id，不再用 node_type 做计算；
- Project 保留在 Tier 外；
- 增加 Draft/Validate/Publish 状态和 Hierarchy Snapshot；
- 增加 Node Metadata 的 provisional/confirmed 和有效期；
- 支持 Project 下多个顶层节点；
- 服务端校验 ordinal、父子归属、孤立节点、单节点无意义 Tier；
- 服务端权限继续以 user/admin 和 Membership 为准。

### Admin UI

- Project list + lifecycle status；
- Project Profile；
- Tiers & Nodes，自底向上 Add parent tier；
- Tier alias、说明、节点编辑和属性；
- Save Draft；
- Validate panel，区分 warning 与 blocking error；
- View as user；
- Published 项目才进入客户 Project selector。

### 样板迁移

- Ngee Ann：移除 Block Test，迁移为 Level → Circuit；
- Preschool：保留当前 Centre → Circuit 为 provisional fixture；
- 在没有真实映射前，不创建假的 Block/Room；
- 预建 Preschool 三 Tier Draft 只能作为空结构草稿，不能发布为真实层级。

### 验收

1. admin 可新建 2、3、4 Tier Project；
2. internal ordinal 与显示 alias 完全分离；
3. 单节点且无独立意义时能 Save Draft，但 Publish 警告；
4. user 无法访问 Admin CRUD；
5. 修改 URL 不能越权 Project/Workspace；
6. Ngee Ann 客户树从 Project 直接看到 Level 6/7；
7. 切换 Project 后 Overview、Explorer 和 AI Analyst 都获得新的 project_id。

## 6. 批次 2：Meter Mapping、Virtual Meter 与 Excel

> 实施状态：已完成。真实 `.xlsx` 可保存为带 SHA 的 Import Batch、检查固定字段/标签/覆盖区间/典型间隔并生成可编辑 Mapping Draft；确认 Mapping 后可显式构建 Raw/Normalized/Interval Fact 与质量事件。重复文件复用批次，重叠文件按覆盖结束时间裁决，Ngee Ann 与 Preschool golden 保持不变。

### 后端

- Meter Point 从 Project Node 分离；
- Source Binding 映射 Excel label 或 Tuya device/DP；
- 保存 resource、category、role 和 official aggregation source；
- Meter Topology 与受控线性 Virtual Formula；
- Import Batch、Raw Artifact、Meter Reading、Interval Fact 和质量事件；
- 文件 SHA 与同键幂等；
- 重叠批次冲突策略；
- average rate 按实际区间时长计算。

### Admin UI

- Data Import：文件预览、字段识别、admin 确认；
- Mapping：source label → Meter Point → Scope；
- 角色与分类：total/component/standalone，load/aircon/light/other；
- Virtual Meter 公式编辑器，只支持选择输入和 +/- 系数；
- Quality Summary：负差、缺口、重复、不规则时间、跳变和覆盖率；
- 未映射和重复聚合作为 Publish blocker。

### Excel 与 API 分工

- 先完成 Excel Adapter；
- 定义 Raw Reading Adapter interface；
- Tuya Adapter 在获得正式 API 契约后实现；
- 两种来源共用后续处理；
- 不使用 LLM 自动字段/节点映射。

### 验收

- 重复导入同一文件不增加重复事实；
- 15 分钟累计读数正确转换为 interval_kwh；
- 非 15 分钟区间的 average_kw 仍正确；
- 总表与分表不会重复计入总量；
- 虚拟表缺输入、负值、单位不一致和环依赖均有明确结果；
- Ngee Ann golden total 为约 5328.2073 kWh；
- Preschool May 2026 fixture 总量为约 24921.8123 kWh。

## 7. 批次 3：Metric、Rule、Component 与项目模板

> 实施状态：已完成。系统已有 9 个受控 Metric Revision、5 个受控 Rule Revision 和 10 个受控 Component Revision；Project 可在 Admin `Templates` 中配置一套 Project Overview Template 与每个 Tier 一套共享 Tier Template。Enabled 与 Ready 分开显示，模板可保存启用状态与顺序，并解释 Metric、Rule、Calendar、面积、人数、子节点和 Meter Mapping 缺口。正式 Preview/Publish 属于批次 4。

### 后端

- 建立 Metric Definition/Revision；
- 建立 Rule Revision；
- 建立 Component Catalog；
- 建立 Project Template 和 Tier Template Draft/Revision；
- Component 只引用注册 Metric 与 Query Spec；
- Tariff、Calendar 和 Node Metadata 按分析时间解析；
- 建议输出统一 Evidence Bundle。

### 初始内容

- total/daily average/peak/time；
- own-history comparison；
- same-tier rank；
- kWh/m²、kWh/person；
- off-hours usage/share；
- coverage/quality；
- 四类确定性异常：高于自身基线、非营业用量、峰值时段、可靠元数据下的归一化异常；
- 最近 4 个同类型完整周期历史基线，以及独立的 previous-period comparison；
- Project Rule Revision 阈值、Attention/High priority 和受控 Action Template；
- Charles Preschool Preset；
- Ngee Ann Level/Circuit Preset。

### Admin UI

- Metrics & Rules：有限表单，不暴露任意 SQL；
- Templates：模块启用、顺序和受控参数；
- 项目总览一个模板，每个 Tier 一个模板；
- 缺面积、人数、Calendar、Tariff 或历史时显示明确降级；
- Preview 使用真实 Project/Scope/Period。

### 验收

- alias 改名不影响 Metric 计算；
- 同 Tier 节点在指定祖先下比较；
- 只有两个节点时不生成 Bell curve；
- 缺面积/人数/费率时不显示误导指标；
- 硬编码 tariff 从 energy-analysis.ts 移除；
- Ngee Ann 与 Charles 模块都由同一 Component Catalog 渲染，但可选模块不同。

## 8. 批次 4：Ngee Ann 发布、Interactive Overview 与保存复跑

### 工作

- 已完成：Draft Preview 与正式运行隔离；Preview 使用真实 Project/Scope/Period、canonical fact 覆盖、Project timezone 和受控 Component Renderer；
- 已完成：Publish 产生不可变 Template Revision，并固定 Hierarchy、Formula、Metric/Rule、Calendar 与 Tariff 版本；
- 已完成：Schema v2 保存 Section、Placement、Layout 与 Presentation，并兼容旧版 Placement-only Draft；
- 已完成：Admin Preview 与客户 Overview 共用 `Render Plan → EnergyTemplateRenderer`；
- 待执行：先用 Admin Review & Publish 为 Ngee Ann 生成首个正式 Template Revision；Preschool 后置；
- 先用 Ngee Ann 真实结果完成并验收 Interactive Overview；
- Interactive Overview 验收后，再建立 Saved Analysis/Analysis Run 与运行状态；
- 固定 Context、所用数据批次和全部计算版本；MVP 不建设任意历史 Snapshot 重放平台；
- 保存结果 Artifact、Evidence、SQL/Query Spec 和质量摘要；
- 历史列表、详情和 Rerun；
- 新数据运行产生新 Run，不覆盖旧结果；
- Save analysis 自动命名并允许修改标题/备注；Saved analysis 只读，Explore with these settings 返回交互模式；
- Rerun 记录 rerun_of_run_id，复用原配置和最新 Available 数据；
- Runs History 展示 Name、Project、Scope、Period、Saved by/at、Data/Report status，并支持 Project/Scope/作者筛选；
- 后置：同一 Run Artifact 生成站内 HTML/PDF、Scheduled Report 和邮件发送，不阻塞第一版 MVP；
- Interactive Analysis 的时间/Scope/粒度/对比变化调用同一确定性计算模块，但不创建正式 Run；
- 第一版只有 Save analysis 创建正式 Run；Generate report、定时报告和保存 AI 正式结果后置；
- Interactive Analysis 视图状态可由 URL 恢复和分享，恢复不创建 Run；未保存交互只进入请求日志/AI Session Trace，不进入 Runs History；
- 保存的 Run 归属当前 Workspace，记录 saved_by/saved_at，并对同一 Workspace user 共享；
- 第一版 user 只做手动 Save analysis、只读历史和 Rerun；Scheduled Report 与 Generate report 后置；
- Release/Revision 不修改、不删除；回滚通过重新激活历史 Release 并记录审计；

### 验收

- 已保存结果能解释当时的数据批次和 Revision；Rerun 使用最新可用数据生成新结果且不覆盖历史；
- 改模板、公式、指标或数据后生成新 Run/Revision；
- 历史报告仍能解释当时口径；
- 每条异常和建议可回到来源批次与查询；
- 失败 Run 不覆盖最后一次成功结果。

## 9. 批次 5：客户页面统一消费发布配置

> 实施状态：共享 Published Template endpoint、Render Plan、Renderer、Section 导航和全局 Period 刷新已完成。Heatmap、Recommended Actions、正式 Ngee Ann Revision 验收和 Explorer 发布版本上下文仍未完成。

### Overview

- 使用 Project Template；
- Ngee Ann 顺序固定为 Action Summary → Data Status & Scope → Energy Overview → Level Comparison → Day Profile & Heatmap → Exceptions & Evidence → Recommended Actions；
- Circuit Ranking 嵌入 Level Comparison 或异常证据，不单独堆成长章节；
- Action Summary 最多 3 条，遵循 Problem → Impact → Action → Evidence；无重要异常显示 No priority exceptions；
- 阻断质量问题优先，并抑制受影响的能耗结论；Data Status & Scope 固定且不可关闭；
- Ngee Ann 两个 Level 只做描述性/历史/可用时归一化比较，Circuit Ranking 每个 Level/分类默认 Top 5、可展开；
- Day Profile 区分工作日、周末和公共假期；多日默认 Date × Hour、单日默认 Level × Hour；
- Recommended Actions 只读且连接 Evidence、Explorer、AI Analyst，不实现工单流程；
- 异常使用最近 4 个同类型完整周期的自身历史平均，不足时只做描述；上一周期对比保持独立；
- 首期只做高于自身基线、非营业用量、峰值时段和归一化异常，阈值来自 Project Rule Revision；
- 异常按额外耗电量/影响范围使用 Attention、High priority；Data Health 黄/红保持独立；
- Action Template 由规则选择，AI 只润色；Evidence 固定当前值、基线、差值、贡献 Circuit、质量、Query/SQL 与版本；
- Overview 默认 Last 7 complete days；完整周期不含今天，无数据时提供 View latest available data 而不偷换 Period；
- Custom 统一 `[from, to)`；默认粒度为单日 Hour、2–31 天 Day、更长范围 Week；
- Peak 固定为 15 分钟 interval-average kW；Coverage `<95%` 时隐藏异常/建议并禁用 Save/Generate；
- Project、Scope、Resource、Period 变化后自动刷新全部模块；模块内可切换粒度、上一周期对比、分类和排名展开；
- 普通交互不显示 Run analysis；正式动作使用 Save analysis / Generate report；
- Forecast 和费用按数据条件隐藏/标 Preview。

### Project Explorer

- 通用树支持 2–4 Tier；
- 节点与 Meter Point 分开表现；
- 只展示来源数据与确定性派生值：最新累计读数、区间能耗、区间平均功率、覆盖率、来源与质量；
- 增加统一 Period Selector，默认 Latest complete data day；漏 1 次同步为黄色 Delayed，连续漏 2 次为红色 Stale，连续 3 日有新时间戳但读数不变为黄色 Flatline；
- Connectivity 只有在 Tuya API 明确提供 heartbeat/online 时展示；
- Scope 只在 Official Aggregation Route 受影响时标红，否则汇总子表 warning/critical 数量；Virtual Meter 显示 Derived/Partial；
- 区分最新同步的 Current data health 与所选时间段的 Selected-period quality；
- Meter 摘要固定六项，并提供 user 规范 CSV / admin 原始 payload 两级导出；
- 同级比较、跨节点热力图、用能异常、成本和行动建议全部进入 Overview；
- 水只在配置后出现。

### AI Analyst

- 继续复用 DataTasksApp；
- Investigate with AI 携带可信 Context；
- 会话中变更时间/范围后服务端重新解析；
- Task Console 展示数据选择、质量、计算与 Evidence，不展示模型私有推理。

### Data Map

- user 只读；
- 展示 Tier、Scope、Meter Binding、Metric 和数据来源；
- 关系标记 configured/inferred 和可信级别。

### 验收

- 切换 Project 四个入口同步变化；
- 同一 Scope/Period 在 Overview、Explorer 与 AI 的数字一致；
- Interactive Analysis 的参数变化不产生 Run；保存后的正式 Run 冻结同一计算结果和版本证据；
- 刷新或分享 URL 能恢复 Interactive Analysis 的 Project/Scope/Period 与模块控件，且不产生 Run；
- 未保存结果不出现在 Runs History；保存结果显示创建人/时间并对同一 Workspace 可见；user 无法配置 Scheduled Report；
- Saved analysis 不可被交互控件改写；Explore/Rerun 产生新上下文或新 Run，HTML/PDF 与页面数字一致；
- Overview/Explorer 往返保持 Project、Scope、Period、Resource 与 Run/Release/Snapshot，Circuit 证据直达 Meter；
- 无数据、部分数据、过期、Flatline、连接未知、失败和 provisional 状态明确；
- Yesterday 等预设不因数据过期被静默重解释，Custom 边界与 Project timezone 可复现；
- Coverage `<95%` 的 Interactive Analysis 不产生正式结论或可保存报告；
- 累计读数差分得到的功率明确标为 interval average power，不冒充瞬时功率；
- 客户 UI 不出现 Tier 1/2 计算术语。

## 10. 批次 6：Harness Configuration 与轻量 AI Operations

本批次以 1.4 节和 #62 为准，不再把通用 DataFoundry 技术设置页面直接挂进 EnergyIQ 后就视为完成。Accounts、Data Sources、Knowledge、Assets 与 Data Map 仍复用既有能力；Models、Skills、Methods、Tools、MCP、Context 和 Instructions 通过 Project-exact Harness Read Model 解释其 owner、scope、revision、适用 Stage 与状态链。

### Harness Configuration

- Overview：按 AI Analyst、Key Findings、Section Analysis、Additional Insights 等 capability 展示用途、配置来源与局部 unavailable；
- Models & Routing：system-owned 与 Workspace default 分开，显示 Profile chain、revision、persisted status、context budget 与 capability source，secret redacted；
- Skills & Methods：builtin/user/workspace physical owner、declared scope、version/revision/SHA、policy 与 applicability；Method lifecycle 仍来自 Governance Store；
- Tools & MCP：builtin、server-owned、MCP 三类，allowed/available/run-dependent/actual 分开；MCP manifest 标记 persisted as-of；
- Context & Instructions：Context source、预算、裁剪策略、Platform/Stage/Skill instruction layers 与 Output Contract；不开放任意 Prompt editor。

首批为只读解释面。Project Harness Policy 写能力必须复用 Project Draft/Release，采用 Validate、Diff/Preview、人工 Publish 与新 revision；若现有 Store 不能回读 immutable history，则保持 disabled，不以当前 revision 冒充历史。

### AI Operations

- Project-scoped Run list/detail、失败与 retry/rerun 关系；
- exact model/profile revisions、selected Skill 与 selection audit；
- Run-captured MCP/tool mapping、Tool succeeded/rejected/failed；
- Context Package/Plan selected/omitted/truncation 与 prompt verification telemetry；
- Token、latency、Artifact/Finding provenance；
- 普通 Admin GET 只见 redacted conversation/Prompt/Context manifest 与状态；**目标能力、当前未实现**的 `View conversation` action 将允许 Project Admin 查看 exact Project 的 user/assistant 客户可见 transcript。该 action 不读取 protected Payload，也不返回 System Prompt、动态 Context、Knowledge 原文、Tool arguments/results、Provider options、secret、内部路径、隐藏推理或完整模型请求；Project Admin 永远不能调用 raw reconstruct。proposed protected payload plaintext consumer 只限 server-internal reconstruct/verify。

Import/Sync、Template 发布审计仍在相邻 Operations 能力中复用。复杂趋势大屏、告警平台、成本结算和任意配置编辑器延期。

## 11. 批次 7：Tuya API Connector

仅在收到正式 API 契约后开发：

- 认证和密钥存储；
- 设备/DP 发现；
- 分页、限流和增量窗口；
- 每日同步；
- 重试与幂等；
- API label 与现有 Meter Mapping；
- Raw 响应和批次审计。

验收要求 API 和 Excel 对同一数据产生一致 Interval Fact 与指标。API 不改变模板与客户页面。

## 12. 测试与验证

每批至少执行与变更相关的：

- Metadata store 与 migration tests；
- Energy Query Context / Access tests；
- Energy analysis 和 data gateway tests；
- web Vitest；
- npm run typecheck；
- npm run build 或对应 workspace build；
- Ngee Ann / Preschool golden data regression；
- 本地浏览器对 user/admin、Project 切换、Draft/Publish 和跨页面 Context 做验收。

涉及 Next.js 页面前先读取仓库所用版本的 node_modules/next/dist/docs 中相关指南，不能依赖旧版本习惯。

## 13. 风险与控制

| 风险 | 控制 |
| --- | --- |
| 一次替换 node tree 导致现有页面全坏 | 保留兼容读取层，按批次迁移 |
| 版本表过多导致 Admin 难用 | Draft 可变，Publish 一次冻结 Snapshot |
| 把 meter 当 node 继续污染结构 | 批次 2 明确拆表和 API |
| 样板 mock 被当成客户事实 | provisional 状态贯穿 UI/Evidence |
| total/submeter 重复求和 | official aggregation source + 发布校验 |
| Excel 与 API 两套逻辑 | 统一 Raw Reading Adapter 和事实管线 |
| AI 给出正确-looking 错数字 | 服务端 Context、只读查询、Evidence 和 golden regression |
| 深 Tier 使 UI/模板组合爆炸 | 通用 ordinal/slice engine，MVP 只打磨 2–4 |

## 14. 不阻塞首批开发的外部输入

以下资料可以后补，不阻塞批次 0–1：

- Ngee Ann 正式营业时间与 Tariff；
- Preschool Block/Room 映射；
- 正式面积、人数及有效期；
- Tuya API 契约；
- Water 项目。

这些资料会阻塞对应模板正式 Published，但不阻塞 Admin Draft、Tier 模型和迁移框架。

## 15. 已批准并完成的范围

当前已完成 **批次 0–3，以及批次 4 的真实 Draft Preview**：

1. golden 基线与 migration 护栏；
2. Project/Tier/Node 正式领域模型；
3. Admin Profile 与 Tiers & Nodes；
4. Draft/Validate/Publish；
5. Ngee Ann 去掉 Block Test；
6. Preschool 保留 provisional fixture，不虚构 Block/Room。
7. Meter Mapping 只能绑定既有 Scope，并支持 Official Aggregation Review；
8. Virtual Meter 作为 Mapping 内可选项，默认不参与官方汇总；
9. 真实 Excel Import Batch、原文件保存、SHA 幂等、字段与标签检查；
10. 确认 Mapping 后的 Raw/Normalized/Interval Fact 物化与 Quality Event；
11. 重叠来源按覆盖结束时间裁决，Raw 证据不丢失；
12. Scope/Meter Point 分离和最近计量层聚合，防止总表与分表重复相加。
13. 精确保留 `Device Name`，并以可解释规则建议 Ngee Ann 的 9 个既有 Scope，管理员最终确认和保存。
14. Metric/Rule/Component Revision、Project/Tier Template Draft 与真实 Scope/Period Preview；
15. Enabled/Ready 分离，并对缺面积、人数、Calendar、Meter Mapping 等条件明确降级。

这一步已做到可见、可验证，同时没有提前把 Metric Registry 和模板编辑器写死。

## 16. 批次 2 完成边界

批次 2 已按以下选择完成：

1. 先批准批次 0–1，其余作为已规划后续；
2. 生产运行时 Excel 解析使用 Node/TypeScript，uv/pandas 仅做复算；
3. Published Snapshot 简化版本管理，不做每字段事件溯源；
4. Preschool 不自动猜 Block/Room；
5. Admin 与客户 UI 均先英文。

数据事实闭环、批次 3 的 Metric/Rule/Component/Template Draft，以及真实 Project/Scope/Period Draft Preview 均已有基础。Preschool Block/Room 仍保持待补输入，不自动猜测。当前下一步只推进 Ngee Ann：正式发布 Revision → Interactive Overview → Save/History/Rerun → 精简 Explorer；AI Analyst 由独立 Agent 并行完成可信问数，二者稳定后再协同。
