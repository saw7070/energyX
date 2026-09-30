---
title: "EnergyIQ 领域词汇表"
summary: "固定 EnergyIQ 中 Project、Tier、Scope、计量、事实、模板和运行等术语，避免计算名与客户展示名混用。"
doc_type: concept
tags: [领域语言, Tier, Meter, Template, Analysis]
updated_at: "2026-08-26"
related:
  - "decisions/当前共识与新会话入口.md"
  - "product/领域模型.md"
status: accepted
---

# EnergyIQ 领域词汇表

本表是代码、数据库、API、文档和 UI 的共同语言。术语的详细字段和关系见[领域模型](product/领域模型.md)。

## 租户与项目

**Partner**  
销售或实施客户项目的合作组织，例如 Tuya。它不属于客户空间 Tier，也不自动获得客户数据权限。

**Workspace**  
客户组织的数据和权限隔离边界。一个用户可以属于多个 Workspace，一个 Workspace 可以包含多个 Project。

**Membership**  
用户与 Workspace 的授权关系。服务端必须由登录身份解析 Membership，不能信任浏览器传入的 workspace_id。

**Project**  
Workspace 内可独立配置、发布和分析的业务项目。Project 是分析根，不是空间 Tier，也不需要 Company 节点充当统一顶层。

## Tier 与空间范围

**Tier Definition**  
某个 Project 内一个有业务意义的层级定义，包含稳定 id、从下往上的 ordinal、客户显示 alias 和可用属性。计算用 id/ordinal，展示用 alias。

**Tier Ordinal**  
Project 内从最低有意义层开始的序号：Tier 1、Tier 2、Tier 3……。它只用于计算和配置，不直接展示给客户。

**Tier Alias**  
管理员为 Tier Definition 配置的业务名称，例如 Circuit、Room、Floor、Block、Estate。

**Tier Structure Lock**  
Structure 阶段在 Draft 内确认 Tier 数量、顺序和 Alias 的检查点。它允许管理员继续创建真实节点，但不等于发布；客户仍只读取第五阶段发布的 Hierarchy Revision。

**Project Node / Scope Node**  
Tier Definition 的具体实例，例如 Room 1、Level 6。它有稳定 scope_id、display_name、parent_scope_id 和 tier_definition_id。

**Scope**  
一次导航、比较、查询或分析覆盖的范围。通常是 Project 或一个 Project Node，也可以精确到 Meter Point。

**Hierarchy Revision**  
一个 Project 已发布的 Tier Definition、Project Node 和父子关系快照。历史运行始终引用当时的版本。

**Node Metadata**  
节点的面积、代表人数、营业时间、用途等属性。需要历史复跑的属性应带生效时间。

## 计量

**Meter Point**  
可独立查询的逻辑计量对象。可以是物理表，也可以是虚拟表；可挂在任意 Project Node。

**Physical Meter Point**  
与 Tuya device/DP 或 Excel source label 绑定、产生原始累计读数的 Meter Point。

**Virtual Meter Point**  
通过已发布线性公式从其他 Interval Fact 加减得到、没有独立上传读数的 Meter Point。

**Meter Role**  
计量点在挂载 Scope 内的覆盖角色：total、component 或 standalone。physical/virtual 属于 Meter Kind，不能混入 Meter Role。

**Published Meter Attachment**<br>
某个 Mapping Revision 中 `meter_point_id → navigation_scope_id` 的已发布挂载关系。它决定 Meter 在 Explorer 中属于哪个 Scope，以及该 Scope 能否直接查询该 Meter；不能由 Fact 中旧的 `scope_id`、Meter Role 或名称在查询时推断。

**Official Aggregation Route**  
一个 `scope + resource + category` 的已发布正式汇总口径，显式列出互不重叠的 `meter_point_ids`。Circuit 的 own-Scope route 允许逐表查询；Level/Project route 只列入该层官方口径。它与 Meter Role、导航挂载分开保存，禁止查询时用 `scope_id + meter_role` 猜测，以防总表和分表重复计算。

**Meter Mapping Revision / Meter Routing Revision**<br>
Mapping schema v2 的不可变身份，指纹覆盖 Physical Meter identity、Published Meter Attachment 与全部 Official Aggregation Route。Template/Project Release、Analysis Context、Overview 与 Saved analysis 必须 pin 同一 revision；缺失、重复、悬空、跨 Resource/Category/Scope 或 pin 不一致均 fail closed。

**Meter Topology**  
计量点之间的总分和公式依赖关系。它与客户导航使用的空间树分开保存。

**Resource Type**  
计量资源。首期支持 electricity，并为 water 使用同一模型；carbon 是未来派生指标。

**Business Category**  
对计量点的业务分类。首期为 overall、load、aircon、light、other。overall 表示已经覆盖整个 Scope 全部用能的总进线口径，不能再与其分类表相加。

## 数据

**Source Adapter**  
把 Excel 或 Tuya API 转换为统一 Raw Reading 的适配器。它不包含指标和模板逻辑。

**Import Batch**  
一次文件导入或 API 同步的可追溯批次，包含来源、SHA/请求窗口、状态、质量摘要和时间。

**Raw Reading / Meter Reading**  
物理计量点在时间点上的累计读数。它不可直接求和。

**Interval Fact**  
同一物理计量点相邻有效累计读数之差，绑定区间、实际时长、单位、质量和来源批次。

**Interval Average Power**<br>
某个有效区间的能耗除以实际经过小时数得到的平均功率。它不是瞬时功率；避免把累计电能差分结果称为 `Instantaneous Power`。

**Utility Fact**  
经映射、质量校验、正式聚合和虚拟表计算后，供模板、Explorer 和 AI 共用的规范事实。

**Data Snapshot**  
一次分析可见的数据批次和质量状态集合。它让运行结果可以解释和复跑。

**Report Time Context**<br>
一次 Overview 分析使用的可信时间语义，绑定 Data Snapshot、Project Release、Timezone、数据截止点和一组版本化命名窗口。它不是用户任意选择的全页日期筛选器。

**Managed Overview / Managed Report**<br>
由已发布 Overview Definition 持续物化的项目管理报告。它以稳定管理问题和自然月 Report Edition 组织内容；新数据进入时重算事实、图表和 AI Artifact，但不重新生成页面代码或 Template Revision。

**Report Edition**<br>
Managed Overview 的自然月业务版本。当前月 Edition 在 Data through 推进时保持 `in_progress` 并可持续更新；月末数据满足完整性门后封存为 `complete`，历史 Edition 不再被新数据改写。

**Overview Materialization Refresh**<br>
在同一 Overview Definition Revision 和 Report Edition 下，基于新的 Data Snapshot/Data through 重新计算确定性事实、图表和状态。它可以每天发生，不等于 Template Regeneration，也不自动创建新的静态页面。

**Insight Refresh**<br>
在同一 Overview Definition Revision 下，针对新的精确 Data Snapshot 重新生成 Section Interpretation、Key Findings 或 Additional Insight Artifact。它可以随每日数据更新运行；Artifact 必须绑定 Snapshot 和生成合同，随机措辞变化不得自动视为业务结论变化。

**Template Regeneration**<br>
改变 Overview Definition、计算能力引用、Section 组织或视觉编排并发布新的 Template Revision。它属于受治理的设计变更，不属于每日数据同步或 Overview Materialization Refresh。

**Report Window Policy Revision**<br>
平台发布的不可变时间窗口规则版本，定义 Rolling complete days、Month-to-date、完整历史月、同进度比较、Forecast horizon 或 Day-type baseline 等算法。Project 只能引用已注册 Revision，不能注入任意日期代码。

**Section Time Binding**<br>
Overview Definition 中 Section 到 primary/supporting named windows 的绑定。每条 Fact、Evidence 和 AI Finding 必须记录实际使用的 windowId，不能用含糊的全页 Period 冒充。

**Data Freshness**<br>
最新已接受读数相对 Project 计划同步时间的新鲜程度。每日批次只能证明数据最近收到，不能证明设备此刻实时在线。

**Connectivity Status**<br>
来源 API 明确提供的 heartbeat、online 或 last_seen 连接信号。没有显式信号时保持 unknown；避免仅凭累计读数是否变化推断在线/离线。

**Flatline**<br>
新时间戳持续到达，但累计读数在配置窗口内保持不变的观测。它可能表示真实零耗能或读数卡住，本身不等于设备离线。

**Meter Data Health**<br>
由 Freshness、覆盖率、数据有效性、Flatline 和可选 Connectivity Status 综合得到的运行状态，用于 Explorer 核查数据是否可用。

## 指标与分析

**Metric Definition / Metric Revision**  
指标的名称、单位、输入事实、聚合方法、可比较范围和版本。metric_id 是稳定身份，revision 固定某次计算口径。

**Rule Revision**  
异常或建议规则的不可变版本，包含阈值、基线方法、适用范围和最低质量要求。

**Analysis Context / Energy Query Context**  
服务端解析的可信查询边界，至少固定 Workspace、Project、Scope、Tier、时间、资源、指标及有关版本。

**Baseline**  
结论的比较基准。MVP 异常默认使用同一 Scope 最近 4 个同类型、同长度完整周期的平均值；不足时只做描述，不判异常。它不同于紧邻当前 Period 的 previous-period comparison。

**Peak interval-average power**<br>
所有可用 15 分钟区间中最大的平均功率 `kW`，由 interval usage 除以实际经过小时数得到，并带发生时间。它不是电表瞬时功率。

**Data Health Alert**<br>
针对读数延迟、过期、Flatline、复位、单位或覆盖问题的运维提示，属于 Project Explorer，不评价用能表现。

**Energy Behaviour Exception**<br>
某个 Scope 的用能相对历史、营业时间或可靠同级基准出现的业务异常，属于 Overview，并必须带 Baseline 与 Evidence。

**Evidence Bundle**  
支撑结论的 Scope、Period、当前值、历史基线、差值、贡献 Circuit、数据质量、SQL/查询参数、数据批次，以及 Data Snapshot、Metric/Rule/Template/Release 版本。

**Interactive Analysis**<br>
用户在已发布 Template/Release 内改变 Scope、Period、粒度、分类或对比参数后即时得到的确定性分析视图。视图状态可以由 URL 恢复；它不改变计算口径、不创建 Analysis Run，也不进入 Runs History。

## 模板与运行

**Component Catalog**  
EnergyIQ 自己维护、允许模板引用的版本化模块注册表。每个 Component Revision 定义输入槽位、适用 target、数据要求、允许的 Analysis/Presentation/Interaction 和 Renderer key；其实现可以复用开源图表库。

**Component Revision**<br>
Catalog 中一个不可变模块定义版本。只有受控发布流程可以新增；Template 和 Agent 必须引用明确 Revision，不能使用未注册的临时代码。

**Overview Definition Revision**<br>
EnergyIQ 面向管理员与 Stage 5 Agent 的单一、不可变 Overview authoring contract。它版本化描述 Overview、Section、Catalog Block、命名 Window、AI Slot Definition 与 Presentation intent；不包含 Page Renderer Key、React/CSS、图表库 option、SQL、Artifact Store 或 Provider 生命周期。经校验和人工发布后，它就是 Project Template Revision 的业务定义，不再另建 Project Overview Profile、AI Slot Profile 或 Project AI Surface 配置真相源。

**Placement**<br>
Overview Definition 经服务端编译后产生的内部组件实例。它可以包含 placement_id、Layout 与具体 Presentation，但不是 Stage 5 Agent 的输入或输出协议。

**Page Renderer Key**<br>
选择整个 Project 页面代码实现的 registry key。它属于应用代码与发布装配，不由 Overview Definition、AI Slot Definition 或 Stage 5 Agent 编写。

**Slot Presentation Reference**<br>
AI Slot Definition 对已发布声明式 Component Revision 或 Presentation Contract 的版本化引用。服务端可用它编译 Placement 与 Render Plan；它不是 Page Renderer Key，也不包含 React/CSS、坐标、图表库 option 或最终视觉角色。旧文档中的 “Renderer ref” 若指 Slot 级声明式表达，统一按本术语理解。

**Analysis Spec**<br>
Placement 使用的受控分析描述，引用已发布 Metric/Rule，并从白名单选择 Dimension、Time Grain、Comparison、Normalisation、Ranking、Share、Filter 和营业/非营业切片。它由确定性查询模块编译，不允许任意 SQL。

**Render Plan**<br>
Template Revision、Component Catalog、Energy Query Context、Metric/Rule 结果和 Data Quality 在一次请求中编译出的临时渲染计划。它不持久化为新的真相源。

**Renderer Adapter**<br>
在 Render Plan 与具体图表实现之间的适配器。当前只有 Recharts 时不提前建立形式化 Adapter；未来局部 ECharts 成为第二实现后再形成真实 seam。Template Revision 始终不依赖底层原生 props/option。

**Template Preset**  
可供不同项目参考的模块组合，例如 Charles Preschool 或 Ngee Ann Level/Circuit preset。它不是正式运行模板。

**Project Template**  
项目总览使用的结构化模板。

**Tier Template**  
某个 Tier Definition 下全部节点共用的结构化模板。首期不提供 per-node override。

**Template Draft**  
尚未发布的结构化模板，可以由 AI 辅助生成并由 admin 调整。

**Template Revision**  
经过校验、固定 Snapshot 预览和人工发布的不可变 Overview Definition；服务端可由它确定性编译 Placement 和 Render Plan。

**Harness Charter**
EnergyIQ 所有 AI Stage 共同遵守的版本化行为纲领，规定 Evidence-first、事实与推断分离、结论先行、普通语言、非重复和诚实验证路径；它不授予权限，也不替代 Validator。

**AI Slot Definition**
Overview Definition Revision 中一个版本化 AI 分析声明，定义稳定 Slot identity、role、业务目标、audience、Section/region intent，以及所引用的 Skill、Method、Context、Tool Policy、Output Contract、Validator 和 Slot Presentation Reference。它不直接编写 Placement 或 Page Renderer Key，也不保存本次分析结果。

**Project AI Surface Definition**
服务端从同一份已发布 Overview Definition Revision 及其 AI Slot Definitions 确定性编译出的只读运行时定义。它可以携带 role、label、order、exact Artifact identity reference 与受控 decoder reference，但不能独立新增、删除、重排或改绑 Slot，不是第二个 authoring truth 或 Store。

**Project AI Surface**
服务端按 exact Project 与当前或历史身份投影 AI Slots、Artifact readiness 和 provenance 的统一只读产品视图。所有 Project 共享同一权限、状态和历史语义；Project 个性化只能来自已发布 Overview Definition Revision，经 Project AI Surface Definition 编译后读取，不能由运行时 Adapter 另行创作。

**Decision Brief**
面向客户的结论先行表达：先给可扫描的 Key Findings，再按需展开 Why、Action、Evidence、不确定性和验证路径；完整已接受内容保持可读，不以截断冒充简洁。Overview 的 AI Slot 首屏只呈现 Summary、结论标题和证据状态，不应再经过嵌套披露。Key Finding 展开一次即可读取完整正文、来源 Section 与 Evidence，并指引用户到相关 Section Insight 做下一步核查；Section Insight 展开一次即可读取完整正文、Evidence、核查问题、限制和进入 AI Analyst 的精确入口。展开是纯读取行为，不启动新的 AI Run 或 Provider 调用。Section Interpretation 与 Overview Synthesis 复用同一版本化 Copy Profile 来约束普通语言、单句单主张、术语解释和非重复；各 Stage 仍保留自己的分析角度与 Evidence 规则。编辑目标用于约束句子密度和默认 Finding 数量；它与防资源滥用的技术安全上限是两个不同合同，超过编辑目标不得导致完整 Artifact 被拒绝。

**Accepted Finding**
已经通过 exact identity、Evidence binding 与 Validator 的只读 Finding 语义。平台合同保留 Section/Finding identity、Evidence refs、`observed | inferred | speculative` claim state、`supports | challenges | independent` relationship、`primary | supporting` prominence，以及 metric/series/time/scope anchors；它不包含 CSS、坐标、React 或 `headline / annotation / sidecar / comparison / limitation / action` 等视觉角色。证据不足属于 Slot/Artifact outcome、limitation 或 unavailable，不得伪装成一个 Claim。

**Decision Composition**
把 Accepted Findings 与 Published Template 编排为 Presentation Blocks 的下游表达能力。它可以根据 Project、Section、prominence 与语义 anchors，把同一个 Finding 表达成 annotation、sidecar 或其他受支持的 Block，但不能改变 Finding Artifact identity、claim state 或 Evidence binding。

**Overview Synthesis**
只消费同一 exact identity 下已接受 Section Artifacts 的受控 AI Stage，负责跨 Section 去重、排序并形成可追溯的 Overview Key Findings；它不得把总结变成无来源的新事实。

**Analysis Run**  
因 Save analysis、Generate report、定时报告或保存 AI 正式结果而产生的不可变分析记录，固定 Template Revision、Scope、Period、Data Snapshot、结果和有关版本。Run 归属 Workspace、共享可见，并记录创建人和创建时间；普通 Interactive Analysis 不创建 Run。

**Model Request Snapshot**<br>
一个 exact Run 在 EnergyIQ Provider boundary 形成的应用级模型可见请求身份，绑定 Workspace、Project、actor、Session、Run、step、retry、schema 和 content hash。它不包含 Provider 内部变换或隐藏推理。

**Protected Request Payload**<br>
**目标术语，尚未实现。** Model Request Snapshot 的可选认证加密内容；默认不存在，只有 server-owned retention policy 才可在限期内保存。它不是 Admin DTO，也不因可解密而自动获得 Runtime/Provider replay 权限。当前生产事实仍是 hash-only。

**Reconstruction Attempt**<br>
**目标术语，尚未实现。** 针对一个 exact Protected Request Payload 的显式服务端访问命令，分开记录 requester principal/capability 与 target actor/Run，具有唯一 `accessAttemptId`、purpose 和 durable terminal audit。候选 consumer 仅限 internal verify；与 Runtime replay/eval 是不同授权。同 attempt 的 retry 只读 terminal status，不再次释放 plaintext。

**Saved analysis**<br>
Analysis Run 的只读客户视图。标题和备注可以调整，但冻结的 Context、版本、结果与 Evidence 不可改变。

**Rerun**<br>
复用历史 Run 配置并基于最新 Available 数据创建的新 Analysis Run，通过 `rerun_of_run_id` 关联原 Run，不覆盖历史结果。

**Report Artifact**<br>
由同一 Analysis Run 结果生成的站内 HTML 或可打印 PDF；它不重新计算指标。

**Template Change Proposal**  
人工或 AI 生成、绑定 base_template_revision_id 的结构化模板 Patch。它只能使用协议允许的操作，必须经过权限、Schema、引用、readiness、Diff、固定快照预览和人工发布，不能直接改变正式模板。

**Additional Insight Finding Feedback**
用户对一个精确 Additional Artifact Finding 提交的 `Useful` 或 `Not useful` 当前选择；它绑定租户、Artifact identity revision、Snapshot/Release/Period、Finding 与 actor，改票保留审计历史，但不会自动改变 Overview 或发布 Method。

**Insight Method Proposal**
从可见 Additional Finding 提炼出的可复用方法候选，绑定原 Artifact/Finding 与创建者。Proposal 在发布前不属于 current Method Registry，也不能进入共享 Overview 生成。

**Insight Method Proposal Lifecycle**
`provisional → in-review → approved → published` 是人工治理的合法晋升链：项目成员可创建和提交 review，管理员才可批准和发布；每次转换绑定 revision、actor 与时间，禁止票数驱动的自动晋升或跳级。

**Additional Insight Evaluation Attempt**
在同一固定 Snapshot、Release、Period、Model Profile 与 Method-set identity 下，使用独立 Provider Run/Session 生成的一次不可变评估结果。失败或 retry 属于这一次 attempt 的恢复与审计，不得伪装为新的 pass@3 样本。

**Blinded Review Pack**
从独立 Evaluation Attempts 生成、隐藏 Run 顺序与 Provider identity 的人工评分包；服务端私有 audit 保留盲评 token 到 exact attempt 的映射。人工评分分别记录 Summary usefulness、各 Insight usefulness，以及新角度、相关性、清晰直白、是否值得深挖、事实与猜想是否诚实和用户价值。

**Snapshot Diff Evaluation**
在 exact Previous Snapshot 与重新生成的 exact Current Snapshot 之间，以双方 Finding 和 Evidence lineage 为依据记录 `New / Changed / Still supported / Resolved / No material change` 的不可变评估。它不以文本相似度代替事实判断，也不会自动发布 current Overview Artifact。

**Change Review / 变化回顾**
面向用户呈现 Previous Overview 与 Current Overview 在指标、Key Findings、Section Interpretation、Additional Insights 和 Evidence 上的变化。客户入口使用 `What changed?`，页面使用 `Previous / Current`；技术实现按对象分别称为 `Snapshot Diff` 和 `Template Revision Diff`。禁止把该能力称为 `A/B` 或 `A→B`，以免与实验分流意义上的 A/B Test 混淆。历史代码变量或旧运行记录中的 A/B 标签仅作为兼容身份保留。

## 用户与后台

**user**  
客户权限。FM 与 Boss 当前均为 user，可以运行、下钻和问数，不能改项目配置或发布模板。

**admin**  
项目实施权限，负责获授权 Workspace/Project 的账号、Tier、计量、数据、规则、模板、发布和技术配置。目标能力（尚未实现）允许 admin 通过显式 audited action 查看 exact Project 的客户可见 user/assistant transcript；admin 不能通过普通 GET、该 action 或 raw reconstruct 获得 System Prompt、动态 Context、secret、隐藏推理或 protected Payload plaintext。

**Platform Operator**<br>
未来可能承担跨项目平台支持的独立 capability；当前未实现，也不因该名称获得 protected Payload plaintext。任何新增跨项目或完整模型请求访问必须另行决策、显式授权并形成 durable audit。

**My Assets**  
用户个人临时文件空间。文件只有经 admin 提升和映射后，才成为 Project Data 或 Project Knowledge。

**Knowledge**  
带原文、解析、切块、全文/向量检索、版本、作用域和引用的非结构化知识。它不能代替 Energy Fact、Tier、映射或指标规则。


## 新版报告工作台（2026-09-12）

以 [新版产品基线](decisions/2026-09-12-Agent项目初始化与Skill复用产品基线.md) 为准。

**Project configuration**：供 Agent、Explorer、报告共同使用的项目事实和计量规则；与可复用分析方法分开。结构化 JSON 为权威，说明可用 Markdown，界面展示解析后的内容。

**Report method / Skill revision**：可复用的分析或呈现方法及其不可变版本，按职责和适用范围分类。来源 Session 用于追溯，不限定唯一使用范围。

**Public / personal scope**：项目公共与用户个人的可见性/编辑范围；不等于所有 admin 产物都是公共，也不等于 Knowledge 内所有报告都共享。

**Initialization conversation**：Admin 提供资料、Agent 识别并维护项目配置的对话；创建 Draft、数据可用和正式发布是不同状态。
