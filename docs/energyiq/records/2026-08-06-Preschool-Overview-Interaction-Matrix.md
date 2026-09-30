---
title: "Preschool Overview Interaction Matrix"
summary: "记录 Preschool Overview 对 Charles 报告模块的保留、适配与主动删除，以及数据所有权、Evidence、降级和浏览器验收边界。"
doc_type: implementation_record
tags: [Overview, Preschool, Interaction, Evidence, Chrome]
updated_at: "2026-08-09"
related:
  - "2026-08-05-Ngee-Ann-Overview-Interaction-Matrix.md"
  - "../decisions/2026-08-05-Overview用户价值与AI-Slot最小交付决策.md"
  - "../decisions/决策-Preschool-Portfolio数据集接入.md"
status: provisional
---

# Preschool Overview Interaction Matrix

## 1. 用途与边界

本矩阵落实 GitHub Issues `#10`、`#11`、`#12`、`#13` 和 `#18` 的 Preschool 页面合同。它不是新的通用 Renderer、Dashboard DSL、Forecast 平台或 Evidence 平台。

- 页面统一使用 Published Project Release、Hierarchy、Mapping、Calendar、Snapshot、Period 和 timezone。
- Deterministic Projection 是 KPI、Benchmark、Spike、Ranking 和 Evidence 的权威来源；React 只组织与显示。
- AI Slot 是可选增强层。模型失败不得阻塞确定性 Overview，也不得改写确定性数值。
- 全局 Period 选择器不恢复。Preschool 首版固定使用已发布的完整 May 2026 Portfolio Snapshot。
- Charles 静态报告是需求与表达参考，不是事实源；Mock、未发布或推断内容必须适配、降级或删除。

## 2. 保留、适配与删除矩阵

| 模块 / 交互 | 处理 | 决策问题与结果 | 权威数据 / 状态所有者 | Evidence | Partial / Unavailable | 浏览器验收 |
| --- | --- | --- | --- | --- | --- | --- |
| Portfolio 总览 | 保留并适配 | 当前总量、日均、覆盖率、Centre 数、Standby 占比与成本可用性 | Project Analysis Snapshot；服务端 KPI | Snapshot、Release、Period、coverage | Tariff 未发布时 Cost 为 `Unavailable`；不以零代替 | 1440/1920 首屏、无横向溢出 |
| Key findings & top actions | 保留并适配 | 显示 0–3 项真正有决策价值的主题，逐项回答 Finding、Why、Action、做与不做的预期后果、Verify | 服务端 Benchmark/Operational Projection 组装结果 | 点击后展开并聚焦同一 Snapshot Evidence | 子 Projection 不可用时撤下相关结论，不伪造替代 Finding 或机械凑满三项 | 键盘可达；Evidence 一击可见 |
| AI energy analyst | 保留为可选增强 | 通过观察、下钻和验证/反证发现额外 Evidence-backed 调查角度，而不是复述当前图表 | 当前用户授权的只读 Agent Run | Finding-specific SQL / tool evidence；允许有界 Top-N/多行结果 | Thinking、Available、Unavailable 均不阻塞确定性页面；证据不足时允许 0 条 | 状态可见；无 silent fallback |
| EUI × Per-pax 四象限 | 保留并适配 | 识别同时高于 Portfolio P75 的 Priority Centres | Published Benchmark Projection | `preschool-eui-benchmark-v1`、`preschool-per-pax-benchmark-v1`、`preschool-quadrant-v1` | Area/Headcount 为 Provisional 时明确标记，不下正式效率结论 | 30 点、P75 轴、G/M/J、颜色＋形状＋文字 Legend |
| Peer benchmark distributions | 新增适配 | 用户看懂“与同类型谁比较、位于 cohort P50/P75 哪一侧” | 服务端三 cohort 的 Centre 点、P50、P75、n | 同一 Benchmark recipes 与 Snapshot pins | 不在浏览器重算 percentile；30 个 Centre 混合三种 cohort，不拟合正态 Bell curve，保留 empirical dots | 1440 单列、1920 双列；2 metrics × 3 cohort lanes |
| 24 小时 Operating / Closed profile | 新增适配 | 回答“平均一天能源发生在什么时候，关闭时段负荷集中在哪些小时” | Published Calendar + 同一 Snapshot 的 Centre-hour Projection | Calendar version、`preschool_centre_hour_cells_v1`、Snapshot | Calendar 或完整 Centre-hour cells 不可用时随 Operational 模块局部 Unavailable | 24 个 hour bars、独立时间轴、Operating/Closed 双编码、无裁切 |
| Standby / Operating split | 保留并适配 | 区分关闭时段与营业时段能源及异常事件 | Published Calendar + Preschool Operational Projection | Calendar version、hour-slot recipe、Snapshot | Calendar 或 facts 不可用时整个 Operational 模块诚实 Unavailable | Golden 数值、Centre type、无横向溢出 |
| Spike / SOP signal | 保留并降级表述 | 显示同 Centre、同 hour-slot 基线偏差及调查优先级 | 服务端 `>50%` Spike 与 provisional SOP projection | 日期、小时、Day Type、usage、baseline、variance、Leading Circuit | Spike 不是浪费结论；SOP score 不是正式 Compliance | Standby/Operating/Centre Type/Day Type 可读 |
| Appliance Ranking | 保留并项目化适配 | 用 9 个客户可读 Appliance 标签回答 Portfolio 能源主要流向；底层实体仍是 Circuit | 服务端 `preschool-appliance-ranking-v1` Projection；项目专属 published alias contract | Snapshot、Release、Hierarchy、Mapping、source query、raw Circuit IDs | 9 标签/30 Centres/official total 任一不满足时局部 Unavailable；不按字符串猜测 | 9 条横向排名可读、总量对账、Evidence 披露 Circuit 来源 |
| Centre ranking | 新增适配 | 先回答“哪五个 Centre 对总量贡献最大”，再允许 FM 展开全部 normalised rows | 服务端排序与 Benchmark Projection | Snapshot、Benchmark recipes、published metadata；原始 Circuit 在 Evidence | Normalisation 缺失时单元格 Unavailable / Provisional | 默认 Top 5 横条；30 行表默认折叠但键盘可达 |
| June planning baseline | 新增 Demo 适配 | 回答“如果 May 的完整周模式延续，June 可用什么量级做排班/预算准备” | 同一 accepted May Snapshot 的 4 个完整 Mon–Sun 周；服务端 `daily_totals_v1` | `preschool-naive-weekly-planning-baseline-v1`、Snapshot、4 周明细 | 任一周不完整则局部 Unavailable；明确不是 AI/统计 Forecast，不展示 June actual | 4 周条形、均值、observed-week range、假设可展开 |
| Provisional cost | 新增 Demo 适配 | 把能耗量级翻译成可理解的预算量级 | June planning baseline × SP Group Q2 2026 low-tension non-domestic reference | 27.27 cents/kWh before GST；适用 2026-04-01 至 2026-06-30；官方来源链接 | 明确 `Estimated / Provisional`、不是客户合同或账单、不写入正式 Tariff store | Rate、period、before-GST、来源一击可见 |
| Live Forecast | 保持 Unavailable | 说明何时才能把 planning baseline 升级为可验收 Forecast | Published Forecast Recipe（当前不存在） | 当前 Snapshot/Release 中无 Forecast recipe | 需要更多历史、Backtest 和正式 Recipe；不把 naive baseline 称为 Forecast | 与 Demo baseline 并列但视觉降级 |
| Snapshot & Evidence | 保留并适配 | 让 FM 查看 Period、Snapshot、Release、Query 和 Recipe IDs | 服务器返回的 Evidence pins | 折叠区；决策卡一键展开并聚焦 | 缺少引用时显示 `Unavailable`，不编造 ID | 鼠标与键盘均可进入；焦点可见 |

## 3. 明确停止项

- 不恢复 Charles 报告里的 Mock June actual 或伪精确 Forecast。June 只提供明确标记的 naive planning baseline。
- 不把 SP 参考价写入客户正式 Tariff、不把 Provisional cost 称为账单、节省或 ROI。
- 不将电表事件推断成现场 Main cause，也不把 Leading Circuit 写成已确认根因。
- 不把 `100 - Spike count` 称为正式 SOP Compliance。
- 不拟合 Bell Curve、不在浏览器计算 mean/std/percentile、不建设通用 Benchmark 平台；当前页面使用服务端点位与 P50/P75 的 empirical distribution。
- 不在 React 汇总 Appliance Ranking，不新增第二套 SQL/统计栈；只从当前权威分析结果形成项目专属服务端 Projection。
- 不把 `preschool-demo` 的 Circuit-as-Appliance 别名合同推广到缺少等价 Published Mapping 的真实项目。
- 不以自动化、截图或 Provider 工具调用替代 Charles 的信息价值与行动价值验收。

## 4. 当前工程证据与剩余门槛

当前新版页面的 Chrome 证据位于 `.scratch/overview-acceptance/`：

- `preschool-current-1440-top.png`
- `preschool-current-1440-benchmark.png`
- `preschool-current-1440-distributions.png`
- `preschool-current-1920-top.png`
- `preschool-current-1920-benchmark.png`
- `preschool-current-1920-distributions.png`
- `preschool-current-1440-operating.png`
- `preschool-current-1920-operating.png`
- `preschool-current-1440-evidence.png`
- `preschool-current-1920-evidence.png`

## 4.1 Demo planning reference 的官方来源与算法

- 官方一手来源：[SP Group — Electricity Tariff Revision for the Period 1 April to 30 June 2026](https://www.spgroup.com.sg/about-us/media-resources/news-and-media-releases/Electricity-Tariff-Revision-for-the-Period-1-April-to-30-June-2026)。
- Appendix 2 官方图：[Q2 2026 electricity tariffs](https://www.spgroup.com.sg/dam/spgroup/images/news-media-releases/2026/Appendix-2---Q2-2026.png0)。其中 Low Tension Supplies, Non-Domestic 为 `27.27 cents/kWh before GST`、`29.72 cents/kWh with 9% GST`，适用 `2026-04-01` 至 `2026-06-30`。
- Preschool 是 Mock Demo。页面只采用 `0.2727 SGD/kWh before GST` 做 Provisional reference；它不是客户合同 Tariff，不进入 Published Tariff Revision，也不覆盖未来正式配置。
- June usage baseline = May 同一 accepted Snapshot 中 4 个完整 Monday–Sunday 周的平均周能耗 × `30/7`；区间使用 4 周 observed minimum/maximum 同比例换算。该方法不建模天气、occupancy、假期、运营变化或趋势，因此只用于量级准备，不用于承诺或节能验收。

## 4.2 A4 Operating Hours 合同与验收边界

- A4 复用同一 Snapshot-scoped Centre-hour × Circuit 查询，在 `PreschoolOperationalProjection` v2 上追加 `operatingSharePct`、`provisionalOperatingCostBeforeGstSgd` 和 `operatingAppliances`；没有新增第二条 SQL 或第二套分析模型。
- v2 保持 additive 是滚动部署兼容策略：旧 Web 可忽略新增字段；新 Web 必须 feature-detect `operatingAppliances`，面对 pre-A4 v2 API 时整个 Operational 模块诚实 fail closed，不用 all-hours Appliance 数据冒充 operating-state breakdown。
- Section 4 阅读顺序固定为 `Key focus → KPI → operating composition → Spike detail → collapsed all-hours supporting context → Method/Evidence`，最终以 Evidence 收尾。Observed leading contributor 不等于 root cause，不展示未经定义的 Potential Saving。
- A4 的自动化与 typecheck 通过不等于共享 `3102` 正向验收通过。只有新 API 构建加载后，真实 Chrome 显示 5 KPI、operating composition、Centre 全事件展开，并完成 1440/1920、鼠标/键盘和 console 验证，才可记录运行时通过；旧 API fail-closed 截图只能证明降级边界。

最新自动化和真实 Chrome 已确认 Day Type、Centre Type、Evidence 一击展开、1440 单列/1920 双列、无横向溢出及零 Console error。`#12` 的服务端 Appliance Ranking、客户侧别名、数值对账和宽屏验收已完成。Preschool 当前只剩：

1. `#13` 按 Charles 的信息价值、分析深度、可读性、图文配合和行动后果标准完成工程改造与最终人工验收；
2. `#18` 在不阻塞确定性页面的前提下，把 AI Slot 从单次聚合响应升级为有界的多步调查。
