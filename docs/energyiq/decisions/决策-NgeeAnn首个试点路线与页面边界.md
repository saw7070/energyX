---
title: "Ngee Ann 首个端到端试点路线与页面边界"
summary: "选择以 Ngee Ann 为首个真实垂直试点，并固定 Overview、Project Explorer、AI Analyst 的职责、运行语义和交付顺序。"
doc_type: decision
tags: [NgeeAnn, Wayfinder, Overview, Project Explorer, Analysis Run]
updated_at: "2026-08-02"
related:
  - "当前共识与新会话入口.md"
  - "决策-MVP底座双功能协同架构.md"
  - "../plans/2026-08-03-三Agent-MVP执行手册.md"
  - "../product/三类核心界面设计.md"
  - "评估-Ngee-Ann模板吸收方案.md"
  - "../plans/开发计划-Admin与模板运行闭环.md"
status: accepted
---

# Ngee Ann 首个端到端试点路线与页面边界

## 1. 背景

EnergyIQ 已经具备 Project/Tier、Meter Mapping、Excel Import Batch、Interval Fact、Metric/Rule Registry、Component Catalog、Template Draft 和真实 Draft Preview。下一阶段不能继续横向增加很多未闭环能力，而要把一个真实项目从数据导入、发布、运行、浏览、问数一直打通到可验收。

同时，现有 Project Explorer 混入了同级比较、成本、异常建议和行动结论，与 Overview 的职责重叠。Charles 新确认的方向是：Explorer 只负责项目结构、计量点、来源数据和数据健康核查；跨节点比较、决策异常和建议统一进入 Overview。

## 2. 选项

| 选项 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. 横向补齐平台 | 同时开发多项目、全部 Admin、完整 Operations、AI 改模板和 Tuya Connector | 功能面看起来完整 | 很难形成一个真实可验收闭环，风险被摊薄 |
| B. Ngee Ann 垂直试点 | 先把一个真实 Project 的发布、运行、Overview、Explorer 和 AI Context 打通 | 最快暴露数据、口径和交互问题；能形成客户可验收成果 | 其他项目能力需要稍后验证 |
| C. 引入通用 BI/Superset | 把图表与 Dashboard 交给外部 BI | 通用图表和编辑能力成熟 | 增加服务、账户、权限和版本边界；不能替代能源事实与项目发布模型 |

## 3. 决定

**选择 B：以 Ngee Ann 为首个真实端到端试点，继续在 DataFoundry 内二次开发。**

- Ngee Ann 是首个主要试点；Preschool 只作为第二套模板与三层结构的泛化验证。
- 首个完成条件是“一个真实 Project 可在受控测试环境稳定导入、发布、运行、下钻、问数和追溯”，不是把整个平台所有菜单都做完。
- 现阶段不引入 Superset 作为运行依赖；CopilotKit 继续服务 AI Analyst，而不是承担 Explorer 图表。

## 4. 三个客户页面的唯一职责

| 页面 | 回答的问题 | 允许展示 | 不应承担 |
| --- | --- | --- | --- |
| Overview | 发生了什么、为什么值得关注、先做什么 | 跨节点/跨时间比较、同级排名、热力图、用能异常、非营业浪费、建议和 Evidence | 原始记录浏览、设备配置 |
| Project Explorer | 项目实际有什么、某个表最近报了什么、数据是否可信 | Project Tree、Meter 列表、累计读数、区间能耗、平均功率、来源、覆盖率、数据健康和质量事件 | 同级业务比较、决策排名、成本结论、行动建议 |
| AI Analyst | 模板之外还要追问什么、计算过程是否可信 | DataFoundry 对话、Artifact Preview、Task Console、Evidence、Trace 和可信 Energy Query Context | 绕过确定性事实层临时编数字；直接改正式模板 |

Explorer 可以展示由来源数据确定性推导的值，例如累计读数差分得到的 `interval_kwh`、区间平均功率和覆盖率；“只展示 API 信息”不等于只显示 API 原始字段。当前 Excel 与未来 Tuya API 均通过 Source Adapter 进入同一事实层，页面不感知来源差异。

## 5. Ngee Ann Overview Preset

固定的阅读顺序是：先结论，再说明数据范围，然后给证据，最后收束为行动。

~~~text
┌──────────────────────────────────────────────────────────────┐
│ 1. Action Summary                                            │
│    最值得处理的 1–3 件事、影响范围、优先级                    │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 2. Data Status & Scope                                       │
│    Project / Scope / Period / 数据新鲜度 / 覆盖率 / 版本       │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 3. Energy Overview                                           │
│    总耗能 / 日均 / 峰值与时间 / 自身历史变化                  │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 4. Level Comparison                                          │
│    Level 6 vs Level 7；Light / Load / Aircon / Other 构成      │
│    Circuit Ranking 只在这里作为“为什么该 Level 更高”的下钻     │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 5. Day Profile & Heatmap                                     │
│    工作日/周末/节假日、24 小时模式、日期×时间热点             │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 6. Exceptions & Evidence                                     │
│    异常日期/时段/Level；贡献 Circuit；规则与查询证据            │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 7. Recommended Actions                                       │
│    按影响排序的核查/节能动作，链接到 Scope 或 AI Analyst       │
└──────────────────────────────────────────────────────────────┘
~~~

`Circuit Ranking` 不独立堆成长章节：

- 正常情况下，它嵌在 `Level Comparison` 内，用来解释 Level 差异；
- 触发异常时，它嵌在 `Exceptions & Evidence` 内，用来定位贡献回路；
- 用户需要逐表核查时，再跳转到 Project Explorer。

### 5.1 模块契约

- **Action Summary**：最多展示 3 条优先事项，每条固定为 `Problem → Impact → Action → Evidence`。没有重要异常时显示 `No priority exceptions`，不为了填满模块生成弱建议；
- **数据质量优先级**：若质量问题会阻断当前 Scope/Period/Metric 的可信计算，先展示数据问题，并隐藏受影响的能耗结论。局部问题只降级受影响部分，不让无关模块整体失效；
- **Data Status & Scope**：固定放在 Action Summary 下方且不可关闭，至少展示 Project/Scope、分析区间、数据完整度、最近成功同步时间以及 Data Snapshot/Release 版本；
- **Level Comparison**：Ngee Ann 只有 Level 6 与 Level 7，不使用统计意义上的“异常同级”标签。展示绝对用量、差值、自身历史变化；面积/人数元数据可用时再展示归一化比较，并说明各 Level 的最高耗电 Circuit；
- **Circuit Ranking**：按所选 Period 的耗电量排序，在每个 Level 与业务分类下默认 Top 5，可展开全部。它只嵌入 Level Comparison 或 Exceptions & Evidence；
- **Day Profile & Heatmap**：Day Profile 区分 Workday、Weekend、Public Holiday。多日范围默认 `Date × Hour`，单日范围自动使用 `Level × Hour`，并允许在适用切面之间切换；
- **Recommended Actions**：MVP 只读，不增加负责人、状态、工单或审批流程。每条行动必须链接 Evidence，并可进入对应 Explorer Scope/Meter 或带上下文的 AI Analyst。

### 5.2 基线、异常与 Evidence 契约

- **异常基线**：优先使用同一 Scope 最近 4 个同类型、同长度且完整的历史周期平均值。周期类型由 Project Calendar 区分 Workday、Weekend 与 Public Holiday；不足 4 个可比周期时只展示描述性变化，不判定业务异常；
- **上一周期对比**：`Compare with previous period` 使用紧邻当前 Period、长度相同的前一时段。它是用户主动查看的比较层，不等同于异常规则使用的历史基线；
- **MVP 异常范围**：只包含用量高于自身历史基线、非营业时间用量、峰值时段异常，以及可靠面积/人数元数据下的归一化异常；不使用 ML；
- **阈值来源**：阈值属于 Project 的 Rule Revision，由 admin 配置，不写死在代码中。尚未由项目确认的阈值只能标记为 `Provisional`，不能作为正式客户结论；
- **优先级**：根据额外耗电量与影响范围排序，客户侧首期只使用 `Attention` 和 `High priority`。Data Health 的黄色/红色是另一套运维状态，不能混为能源异常严重程度；
- **建议生成**：确定性规则选择受控 Action Template，AI 只可润色表达，不得改变事实数字、优先级、规则结论，也不得把可能原因写成已确认原因；
- **Evidence**：每条结论固定携带 Scope、Period、当前值、历史基线、差值、贡献 Circuit、数据质量、Query/SQL，以及 Data Snapshot、Metric/Rule/Template/Release 版本。

## 6. 数据、发布和运行约束

### 6.1 首个数据契约

- Ngee Ann Excel 首期固定使用 `Device Name`、`Time`、`Active Energy`；
- 使用通用 Source Adapter 与 Fact Pipeline，但不在首期引入大模型字段映射；
- Import Batch 不可变，文件 SHA 用于幂等；自然键重复去重，冲突交给 admin 处理；
- 数据只在通过校验后进入 `Available`，客户不看到待验证批次；
- coverage `<95%` 阻止正式运行，`95%–99.5%` 警告，`>=99.5%` 为完整；未解决的复位、单位或聚合冲突始终阻止发布。

### 6.2 Release、Snapshot 与 Run

- 一个客户可见 `Project Release` 固定 Hierarchy、Mapping、公式和 Template Revision；
- Interactive Analysis 使用当前 `Available` 事实和已发布 Project Release/Template；用户切换时间、Scope 或交互控件时自动重新解析，不创建 Analysis Run；
- `Data Snapshot` 在保存正式结果时固定该结果可见的已验证数据；数据更新不要求重新发布 Project Release；
- 只有 hierarchy、mapping、formula、metric/rule 或 preset 变化才发布新 Release/Revision；
- 用户点击 `Save analysis`、`Generate report`，或系统执行定时报告时，才创建新的不可变 `Analysis Run`；运行固定 Project Release、Data Snapshot、Scope、Period、Metric/Rule/Calendar 等版本；
- 普通切换时间/Scope、下钻、展开模块、查看 Circuit 和上一周期对比都不创建 Run，也不新增 `Query Receipt` 领域对象；查询仍可显示当前 Evidence，并进入普通请求/Session Trace；
- AI Analyst 普通追问和切换范围只进入 Session Trace；只有用户把 AI 结果保存为正式分析/报告时，才创建带 `parent_analysis_run_id` 的 Child Analysis Run；
- Project Release 与 Template Revision 不可修改、不可删除；需要回滚时重新激活历史 Release 并记录激活审计，不改写历史内容；
- 失败运行不覆盖最后一次成功结果。

### 6.3 Interactive Analysis

Interactive Analysis 是 Overview 的默认使用方式。Template 固定分析模块、Metric、Rule 和 Evidence 契约；用户在这些护栏内自由改变运行参数：

- 全局：Project、Scope、Resource、Period；
- 通用时间预设：Yesterday、Last 7 days、Previous week、Previous month、Custom；需要时可保留 Last 30 days 作为附加预设；
- Overview 首次进入默认选择 Last 7 days；Project Explorer 继续默认 Latest complete data day；
- 模块内：15 min / Hour / Day 显示粒度、Compare with previous period、业务分类筛选、排名展开；
- 所有模块共享同一个全局 Period。模块内控件可以改变展示粒度或对比层，但不能各自选择互相矛盾的主时间范围；
- 交互不能改变 Template 结构、Metric/Rule 口径、SQL 或 Project Release。

Project、Scope、Resource、Period、granularity、comparison 和分类筛选等视图状态写入 URL。刷新页面或分享链接时应恢复同一视图，但 URL 只是导航状态，服务端仍重新校验 Workspace/Project 权限及已发布版本；恢复链接不创建 Analysis Run。

未保存的 Interactive Analysis 不进入 Runs History，只保留普通请求日志；由 AI 发起的交互同时进入 AI Session Trace。用户点击 `Save analysis` 后，系统才创建当前 Workspace 内共享可见的不可变 Analysis Run，并记录 `saved_by` 与 `saved_at`；FM/Boss 使用同一 user 权限均可查看。`Generate report` 可基于现有正式 Run 生成报告，若当前结果尚未保存则先固化一次 Run。

每日、每周、每月等 Scheduled Report 首期只允许 admin 配置。user 可以手动 `Save analysis` 和 `Generate report`，不能创建或修改调度规则。

时间预设按 Project timezone 解析：Yesterday 是上一个完整日；Last 7 days 是最近 7 个完整日；Previous week 是前一个完整日历周；Previous month 是前一个完整日历月。

Interactive Analysis 和正式 Analysis Run 必须调用同一个确定性 Analysis Resolver。区别只在于是否冻结 Data Snapshot、结果 Artifact 和版本证据，不能维护两套计算实现。

### 6.4 时间、峰值与部分数据语义

- Yesterday、Last 7 days 等完整周期预设按 Project timezone 计算，永不包含尚未结束的今天；
- 数据过期或所选 Period 无数据时，不把 Yesterday 偷换成最近有数据的一天。页面显示空状态、最近成功同步时间和 `View latest available data`；用户点击后才显式改变 Period；
- Custom 在服务端统一解析为左闭右开 `[from, to)`；界面输入的结束日期仍按“包含当天”展示，并转换为次日 00:00 的排他上界；
- 默认图表粒度为：单日 `Hour`、2–31 天 `Day`、更长范围 `Week`。用户仍可切换 Template 允许的粒度；
- Peak 固定为最高 15 分钟区间的平均功率 `kW`，同时展示发生时间；不得称为瞬时功率；
- Coverage `<95%` 时，Interactive Analysis 可以显示确定性可得的部分图表和 `Partial data` 警告，但隐藏异常与 Recommended Actions，并禁用 `Save analysis` / `Generate report`。Explorer 仍允许核查缺失与来源数据。

### 6.5 Saved Analysis、Rerun 与 Report

- `Save analysis` 默认使用 `Project · Scope · Period` 作为标题，用户可修改标题并添加备注；这些是可编辑元数据，不改变不可变分析内容；
- 保存时冻结 Project Release、Data Snapshot、Template/Rule/Metric Revision、Scope、Period、筛选、粒度、比较参数、结果 Artifact 和 Evidence；
- 打开历史结果进入只读 `Saved analysis` 模式。`Explore with these settings` 把相同参数带入 Interactive Analysis，但不改变原 Run；
- `Rerun` 复用原配置并基于最新 Available 数据创建新 Run，记录 `rerun_of_run_id`，绝不覆盖旧结果；
- Runs History 固定展示 Name、Project、Scope、Period、Saved by、Saved at、Data status、Report status，并支持按 Project、Scope、作者筛选；
- `Generate report` 从同一个 Run Artifact 生成站内 HTML 与可打印 PDF，不另走第二套计算。当前分析尚未保存时先创建 Run；
- Scheduled Report 同样产生 Run 与报告并写入 Workspace Reports。MVP 不发邮件/短信；失败进入 Admin Operations。

## 7. Explorer 数据健康模型

Explorer 的告警只描述“数据或计量是否可信”，不描述“用能是否优秀”。每日同步首期使用以下已确认状态：

| 状态 | 判断依据 | 建议 UI | 含义 |
| --- | --- | --- | --- |
| Healthy | 最近计划同步成功、最新读数足够新、无阻断质量事件 | 绿色 | 数据正常可用 |
| Delayed | 错过 1 次计划同步 | 琥珀色 | 数据可能延迟，继续观察 |
| Stale / Suspected offline | 连续错过 2 次计划同步，时间戳没有前进；或 Tuya 明确返回 offline | 红色 | 数据已过期或设备疑似离线 |
| Flatline | 连续 3 个日历日有新时间戳到达，但累计读数完全不变 | 琥珀色 | 可能是真实零耗能，也可能是卡表；不能单凭此状态断言离线 |
| Invalid | 复位、负差、单位冲突、重复冲突或不可能跳变 | 红色 | 数据不可直接用于正式分析 |
| Unknown | 尚无已接受读数或历史不足 | 灰色 | 暂时无法判断数据健康；Connectivity 可独立为 Unknown |

如果 Tuya API 提供明确的 heartbeat/online/last_seen 字段，Explorer 同时展示 `Connectivity` 与 `Data health`。正式 API 契约未提供这些字段前，Connectivity 保持 `Unknown`；页面只写 `Last data received` 和 `Data health`，不能把每天一次导入包装成实时在线状态。

树节点按以下方式汇总状态：

- Meter 行显示自身状态；
- Scope 行显示问题数量，例如 `1 critical · 2 warning`；
- 只有该 Scope 的 Official Aggregation Route 所依赖的计量点出现红色状态时，Scope 才标红；其他子表异常将 Scope 标黄并显示数量，避免一个非关键分表把整个 Project 染红；
- Flatline 默认检查全部 Physical Meter。管理员可对确认长期停用的 Meter 静音，但必须填写原因并保留 mute/unmute 审计；
- Virtual Meter 不显示 Online/Offline，而显示 `Derived`。其数据健康继承输入表；任一必要输入缺失时显示 `Partial` 并列出受影响输入。

Data Health 使用两套时间语义：

- `Current data health` 始终按最新计划同步判断，用在左侧树的绿/黄/红状态；
- `Selected-period quality` 按用户当前时间范围计算 Coverage、Missing、Reset 等，用在主区质量面板；
- 查看历史数据不会拿历史最后时间戳推断设备“当前在线”，当前设备故障也不会自动篡改历史区间的质量结论。

Explorer 默认展示 `Latest complete data day`：Project timezone 下最近一个已经完成整日边界、事实进入 `Available` 的日历日；页面同时显示覆盖率。用户仍可切换 Yesterday、Last 7 days、Last 30 days 或 Custom。

选择单个 Meter 时，顶部固定展示：

1. Latest reading：最新累计读数；
2. Last data received：最近接受数据时间；
3. 24h energy：Latest complete data day 的实际耗能；
4. 24h average power：有效能耗除以实际覆盖小时；
5. Peak interval-average power：最高有效区间的平均功率；
6. Coverage：应有点数、有效点数和比例。

Voltage、Current、Power Factor 等只有来源实际提供时才放入次级 `Electrical details`，不占据固定摘要。

导出与告警边界：

- user 可导出所选 Meter/Period 的规范 CSV，包含 timestamp、cumulative reading、interval usage、interval average power、quality flag 和 source batch；
- admin 另可下载不可变原始 Excel/API 响应；user 不直接获得含内部 device/DP、请求参数或未校验重复记录的原始 payload；
- MVP 告警只出现在 Explorer 和 Admin Issue List，不做邮件、短信或推送。

跨页面上下文传递：

- Overview 的证据链接进入 Explorer 时保留 Project、Scope、Period、Resource、Analysis Run/Release/Snapshot；
- 如果证据指向具体贡献 Circuit，Explorer 直接选中对应 Meter；
- 返回 Overview 时使用该 Meter 最近的、具备结构化模板的业务 Scope，并保留当前 Period/Resource；
- URL 只保存导航选择，服务端仍重新校验权限和可信 Context。

功率口径固定为：

~~~text
interval_average_kw = interval_kwh / actual_elapsed_hours
24h_average_kw = valid_interval_kwh_sum / covered_hours
~~~

因此页面应写 `15-minute average power`、`24-hour average power` 或 `Peak interval-average power`。只有 API 确实提供瞬时有功功率时，才展示 `Instantaneous active power`。

## 8. Wayfinder 更新后的 MVP 路线

Wayfinder 的核心原则仍是“先跑通一个真实案例，不横向铺平台”。结合当前真实进度，交付顺序更新为：

1. **M1：Ngee Ann 可交互 Overview**：数据底座固定真实分析结果，管理员正式发布 Template Revision，Boss/FM 可选择时间查看七个结构化模块；
2. **M2：保存、复跑与数据核查**：在已经可用的 Overview 上增加 Save、Saved Analysis、History、Rerun，并精简 Explorer、补 Data Health；
3. **M3：AI Analyst 可信问数**：复用 DataFoundry 原生 Runtime、Task Console 和受控图表，回答五个 Ngee Ann 核心问题；
4. **M4：结构化模板与 AI 协同**：Overview/Explorer 与 AI 传递相同 Project、Scope、Period 和 Evidence；
5. **M5：Preschool 泛化**：验证 Block → Room → Circuit，不提前猜测缺失映射；
6. **M6：外部接入与扩展**：Tuya API、Water、复杂图表和 AI Template Proposal。

Data Foundation 不是一个必须“全部做完”的前置平台，而是按 M1–M4 的真实需求持续提供数据能力。三个 Agent 可以并行准备，但结构化模板始终是产品主线。

原路线中“先完整建设 Analysis Run 再验证 Overview”不再适用：先证明 Interactive Overview 有决策价值，再增加保存和复跑。Explorer 也不再阻塞 AI 的准备工作；AI 可并行验证现有 Runtime，但正式验收仍使用与 Overview 相同的 Ngee Ann golden result。

## 9. 已确认的后续运行规则

1. Template 首期只允许模块开关、顺序、规则阈值和营业时间配置；不开放自由画布或任意 SQL。发布修改时生成新的 Template Revision；
2. Interactive Analysis 中改变 Scope/Period、图表粒度或上一周期对比时自动刷新且不创建 Run；AI 普通追问也不创建，只有保存 AI 正式结果时创建 Child Analysis Run；
3. 新加坡节假日和 `08:00–18:00` 营业时间可作为 `Provisional` 配置展示；未确认的 Tariff、面积和人数指标只在 Admin Preview 出现，客户正式页面隐藏；
4. Project Release 不修改、不删除；回滚通过重新激活历史 Release 完成并保留审计；
5. Ngee Ann 在受控测试环境通过导入、发布、运行、Overview、Explorer、AI 和追溯验收后，才开始 Preschool 泛化；
6. Tuya API 连接信号为可选能力；合同未确认前保持 Connectivity `Unknown`；
7. 每日同步漏 1 次为黄色 Delayed，连续漏 2 次为红色 Stale；连续 3 日新时间戳下读数不变为黄色 Flatline；
8. Explorer 默认时间为 Latest complete data day，同时保留完整 Period Selector。

## 10. 后果与复审条件

- 现有 Explorer 中的 Horizontal/Vertical Comparison、业务异常建议和硬编码 Cost 应迁移到 Overview，而不是继续扩建；
- Explorer 与 Overview 共用 Project、Scope、Period 控件和同一事实接口，但使用不同的呈现模块；
- 现阶段优先复用本项目已有 Recharts 和通用 UI；只有出现高密度二维热力图、超大量点或外部 BI 自助分析的明确需求时，才复审图表技术；
- 若客户未来明确要求自由拖拽、跨业务自助建图或数百种通用图表，再重新评估 Superset sidecar，不把它作为当前 Explorer 的前置依赖。

## 11. 关联

- [三个核心任务界面与 Data Map](../product/三类核心界面设计.md)
- [Ngee Ann 现有模板吸收方案](评估-Ngee-Ann模板吸收方案.md)
- [当前共识与新会话入口](当前共识与新会话入口.md)
- [开发计划：Admin 与模板运行闭环](../plans/开发计划-Admin与模板运行闭环.md)
