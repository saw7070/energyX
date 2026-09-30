---
title: "2026-08-06 开发记录：Overview 夜间执行清单"
summary: "收口 Ngee Ann 与 Preschool 客户可见 Overview；维护主 Agent 确定性 Overview、侧边 AI 审核与两项目试点预验收的夜间执行边界。"
doc_type: runlog
tags: [Overview, Ngee-Ann, AI-Slot, Preschool, 开发记录]
updated_at: "2026-08-08"
related:
  - "../decisions/2026-08-05-Overview用户价值与AI-Slot最小交付决策.md"
  - "../decisions/决策-NgeeAnn首个试点路线与页面边界.md"
  - "../decisions/决策-Preschool-Portfolio数据集接入.md"
---

# 2026-08-06 Overview 夜间执行清单与 Runlog

## 1. 今晚目标与执行边界

北极星：先把 Ngee Ann 做成无需切换整页 Scope/Period 的多时间尺度 Project 决策页；自动化和真实 Chrome 收口后，推进 AI 可信链路与 Preschool 垂直切片。

范围内新问题可以直接修复，但必须直接改善当前 Ngee Ann/Preschool 页面、可自动回归、且不引入第二套 Runtime、Snapshot、Scheduler、Cadence DSL 或通用 Insight 平台。范围外问题只进入停车场，明天讨论。

## 2. 任务顺序与状态

状态：`TODO` / `DOING` / `BLOCKED` / `DONE`。

| 顺序 | Ticket / 切片 | 状态 | 交付与验收边界 |
| --- | --- | --- | --- |
| 1 | #9 / Ngee Ann 页面外壳 | DONE | Ngee Ann 固定 Project Scope、滚动 28 天；隐藏整页 Scope/Period/Custom 日期控件；旧深链规范化到同一 current Overview；非 Ngee Ann 兼容合同保留。 |
| 2 | #9 / 所有小时条形图坐标轴 | DONE | Day profile、单日 Hourly Energy trend、Incident 24-hour evidence 的柱体与 00:00–21:00 时间轴分成相邻独立行；日期粒度图未做无依据改写。 |
| 3 | #9 / Day profile 信息价值 | DONE | 增加 Profile mean 参考线、高于均值的语义蓝色、相对均值百分比；没有把“高于均值”误称为异常。 |
| 4 | #9 / Heatmap | DONE | 默认显示服务端 `mean_of_complete_local_days` 合同的 Level × hour average；提供 Weekday/Weekend；Date × hour 仍可局部查看；平均视图无日期选择器。 |
| 5 | #9 / AI 卡片排版 | DONE | 评估后保留底部纵向操作区：当前标题宽度、移动端和键盘顺序更稳；用户已说明这项可保持现状。 |
| 6 | #9 / 自动化验收 | DONE | 定向、Web 全量、AI 定向、生产构建和 Impeccable 机械审查通过。 |
| 7 | #9 / 运行服务与 Chrome | DONE | Integration 生产服务已更新；旧 URL 在真实 Chrome 规范化；1440/1920 验证全局控件消失、28d/7d/1d 结构、小时轴和平均 Heatmap。Charles 最终人工签字不在自动化完成声明内。 |
| 8 | #17 / 真实 Provider Evidence | DONE | #17 已证明 Ngee Ann 页面级自主 Run、Snapshot/cutoff pin、只读 SQL、Evidence dialog 与 fail-soft UI 可以端到端工作，Issue 已关闭。后续同 Snapshot 复测证明 Provider 不稳定，但不会因此重开或扩张 #17。 |
| 9 | #14/#16 / Finding → AI Analyst 继续追问 | DONE | Overview 已带入 Finding、Evidence、Project、Snapshot；补入 timezone/data cutoff，并在 Analyst 中展示 Data through。没有建设通用 Session/lineage 平台；旧回答在上下文变化后的自动失效进入停车场。 |
| 10 | #10 / Preschool 真实数据与独立 Overview | DONE | 已从权威 May Excel 生成 270 个 series、200,880 条小时事实，完成 Mapping、materialization、Project Publish 和独立 `PreschoolOverviewRenderer`；固定 2026-05-01..31，不暴露全局 Scope/Period。 |
| 11 | #11 / Preschool Benchmark 与效率四象限 | DONE | 服务端权威计算 Portfolio/Cohort P50/P75、EUI × Per-Pax 四象限和 G/M/J Priority；Renderer 只展示投影，不在客户端重算 percentile。数值 Golden、30 点 SVG、定向测试与 1440/1920 Chrome 回归均通过。 |
| 12 | #12A / Operating Calendar 与 Standby/Operating | DONE | 发布 Project Calendar：Mon–Fri 07:00–19:00、周末关闭、5 月 1/27 日关闭；Project Release v2 继续 pin 同一 Snapshot。真实 Golden：Operating 21,818.0283 kWh，Standby 3,103.7840 kWh / 12.45%。 |
| 13 | #12B / Spike 与 provisional SOP signal | DONE | 完成 Preschool 专属 same-Centre/same-hour-slot Spike 与 `Provisional after-hours SOP signal`；真实 Golden、Evidence pins、定向测试与 Chrome 均通过，没有建设通用 anomaly/SOP DSL。 |
| 14 | #13 / Preschool 最终组装 | DONE（自动化部分） | 把已有 Benchmark 与 Operational 投影组装为 3 张 Finding → Why → Action → Verify 决策卡；Forecast 只显示 Reference-only / Unavailable。自动化、构建和 Chrome 已通过；Charles 人工终验仍保留。 |
| 15 | #18 / Preschool AI Pack/Slot | DONE（代码）/ BLOCKED（Provider） | `preschool-analysis-pack@v1`、受控 Discovery Evidence Bundle、真实自动 Run、严格 JSON/Evidence guard、AI-labelled Slot 与 fail-soft 已完成。固定 StepFun Profile 三次验收为 0 次有用 Finding、1 次 accepted-empty、2 次 fail-closed，未达到至少 2/3 accepted；不以放松 Evidence 换通过。 |

## 3. Ngee Ann 已完成改动

- `published-decision-dashboard.tsx`：Ngee Ann 固定 Project/current 28d，移除全局 Scope/Period 表面并规范化旧深链。
- `ngee-ann-hour-axis.tsx`：三个小时条形图共用的独立窄时间轴。
- `ngee-ann-day-profile.tsx`：柱体/时间轴拆分、Profile mean 与语义色。
- `ngee-ann-energy-trend.tsx`：仅小时粒度使用独立时间轴。
- `ngee-ann-daily-anomalies.tsx`：Incident 24-hour evidence 使用独立时间轴。
- `ngee-ann-overview-view-model.ts`、`ngee-ann-usage-heatmap.tsx`：使用已验证服务端 Day Profile mean 合同生成 28d Weekday/Weekend Level × hour average，不从原始格子猜算。
- `ngee-ann-ai-run.ts`：AI Run 只暴露 schema inspection 与只读 SQL 工具；拒绝无关 workspace/file/skill 工具。
- 对应 `*.test.ts(x)`：锁定 current 28d、旧深链、Project Scope、独立时间轴、平均 Heatmap 和 AI 工具边界。

## 4. 已取得验收证据

### 自动化

- ViewModel/Renderer 定向回归：184/184 passed。
- Web 全量：85 files，935/935 passed。
- AI 定向：2 files，46/46 passed。
- `npm run build:web`：passed。
- `git diff --check`：passed（仅既有 CRLF 提示）。
- Impeccable detector：`[]`，未发现高优先级机械 UI 问题。

### 最终集成回归（含 Preschool #10–#13）

- Preschool/Ngee/API 定向回归：8 files，250/250 passed。
- Web 全量：86 files，945/945 passed。
- `npm run typecheck`、`npm run build`、`npm run build:web`：passed。
- `git diff --check`：passed（仅既有 CRLF 提示）。

### 运行与 Chrome

- API `127.0.0.1:8787` 和 Web `127.0.0.1:3000` 均来自 Integration；Overview HTTP 200。
- 旧 `Custom 2026-06-10..16` URL 自动变为 Project current Overview，固定窗口为 2026-05-20..2026-06-16，Snapshot `energy-snapshot-03499dcda183ae28c47f7d66`。
- DOM：`Analysis Scope` 0；Yesterday/Last 7/Previous week/Previous month/Custom 按钮 0；全局 date input 0；rolling 28d 标记 1。
- Day profile：独立时间轴 1；柱体内部可见小时文本 0；Profile mean 可见。
- Heatmap：默认 average=true、Weekday=true，平均视图 date selector 0。
- 截图：
  - `.scratch/overview-acceptance/ngee-ann-current-overview-1920-top.png`
  - `.scratch/overview-acceptance/ngee-ann-day-profile-axis-1920.png`
  - `.scratch/overview-acceptance/ngee-ann-day-profile-axis-1440.png`
  - `.scratch/overview-acceptance/ngee-ann-heatmap-average-1920.png`

### AI Provider 当前边界

- Ngee Ann #17 已有一次真实 StepFun accepted Run，证明端到端链路可工作；同 Snapshot 后续 StepFun/DeepSeek 复测不稳定，因此 #17 保持关闭但 Provider reproducibility 不得宣称通过。
- Preschool #18 固定 Snapshot `energy-snapshot-52ca9611e48b0d71c2efe7b7`、Workspace 默认 StepFun 3.7 Flash Profile 与同一代码连续跑三次：
  - Run 1：确定性页面约 `5.1s`；模型在第一次成功 SQL 后继续调用并超过两次 SQL 尝试上限；约 `240s` 后 fail closed。
  - Run 2：确定性页面约 `4.0s`；模型自行派生“约 45%”并把错误 Scope 过滤得到的零行解释为数据缺失；约 `135s` 后 numeric Evidence guard fail closed。
  - Run 3：确定性页面约 `3.9s`；约 `125s` 返回 `accepted-empty`，诚实显示没有值得补充的额外 Evidence-backed candidate。
- 结果：`0/3` 次产生可交付的非空 Finding，`1/3` 次被接受为空结果，`2/3` 次被守卫拒绝。当前 Flash Profile 不满足“稳定产生客户价值”的 Provider gate。
- 数字守卫只从 Finding 实际引用的 bundle `values` 与 SQL rows 中的 number 类型取白名单；字符串 ID、日期和 version 不再贡献数字。日期/Evidence index 只按完整结构引用剔除；保留合理显示精度容差，不建设单位语义引擎。
- 确定性 Overview 始终先显示并保持权威；下一次 Provider 验收只在有可用的更强 Profile/凭据后，用同一 Snapshot 再跑三次，不继续 Prompt churn，也不静默 fallback。

### 确定性性能测量与最小优化

- 优化前 Preschool warm 三次为 `8731 / 8699 / 8092 ms`，median `8699 ms`。
- 计时定位到 Preschool Renderer 未消费的 270-meter operational breakdown：每个 Meter 仍生成 JSON/policy evaluation，约占 `3.4s`；它不是 AI、React 或每条 SQL 重算 Snapshot SHA。
- Resolver 增加可选 `includeMeterOperationalBreakdown`，Preschool 明确关闭，默认保持开启；Ngee Ann Project off-hours 与 Preschool Centre-hour 投影、Snapshot/Evidence/Golden 均未改变。
- 优化后 warm 三次为 `5294 / 5950 / 4923 ms`，median `5294 ms`，约改善 `39%`。
- 最终定向 Suite：9/9 files、63/63 tests；其中 Preschool trusted Resolver 测试约 `8.29s`，Ngee Ann rolling-28d across scopes 测试约 `18.04s`。测试夹具耗时不等同页面 warm latency，但继续提示后续模块不能线性叠加未消费 Projection。

## 5. Preschool 已完成与正在收口的切片

### 真实 May 数据链路（#10）

- 权威来源：`Preschool_Database_30centres_May2026.xlsx`，30 centres × 31 days × 9 meters，小时累计表。
- 规范化产物：270 series、201,150 readings；materialization 生成 200,880 条小时事实，invalid/unmapped/duplicate/gap/orphan 均为 0。
- Published Snapshot：`energy-snapshot-52ca9611e48b0d71c2efe7b7`；真实总量 `24,921.8123 kWh`，coverage 100%。
- 独立 `PreschoolOverviewRenderer` 固定 May 2026 Project 视图；旧/无 Period URL 统一规范化；全局 Scope/Period/日期与通用 Area/headcount/section-nav 不向客户展示。
- 首版 Chrome 证据：
  - `.scratch/overview-acceptance/preschool-overview-may-1440.png`
  - `.scratch/overview-acceptance/preschool-overview-may-1920.png`
  - `.scratch/overview-acceptance/preschool-overview-may-1920-evidence.png`

### Benchmark / Matrix（#11）

- 服务端 `preschool-may-2026-benchmark@1` 使用同一 Release/Snapshot/Hierarchy/Mapping，读取 Published hierarchy 的 provisional area、headcount、facilityType。
- EUI 定义：`May usage × 12 / published comparison area`；Per-Pax 定义：`May usage / published representative headcount`。
- Portfolio Golden：EUI P75 `10.525439076 kWh/m²/year`；Per-Pax P75 `20.84584375 kWh/person/month`；Priority centres `G / M / J`。
- 页面展示 Portfolio crosshair、Cohort P50/P75、Centre 指标、四象限和 Evidence recipe ids；缺少服务端投影时诚实 Unavailable。
- 定向回归：Benchmark、Resolver、ViewModel、Renderer registry 共 14/14 passed。
- 最终 Chrome 证据：
  - `.scratch/overview-acceptance/preschool-final-1440-full.png`
  - `.scratch/overview-acceptance/preschool-final-1920-full.png`
  - `.scratch/overview-acceptance/preschool-final-benchmark-1920.png`
  - `.scratch/overview-acceptance/preschool-final-operating-1920.png`
  - `.scratch/overview-acceptance/preschool-final-forecast-1920.png`
- 最终 1440/1920 DOM：3 张 Decision cards、30 个 Benchmark points、2 条 P75 axes、0px page-level horizontal overflow；没有来自 `127.0.0.1:3000` 的 browser error log。

### Operating Calendar（#12A）

- 创建 immutable Calendar `calendar-a3c5b3e9-0dce-4349-97a0-c018e75f2b86`，发布为 `preschool-demo-template-v2` / `preschool-demo-hierarchy-v6`。
- Calendar：Mon–Fri `07:00–19:00`；Saturday/Sunday closed；`2026-05-01` 与 `2026-05-27` closure。
- Snapshot 未重算也未漂移，仍为 `energy-snapshot-52ca9611e48b0d71c2efe7b7`。
- 真实 May API 回读：Total `24,921.8123 kWh`；Operating `21,818.0283 kWh`；Standby `3,103.7840 kWh`；Standby share `12.45%`。
- 原生确认框与受控 time/date input 的浏览器自动化兼容性只影响 Admin UI 自动化；最终发布通过同一个正式 API 边界完成，没有直接写 SQLite，也没有生成重复 revision。发布后恢复 password-mode API/Web，只有一个 API writer。

### Spike / provisional SOP signal（#12B）

- 服务端 `preschool-operational-projection` 使用同一 Release/Snapshot/Hierarchy/Mapping 与已发布 Calendar，只增加一条 Snapshot-scoped Centre-hour 查询。
- Spike 基线是同一 Centre、同一 hour-slot、同一 operating state 的均值；门槛为高于基线 50%，不是通用异常引擎。
- 真实 Golden：Standby `7 Spikes / 3 Centres`；Operating `21 Spikes / 14 Centres`；provisional SOP signal `L / E / N`，分数 `96 / 98 / 99`。
- 页面展示事件时间、usage、baseline、variance 与 leading Circuit；明确说明 Spike 可能来自合法活动或 override，不自动等同浪费。

### 最终决策组装（#13）

- 页面首屏按固定优先级显示 3 张 Evidence-backed 卡片：After-hours、Efficiency、Operating exceptions。
- 每张卡片回答 Finding、Why it matters、Top action、Verify，并链接到同一页面的 Evidence；没有合成 Impact score、root cause 或 savings claim。
- Demo Forecast 明确为 `Reference demo only — not published`；Live Forecast 为 `Unavailable`，缺口是 June metered actual、Published Forecast Recipe、充分历史与 backtest。页面不展示原 Demo 的 `28,011`、模拟 Actual 或未发布 Cost。
- Snapshot 为 partial 或相关服务端投影缺失时，只隐藏对应决策卡，不在 Web 端补算。
- Durable Ticket evidence：
  - #11 `https://github.com/Zion74/energyiq-datafoundry/issues/11#issuecomment-5197077235`
  - #12 `https://github.com/Zion74/energyiq-datafoundry/issues/12#issuecomment-5197077519`
  - #13 `https://github.com/Zion74/energyiq-datafoundry/issues/13#issuecomment-5197077742`
- 最终运行态：password-mode API/Web 已重启；`/ready` 200、Overview 200，端口 8787/3000 各只有一个 listener，保持单 API writer。

### Preschool AI Pack / Slot（#18）

- API Analysis Pack、Energy Context、受控 Discovery Evidence Bundle、独立 `PreschoolAiSlot`、Renderer registry 与 fail-soft 状态已接通；Agent 只允许 `inspect_schema` 与 `run_sql_readonly`。
- SQL 由 Agent 自主选择决策角度，但成功结果必须是恰好一行的真实聚合；最多两次尝试、第一次成功后立即输出，排名、Top N、行位置和 LIMIT 数字不能冒充 Evidence。
- 任何非空 Finding 必须逐条绑定当前 Snapshot/Period、引用的 bundle item 与恰好一次成功 SQL Evidence；无依据数字、跨 Snapshot、额外 SQL、无 schema inspection 均 fail closed。
- 1440/1920 页面无横向溢出、无 Runtime/Log error；确定性卡片、AI-labelled 空结果、Benchmark 和 Operating behaviour 保持可见。截图：
  - `.scratch/overview-acceptance/preschool-ai-final-1440.png`
  - `.scratch/overview-acceptance/preschool-ai-final-1440-slot.png`
  - `.scratch/overview-acceptance/preschool-ai-final-1920.png`
  - `.scratch/overview-acceptance/preschool-ai-final-1920-slot.png`
- 因三次真实 Run 没有被接受的非空 Finding，本轮没有伪造 AI Evidence dialog 截图；该人工验收项随 Provider gate 保留。

## 6. 缓存、Resource 与 Spike 旁路复核结论

独立结论：部分同意。旁路文档正确指出重复进入没有 Resolver result cache/in-flight 去重，以及无 Published Water 的专属 Overview 仍显示 Water；但其“性能根因尚未计时”已经过时，当前主要未消费 Projection 已被实测并修复。

- 旁路复核发生时还没有可复用的确定性 Resolver Cache。AI `currentRuns` 只做同一浏览器文档内的 module-level single-flight，不缓存确定性 Overview；它可覆盖正常 SPA 离开/返回，但不承诺硬刷新、新标签页或 Web 重启后的 AI 复用。
- 后续缓存必须位于重新授权之后，只缓存成功的确定性 Resolver 结果和同 key in-flight；不得缓存 AI、错误、权限失败或跨 Workspace payload。建议有限 LRU `4–8` 条、短 TTL、Refresh bypass，不做持久化/分布式缓存。
- 完整 key 至少包含 user authorization identity、Workspace、Project、Scope、Resource、analysis from/to/cutoff、Snapshot、Project Release、Hierarchy、Meter Mapping、Meter Formula、Metric version、Calendar、Tariff、Renderer/Recipe/Contract revision。只用 Snapshot SHA 不足。
- Ngee Ann/Preschool 当前只有 Electricity Published capability；专属 Overview 应隐藏 Water，并把旧 `resource=water` 深链规范化回 Electricity。通用页面和未来真正发布 Water 的 Project 不应被全局删除 Water。
- Charles 首版 Spike 继续使用同 Centre、同 hour-slot mean 的 `>50%` 规则以保持 parity；页面已标记 `Provisional SOP signal`，主要展示 Spike、影响 kWh、最严重偏差、Centre/Circuit 和调查动作。`100 - Spike Count` 只可作为弱化的 Charles/provisional score，不得称为正式 Compliance。
- #16 继续是 post-v1 Custom Period/模块 handoff，不恢复控制整页的全局 Period，也不承担 cache/scheduler/artifact 平台。

### #28 有界 Resolver Cache 与 Resource capability 已实施

- Cache 位于服务端重新授权之后，只缓存成功的确定性 Resolver 结果；错误、权限失败、配置失败和 `:memory:` 测试数据库均不缓存。实现为进程内 LRU `6` 条、TTL `120s`，带同 key in-flight 去重与 generation-safe Refresh bypass，不引入持久化或分布式平台。
- Key 固定授权身份、Workspace、Project、Scope、Resource、窗口/timezone、Snapshot、Release、Hierarchy、Mapping、Formula、Metric、Calendar、Tariff、Renderer、Recipe 与 Contract；对象 deep-freeze，MetadataStore/DataGateway 实例隔离。
- Ngee Ann server-issued pin 快路径：cold `3862.18ms / 11 SQL`；cache hit `3.92ms / 0 SQL`；manual refresh `3144.41ms / 11 SQL`。缓存命中不再扫描整份事实，但仍先重新授权并核对完整 pin；篡改日期的 cold miss 仍以 `ENERGYIQ_CURRENT_OVERVIEW_WINDOW_MISMATCH` fail closed。
- Preschool fixture：cold `1711.98ms / 8 SQL`；cache hit `8.01ms / 0 SQL`；refresh `1570.89ms / 8 SQL`。
- 权限回归：viewer 暖缓存后把 Project 改为 Draft，同 key 在缓存前返回 `ENERGYIQ_PROJECT_FORBIDDEN`，SQL 不增加；恢复 Published 后才能继续命中。
- Ngee Ann 与 Preschool 只暴露 Electricity；旧 `resource=water` 链接自动规范化为 Electricity。通用 Project 继续保留 Electricity + Water，不做全局删除。
- 自动化：Cache/API/UI 聚焦 Suite `7 files / 89 tests` passed；Water/dashboard Worker Suite `47/47` passed；`npm run typecheck`、`npm run build`、`npm run build:web` 均 passed。
- 当前 Chrome：Ngee Ann 旧 Water 链接规范化到 rolling 28d Electricity，热导航到 Ready 约 `2668ms`；Preschool 旧 Water 链接规范化到 May Electricity，热导航约 `2754ms` 且 Complete data 已显示。两页 Water、全局 Period、Analysis Scope 均为 0。
- 本次 Header/Water 修改后的真实 Chrome 重新验收：Ngee Ann 在 `1440×900` 的 `innerWidth / document scrollWidth = 1440 / 1430`、`1920×1080 = 1920 / 1910`；Preschool 分别为 `1440 / 1440`、`1920 / 1920`。四档均只有一个 Electricity 控件，Water、Last Week 与 Analysis Scope 均为 0，无 page-level 横向溢出。新证据：
  - `.scratch/overview-acceptance/issue-28-ngee-ann-water-header-1440x900.jpg`
  - `.scratch/overview-acceptance/issue-28-ngee-ann-water-header-1920x1080.jpg`
  - `.scratch/overview-acceptance/issue-28-preschool-water-header-1440x900.jpg`
  - `.scratch/overview-acceptance/issue-28-preschool-water-header-1920x1080.jpg`
- 同一浏览器文档内真实 SPA 返回验收：两项目分别从 Overview 进入 Saved analyses 再返回同一 Snapshot。只读 Metadata `runs` 计数保持 Ngee Ann `66 → 66`、Preschool `26 → 26`，证明没有第二个页面 AI Run。这个承诺明确不覆盖硬刷新、新标签或 Web 重启；覆盖这些场景将需要 AI result persistence/replay，与 #28 的 No AI cache/Artifact 非目标冲突。

### Kimi K3 Provider 验收与停止结论

- 已在默认与 Preschool Workspace 创建 `openai-compatible / kimi-k3` Profile，官方 Base URL 为 `https://api.moonshot.cn/v1`；密钥仅进入服务端 secret store，本文、Issue 与代码均不保存密钥。Preschool连通性 probe 为 `connected`，约 `5024ms`。
- K3 固定采样兼容：连通性 probe 不再强制 `temperature: 0`；Kimi 的结构化 helper 使用固定 `temperature: 1`，并把 `reasoning_effort` 限制为 `low`。StepFun、DeepSeek、Alibaba 行为保持不变；相关 focused tests `33/33` passed，全仓 typecheck/build passed。
- 真实 Preschool 同 Snapshot 依次暴露三个层次的兼容问题：
  - 未归一化固定温度时，正式 Run 立即返回 `invalid temperature: only 1 is allowed for this model`；
  - helper 未继承 low reasoning 时，`162s` 仍停在 Inspecting；修正后不再出现该高思考卡住；
  - 低思考 Run 依次在 `table_names`（约 `63s`）、`claims[].values`（约 `47s`）和通用 `skillNames`（约 `45s`）被 Moonshot flavored JSON Schema 拒绝，均为 optional array 在服务端转换后发生 parent `items` 与 `anyOf` branch `items` 冲突。
- 当同类错误从 Energy 工具扩散到治理工具和通用 Skill 工具时，已触发停止条件：继续需要建设统一的 Moonshot tool-schema normalizer 或改整套 Agent 工具 Schema，超出 Overview MVP。两轮局部 nullable Schema 试修已完整撤回，不把未完成的兼容层留在代码中。
- Kimi Profile 保留为已连接候选，但不设为 Workspace 默认。Preschool 已恢复 `Workspace default · EnergyIQ StepFun 3.7 Flash Primary`（binding revision `3`）；默认 Workspace 从未切离 StepFun。Kimi 本轮 `0` 个可验证 Finding，不能宣称 AI Slot Provider gate 通过。
- 后续若重新评估 Kimi，应单独建立 Provider compatibility Ticket，先用全工具 Schema fixture 做一次静态兼容审计，再决定是否实现统一 normalizer；不得继续在 Overview Ticket 内逐字段追补，也不得放松 Evidence guard。

### DeepSeek V4 Flash 固定 Profile 复测与协议分层校准

- 本轮经用户授权，为 Preschool Workspace 配置并连通 `DeepSeek V4 Flash`；连通性 probe 约 `1305ms`。当前 Preschool Workspace 默认绑定已改为 DeepSeek（binding revision `4`），固定 Profile 验收期间 fallback 保持关闭，未建立 `DeepSeek → StepFun → Kimi` 自动链。
- 同一 Preschool Snapshot、cutoff、Pack、Profile revision 连续三次真实 Run 均通过 Tool Schema 注册，均完成 `inspect_schema` 与一条只读 SQL；因此 DeepSeek 本轮失败不属于 Tool Schema/线协议失败。
- 结果为 `1/3` accepted non-empty、`2/3` Finding-specific numeric Evidence fail closed，未达到 `>=2/3` 可交付门槛。通过的一次同时识别到 SQL 聚合与发布 Calendar 的 operating/standby 口径不一致；失败守卫未放宽。
- 独立代码复核确认口径分裂：Preschool cumulative Fact Writer 写入 `NULL AS is_operating`，AI scoped datasource 原样透传；确定性 Overview 则使用 Release-pinned Calendar 动态计算 operating/standby。最小 MVP 先停止把 scoped `is_operating` 描述为 Calendar 权威字段，Published operating/standby 数值只使用同 Snapshot deterministic Evidence；若未来需要 Agent 自主按 operating state SQL，再复用同一 Calendar window resolver 建 run-scoped overlay，不回写事实、不把 NULL 当 standby。
- Provider 兼容性独立研究已沉淀为 `docs/energyiq/2026-08-06-AI-Tool-Schema-Provider兼容性独立研究.md`。后续把 `provider_schema_rejected`、`tool_arguments_invalid`、`tool_execution_failed` 与 `result_evidence_rejected` 分开记录；只有通过当前 Tool Bundle 预检的 Profile 才能进入 fallback。

明确停止：不做浏览器全局 Analysis Provider、跨用户/跨 Workspace cache、分布式 cache、并行多 DuckDB connection、历史 Snapshot 回放、通用 Scheduler/Cadence DSL、单位语义验证平台；不删除 Snapshot fail-closed，也不为了 Provider 接受率放松 Evidence。

## 7. 范围外停车场（明天讨论）

- Kimi 已证明当前阻塞是系统性 Tool JSON Schema 兼容，而不是单纯模型强弱；不再在 #18 内继续换模型或微调 Pack。下一 Provider 前沿先校准 #14 为 provider-neutral、固定 Profile revision、无 silent fallback 的可信问数/工具合同验收。
- #28 的 bounded Resolver cache、in-flight、Resource capability、当前 1440/1920 Chrome 与同文档 SPA AI 去重证据均已形成。Owner 仍需消除其与 #19 的 `T18` 编号冲突，并移除把 #13 Charles 人工门当作整票技术 blocker 的错误依赖。
- Spike/SOP 分数标签进一步弱化为 Charles/provisional score；当前已有 `Provisional SOP signal`，不阻塞页面价值。
- 是否把 28d 平均 Heatmap 下沉成新的服务端确定性 contract；当前已复用 Day Profile 的权威 mean。
- AI Finding 的共享、版本化 Insight Artifact 是否有真实多用户复用需求。
- 半年/一年数据积累后，Overview 内新增的长期结构模块与基线定义。
- Preschool Portfolio/Centre 中哪些指标在两个真实项目验证后才值得提取为共享 Kernel。
- Benchmark 缺少任一 centre metadata 时，目前 project-specific 投影 fail closed；是否细化成模块级 Unavailable，等真实缺失场景出现后再决定。
- Admin 原生确认框与受控 date/time input 的 Chrome 自动化兼容性；不阻塞客户 Overview，也不为此建设第二套 Admin 提交机制。
- Preschool warm median 已由约 `8.7s` 降至约 `5.3s`；cold/warm/cache-return 仍需分开记录。后续 cache 只解决重复进入，不冒充首次计算优化。
- 通用 Scheduler/Cadence DSL、历史 Snapshot 回放、第二套 Query Receipt/Version 仓库：明确停止。

## 8. 完成标准

- [x] 本文可作为压缩后的恢复入口，记录顺序、状态、证据、阻塞和停车场。
- [x] Ngee Ann #9 客户可见修复、测试、构建与 1440/1920 Chrome 证据齐全。
- [x] #14/#16 形成可验证的 Finding → AI Analyst 最小链路结论或修复。
- [x] Preschool 形成真实数据到独立 Renderer、Benchmark 和 Operating Calendar 的垂直可见切片。
- [x] #12B Spike/SOP 代码、数值 Golden、全量测试/构建与 1440/1920 Chrome 证据完成。
- [x] #13 自动化最终组装完成；Charles 人工终验保留为外部验收门。
- [x] #18 代码、严格 Evidence guard、三次固定 Profile 真实验收与 1440/1920 fail-soft 页面证据完成；Provider 接受率未通过并明确保留。
- [x] Preschool 确定性 warm median 约改善 39%，未删除 Snapshot fail-closed，也未改变 Golden。
- [x] #28 有界 Resolver Cache、in-flight、Refresh bypass、授权回归、Water capability 与 Chrome 验收完成；Issue 因 `Blocked by #13` 和 Charles 人工门保持 open。
- [x] Kimi K3 Profile 与固定温度/low-reasoning seam 已验证；真实 Agent Run 因系统性 Moonshot tool-schema 不兼容未通过，已恢复 StepFun 默认并停止逐字段追补。
- [x] 缓存/Water/Spike 旁路意见已独立复核并落成最小切片与明确停止项。
- [x] Durable tracker 已更新：#18 Provider 证据、#13 性能边界与独立后续 #28；当前账号无权把 #18 workflow label 从 `ready-for-agent` 改为 `needs-info`，也无权给 #28 添加 `ready-for-agent`，以 Issue body/comment 记录真实状态。
- [x] 所有范围外问题仅登记，没有扩建通用平台。
- [x] 文档未写入任何密钥、Cookie 或 token。

## 9. 2026-08-07 夜间双线执行合同

### 9.1 唯一北极星与 Owner

今晚只证明两件客户可见的事：同一套 Overview 能随真实新增数据稳定更新；AI Analyst 能在不篡改确定性权威层的前提下提供可验证的补充分析。

| 线路 | Owner | 负责范围 | 不负责范围 |
| --- | --- | --- | --- |
| 主线 | 主 Agent | #9 两批真实数据连续演示、Ngee Ann/Preschool 确定性 Overview、Saved A/current B、Chrome/Evidence、#28 跟踪收口 | Provider、Prompt、Tool Schema、AI Finding 生成质量 |
| AI 线 | 侧边任务 Agent | #14 → #18 → #16 的可信工具链、Provider 固定验收、AI Finding 与 Ask AI deeper/Session continuation | Renderer/ViewModel、Excel materialization、Mapping、Snapshot A/B、确定性 KPI/Evidence |

同一文件族只能由一条线路修改。侧边 Agent 不直接修改 Integration 工作树、不重启或写入主线共享数据库；交付必须是隔离 Worktree/Branch、精确 commit、改动清单、测试和真实 Run 证据，由主 Agent审核后集成。

### 9.2 主 Agent 夜间顺序

| 顺序 | Ticket / 切片 | 今晚状态 | 验收边界 |
| --- | --- | --- | --- |
| M1 | #28 跟踪校准 | DONE | 已改名为唯一的 `T17A`、移除失效依赖、补充最终证据并关闭；没有继续扩写缓存。 |
| M2 | #9 A/B 数据预检 | DONE | 四份权威 Excel 已用生产解析器核对覆盖、SHA、映射与重叠去重语义；A/B Golden oracle 已固定，当前客户 Published Snapshot 未改动。 |
| M3 | #9 Snapshot A | DONE | 隔离 fixture 只导入第一批 Level 6/7 Excel，沿正式 Register → Mapping → materialization → Published Overview 路径生成 A；保存分析后冻结其 Snapshot、序列化 Analysis、Evidence 与 Release provenance。 |
| M4 | #9 Snapshot B | DONE | 在同一隔离 Workspace/Project/Release/Mapping/Renderer 追加第二批 Level 6/7 Excel；重叠读数幂等去重，不双算；生成新的 Current B Snapshot。 |
| M5 | #9 最小连续状态 | DONE（确定性边界） | Current B 的 28d 值更新为 `4,904.8659 kWh`，前一 28d 与 Saved A 的 `4,831.5555 kWh` 一致；Saved A 仍指向自己的 Snapshot/Evidence。AI Finding lifecycle 仍由侧边 AI 线负责，主线没有建设历史 Snapshot/Insight 平台。 |
| M6 | #9 自动化与 Chrome | DONE（工程证据） | 新增真实四 Excel 的 A→B 验收测试；隔离 Chrome 回读 Current B 与 Saved A，验证 Snapshot/Evidence 不混用、同一 Release/Recipe/Renderer、确定性首屏及 1440/1920 无横向溢出。隔离 dev-auth 首次壳层 hydration warning 已登记，不冒充正式 password-mode Console 结论。 |
| M7 | #13 非 AI 回归 | DONE（工程证据） | 5 个 Preschool 确定性测试文件 `65/65` 通过；共享 password-mode Chrome 回读 May Portfolio、Benchmark、Operating/Spike 与 Leading Circuit-as-Appliance alias，1440/1920 无横向溢出且本次 error log 为空。Charles 人工门保持 open。 |

主线停止条件：A/B Golden 无法稳定复现；重叠导入会改写现有 Published 数据；必须新增通用版本库/历史回放/Scheduler/第二套 Evidence；需要修改侧边 Agent 正在占用的 AI 文件。触发后只记录证据并停止该切片，不用临时架构掩盖。

### 9.3 侧边 AI Agent 夜间顺序

| 顺序 | Ticket / 切片 | 验收边界 |
| --- | --- | --- |
| A1 | #14 Provider-neutral Tool Bundle 预检 | 用小型 canonical Schema、一次无害强制工具调用、本地参数校验和 result replay，把失败明确分成 `provider_schema_rejected`、`tool_arguments_invalid`、`tool_execution_failed`、`result_evidence_rejected`；固定 Profile revision，单次 Run 内禁止 silent fallback。 |
| A2 | #18 Preschool 固定 Profile 验收 | DeepSeek V4 Flash、thinking disabled、fallback off、同一 Snapshot/Pack/Profile 连跑 3 次；记录 Run/Session、工具次数、延迟、token 和 accepted/fail-closed 原因。目标至少 2/3 产生非空、有用、Finding-specific Evidence；不放松数字/Evidence 守卫。 |
| A3 | #16 Ask AI deeper 最小连续性 | 从页面带入 Project/Scope/Window/Snapshot/Finding/Evidence；服务端重新授权并在 Snapshot 漂移时标记 outdated；允许用户编辑后提交，禁止自动提交。只复用现有 Session/AG-UI，不建设通用分支/Artifact/Cadence 平台。 |
| A4 | 交付主 Agent 审核 | 提供隔离 branch/worktree、精确 commits、改动文件、定向测试、真实 Provider 证据和未解决风险；不自行合并 Integration，不自行关闭 #9/#13。 |

侧边线停止条件：需要弱化授权/只读 SQL/Snapshot/Evidence；需要通用 Provider Router 或全工具 Schema 平台；连续失败的根因已经属于模型质量而不是合同缺陷；与主线 Renderer、materialization、A/B 文件发生冲突。

### 9.4 文件与环境所有权

- 主线优先占用：Ngee Ann/Preschool Renderer、ViewModel、确定性 Resolver/Projection、Import/Mapping/Snapshot A/B 测试与验收脚本。
- AI 线优先占用：Provider adapter、Tool Bundle/Schema、AI Run/validator、AG-UI Session continuation；若必须触碰 Renderer，只提交接口需求，不直接改主线文件。
- Integration 是主 Agent 唯一审核/合并环境；两条线各用 `codex/` 分支和隔离 Worktree。不得 `reset --hard`、`clean`、`stash`、批量格式化或吸收无关脏改动。
- 本地服务/端口/数据库由主 Agent统一调度；侧边 Agent 的真实 Run 使用隔离配置，密钥不得进入文档、Issue、日志或 commit。

### 9.5 早晨交付格式

主 Agent 与侧边 Agent 都必须按以下格式交付：`完成结果 → commit/文件 → 自动化证据 → 真实运行/Chrome 证据 → 未完成项 → 是否触发停止条件`。用户睡眠期间不宣称 Charles 人工验收，也不因无人在线而扩大 scope。

### 9.6 夜间 Goal 与监督规则

- 已创建活动 Goal：在不修改 AI Analyst Provider、Prompt、Tool、Session 与结果恢复实现的前提下，完成 #9 的 Ngee Ann 两批真实数据 A→B 连续验收，并在通过后回归 Preschool 非 AI Overview。
- Goal 完成必须同时满足：Runlog 与 GitHub Ticket 保持同步；Saved A 固定、Current B 更新且 A/B Snapshot/Evidence 不混用；只处理明确阻塞 #9 的最小确定性缺口；Preschool 确定性回归有测试或 Chrome 证据；早晨交接明确区分自动化、真实运行与人工验收。
- 每完成一个切片即更新本表；发现新问题时，范围内且直接阻塞当前交付才修复，范围外写入停车场。不得以“顺便完善”为由建设历史 Snapshot、通用 Cache、Scheduler、Provider Router、Insight Artifact 或第二套 Evidence 平台。
- Goal 只在上述工程目标全部完成且没有 required work 时标记完成；若同一停止条件连续出现并达到 Goal 的 blocked 规则，才标记 blocked。等待用户/Charles 人工验收本身不冒充工程完成，也不冒充阻塞。

### 9.7 主线夜间完成证据

#### A→B 自动化与保留 fixture

- 新增验收测试：`apps/api/src/energy/ngee-ann-two-snapshot-acceptance.test.ts`。它直接读取四份真实 Level 6/7 Excel，调用生产 Register、Mapping、materialization、Published Overview 与 Saved Analysis 路径，不复制计算公式，也不直接修改 Metadata/DuckDB。
- Integration commits：`e2a0287`（A→B 连续性）、`9c674b0`（可保留隔离 fixture）、`445b666`（A/B 固定 Calendar/Tariff）。聚焦 worker branch 为 `codex/t09-two-snapshot-demo`。
- 最终保留 fixture：`.scratch/overview-acceptance/ngee-ann-two-snapshot-20260807-0240`。正式验收 `1/1` 通过，总耗时约 `234.18s`：A materialization `64.716s`、A resolve `2.713s`、B materialization `156.892s`、B resolve `3.983s`、B 后回读 Saved A `0.010s`。
- Snapshot A：`energy-snapshot-50a0a3e83467ca65b07bca63`，28d `4,831.5555 kWh`，latest complete day `2026-05-19`。Snapshot B：`energy-snapshot-03499dcda183ae28c47f7d66`，28d `4,904.8659 kWh`，latest complete day `2026-06-16`。
- B 的 previous 28d 精确等于 A current 28d；B rolling 7d 为 `1,531.168324 kWh`，前 7d 为 `1,211.677268 kWh`，约 `+26.4%`。A/B 使用同一 Template Release、Renderer、Recipe、Hierarchy、Mapping、Calendar `sg-calendar-v1`、Tariff `sg-tariff-v1` 与 timezone。
- 第二批重叠导入检出 `3,455` 个重复键与 `16` 个冲突键，生产 materialization 去重后 B facts 为 `100,205`；没有 double-count、gap、negative delta 或 orphan。
- Saved A `saved-analysis-0e09b34e-5cf8-4af0-8e4e-16d87dc7aded` 在 B 发布后仍保留 A 的 Snapshot、序列化结果、序列、query、Evidence IDs 与 Template revision；Current B 使用自己的 Snapshot/Evidence。没有创建通用历史回放或第二套 Evidence。

#### 隔离 Chrome 与环境边界

- 隔离 API/Web 使用 `8788/3001` 和上述保留 fixture；共享 `8787/3000` 未停止、未改写。早晨可直接检查 Current B 与 Saved A。
- Current B：`http://127.0.0.1:3001/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity`。Saved A：`http://127.0.0.1:3001/energyiq/saved/saved-analysis-0e09b34e-5cf8-4af0-8e4e-16d87dc7aded`。
- Current B 在 CSS 1440/1920 下分别为 `innerWidth/document scrollWidth = 1440/1427`、`1920/1907`；Saved A 分别为 `1440/1440`、`1920/1920`，均无 page-level 横向溢出。
- 可读首屏证据：`.scratch/overview-acceptance/ngee-ann-two-snapshot-20260807-0240/current-b-top.png` 与 `saved-a-top.png`。精确 1440/1920 是 DOM 测量证据；CDP 全页截图超时，因此不把文件名带 `1440/1920` 的中间截图冒充精确尺寸证据。
- 隔离 dev-auth 首次打开会出现一次壳层 hydration mismatch；它发生在 `DevSignedOutScreen` 与已登录 shell 交接，不影响 A/B 数据、Renderer 或 Evidence。该问题不在 #9 内修；正式 shared password-mode 的既有 Chrome 证据仍需与此隔离 harness 限制分开陈述。

#### Preschool 非 AI 回归

- 聚焦测试：`preschool-appliance-projection`、`preschool-benchmark-projection`、`preschool-operational-projection`、`preschool-overview-view-model`、`published-decision-dashboard` 共 `5 files / 65 tests` 通过。测试 stderr 中两个未 mock 的 AI result resume `401` 已登记给 AI 线，测试本身通过，主线没有修改 Session/Result resume。
- 共享 password-mode Chrome 回读 `preschool-demo`：May Portfolio `24,921.81 kWh`、30 Centres、Standby `3,103.78 kWh / 12.5%`、Benchmark `G/M/J`、Operating/Spike 与 9 个 customer Appliance alias 均可见。
- CSS 1440/1920 的 `innerWidth/document/body scrollWidth` 分别为 `1440/1440/1440` 与 `1920/1920/1920`；本次 browser error log 为空。首屏证据：`.scratch/overview-acceptance/preschool-night-top-20260807.jpg`。

### 9.8 早晨交接与未完成边界

- 主线工程 Goal 已满足：A→B、Saved A/Current B、Snapshot/Evidence、Preschool 非 AI 回归、Runlog 与 Ticket 证据均已形成；没有触发停止条件，也没有修改 AI Analyst Provider、Prompt、Tool、Session 或 Result resume。
- 侧边 AI 线的 A1–A4 仍由侧边任务 Agent 独立交付；在收到 branch/commit/真实 Run 证据前，主 Agent 不声明 AI 质量、连续追问或恢复问题完成。
- #9 与 #13 不关闭：Charles 人工价值/可读性验收、侧边 AI 结果以及两批数据的现场演示仍是明早人工检查项。工程通过、真实 Chrome 与人工验收保持三个独立证据层级。
- 早晨优先顺序：先在隔离 `3001` 对照 Saved A/Current B；再看共享 `3000` Preschool；最后审核侧边 AI Agent 交付。若客户信息价值仍不足，只切下一张可见模块，不回到通用底座扩建。

## 10. 2026-08-07 AI Analyst 合并、统一模型与 Golden 验收

### 10.1 模型配置产品决策

- EnergyIQ 只维护一个 Admin 管理的系统默认模型与密钥；所有 Workspace 和 Project 统一继承，不提供按 Workspace 绑定或覆盖模型的产品行为。
- Workspace 仍是数据授权、Project、会话和历史结果的隔离边界，不再是模型选择边界。普通用户不能看到或读取系统密钥。
- 代码内部保留 `workspace-default` 作为兼容 ID，避免不必要的数据库迁移；用户界面统一显示 `EnergyIQ system default` / `System default`，它不再表达“每个 Workspace 有一个默认模型”。
- 当前系统默认已指向 Admin 加密保存的 `deepseek-v4-flash` Profile，`reasoningEnabled=false`，单次 Run 禁止静默 fallback。以后更换同一 Provider 密钥只更新一次系统 Secret；更换 Provider/Model 也只切换一次系统 Profile，不逐个修改 Workspace。

相关 Integration commits：`51bf075`、`83f8292`、`e34254a`、`e5da432`。

### 10.2 Ngee Ann 真实 Provider Golden

- 权威问题：2026-06-03 至 2026-06-09（Asia/Singapore）Ngee Ann Project official electricity consumption。
- Golden：`1,211.6773 kWh`，展示精度 `1,211.68 kWh`；`2,688` 条有效 interval facts；7 个完整日；quality events 为 0。
- 修正旧交接中的 `477.05 kWh`：该值是 Level 6 的 Light + Load 小计，不是 Project total，不能继续作为本问题 Golden。
- Scope 合同已明确：AI relation 已按当前 Project/Scope/Period 绑定；Project total 不得再加 `scope_id='project'`，而应沿 official aggregation route 聚合已发布 hierarchy nodes。

同一代码、Snapshot、Profile 下三轮真实 DeepSeek Run 均为 `completed`，且工具顺序一致为 `inspect_schema → run_sql_readonly → analysis_requirements_commit`：

| Run | 结果 | 工具数 | 客户答案 |
| --- | --- | ---: | --- |
| `f23068d3-19f4-42be-bd3f-6f2eaf76d804` | `1,211.6773 kWh / 2,688` | 3 | 已持久化并可恢复 |
| `784fd8ce-3c42-4954-9b4c-f04646df7af5` | `1,211.6773 kWh / 2,688` | 3 | 已持久化并可恢复 |
| `7762b7c5-803d-437e-b7b3-4ffecfbae2f0` | `1,211.6773 kWh / 2,688` | 3 | 已持久化；显示缺口修复后可恢复 |

### 10.3 最终答案显示缺口与最小修复

- 第三轮 Provider 实际生成并持久化了 `1,209` 字符的完整客户答案，但模型在最后工具之后先产生一条 reasoning transition。Web 的 thought resolver 错误地用该 transition 替换了后续独立 assistant 正文，导致 Chrome 只看到 Thinking。
- 最小修复：assistant 自己有独立正文时优先正文；只有正文为空或与 reasoning 重复时才折叠 reasoning。没有修改 Provider、SQL、Evidence、Session、缓存或 AG-UI 协议。
- Commit：`6b214da fix(web): preserve final answer after reasoning`。
- 自动化：`assistant-thought-content`、`step-assistant-state`、`conversation-restore` 共 `3 files / 100 tests` 通过；Web production build 通过并生成 17 个页面。
- 正式重启：API `8787` 与 Web `3000` 来自 Integration；`/healthz`、`/ready`、Overview 均为 HTTP 200。
- 真实 Chrome：重新打开第三轮既有会话，没有再次调用模型；页面显示完整 `Answer`、`1,211.68 kWh`、period/scope/unit/caveats 与 Evidence 验证说明。

### 10.4 未完成与停止项

- 三轮正确不等于信息价值与语言质量已获 Charles 验收；用户已明确把“人类真正需要的信息及展现形式”留到后续专项讨论，本轮不擅自扩大。
- Chrome Workspace 切换证明 Session/数据仍隔离：Ngee Ann → Preschool 只显示 Preschool 会话并恢复 8 个 Active Aging Centers 等既有答案；切回 Ngee Ann 后只恢复 Ngee 会话及 `1,211.68 kWh` Answer，且没有新增 Provider Run。模型选择不随 Workspace 改变。
- #16 仍有一个明确剩余项：切回 Ngee Ann 时页面顶部当前 Context 会重置为 Project 默认 `Last 30 days / Data through 2026-08-06`，而历史 Answer 仍属于 `2026-06-03..09`。当前未发生跨 Project 数据混用，但 UI 必须恢复原 Context 或把旧 Answer 标记为 Outdated；该项不并入 #14，也不以本轮临时架构掩盖。
- 三轮各约 `62k–65k` input tokens，说明当前 Context/Schema 每轮重复输入仍偏重；记录为后续性能/成本切片，不阻塞本次可信闭环，也不在本轮建设通用 Context 缓存平台。
- 不新增 Workspace 模型配置、通用 Provider Router、自动 fallback 链、历史 Snapshot 回放、Scheduler/Cadence DSL 或第二套 Evidence 平台。

## 11. 2026-08-07 Overview 与 Project Explorer 体验收口行动方案

### 11.1 北极星与用户阅读顺序

本轮唯一目标不是增加报表数量，而是让 Boss/FM 不需要寻找，就能按以下顺序取得价值：

1. **结果是什么**：先给一句可理解的 takeaway 和一个关键数字；
2. **为什么重要**：用最合适的一张图说明变化、贡献或影响；
3. **要做什么**：给出下一步、做与不做的预期差异和验证指标；
4. **如何证明**：Evidence 可展开，但技术版本、公式、SQL、Mapping 和 Import Batch 不占主阅读路径。

图表是解释信息的形式，不是交付目标。每张图必须回答一个明确问题；不能回答用户问题的图不进入 MVP。

### 11.2 Overview 信息架构与视觉边界

- 页面先展示 0–3 个真正值得处理的主题；每个主题默认只保留：一句结论、关键数字、一个主要贡献者、一张解释图、下一步与验证指标。
- `Why`、做与不做的后果、限制和详细 Evidence 分成清楚的小段，并按重要性渐进展开；不再把完整技术报告塞在一张卡里。
- 桌面端使用可见的章节目录，支持 `Priorities / What changed / Where / When / Evidence` 跳转；复用现有 generated section navigation，避免第二套竞争导航。窄屏退化为顶部横向/折叠菜单。
- 正文和辅助文字提高到可读字号，减少 `10px/11px` 技术说明；标题、结论、证据和辅助信息形成稳定层级。
- 颜色只表达状态：严重异常、待调查、已验证/正常、缺失/不可用；不为了“好看”把所有图染色。
- 技术细节默认折叠；用户应能在不理解 Snapshot、Recipe、SQL 或 Mapping 的情况下完成阅读和决策。

### 11.3 图表任务与决策问题

| 项目 | 图表/改造 | 必须回答的问题 | 边界 |
| --- | --- | --- | --- |
| Ngee Ann | 1d/7d/28d current-vs-previous 差异条 | 变化发生在哪个时间尺度，值得立即关注还是结构性问题？ | 使用同一 Snapshot 的现有确定性结果 |
| Ngee Ann | 带 baseline、异常点和关键日期的日趋势 | 变化从哪一天开始，是否重复出现？ | 不把高于均值自动称为异常 |
| Ngee Ann | Level/Category 变化条或 dumbbell | 哪个 Level/Category 对变化贡献最大？ | 取代长表的主视图，完整表保留在 Evidence |
| Ngee Ann | New / Recurring / Resolved 状态条 | 新数据进来后，问题是新出现、持续还是已缓解？ | 只使用 A→B 可证明的状态，不建设通用历史平台 |
| Preschool | Appliance 与 Centre Top 5 | 能耗主要集中在哪里，先检查谁？ | 全量排名可展开，不重复堆图 |
| Preschool | Operating/closed profile 或 Centre×Hour 视图 | 哪些时段、哪些 Centre 反复出现非营业用能或 Spike？ | 必须来自服务端 Projection；数据不足时退化为受影响 Centre 条形图 |
| Preschool | Empirical distribution / Bell-curve-style view | 某 Centre 位于同类分布什么位置，偏离有多明显？ | 优先真实经验分布；不强行假设正态，不在浏览器计算 percentile |
| Preschool | June naive baseline | 如果五月模式不变，六月大约处于什么范围？ | 使用历史完整周平均/日型，明确 `Demo estimate`、假设、区间和不可作为正式 Forecast |
| Preschool | Provisional cost | 当前能耗按公开参考电价大约对应多少费用？ | 采用 2026 Q2 SP 低压非住宅参考价，标记非客户合同 Tariff/非账单 |

Preschool May Demo 的公开参考价固定为 SP Group 2026-04-01 至 2026-06-30 低压非住宅 tariff：`27.27 cents/kWh before GST`（含 9% GST 为 `29.72 cents/kWh`）。页面默认使用税前参考价，并显示来源、期间和 `Provisional estimate`；它不能写入正式客户 Tariff 配置，也不能用于 Ngee Ann。

### 11.4 Project Explorer 最小产品结构

Project Explorer 只回答“这是哪个设备/Scope、在选定时间用了多少、曲线怎样、数据是否可信、来源在哪里”。

- Overview → Explorer 精准携带 Project、Scope、Resource、Period、data cutoff 与 Snapshot/Release 语境；服务端重新授权。
- 直接进入时显示最新可用完整数据窗口；所选窗口无事实时显示明确 empty state 和 `View latest available`，不得把无数据渲染成真实 `0 kWh / 0%`。
- 主区展示设备/层级信息、最新 accepted reading、energy、interval-average power、coverage，以及一张日/周/月或传入窗口的服务端趋势。
- Formula、Mapping、Import Batch、Source ID 和完整质量事件放入可展开 Evidence；默认只用普通语言说明数据来源与健康状态。
- 不加入同级 Benchmark、AI 总结、成本或节能建议，不复制 Overview。

对应执行 Ticket：[#31](https://github.com/Zion74/energyiq-datafoundry/issues/31)。

### 11.5 执行顺序与所有权

| 顺序 | 所有者 | Ticket/切片 | 完成条件 |
| --- | --- | --- | --- |
| V1 | 主 Agent + Overview 子 Agent | #9/#13 阅读体验与目录 | takeaway-first、段落层级、可读字号、技术细节折叠、1440/1920 |
| V2 | 主 Agent + Explorer 子 Agent | #31 Explorer 上下文与趋势 | 精准下钻、诚实 empty state、日/周/月事实趋势、无内部裁切 |
| V3 | 主 Agent + Preschool 子 Agent | #13 Demo visuals | Top 5、运营时段、经验分布、naive June baseline、Provisional tariff 均有明确语义与假设 |
| V4 | 主 Agent | #5 校准与关闭复核 | Area/Headcount/Provisional 的当前与 Saved Analysis 闭环有自动化和 Chrome 证据 |
| V5 | 主 Agent | #19 → #20 → #21 | Release/rollback → Saved/Rerun/export → 两项目试点验收 |

AI Analyst 的 #30/#18/#15 继续由侧边任务 Agent 执行；不得修改本轮确定性 Renderer、Explorer 或官方指标。

### 11.6 验收问题

每个项目的首屏必须让一个不了解技术的用户在约 60 秒内回答：

1. 最值得注意的事情是什么？
2. 影响多大？
3. 哪个 Scope/Centre/Circuit/Appliance 贡献最大？
4. 这是今天、短期还是结构性问题？
5. 下一步做什么？
6. 做了以后看哪个指标，多久复核？
7. 如果需要核查，能否一键到准确 Explorer Evidence？

自动测试、Chrome 证据和 Charles/用户人工价值验收继续分开记录。

### 11.7 明确停止项

- 不建设通用 Dashboard/Chart DSL，不用新增图表数量衡量进度。
- 不在 React 重算官方 KPI、percentile、Tariff、Forecast 或 Evidence。
- 不把公开电价估算冒充客户合同 Tariff，不把 naive baseline 冒充正式 Forecast。
- 不恢复控制整页的全局 Period/Scope 选择器；Explorer 的日/周/月只影响局部设备事实查看。
- 不因视觉改造修改 Snapshot、权限、AI Tool、Provider、Session 或第二套数据平台。

### 11.8 2026-08-07 执行与复核结果

| 切片 | 状态 | 已形成的可验证结果 |
| --- | --- | --- |
| V1：#9/#13 阅读体验 | DONE（工程验收） | Ngee Ann 与 Preschool 均采用 takeaway-first 阅读顺序；桌面左侧目录、窄屏顶部目录、较大字号、分段决策卡和折叠 Evidence 已落地。Ngee Ann 首要主题已使用同一零轴展示 1d/7d/28d 与各自治理基线的差异；数值直接来自服务端 Snapshot，条长只做卡内相对缩放并明确说明。A→B `New / Newly supported / Recurring / Resolved / No longer supported` 已由服务端在兼容 Saved A 与 Current B 之间计算；React 只展示结果，不推断生命周期。日趋势进一步叠加同一 Snapshot/Release/Scope/date 的治理基线和需复核日期，accepted usage 始终保持权威主图。 |
| V2：#31 Explorer | DONE（工程验收） | Overview 已从 Ngee Ann 结论准确跳到主要贡献 Scope，并从 Preschool Top 5 准确跳到 Centre；Project/Scope/Resource/Period/Snapshot/Release 全部保留。Explorer 已提供服务端 Daily / Week / Month、24h profile、子 Scope 健康摘要和叶子 Meter/Circuit 最新 accepted cumulative reading；技术 provenance 默认折叠。Week/Month 复用同一 `daily_totals_v1` 在 API 聚合，没有新增 DuckDB 查询，边界周/月明确按 partial calendar period 处理。旧 Snapshot/Release 链接 fail closed，并要求用户显式切换到 Current。 |
| V3：#13 Preschool visuals | DONE（工程验收） | 已加入经验分布、24h operating/closed 结构、Centre Top 5、四个完整周均值形成的 June demo baseline，以及使用 SP 2026 Q2 低压非住宅公开参考价的 provisional cost。修复了把 standby/off-hours 用量误当作五月总用量的成本语义错误。 |
| V4：#5 校准 | DONE | 同一 Chrome 完成 Preschool Current → Save → Saved 回读：Current 与 Saved 均固定 Snapshot `energy-snapshot-52ca9611e48b0d71c2efe7b7`；Saved `saved-analysis-39829006-b056-476b-baa6-4dde4b05dd5d` 保留根 Scope Missing、30 个比较 Scope 与 Provisional Area/Headcount/EUI/Per-pax，不读取 Current 元数据重算。#5 已关闭。 |
| V5：#19 → #20 → #21 | #20 DONE（工程验收）；#21 NEXT | #19 已作为 Post-MVP `wontfix` 关闭；MVP 不建设完整事实 A/B 即时切换。#20 已完成确定性 Saved Snapshot、项目专属 Renderer 恢复、latest-data Rerun、浏览器打印，以及已完成 AI Artifact 的冻结/恢复；下一阶段进入 #21 两项目人工试点验收。 |

自动化证据：Web 相关 `6 files / 117 tests` 通过；API/Data Gateway/可信执行定向回归 `30/30` 通过，Calendar/reading 生产路径定向回归 `1/1` 通过；仓库 typecheck、API build 与 Web production build 通过（17 pages）。完整 `energy-analysis.test.ts` 为 `17/19`：最新 accepted cumulative reading 和两项目核心事实均通过；两条既有 anomaly baseline 用例仍因样本数期望（3 vs 4）不一致失败，本轮没有修改 anomaly 代码，作为独立测试债记录，不扩大 #31。真实 Chrome：Ngee Ann 与 Preschool 的精准下钻、叶子累计读数、子 Scope 健康、Daily/Week/Month URL 恢复和 stale Release fail-closed 已完成回读。

新增收口证据：`cda2a15` 将 `/analysis/execute` 固定到已发布 Project 上下文，旧 Overview/Explorer 的 Release 或 Snapshot 漂移会在 DuckDB 前以 409 fail closed；`82f0d8c` 保留 Saved/Explorer 的冻结 Evidence 边界；`4adc03e` 将两项目可见结论链接到准确 Scope；`c18cfa0` 增加子 Scope 健康摘要；`6442617` 增加 Snapshot-guarded 叶子累计读数合同；`29ba4f2` 与 `2ce9a5d` 让局部图表视图写入 URL 并在刷新后恢复；`c7cf0f7` 增加服务端权威自然周/自然月趋势，同样不触发 Overview 或 AI 重算。Chrome 已证实 Ngee Ann `Level 7 → Total Office Light` 显示 `1,667.38 kWh` 与原 Excel 来源，并显示 5 个自然周点；Preschool `Centre E → Plug Load3` 显示 `202.48 kWh` 与 normalized cumulative 来源，Week/Month 均可刷新恢复；伪造 `stale-release` 时只显示 outdated 状态，当前事实没有混入。

Workspace 复核结论：先前“Preschool 被 Ngee Ann Workspace 限制”不是 Renderer 或 API 缺失，而是共享 Chrome 仍处于 Ngee Ann Workspace 且保留旧 Project URL。使用 Admin 账号将 Workspace 切换为 `Preschool Demo`，再进入 `preschool-demo` Project 后，Portfolio、Benchmark、Operating、June plan 与 Centre detail 均正常显示。切换 Workspace 后若保留旧 Project URL，应显示上下文不匹配而不是跨 Workspace 读取，这属于正确隔离行为。

### 11.9 #9 日趋势解释层与 #19 停止条件

- Ngee Ann 日趋势现在以 accepted daily totals 为主图，并在严格匹配同一 Snapshot、Release、Project/Scope、local date、事实区间、actual usage 与质量身份时，显示治理基线、差值、规则结果和需复核标记。任何匹配或公式校验失败只让 overlay fail closed；不会隐藏或重算 accepted usage。
- 非 suppressed 行会校验 `impact = actual - baseline`、相对变化率和 20%/20 kWh 双阈值结果。主阅读区只显示两位小数与一位百分比，原始数值、query、rule revision、bundle、cutoff 和 baseline method 保留在折叠 Trend Evidence。
- 需复核日期使用紧凑圆点，避免 28 天窄列中的文字标签互相遮挡；聚焦日期后可直接跳到同一 frozen incident Evidence。这个切片不新增 SQL、Kernel 指标、AI 推理或浏览器端异常计算。
- 聚焦自动化：ViewModel + Renderer `2 files / 198 tests` 通过；仓库 typecheck、diff check 与 Web production build（17 pages）通过。当前切片的新鲜 1440/1920 Chrome 仍需在下一验收层单独记录，不能沿用较早截图冒充本次视觉证据。
- #19 的停止原因不是一般工程洁癖，而是现有事实存储无法同时服务 A 与 B：写入 B 后 A 的事实已经不存在，Metadata 指针不能恢复它。不得在未获产品授权时把 #19 扩成通用历史 Snapshot 仓库，也不得交付不能真实回读 A 的伪 rollback。

2026-08-07 后续产品校准：当前 MVP 不要求完整事实 A/B 即时切换，#19 已关闭为 `not planned / wontfix`，并从 #20 依赖中移除。MVP 保留的是成功日更 Current、失败不混入半成品、Saved A 固定、Rerun B 新建的连续数据闭环。

同日真实 28 天 Chrome 验收发现，四位小数分别序列化的 actual、baseline、impact 与 percentage 在 Web 反算时产生最大 `0.0001 kWh`、`0.000297 percentage points` 的尾差，原 `0.0001` 统一容差误将 17 行合法 Evidence 判为无效。修复只把 impact 容差校准为 `0.0002 kWh`、percentage 容差校准为 `0.001 percentage points`；1 kWh / 1 percentage point 篡改测试仍 fail closed，不影响规则阈值、Snapshot、Scope 或权限守卫。

### 11.10 #20 Saved Analysis / Rerun / browser print

- 新保存的 Analysis Run 除原有不可变 query、analysis、Template Revision 与 Data Snapshot 外，同时冻结完整 `ProjectAnalysisSnapshot` 和有限的决策视图状态（grain、comparison、category）。旧记录没有完整 Snapshot 时继续进入原通用只读兼容页，不伪造项目专属投影。
- Saved Ngee Ann 与 Preschool 结果现在复用各自正式 Project Renderer，不再以通用 `EnergyTemplateRenderer` 代替。服务端回读会校验 Snapshot 内的 Project、Scope、Resource、Template Revision、Data Snapshot 和 analysis provenance；任一身份漂移均 fail closed。
- Saved 页面使用显式 `saved` AI Slot：保存时若已有完成结果，会冻结最终卡片、Evidence、Run/Profile、实际模型信息、请求指纹/上下文 SHA-256、Snapshot、Release 与完成时间；若当时没有完成结果，页面诚实说明未保存 AI。两种情况在重新打开或刷新时都不会启动新 AI Run，也不会保存 chain-of-thought 或流式中间状态。
- `Save analysis` 可与当前已完成 AI 结果原子保存。用户显式点击 Rerun 时先创建不可变的确定性 B，再为 B 获取一次 AI；完成结果通过 creator-only、Snapshot/Release/Renderer/Evidence 守卫做一次性附着。相同重试幂等，不允许用另一条结果替换；AI 暂时不可用时仍保留可用的确定性 B。
- Ngee Ann 保存时用当前 Snapshot/Release pin 证明保存内容就是屏幕上的 A；持久化给 Rerun 的仍是 `current-overview-28d` 语义，而不是 A 的固定日期。真实两批 Excel 验收证明 Current 从 A 推进到 B 后，Rerun 创建同 series 的 sequence 2、记录 `rerun_of_id` 并使用 B，A 的 analysis/query/snapshot JSON 保持不变。
- 浏览器打印采用轻量 `window.print()` 与 print CSS：隐藏导航和操作按钮，解除 Shell 固定高度及滚动裁切，保留报告、图表和 Evidence；没有引入服务端 PDF 服务。
- 自动化：AI Artifact 接入后的聚焦回归 `8 files / 83 tests`、仓库 typecheck、Web production build（17 pages）通过；真实 A→B→Rerun 验收 `1/1` 通过（约 183 秒）。真实 Chrome 新建并回读 Ngee Ann 与 Preschool Saved result，分别确认专属 Renderer、原 Snapshot、无新 AI progress、1440/1920 无横向溢出和 console 0 warning/error；打印媒体下 header/action 隐藏、main/shell overflow visible。
- 真实完成 AI 结果验收使用 Preschool Snapshot `energy-snapshot-52ca9611e48b0d71c2efe7b7`：保存后打开 `saved-analysis-cdbe7b98-2179-4947-a2df-dbe155f4cf4f`，冻结 Run `preschool-overview-d7082e0f-319f-4347-90aa-7f779786f77c`。刷新 Saved 页面后卡片全文和 Run 标识逐字一致，页面没有 `Thinking / Running / Inspecting`。Ngee Ann 当前固定 Session 中的既有 Provider Run 未完成，作为 Provider/Session 运行问题单独处理，不影响本次 Preschool 真实链路与两项目自动化合同结论。
- #20 已达到工程关闭边界；Charles/人工信息价值、打印效果和两项目连续操作验收继续属于 #21，不能由自动化或本次 Chrome 证据代替。

### 11.11 AI Slot 决策阅读层级

- 2026-08-07 用户验收指出，原 AI Slot 虽然字段完整，但把 `What / Why / Next / Expected / Ignored / Verify / Limitations` 等量铺开，形成长段模型输出；用户需要先读完文字才能找到结论和行动。这不是单纯字号问题，而是信息优先级错误。
- Ngee Ann 与 Preschool 现统一采用 `AI analyst briefing`：每条 Finding 使用全宽纵向决策单元，不再把三条长文本压进三列。默认阅读顺序固定为标题 → `What the data shows` → `Why this matters` → 黑底 `Recommended next check`；Preschool 继续直接显示 `Expected if acted on / If ignored` 的决策后果。
- Relationship 与可信度改成普通用户可理解的状态：`Reinforces a known issue / Challenges the current view / New investigation angle`，以及 `Evidence-backed / Hypothesis / Needs more evidence`。技术性的 `theme` 和孤立 `Evidence` 标签不再占据正文阅读路径。
- `How to verify`、限制和技术说明默认收进 `Verification and limitations`；Finding-specific Evidence 弹窗和 `Ask AI deeper` 仍保留。改造不修改 AI Run、Finding JSON、Snapshot、Evidence、保存/恢复或权限合同，也不在 React 重写模型结论。
- 自动化：两项目 AI Slot `20/20` 通过；含 Saved Analysis/API/Renderer 的聚焦回归 `8 files / 83 tests` 通过；Impeccable UI detector `0` 条发现；仓库 typecheck 与 Web production build（17 pages）通过。
- 真实 Admin Chrome 在 Preschool 完成结果上验收：当前 `1600×789` viewport 中标题为 18px、核心数据与行动为 16px，次要详情默认闭合，无横向溢出，console 为空。Ngee Ann 的既有 Provider Run 仍停留在进行中，因此真实完成卡片不能冒充验收；三条 Finding 的同构阅读层级由组件/Renderer 测试覆盖，待 Provider 结果可用后再做人工内容验收。

## 12. 2026-08-08 夜间收口路线与追踪表

### 12.1 本轮目的

不再扩大 Overview 模块数量。本轮把已经存在的 Ngee Ann、Preschool、AI Finding 表达和 Saved/Explorer 能力组织成可试点验收的两项目产品，并明确哪些结果已经由工程证明、哪些仍必须由 Charles/用户人工判断。

执行顺序固定为：

1. **#9 Ngee Ann 阅读路径**：完成 Level/Composition 减负后的 60 秒阅读复核，验证 Takeaway → Verified figures → Change → Contributors → Time patterns → Evidence 的顺序，以及 1440/1920、默认折叠、无全页横向溢出和无 console error。
2. **#13 Preschool 回归**：确认近期共享 AI、History、Explorer 和样式改动没有破坏 Portfolio、Benchmark、Operating、Appliance、June demo baseline 与 provisional cost；不重复建设已经完成的页面模块。
3. **#35/#36 审核与 #15 校准**：审核侧边 Agent 的 AI Finding 表达画板、Context budget/cache/checkpoint 是否满足既有合同且没有变成通用平台；只保留 #15 仍未被 #35/#36 覆盖的真实客户可见交付。
4. **#21 两项目试点预验收**：形成 Ngee Ann 与 Preschool 的同一套演示步骤、证据清单、人工问题和停止条件；不把工程通过冒充 Charles 签收。

### 12.2 实时状态

状态：`TODO` / `DOING` / `DONE` / `BLOCKED`。

| 顺序 | Ticket / 切片 | 状态 | 完成判据 |
| --- | --- | --- | --- |
| N1 | #9 Level/Composition 客户阅读层 | DONE | `ca4d170`：主层统一为 1–2 位显示精度；Level/Category/Circuit 使用占比、当前值和较上期变化；四位精度、Quality 与技术 ID 留在折叠明细；Accounting/Derived 默认折叠。专项 `199/199`，真实 Chrome 28-day 数据与交互通过。 |
| N2 | #9 60 秒阅读路径与 1440/1920 | DONE（工程预验收） | 新鲜 Chrome 已验证首要信息、Contributor、时间图、Evidence、折叠、溢出和 console；AI 后台状态不阻塞确定性页面。Charles 人工价值验收仍未完成。 |
| P1 | #13 Preschool 确定性回归 | DONE（工程预验收） | API Projection、ViewModel、Renderer 与 Dashboard `70/70`，仓库 typecheck 通过；新鲜 Chrome 关键模块、公开参考价/Forecast 边界、History 和双分辨率未回退。#18 与 Charles 人工门槛仍独立开放。 |
| A1 | #35/#36 只读审核 | DONE（审核） | #35 方向正确但缺服务端 Block 校验、语义 Evidence、可访问性与真实 Provider/多尺寸证据；#36 发现显式 output budget 被 4096 fallback 覆盖的回归，修复前不合并。 |
| A2 | #15 剩余范围校准 | DONE（决策） | #15 只保留“完整 SQL/Table Artifact 物化受控图表、168 点 Golden 与刷新恢复”；不再作为 Overview #21 的完整硬阻塞，不建设第二套图表平台。 |
| T1 | #21 两项目试点预验收 | DONE（工程清单） | 两项目演示清单、现有证据、工程缺口、12 个 Boss/FM 问题与停止条件齐全；真实 Provider、目标环境与 Charles 人工签收仍阻止关闭 #21。 |
| R1 | 提交与 Issue 更新 | DONE | UI 收口提交 `e71fa89`；本 Runlog 独立提交。#9/#13/#35/#36 已追加 UTF-8 复核证据，#15/#21 正文按真实剩余范围校准；未带入侧边 AI、tsconfig、next-env 或 `.scratch` WIP。 |

### 12.3 60 秒人工阅读问题

两个项目都必须让非技术用户无需打开 Evidence 就能回答：

1. 现在最值得注意的事情是什么？
2. 影响多大，是 1 天、7 天还是 28 天问题？
3. 哪个 Level、Centre、Circuit 或 Appliance 最值得先查？
4. 图表直接证明了什么，哪些解释仍只是调查方向？
5. 下一步做什么；做了和不做可能看到什么差异？
6. 用哪个指标、在什么窗口验证？
7. 需要核查时能否一键到同 Snapshot 的 Explorer/Evidence？

### 12.4 证据分层

- **自动化证据**：Golden、ViewModel、Renderer、API projection、Snapshot/Evidence 守卫和交互测试。
- **运行/Chrome 证据**：已登录真实 Workspace、当前 Published Snapshot、1440/1920、无全页横向溢出、无 console error、关键折叠/跳转可操作。
- **人工价值证据**：Charles/用户是否能在 60 秒内说出结论、影响、下一步和验证方式。前两层不能替代这一层。

### 12.5 停止条件

- 不为关闭 Ticket 而伪造 AI Finding、Forecast、Tariff、节省额或根因。
- 不修改侧边 Agent 正在编辑的 AI 文件；审核发现冲突时先记录并等待其稳定交接。
- 不恢复控制整页的全局 Scope/Period；局部探索不触发整页或全部 AI 重算。
- 不把 #36 扩成通用 Prompt/Context cache、分布式 checkpoint 或 Provider Router。
- 不把 #35 扩成任意 HTML/JS 执行画布；允许 Agent 选择受控表达原语，但确定性 KPI/Evidence 仍权威。
- 不在没有 Charles/用户明确签收时关闭 #9、#13 或 #21 的人工验收门。

### 12.6 本轮工程与 Chrome 结果

- Ngee Ann 主阅读路径为 `Takeaways → Verified figures → AI briefing → Change over time → Main contributors → Time patterns → Evidence`；1d/7d/28d 共用同一 cutoff/Snapshot。Accounting、Derived、原始技术 ID 和完整 Metadata 说明默认折叠；主层 Metadata 提示压缩为“标准化 Benchmark 暂不可用，但能耗、对比和成本仍有效”。
- 专属 Overview 不再在标题下重复展示 Run message 与 Release ID；这些审计信息继续保留在折叠 Evidence。共享通用 Renderer 保持原行为。
- Ngee Ann 新鲜 Chrome：CSS `1440×900`、`1920×1080` 均为全页/主区/模块横向溢出 `0`，19 个技术详情默认关闭，无全局 Period/Scope 控件。AI 当时处于后台分析，确定性页面已完整可读；不能冒充 AI Available 验收。
- Preschool 新鲜 Chrome：CSS `1440×900`、`1920×1080` 均为全页/主区/模块横向溢出 `0`，console warning/error `0`，8 个详情默认关闭，无全局 Period 控件。页面回读 `24,921.81 kWh`、`30 Centres`、`3,103.78 kWh / 12.5%` standby、9 个 Appliance aliases、June `26,240 kWh` demo baseline 与 `27.27 cents/kWh` 公开参考价。History 弹窗可打开并关闭，Current Overview 留在背景；AI 后台分析不阻塞确定性结果。
- 自动化：本轮 Ngee Ann Renderer + Published Dashboard `96/96`；Preschool Projection/ViewModel/Renderer/Dashboard `70/70`；仓库 typecheck、diff check 通过；Impeccable detector `0` 条发现。Dashboard 测试仍有两条既有的 AI resume `401` stderr，属于 #18 测试隔离，不归入 #9/#13 确定性改造。

### 12.7 #35、#36 与 #15 校准结论

- **#35 保持打开**：受控 Presentation Blocks、Agent 自选有图/无图、非法 Block 局部降级和禁止任意代码方向成立，聚焦回归 `105/105`。关闭前仍需最小服务端 Block 校验、Block 到 Evidence 的语义绑定、非颜色单一表达，以及两个项目真实 Provider 的有图/无图与多尺寸证据。当前 12 个文件仍为侧边 Agent 未提交 WIP，主 Agent不选择性吸收。
- **#36 保持打开且暂不合并**：现实现复用已有 Context Package/Plan/Checkpoint，没有新增平台，聚焦回归 `28/28`；但 `27df662` 会在 Profile 只有显式 `maxTokens/maxOutputTokens`、没有 `contextLength` 时把 Output 设置错误降为 `4096`。必须先让显式 Output 与保守 Context fallback 解耦并补回归测试；真实 DeepSeek pass@3、same-session 与 Cache 证据仍需完成。
- **#15 缩窄且不阻塞当前 Overview 试点**：已具备 Task Console、刷新恢复、168 小时点和受控 line/bar/pie。剩余只做从完整 SQL/Table Artifact 物化图表，移除模型重复传隐含 limit 的依赖，并保留一个 168 点 Golden；其他图型只在试点出现真实决策问题时增加。#15 复用 #35 的受控表达 seam，不建设第二套通用图表平台。

### 12.8 #21 两项目试点最小检查表

1. 固定两个 Workspace/Project、Published Release、Snapshot、timezone 和模型 Profile；关闭 fallback，明确目标试点环境后才发布。
2. Ngee Ann：60 秒看出问题、影响、贡献者、下一步与验证；核对 1d/7d/28d、Top exceptions、Trend、Level/Composition、Day profile 与 Heatmap；History 打开 Saved A 不重算。
3. Ngee Ann A→B：只用正式 Register → Mapping → materialization → Publish → Overview → Save/Rerun；B 更新 Current，Saved A 字节稳定，A/B Snapshot 与 Evidence 不混。
4. Preschool：核对总量、30 Centres、standby、Top 5、9 个 aliases、Benchmark distribution、Operating/closed profile 和 June demo；公开参考价必须明确不是客户 Tariff 或账单。
5. 两项目浏览器：CSS `1440×900`、`1920×1080`、无横向溢出、无应用 console error/warning；验证 Evidence、History、Explorer、AI deeper、Escape、焦点返回与 AI `Analyzing / Available / Unavailable`。
6. 固定 12 个 Boss/FM 问题，逐题保存数字、Evidence、Run、耗时和人工判断；验收标准是正确、同 Snapshot、说人话和有决策价值，不是“模型有回答”。
7. #21 只有在工程证据、真实 Provider 证据和 Charles/用户人工价值验收三栏全部完成后才能关闭。当前真实阻塞为 #18/#35 Provider 证据、目标试点环境和 Charles 对 #9/#13 的人工签收；#36 不作为试点阻塞。
