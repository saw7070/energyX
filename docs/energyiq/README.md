# EnergyIQ 文档索引

> **新版产品执行入口（2026-09-12）：** [2026-09-12-Agent项目初始化与Skill复用产品基线](decisions/2026-09-12-Agent项目初始化与Skill复用产品基线.md)。新版 Agent 初始化、报告与 Skill 权限以此为准；旧 Overview 文档保留为旧版说明。

本目录是 energyiq-datafoundry 中 EnergyIQ 二次开发的决策源。文档区分“当前有效决策”“待批准决策”“实施计划”“实现证据”和“历史文档”，避免新会话把旧方案当成现状。

## 目录怎么读

根目录只保留本索引和 [领域词汇表](CONTEXT.md)。其余文档按用途分类：

- `product/`：PRD、甲方确认稿、核心界面和领域模型，回答“产品要解决什么问题”；
- `decisions/`：当前架构、产品和治理决策，回答“为什么这样设计、边界是什么”；
- `plans/`：开发计划、执行手册、流程、Runbook，回答“接下来怎么做、怎么运行”；
- `records/`：实施记录、Runlog 和验收证据，回答“实际发生了什么、证据在哪里”；
- `research/`：外部项目和技术调研，研究结论不能直接替代产品决策；
- `handoff/`：当前人工交接手册；`handoff/agent/` 是阶段性 Agent 交接；
- `evidence/`：机器生成的 Replay/测试/交付证据包；
- `archive/`：明确标记为 `superseded` 的历史文档；
- `mockups/`：视觉和交互参考资产，不是运行时事实或正式数据源。

新同事先看 [交接手册 HTML](handoff/交接手册-架构任务路径与本地部署.html)，再按 [当前共识](decisions/当前共识与新会话入口.md) → [产品定义](product/README.md) → [架构决策](decisions/README.md) → [实施计划](plans/README.md) → [实施记录](records/README.md) 阅读。

## 交接人入口

- [交接手册 HTML](handoff/交接手册-架构任务路径与本地部署.html)：会议和快速阅读版本，可直接在浏览器打开或打印。
- [交接手册 Markdown](handoff/交接手册-架构任务路径与本地部署.md)：唯一维护源，包含架构、任务路径、`dev`/`main` 服务器边界和本地部署步骤。

## 新会话必读

按顺序：

1. [当前共识与新会话入口](decisions/当前共识与新会话入口.md)：截至 2026-08-03 的全部最终共识、现状、差距、开放输入和延期项；
2. [MVP 底座 + 双功能 + 协同架构](decisions/决策-MVP底座双功能协同架构.md)：当前最高优先级与复杂度边界；
3. [Overview 改造与 AI Analysis 打通最终方案](decisions/决策-Overview改造与AI-Analysis打通最终方案.md)：项目专属 Recipe/Renderer、DataFoundry AI 边界和最终实施顺序；
4. [Overview 用户价值与 AI Slot 最小交付决策](decisions/2026-08-05-Overview用户价值与AI-Slot最小交付决策.md)：统一 Snapshot/Facts、独立 Section Interpretation、AI Executive Summary、At a glance fallback 和 Additional AI Insights，并让 Overview 首屏与已存 AI Artifact 恢复解耦；
5. [Charles 系统价值复核与两批数据连续演示决策](decisions/2026-08-06-Charles系统价值复核与连续数据演示决策.md)：用连续 Snapshot、简洁洞察、图文协同和行动后果证明系统相对一次性 Claude HTML 的价值；
6. [项目 Renderer、Recipe 与时间上下文](decisions/决策-项目Renderer-Recipe与时间上下文.md)：全局主时间、Benchmark、四象限和 AI 上下文契约；
7. [Ngee Ann 首个试点路线与页面边界](decisions/决策-NgeeAnn首个试点路线与页面边界.md)：Ngee Ann 模块、交互/保存语义，以及 Overview/Explorer/AI 的最新边界；
8. [三 Agent MVP 最终执行与重置包](plans/2026-08-03-三Agent-MVP最终执行与重置包.md)：唯一派工入口及三个可复制 Prompt；
9. [三 Agent MVP 执行手册](plans/2026-08-03-三Agent-MVP执行手册.md)：Data Foundation、Structured Template 和 AI Analyst 的责任、并行依赖与验收；
10. [DataFoundry Agent Harness 复用边界](decisions/说明-DataFoundry-Agent-Harness与EnergyIQ复用边界.md)：解释已有 Runtime、Task Console、Knowledge/MCP/Tools 和受控图表，不重复建设；
11. [领域词汇表](CONTEXT.md)：Project、Tier、Scope、Meter、Fact、Template、Run 和 Data Health 的统一用语；
12. [开发计划：Admin 与模板运行闭环](plans/开发计划-Admin与模板运行闭环.md)：已有 Admin/模板能力、2026-08-15 Preschool Stage 1–3 v12 可用化、真实 Provider、A→B、多账户与 Ngee Ann 后续依赖计划；
13. [最新 MVP PRD](product/PRD-EnergyIQ-MVP.md)：客户页面、Admin、数据、模板与验收。
14. [Project 通用 Report Time Context 与 Overview 复用决策](decisions/2026-08-19-Project通用Report-Time-Context与Overview复用决策.md)：平台统一命名窗口、AI Analysis exact/all-available、Scope eligible coverage、历史 exact Session 续问与 unavailable/mismatch 只读恢复、身份与变化治理；Stage 5 通过单一声明式 Overview Definition 组合 Sections、Catalog 能力与 AI 方法。
15. [Ngee Ann 自然月 Managed Overview 夜间执行路线与 Runlog](plans/2026-08-20-Ngee-Ann自然月Managed-Overview夜间执行路线与Runlog.md)：Charles 自然月反馈、每日数据/AI 重算与 Template Regeneration 边界、四份 Excel A/B/C、论点驱动页面和发布验收门。
16. [Tuya、Overview 性能与数据更新夜间执行 Runlog](records/2026-08-23-Tuya-Overview性能与数据更新夜间执行Runlog.md)：Tuya 安全接入、#93 载荷优化、统一数据更新验收与真实 Provider/浏览器/部署的证据边界。
17. [Harness 逻辑控制面、Run Event 与可替换 Runtime 边界](decisions/决策-Harness逻辑控制面、Run-Event与可替换Runtime边界.md)：`accepted`；由既有 Store/contract 组成 Harness 逻辑控制面，固定 append-only Run Event、Mastra 生产 Runtime 与 Pi/其他 Adapter challenger 的责任边界；
18. [Harness Evolution 主 Agent 审核与协作交接](handoff/agent/2026-08-24-Harness-Evolution主Agent审核与协作交接.md)：记录 PR #106/#110 的复审门、#103–#105 依赖和稳定所有权边界。

若旧聊天或旧文档冲突，以“当前共识与新会话入口”及其链接的 accepted 专题为准。

## 当前有效决策

| 文档 | 解决的问题 |
| --- | --- |
| [阶段技术选型](decisions/阶段技术选型-基于DataFoundry二次开发.md) | 为什么选择在 DataFoundry 内二次开发，不引入 Superset/Rill 作为 MVP 主底座 |
| [双角色、用户动线与管理后台](decisions/决策-双角色与管理后台.md) | user/admin 权限、Boss/FM 动线、Admin 信息架构与 DataFoundry 技术配置复用 |
| [三个核心任务界面与 Data Map](product/三类核心界面设计.md) | Overview、Explorer、AI Analyst、Data Map 的页面任务和交互 |
| [MVP 底座 + 双功能 + 协同架构](decisions/决策-MVP底座双功能协同架构.md) | 数据底座按需支撑双功能；结构化模板优先，AI Analyst 增强，最后做协同 |
| [Ngee Ann 首个试点路线与页面边界](decisions/决策-NgeeAnn首个试点路线与页面边界.md) | 首个试点、Ngee Ann Preset、时间与异常语义、Interactive/Saved Analysis、Rerun/Report、Explorer 数据健康和开发顺序 |
| [DataFoundry Agent Harness 复用边界](decisions/说明-DataFoundry-Agent-Harness与EnergyIQ复用边界.md) | 复用现有 Mastra/AG-UI、Task Console、Knowledge、MCP、Skills、模型配置和受控 Chart Artifact |
| [Harness 逻辑控制面、Run Event 与可替换 Runtime 边界](decisions/决策-Harness逻辑控制面、Run-Event与可替换Runtime边界.md) | accepted；复用既有 Store/contract 的逻辑控制面，固定 Protocol/Validator、append-only Run Event、目标 Model Gateway seam 与可替换 Runtime 的治理边界 |
| [灵活 Tier、项目节点与计量点](decisions/灵活项目结构与计量点模型.md) | Project 外置、Tier alias/ordinal、加层判断、任意节点挂表、虚拟表和 Water |
| [领域模型](product/领域模型.md) | Tier Definition、Node、Meter、Fact、Metric、Template、Run 的字段和关系 |
| [项目专属模板与决策型分析](decisions/决策-项目专属模板与决策型分析.md) | EnergyIQ Template Schema、Component Catalog/Analysis Spec、开源复用边界、Agent 受控生成、证据与复跑 |
| [项目 Renderer、Recipe 与时间上下文](decisions/决策-项目Renderer-Recipe与时间上下文.md) | 已确认的统一主时间、受控局部时间、Benchmark 周期、正确四象限和 AI 上下文契约 |
| [Overview 改造与 AI Analysis 打通最终方案](decisions/决策-Overview改造与AI-Analysis打通最终方案.md) | 项目专属 Recipe + React Renderer、DataFoundry AI Runtime 边界、上下文跳转、AI Slot 与实施顺序 |
| [Overview 用户价值与 AI Slot 最小交付决策](decisions/2026-08-05-Overview用户价值与AI-Slot最小交付决策.md) | 以同一 Published Snapshot 连接 At a glance、Section Interpretation、AI Executive Summary 和 Additional AI Insights；新 Snapshot 预生成共享 Artifact，Overview 首屏与 AI 恢复解耦，AI 正文只允许安全 Markdown 子集 |
| [Charles 系统价值复核与两批数据连续演示决策](decisions/2026-08-06-Charles系统价值复核与连续数据演示决策.md) | 承认一次性 Claude HTML 的适用场景，并以两批数据连续更新、0–3 条精炼洞察、图文协同和行动后果定义下一项客户价值验收 |
| [四界面 UI/UX 一致性与功能保护决策](decisions/2026-08-08-四界面UI-UX一致性与功能保护决策.md) | 统一 Overview、AI Analyst、Project Explorer 与 Admin 的视觉语法、可读性和操作习惯，同时保留不同侧栏职责并保护现有功能 |
| [Project Explorer 性能、时间、指标与 Snapshot Health 决策](decisions/2026-08-08-Project-Explorer性能时间指标与Snapshot-Health决策.md) | 将 Explorer 收窄为快速的设备与数据核查界面，默认 Project 统一最新完整日，并按节点类型展示指标、自身平均线与诚实的 Snapshot Health |
| [Project 通用 Report Time Context 与 Overview 复用决策](decisions/2026-08-19-Project通用Report-Time-Context与Overview复用决策.md) | 以可信 Data through + 版本化命名窗口替代 Project 日期分支；固定 AI exact/all-available、Scope eligible coverage、历史 exact Session 语义，并记录 Ngee Ann Holiday 五 Section/@2 Release、同 cohort 24 小时曲线、确定性 Key Points/动作、第五 AI Artifact 与旧四 Section Saved 不迁移合同 |
| [Ngee Ann 自然月 Managed Overview 夜间执行路线与 Runlog](plans/2026-08-20-Ngee-Ann自然月Managed-Overview夜间执行路线与Runlog.md) | in progress；自然月 Report Edition、每日物化/AI 重算、四份 Excel A/B/C、论点驱动 Overview、What Changed 与发布验收的唯一夜间跟踪入口 |
| [项目配置、数据接入与模板发布流程](plans/流程-项目配置与模板发布.md) | Admin 从 Project Draft 到 Published 的操作与发布门槛 |
| [Preschool 数据与三层目标结构](decisions/决策-Preschool-Portfolio数据集接入.md) | 区分 Centre×Circuit 现有事实与 Block→Room→Circuit 目标映射 |
| [Ngee Ann 模板吸收方案](decisions/评估-Ngee-Ann模板吸收方案.md) | 原型可直接吸收、需参数化、延期模块与 golden baseline |
| [NetZero Prototype 完整理解与复用审计](research/2026-08-03-NetZero-Prototype完整理解与复用审计.md) | 全量拆解 NetZero SaaS、Ngee Ann/EliteIOT 指标与图表、真实/Mock 边界，以及项目专属 Recipe + Renderer 路线 |

## 待批准决策

| 文档 | 状态 |
| --- | --- |
| [受保护模型请求 Payload、保留与重建权限边界](decisions/决策-受保护模型请求Payload与重建权限边界.md) | proposed / target / not implemented；内容已按 proposed design 审核接受，但不表示 #102 完成，也不授权 #122/#123/#105、raw reveal、Runtime/Provider replay 或部署 |

## 实施计划

| 文档 | 状态 |
| --- | --- |
| [五项可发布版本夜间执行路径](plans/2026-08-28-五项可发布版本夜间执行路径.md) | active；统一收口 Overview AI 文案、AI Analyst、Tuya Office、Harness Skill 与 Ngee Ann Holiday，固定并行开发、串行合并、浏览器/Provider/不可变 Release 验收门 |
| [Ngee Ann Analysis 模板复刻执行方案](plans/2026-08-10-Ngee-Ann-Analysis模板复刻执行方案.md) | in progress；N5 已完成 server-published Category×24h 与 Level→Circuit×24h 工程切片，待合并后真实 Chrome 1440/1920/tablet 与 Charles 人工验收 |
| [Preschool Section 5 Charles 复刻执行方案](plans/2026-08-10-Preschool-Section5-Charles复刻执行方案.md) | in progress；A5 已进入人工验收；[#42](https://github.com/Zion74/energyiq-datafoundry/issues/42) 把固定 June Forecast 校准为自然月 Monthly Energy Outlook，冻结 Original Estimate，并按同日期范围对照 Actual 与 Current Outlook |
| [AI Analyst Harness 与 AI Slot 执行路径](plans/2026-08-08-AI-Analyst-Harness与AI-Slot执行路径.md) | in progress；第 18 节为当前四层路线：Harness Charter、分类 Skill、AI Slot Definition、Overview Synthesis，并以唯一 published Overview Definition authoring truth、共享 Project AI Surface 与 Decision Brief 渐进披露推进；早期“两项目 60 秒/Pattern Cards”仅保留为历史阶段 |
| [AI 输出审核边界二次验证结论与实施计划](decisions/2026-08-16-AI输出审核边界二次验证结论与实施计划.md) | provisional；独立复核 Layer 1–3 与 A→B 后选择 Option 3+：Evidence 约束事实，推断/猜想保留发挥空间，按最小片段局部失败，并以 typed claim、sourceClaimIds 和真实 Provider/A→B 为后续验收门 |
| [2026-08-06 Overview 夜间执行清单与 Runlog](records/2026-08-06-Overview夜间执行清单与Runlog.md) | in progress；第 11 节为 2026-08-07 当前行动方案：Overview takeaway-first 阅读体验 → #31 Explorer 精准下钻与设备趋势 → Preschool 演示型图表 → #5/#19/#20/#21 收口；AI 侧线保持隔离 |
| [三 Agent MVP 最终执行与重置包](plans/2026-08-03-三Agent-MVP最终执行与重置包.md) | accepted；唯一派工入口，含共同基线和三个最终 Prompt |
| [三 Agent MVP 执行手册](plans/2026-08-03-三Agent-MVP执行手册.md) | accepted；三个 Agent 的责任、并行节奏、MVP 边界与验收 Owner 已确认 |
| [开发计划：Admin 与模板运行闭环](plans/开发计划-Admin与模板运行闭环.md) | in progress；PR #110 只交付 hash-only Run Event tracer；#102 的 protected reconstruction 仍是 proposed、#122/#123 未授权；PR #120 仅按隔离 evaluation 接受且不构成生产 adapter；#105 继续冻结 |
| [2026-08-23 Tuya、Overview 性能与数据更新夜间执行 Runlog](records/2026-08-23-Tuya-Overview性能与数据更新夜间执行Runlog.md) | in progress；Tuya Connector 本地自动化已收口，下一步合入 #93、建立统一数据更新门，再按保护配置决定真实 Provider 与部署。 |

原来的三线责任文档、各 Agent Handoff 和纠正 Prompt 已标记为 `superseded`，只保留为历史入口；执行统一以“三 Agent MVP 执行手册”为准。

## 实现证据

| 文档 | 作用 |
| --- | --- |
| [Managed Overview 不可变投影与冷加载性能 Tracer 实施记录](records/2026-08-25-Managed-Overview不可变投影与冷加载性能Tracer实施记录.md) | Issue #172；把 current Overview 从 read-time full compute 改为 exact identity 发布后预物化、无 TTL immutable projection 与原子 current pointer；普通 GET 只读 projection，并保留 AI `OverviewContextPackage` seam 与未完成边界 |
| [Tuya Office Overview 原子投影发布实施记录](records/2026-09-01-Tuya-Overview原子投影发布实施记录.md) | Issue #224；以 durable journal 和 Project writer/read lock 让 Snapshot、facts 与 Managed Overview pointer 只呈现 old-complete 或 new-complete，并覆盖 first publish、candidate-pointer crash、revision rotation 与 post-publication prewarm 边界 |
| [Tuya Office 动态决策 Overview 实施记录](records/2026-09-01-Tuya-动态决策Overview实施记录.md) | Issue #224 的动态页面候选；八段决策视图、真实 meter health、exact anomaly、complete/partial/unavailable 与低覆盖 fail-closed；真实 Tuya AI Artifact 仍归 #100 |
| [Current Overview minimum 恢复与身份门实施记录](records/2026-08-25-Current-Overview-Minimum恢复与身份门实施记录.md) | 无 pin Overview 先恢复服务端 canonical minimum；minimum/full Workspace、Project、Snapshot、Release 身份 fail closed；Preschool calendar unavailable 时跳过无关 planning SQL，并锁定 Explorer/AI 精确 handoff |
| [AI Analyst 启动延迟与准备阶段观测实施记录](records/2026-08-25-AI-Analyst启动延迟与准备阶段观测实施记录.md) | 区分 pre-Run 数据准备与 Provider first-token；以 `energyiq-run-preparation@1` 显示诚实 Preparing，并固定 #172 Context Package、#173 观测和 #165 时间窗口的职责边界 |
| [Prompt / Skill / Method 盘点与晋升标准](research/2026-08-24-EnergyIQ-Prompt-Skill-Method盘点与晋升标准.md) | 当前代码中的正式 Skill、Method/SOP、Stage Prompt、Protocol/Validator、Context 与 Tool/MCP 边界，以及首个 governed Skill 候选 |
| [2026-08-17 Preschool Stage 3 native submit unavailable 修复记录](records/2026-08-17-Preschool-Stage3-native-submit-unavailable修复记录.md) | 记录真实 Provider 已完成调查却未调用正式 submit tool 的根因、v23 identity 旋转、v22 历史只读边界，以及部署与真实 B 验收的剩余门 |
| [2026-08-23 Admin Harness Truth 与 Skill 演进复核交接](handoff/agent/2026-08-23-Admin-Harness-Truth与Skill演进复核交接.md) | PR #99 的只读 Harness/Operations truth drift、RED→GREEN、主 Agent 修正、自动化证据与尚未完成的浏览器/Provider/部署边界 |
| [2026-08-24 Harness Evolution 主 Agent 复审交接](handoff/agent/2026-08-24-Harness-Evolution主Agent审核与协作交接.md) | PR #106/#110 的固定复审门、#110 hash-only + bounded Runs 真实范围、#102–#105/#114/#117 依赖与重新提交流程；易失状态留在 GitHub |
| [2026-08-18 生产不可变 Release 部署与回滚 Runbook](plans/2026-08-18-生产不可变Release部署与回滚Runbook.md) | 用真实 release 目录、强制 TypeScript 构建、精确 SHA、独立 Metadata 备份与原子 current 切换防止发布覆盖旧版本 |
| [2026-08-16 AI 输出审核边界讨论与二次验证请求](records/2026-08-16-AI输出审核边界讨论与二次验证请求.md) | 用户与侧边 Agent 关于运行时审核、Stage 3 质量审核、Evidence、Epistemic Status 和结构化 Claim 的讨论记录；不是 accepted 决策，要求主 Agent 独立复核后再提交最终结论与修改方案 |
| [2026-08-09 Preschool Overview AI 路线 B 集成记录](records/2026-08-09-Preschool-Overview-AI-路线B集成记录.md) | 两阶段 AI Artifact、bounded failed retry、Benchmark/Standby 薄适配、本地自动化证据，以及仍待完成的服务端执行、Provider 与 Chrome 边界 |
| [2026-08-04 Ngee Ann 权威 Excel、Mapping 与 Facts Materialization 实施记录](records/2026-08-04-Ngee-Ann权威Excel-Mapping与Facts-Materialization实施记录.md) | 四份权威 workbook、18/18 Mapping、项目级 canonical interval rebuild、100,205 facts、固定 Golden、Admin readiness 与 #4/#24/#19 边界 |
| [可信查询范围与 Energy Fact 接入记录](records/2026-07-31-可信查询范围与Energy-Fact接入记录.md) | Ngee Ann/Preschool 事实接入、DuckDB Scope 约束、SQL allowlist 和验证证据 |
| [2026-08-01 Admin 与 Tier 批次 0–1 实施记录](records/2026-08-01-Admin-Tier-批次0-1实施记录.md) | Project/Tier/Node Draft、Validate、Publish、样板迁移、测试和本地复现证据 |
| [2026-08-01 Admin Meter Mapping 与虚拟电表实施记录](records/2026-08-01-Admin-Meter-Mapping与虚拟电表实施记录.md) | 物理表映射、官方汇总审查、可选加减法 Virtual Meter、Draft 保存与验证证据 |
| [2026-08-01 Admin Excel Import Batch 实施记录](records/2026-08-01-Admin-Excel-Import-Batch实施记录.md) | 真实 Excel 保存与检查、SHA 去重、精确标签到 Mapping Draft、浏览器与测试证据 |
| [2026-08-02 Admin Metric/Rule Registry 实施记录](records/2026-08-02-Admin-Metric-Rule-Registry实施记录.md) | 受控指标与规则版本、项目 Draft 选择、Ready 判定、确定性执行与 provenance 证据 |
| [2026-08-02 Admin Component Catalog 与 Template Draft 实施记录](records/2026-08-02-Admin-Component-Catalog与Template-Draft实施记录.md) | 受控组件目录、Project/Tier 模板草稿、真实事实预览、时区处理与双项目浏览器证据 |
| [2026-08-03 Admin Preview 与客户 Overview 统一渲染实施记录](records/2026-08-03-Admin-Preview与客户-Overview统一渲染实施记录.md) | Template Schema v2、共享 Render Plan、受控布局视觉协议、双端 Renderer 与兼容发布策略 |
| [2026-08-03 AI Analyst 可信问数与受控图表实施记录](records/2026-08-03-AI-Analyst可信问数与受控图表实施记录.md) | Qwen/DeepSeek Provider、权威 Energy Query Context、Ngee Ann 可信 SQL、Task Console completed 与 168 点后端 ChartPreview |
| [2026-08-04 Tariff 与营业日历持久化实施记录](records/2026-08-04-Tariff与营业日历持久化实施记录.md) | 不可变 Tariff/Calendar、Published Release Resolver、API/Web/Saved serialized 集成、显式 Unavailable，以及待完成的 Ngee Ann #24-first Golden |
| [2026-08-04 Published Meter Routing 实施记录](records/2026-08-04-Published-Meter-Routing实施记录.md) | Mapping schema v2、Meter attachment、按 Scope/Resource/Category 的官方 routes、Release pin 与四层 Golden |
| [2026-08-04 T03/T04/T13 集成实施记录](records/2026-08-04-T03-T04-T13集成实施记录.md) | Runtime policy、Period-effective metadata、Workspace 默认模型、公开 API/持久化契约，以及 T13 尚未通过的 live 产品门禁 |
| [Preschool Overview Interaction Matrix](records/2026-08-06-Preschool-Overview-Interaction-Matrix.md) | Preschool 对 Charles 模块的保留、适配与主动删除；包含 A4 Operating Hours 的 v2 additive/feature-detect 合同、Evidence 收尾顺序，以及新 API 构建后的 3102 正向验收边界 |
| [2026-08-03 DeepSeek V4 Flash 与 DataFoundry 实测记录](records/2026-08-03-DeepSeek-V4-Flash与DataFoundry实测记录.md) | Flash 连接和工具链可运行，但同一问数产生过两种结果；记录时区 SQL、图表触发、60 秒超时和用户级模型配置等真实缺口 |
| [2026-08-01 Ngee Ann 源到事实契约原型](records/2026-08-01-Ngee-Ann-源到事实契约原型记录.md) | 统一 Adapter、SHA 幂等、实际时长 Fact、Virtual Load 12、冲突与官方汇总排重的可运行证据 |
| [2026-08-01 Admin 首次数据源配置交互原型](archive/2026-08-01-Admin-首次数据源配置交互原型记录.md) | 已废弃的 A/B/C 历史实验记录；正式路径已回归 Project Overview、Structure、Data Sources 与 Meter Mapping |

## 外部确认与参考

| 文档 | 作用 |
| --- | --- |
| [甲方确认稿](product/甲方确认稿-日级能源分析与AI问数MVP.md) | 客户已确认的日级分析与 AI 问数需求边界 |
| [Charles 静态能源报告](../template/Preschool/Energy_Report_May2026.html) | Preschool 模板种子，不是可运行模板 |
| [调研索引](research/README.md) | ChatBI 历史选型，以及 Explorer 对 CopilotKit、Superset、Recharts/ECharts 的当前评估 |

## 历史/已被替代

这些文档保留讨论与实现演进证据，不应直接作为新开发规格：

| 文档 | 被什么替代 |
| --- | --- |
| [早期 MVP 交互与分析架构](archive/MVP-产品交互与分析架构.md) | 最新 PRD、动态 Tier 决策和开发计划 |
| [2026-07-31 DataFoundry 整合实施方案](archive/实施方案-DataFoundry复用与EnergyIQ整合.md) | 当前共识与 2026-08-01 开发计划；其中 DataFoundry 复用原则仍有效 |

## 当前代码入口

- apps/web/src/app/energyiq：EnergyIQ Shell 与页面；
- apps/api/src/energy：Query Context、确定性分析和样板；
- packages/metadata/src/energyiq-project-setup-store.ts：Project/Tier/Node Draft、Validate、Publish 与不可变 Revision；
- packages/metadata/src/energyiq-template-store.ts：受控 Component Catalog、Project/Tier Template Draft、Schema v2 与不可变 Template Revision；
- packages/metadata/src/energyiq-operational-policy-store.ts：版本化 Tariff/Operating Calendar、Project/Scope 生效解析、active/Release-pinned 运行来源和显式 Unavailable；
- apps/web/src/app/energyiq/_components/energy-template-render-plan.ts：Admin Preview 与客户 Overview 共用的临时 Render Plan 编译入口；
- packages/metadata/src/energyiq-store.ts：Project/Node/Access 兼容读取与运行时存储；
- packages/data-gateway/src/energy-scoped-datasource.ts：受 Scope 限制的能源事实查询。

当前已有页面并不等于对应领域能力已经正式完成。具体“已验证/仍需开发”以[当前共识第 14 节](decisions/当前共识与新会话入口.md#14-当前实现与目标差距)和最新实施记录为准。
