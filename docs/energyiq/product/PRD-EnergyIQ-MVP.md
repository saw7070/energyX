---
title: "EnergyIQ MVP 产品需求文档"
summary: "面向客户确认与内部开发的当前 PRD，覆盖日级能源分析、动态 Tier、决策模板、可信问数与 Admin 发布闭环。"
doc_type: prd
tags: [MVP, PRD, 决策看板, Project Explorer, AI Analyst, Admin]
updated_at: "2026-08-26"
related:
  - "../decisions/当前共识与新会话入口.md"
  - "三类核心界面设计.md"
  - "../plans/开发计划-Admin与模板运行闭环.md"
  - "../decisions/决策-NgeeAnn首个试点路线与页面边界.md"
status: accepted
---

# EnergyIQ MVP 产品需求文档

## 1. 产品定义

EnergyIQ 将 Tuya/Excel 的能源数据转化为可复跑、可下钻、可追溯的决策建议。

它不是一个让客户自由搭建图表的 BI，也不是每次打开都重新设计页面的 Agent。MVP 将结构化决策模板与 DataFoundry 可信问数组合：

- 重复发生的管理问题由固定模板确定性计算；
- 未覆盖的问题由 AI Analyst 探索；
- 两者共用同一个 Energy Fact、Metric、Scope、Time Range 和 Evidence。

## 2. 已确认客户需求

1. 接入 Tuya API；API 暂不可用时使用 Excel；
2. 保存和处理 Raw Data；
3. 原始读数约 15 分钟一条，当前每天同步一次即可；
4. 用户按时间段运行分析，而不是只看瞬时值；
5. 结构化看板可由 admin 调整、发布、保存和复跑；
6. SQL、计算口径、数据批次和结论可追溯；
7. 支持 Workspace 多租户和多 Project；
8. Project 内层级按真实硬件/业务配置，不固定 Room/Floor/Block；
9. 支持总表、分表、父节点挂表和虚拟表；
10. 支持 Electricity，并预留 Water；
11. 展示应帮助决策，图表必须服务于异常、比较和行动建议；
12. 模板之外可继续使用 AI 问数。

## 3. MVP 目标

- admin 能从空 Project 配置 2–4 Tier、节点、属性和电表映射；
- admin 能导入现有 Excel，校验累计读数并生成区间事实；
- admin 能预览、校验和发布 Project/Tier Template；
- user 能在 Interactive Analysis 中切换 Project、Scope、时间段和展示控件自动刷新，并在需要时保存正式分析；
- Overview、Explorer 和 AI Analyst 对同一上下文给出一致数字；
- 每条重要结论有 Evidence；
- 跨 Workspace/Project 查询被服务端阻止。

## 4. 非目标

- 实时流、秒级分析；
- 客户自由 BI 编辑；
- 复杂角色和节点级 ACL；
- 自动 ML 异常；
- AI 自动发布模板；
- 正式 Forecast、Carbon；
- 5–7 Tier 的完整 UX；
- 跨 Workspace Portfolio。

## 5. 用户与权限

| 权限 | 人物 | 主要任务 |
| --- | --- | --- |
| user | FM、Boss | 看建议、下钻、复跑、问数 |
| admin | 我方与首期实施人员 | 创建账号/项目、配置数据与层级、发布模板、排错 |

FM/Boss 权限相同。Workspace 是客户隔离边界；Project 是 Workspace 内的配置和分析根。一个 user 可以属于多个 Workspace，首期默认可看 Workspace 内全部 Published Project。

## 6. 客户信息架构

顶部 Project selector 右侧：

1. Overview；
2. Project Explorer；
3. AI Analyst；
4. Data Map。

客户界面先全英文。Admin 只向 admin 显示。

### 6.1 Overview

目标：一分钟内回答“哪里值得关注、影响多大、下一步核查什么”。

Ngee Ann 首个 Preset 的页面顺序：

1. Action Summary；
2. Data Status & Scope；
3. Energy Overview；
4. Level Comparison；
5. Day Profile & Heatmap；
6. Exceptions & Evidence；
7. Recommended Actions。

Circuit Ranking 嵌入 Level Comparison 或 Exceptions & Evidence，不单独堆成长章节。Forecast Preview 仅在数据条件满足时加入后续版本。

模块规则：

- Action Summary 最多 3 条，结构固定为 `Problem → Impact → Action → Evidence`；没有重要异常时显示 `No priority exceptions`；
- 阻断当前 Scope/Period/Metric 的数据质量问题先于能耗建议，并隐藏受影响结论；
- Data Status & Scope 固定紧跟 Action Summary 且不可关闭，显示范围、区间、完整度、最近成功同步及数据/发布版本；
- Ngee Ann Level 6/7 只做描述性比较，包括绝对量、差值、自身历史和最高耗电 Circuit；面积/人数可用时再做归一化，不使用统计异常标签；
- Circuit Ranking 按当前 Period 耗电量排序，每个 Level/分类默认 Top 5，可展开全部；
- Day Profile 区分 Workday、Weekend、Public Holiday；多日默认 Date × Hour，单日默认 Level × Hour，并允许切换适用切面；
- Recommended Actions 首期只读，每条连接 Evidence、Explorer 或带 Context 的 AI Analyst，不做负责人、状态、工单或审批。

桌面左侧目录：

- Overview；
- Benchmarks；
- Standby wastage；
- Operating hours；
- Forecast preview。

全局支持 Yesterday、Last 7 days、Previous week、Previous month 和 Custom，可按需要保留 Last 30 days。切换 Scope/Resource/Period 后所有模块自动刷新，不创建 Analysis Run。

模块内允许切换 15 min/Hour/Day、Compare with previous period、业务分类和排名展开；这些控件不改变全局主时间范围，也不能修改模板结构或指标口径。`Save analysis`、`Generate report` 与定时报告才创建正式 Run。

Project、Scope、Resource、Period、granularity、comparison 和分类筛选等视图状态进入 URL。刷新或分享链接后恢复同一 Interactive Analysis 视图，但服务端仍重新校验权限和已发布 Context；恢复链接不创建 Run。

Overview 首次进入默认 Last 7 days。完整周期预设按 Project timezone 计算并排除未结束的今天；Custom 内部使用 `[from, to)`，但结束日期在 UI 中包含当天。数据过期或无数据时不改写预设含义，显示最近同步时间和 `View latest available data`。

默认粒度为单日 Hour、2–31 天 Day、更长范围 Week，用户仍可切换允许的粒度。Peak 定义为最高 15 分钟区间平均功率 kW，并展示发生时间。Coverage `<95%` 时显示 Partial data 和可得图表，隐藏异常/建议并禁用 Save analysis / Generate report。

### 6.2 Project Explorer

目标：按真实 Project Tier 找到 Scope/Meter，核查来源读数、确定性派生值、数据健康、质量和溯源。业务比较和决策建议属于 Overview。

桌面：

- 左：Tier Node + Meter Point 树；
- 主区页头：Breadcrumb、Resource、Period、Last data received 与 AI 入口；
- 主区摘要：最新累计读数、区间能耗、24 小时平均功率、峰值区间平均功率和覆盖率；
- 主区详情：原始累计/区间曲线、Meter 列表、Data Health、Quality Event、Source Binding 与 Data Snapshot。

默认时间为 `Latest complete data day`，即 Project timezone 下最近一个整日事实已经进入 `Available` 的日历日；同时显示覆盖率。用户仍可选择 Yesterday、Last 7 days、Last 30 days 或 Custom。

Explorer 允许：

- Project/Scope/Meter 结构与直接挂载关系；
- API/Excel 原始字段和确定性生成的 `interval_kwh`、`interval_average_kw`；
- Healthy；漏 1 次计划同步为黄色 Delayed；连续漏 2 次为红色 Stale；连续 3 日有新时间戳但累计读数不变为黄色 Flatline；另有 Invalid、Unknown；
- Physical/Virtual、total/component/standalone 和正式聚合口径；
- 单个 Meter 自身的趋势、覆盖和来源证据。

Explorer 不展示同级排名、跨节点热力图、用能业务异常、成本、可能原因和行动建议。Flatline 只表示新时间戳到达但累计读数不变，不能单独等同离线。没有 Tuya heartbeat/online 信号时只显示 Data Health 和 Last data received，不伪造实时在线。

状态汇总与 Meter 类型：

- Meter 行显示自身状态；Scope 显示 critical/warning 数量；只有 Official Aggregation Route 受红色状态影响时 Scope 标红，否则子表问题只标黄；
- Flatline 默认检查全部 Physical Meter；admin 可填写原因后静音；
- Virtual Meter 显示 Derived，不显示 Online/Offline；健康继承输入，必要输入缺失时为 Partial；
- 左侧树展示最新同步的 Current data health；主区展示当前时间范围的 Selected-period quality。

Meter 详情固定摘要为 Latest reading、Last data received、24h energy、24h average power、Peak interval-average power 和 Coverage。user 可导出规范化 CSV；admin 另可下载不可变原始 Excel/API payload。MVP 告警只在 Explorer 与 Admin Issue List 展示，不发送邮件、短信或推送。

Overview 证据进入 Explorer 时保留 Project、Scope、Period、Resource 与 Run/Release/Snapshot；Circuit 证据直接选中 Meter。返回 Overview 时回到最近的模板 Scope，并保留时间和资源。

### 6.3 AI Analyst

直接复用 DataFoundry DataTasksApp：

- Chat、Session、Streaming；
- Artifact/Chart Preview；
- Task Console；
- Evidence、Trace；
- Files 与 Knowledge 引用。

Investigate with AI 从 Overview/Explorer 跳转并保留 Project、Scope、Tier、Resource、Period 和版本。后端重新解析可信 Energy Query Context。

### 6.4 Data Map

user 只读，可查看：

- Project/Tier/Scope；
- Meter Point 与 Source Binding；
- Metric 与业务分类；
- 数据来源和可信状态；
- configured 与 inferred 关系。

编辑只在 Admin。

## 7. Admin

Admin 是项目交付流水线：

~~~text
Draft → Data connected → Mapping valid → Template ready → Published
~~~

Project Tabs：

1. Profile；
2. Tiers & Nodes；
3. Meter Mapping & Virtual Meters；
4. Data Import & Quality；
5. Attributes, Calendar & Tariff；
6. Metrics & Rules；
7. Templates；
8. Preview & Publish；
9. Runs & Audit。

全局复用 DataFoundry：

- Accounts；
- Data Sources；
- Data Map；
- Knowledge；
- Assets；
- Models；
- Skills；
- Tools；
- MCP；
- Operations。

Draft 可未完成保存。Validate/Publish 才检查缺失、重复聚合、虚拟公式、数据覆盖、模板数据条件和 Evidence。

## 8. 动态 Tier

Project 在 Tier 外。每个 Project 自底向上定义：

- tier_definition_id；
- ordinal；
- alias；
- nodes；
- parent relationships；
- attributes。

Tier 1 不写死 Circuit。客户只看 alias 和 display_name。

增加层级的条件：它有独立分析、汇总、导航、权限、数据绑定或属性意义。单节点无意义 Tier 在发布时警告。MVP 重点 2–4 Tier，保留 5–7；不开放跳 Tier。

## 9. 计量

- Physical Meter 绑定 Excel label 或 Tuya device/DP；
- Meter 可以挂任意 Scope；
- business category：load、aircon、light、other；
- Meter Kind 区分 physical/virtual；Meter Role 区分 total、component、standalone；Official Aggregation Route 单独配置；
- 空间树与 Meter Topology 分开；
- 总表优先，不与分表重复相加；
- Virtual Meter 由已发布线性 +/- 公式计算；
- Electricity/Water 共用框架。

## 10. 数据

### 10.1 来源

Excel 当前主用；Tuya API 后续每日同步。两者统一输出 Raw Reading。

### 10.2 存储

同时保存：

- Raw Artifact；
- Import Batch；
- 累计 Meter Reading；
- 15 分钟或实际时长 Interval Fact；
- Utility Fact；
- Data Snapshot；
- Quality Event。

### 10.3 计算

~~~text
sort by meter/time
→ dedupe
→ delta cumulative reading
→ validate reset/gap/jump/interval
→ interval usage
→ average rate by actual elapsed time
→ virtual formula
→ official aggregation
~~~

累计 Active Energy 不可直接求和。重传必须幂等。

## 11. 指标与异常

首期指标：

- total usage、daily average；
- peak rate/time；
- own-history change；
- same-tier rank；
- kWh/m²、kWh/person；
- off-hours usage/share；
- coverage 和质量。

首期异常：

- 用量高于自身历史基线；
- 非营业时段用量；
- 峰值时段异常；
- 可靠元数据下的人均/单位面积归一化异常。

异常基线取同一 Scope 最近 4 个同类型、同长度完整周期的平均值，并按 Workday、Weekend、Public Holiday 区分；不足 4 个可比周期时只展示描述性变化。`Compare with previous period` 使用紧邻当前 Period、长度相同的前一时段，与异常基线分开。

阈值由 admin 作为 Project Rule Revision 配置，不写死在代码中；未确认阈值只能标记 `Provisional`。异常按额外耗电量和影响范围排序，客户侧只用 `Attention` / `High priority`；数据健康黄/红状态保持独立。规则选择受控 Action Template，AI 只能润色，不能改变数字、优先级或事实强度。

每条 Evidence 必须包含 Scope、Period、当前值、历史基线、差值、贡献 Circuit、数据质量、Query/SQL，以及 Data Snapshot、Metric/Rule/Template/Release 版本。四象限可用 kWh/person × kWh/m²；Bell curve 和复杂图表只在可比样本足够时出现。

## 12. 模板

- 一个 Project Overview Template；
- 每个 Tier Definition 一个 Tier Template；
- 同 Tier 节点共享，不做 per-node override；
- Preset 只作参考；
- 模板由受控 Component Catalog 组成；
- admin 首期只可调整模块开关、顺序、规则阈值和营业时间，不开放自由画布或任意 SQL；
- AI 可生成 Draft，admin 发布；
- 未来 AI 修改只生成 Proposal；
- 正式模板不含任意 SQL/HTML/React/Prompt。

缺面积、人数、Tariff、Calendar 或历史时隐藏/降级对应组件。Forecast 至少需要约 3 个月历史和回测，最好 6–12 个月。

## 13. Analysis Run 与追溯

Overview 默认执行 Interactive Analysis：使用已发布 Template/Release 和当前 Available 事实，通过同一确定性计算模块返回结果；时间、Scope、粒度、分类和上一周期对比变化只刷新视图，不持久化 Run。

每次 Run 固定：

- Workspace/Project/Scope/Tier；
- Resource/Time Range/Timezone；
- Hierarchy、Formula、Data Snapshot；
- Metric、Rule、Calendar、Tariff；
- Template Revision；
- Query/SQL、结果和 Evidence。

同 Snapshot 与版本复跑一致。新数据创建新 Run，不覆盖历史。只有 `Save analysis`、`Generate report`、定时报告或保存 AI 正式结果才创建 Run；普通切换时间/Scope、下钻、展开和对比只进入请求/Session Trace。

AI Analyst 普通追问不创建 Run；用户保存 AI 正式结果时才创建带 `parent_analysis_run_id` 的 Child Analysis Run。Project Release 与 Template Revision 不修改、不删除；回滚通过重新激活历史 Release 并写入审计完成。

未保存的 Interactive Analysis 不进入 Runs History，只保留普通请求日志；AI 交互同时保留 Session Trace。`Save analysis` 创建 Workspace 共享可见的不可变 Run，并记录 `saved_by`、`saved_at`；同一 Workspace 的 FM/Boss 均可查看。每日、每周、每月等 Scheduled Report 仅由 admin 配置，user 只能手动保存分析和生成报告。

Save analysis 默认标题为 `Project · Scope · Period`，允许编辑标题和备注；Run 内容仍不可变。历史结果以只读 Saved analysis 模式打开，`Explore with these settings` 仅复制参数到 Interactive Analysis。Rerun 使用相同配置和最新 Available 数据创建带 `rerun_of_run_id` 的新 Run，不覆盖原结果。

Runs History 显示 Name、Project、Scope、Period、Saved by、Saved at、Data status、Report status，并支持 Project/Scope/作者筛选。Generate report 从同一 Run 结果生成站内 HTML 与可打印 PDF，不重复计算；未保存结果先创建 Run。Scheduled Report 产生同类 Run/报告并进入 Workspace Reports；MVP 不发邮件/短信，失败进入 Admin Operations。

## 14. 样板

### Ngee Ann

目标：Project → Level → Circuit。移除历史 Block Test。正式聚合使用 Level 的总 Light/Load，不与分回路重复。

### Preschool

目标：Project → Block → Room → Circuit。Charles 数据当前只明确 Centre → Circuit；正式 Block/Room 映射必须由 admin 确认。当前 fixture 只能标 provisional。

只有 Ngee Ann 在受控测试环境通过导入、发布、运行、Overview、Explorer、AI 和追溯验收后，才开始 Preschool 正式泛化。

## 15. 页面状态

| 状态 | 行为 |
| --- | --- |
| No data | 说明尚未完成首次导入 |
| Delayed | 漏 1 次计划同步，黄色提示 |
| Stale / Suspected offline | 连续漏 2 次计划同步或 API 明确 offline，红色提示；保留最近成功结果并标记日期 |
| Flatline | 连续 3 日有新时间戳但读数不变；标记“零耗能或疑似卡表”，不直接断言离线 |
| Connectivity unknown | 只显示 Last data received，不显示实时在线 |
| Partial | 展示覆盖率，降低或隐藏结论 |
| Provisional | 明确说明属性/映射未确认 |
| Running | 防重复提交 |
| Failed | 保留上次成功结果并可重试 |
| Water not configured | 不显示水入口 |
| Insufficient evidence | 不生成数字或根因结论 |

## 16. 非功能要求

- 所有服务端查询重新校验 Membership/Project/Scope；
- SQL 只读且按 Energy Query Context 限制；
- 原始文件、批次和派生链可追溯；
- 模板和公式发布不可变；
- 客户 UI 不能暴露内部 Tier ordinal；
- Project 切换必须驱动全部客户页面更新；
- 普通 Runs/Trace GET 只返回 redacted manifest/status；**目标能力、当前未实现**的 audited `View conversation` 将允许 Project Admin 查看 exact Project 的 user/assistant 客户可见 transcript，但不能查看 System Prompt、动态 Context、Tool arguments/results、secret、隐藏推理或完整模型请求；Project Admin 永远不能调用 Protected Request raw reconstruct；
- 每日 20 个表 × 96 点约 1,920 行只是当前小规模，模型不能依赖这个硬上限。

## 17. MVP 验收

1. admin 创建并发布一个 2 Tier Project；
2. admin 创建 3/4 Tier Draft；
3. 单节点无意义 Tier 发布时被提醒；
4. Excel 导入后累计读数正确差分；
5. 重复导入不重复；
6. total/component 不重复求和；
7. Virtual Meter 可算且错误可见；
8. user 不能进入 Admin 或其他 Workspace；
9. Project 切换后四个入口同步；
10. Overview、Explorer、AI 对同 Scope/Period 数字一致；
11. Interactive Analysis 切换时间/Scope 后自动刷新且不制造 Run；已保存的 Template Revision 与 Analysis Run 可复跑；
12. Evidence 能回到 SQL/Query、批次和版本；
13. Ngee Ann golden total 与 Preschool golden total 通过；
14. 缺失元数据的模块正确隐藏或降级。
15. Explorer 不再出现跨节点比较、成本或行动建议，并能区分 Stale、Flatline 与显式 Connectivity；
16. 由累计读数推导的功率明确标为区间平均功率。
17. 漏 1 次/2 次计划同步分别进入黄色 Delayed/红色 Stale，Flatline 不误判为离线；
18. 历史 Release 可重新激活，但其内容和历史 Run 不被改写。
19. 复制或刷新 Interactive Analysis URL 可恢复 Project/Scope/Period 和模块控件，且不创建 Run；
20. 未保存交互不进入 Runs History；保存后同一 Workspace 用户可见，并显示创建人和创建时间；
21. user 无法创建或修改 Scheduled Report，admin 可配置每日、每周和每月调度。
22. Action Summary 不超过 3 条，无重要异常时不生成弱建议；阻断数据质量问题优先展示并抑制受影响结论；
23. Data Status & Scope 不可关闭，Ngee Ann 两个 Level 不被错误标为统计异常，Circuit Ranking 默认 Top 5 且可展开；
24. Heatmap 根据单日/多日选择默认切面，Recommended Actions 的每条建议均可回到 Evidence、Explorer 或 AI Analyst。
25. 异常基线使用 4 个可比完整周期；历史不足时不误报异常，上一周期对比与异常基线明确区分；
26. 未发布的 Provisional 阈值不产生正式客户结论，业务优先级与 Data Health 状态不混用；
27. AI 润色不改变确定性规则输出，Evidence 包含当前值、基线、差值、贡献 Circuit、质量、查询和全部版本。
28. Overview 默认最近 7 个完整日，完整周期不包含今天；无数据时不把 Yesterday 静默改为最近可用日；
29. Custom 日期边界无午夜重复，默认粒度按 Period 自动选择，Peak 明确为 15 分钟区间平均功率；
30. Coverage 低于 95% 时仍可核查部分图表，但异常/建议隐藏且 Save analysis / Generate report 不可用。
31. Saved analysis 只读且冻结完整版本；Explore with these settings 和 Rerun 都不改写原 Run；
32. Runs History 字段与筛选完整，Rerun 使用最新数据并记录原 Run；
33. HTML/PDF 报告复用同一 Run 数字，Scheduled Report 进入 Workspace Reports，失败在 Admin Operations 可见。

## 18. 外部待补输入

- Ngee Ann 正式营业时间、Tariff；
- 两个样板 Meter 角色和 Scope 映射；
- Preschool Block/Room；
- 面积、人数和有效期；
- Tuya API 合同；
- 近期 Water 项目；
- DB schedule/现场反馈用于确认具体根因。

这些不阻塞 Admin/Tier 开发，但会阻塞相关 Project 的正式 Published 状态。
