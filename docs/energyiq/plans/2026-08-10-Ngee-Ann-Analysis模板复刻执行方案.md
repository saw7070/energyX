---
title: "Ngee Ann Analysis 模板复刻执行方案"
summary: "在 Preschool 确定性模板、AI Artifact 与连续数据经验之后，先审计 4178 Analysis 原型，再按客户问题映射到正式 Snapshot/ViewModel/Renderer。"
doc_type: implementation
tags: [EnergyIQ, Overview, Ngee Ann, Charles, Template, AI Slot]
updated_at: "2026-08-13"
status: active
related:
  - "2026-08-10-Overview夜间执行路线与Runlog.md"
  - "../handoff/agent/2026-08-04-Overview-AI-New-Orchestrator-Handoff.md"
---

# Ngee Ann Analysis 模板复刻执行方案

## 1. 目标与边界

目标不是把 `http://127.0.0.1:4178/analysis` 的静态 React 原型原封不动搬进产品，而是先达到 Charles/NAP 模板的基础验收效果：

1. 保留原型里真实帮助 FM/Boss 判断的章节、论点、指标、图表和下钻关系；
2. 每个客户可见数字来自当前 Published Snapshot、共享 Kernel/ViewModel 和 Evidence；
3. 图表服务于“发生了什么、为什么重要、下一步怎么做”，不能只是素材堆叠；
4. AI interpretation 穿插在对应 Section，但不替代确定性指标、图表或缺失数据；
5. 缺少 Tariff、Calendar、Mapping 或事实时局部显示 Unavailable，不用静态假数字补齐。

本切片不建设通用 Dashboard DSL、任意 HTML/JS 执行器、第二套 Snapshot/Analytics Kernel 或自动模板生成平台。

## 2. 开始前自我 Grilling

### Q1：原型同样是 React，是否可以直接复制组件？

只能复用视觉结构和低层无业务状态的图表组件。原型的固定日期、数字、费率、阈值、营业时间、建议和按钮状态不能进入正式 Renderer，否则新数据进入后仍是静态 HTML 的另一种形式。

### Q2：为了 1:1 对齐，是否应在浏览器计算缺失指标？

否。浏览器只渲染服务端 ViewModel。缺少服务端 Projection 的模块先标记 `adapt / unavailable`，再评估一个最小项目专属 Projection；不得在 React 复制 SQL 或公式。

### Q3：是否先把所有模块一次做完？

否。先建立逐模块矩阵和截图基线，再按客户阅读顺序切成可验收的垂直 Slice。每个 Slice 都要经过 Metric → Evidence → ViewModel → Renderer → Browser，而不是先做一堆后端再统一接 UI。

### Q4：AI Slot 是否立即插入所有模块？

否。只有模块的确定性 Facts/Signals 已稳定时，才把同一 Snapshot 的 AI interpretation 放在对应 Section。AI 可以发现额外角度和选择图表，但未经 Runtime 接受的数字/图表不能显示为可信结果。

## 3. 第一阶段：只读模板审计

对 4178 页面逐段保存截图和模块矩阵，每个模块记录：

| 字段 | 必须回答的问题 |
| --- | --- |
| Section / module | 原型标题、位置、默认展开状态是什么？ |
| Customer question | 用户看完要知道或决定什么？ |
| Claim / takeaway | 原型是否明确给了结论，还是只有图？ |
| Metric / visual | KPI、表、图、筛选器和交互分别是什么？ |
| Current EnergyIQ | 当前 Ngee Ann Snapshot/ViewModel/Renderer 是否已有等价能力？ |
| Provenance | 数字可绑定哪个 Query/Evidence；缺什么输入？ |
| Decision | `retain / adapt / drop / unavailable` |
| Estimate | `S / M / L`，并说明真正耗时点在 Projection、数据还是 UI |
| AI role | AI 应解释什么；哪些事实必须保持确定性？ |

输出包括：整页截图、各 Section 截图、交互态截图、模块矩阵和第一个实现 Slice 建议。审计阶段不改正式 Renderer。

## 4. 推荐实现切片

矩阵完成前不锁死最终模块，但默认按以下顺序评估：

1. **首屏与数据上下文**：Project、统一 cutoff/Snapshot、Data Status、1d/7d/28d takeaway 和关键 KPI；
2. **时间变化**：趋势、baseline、异常点与关键日期，回答变化发生在哪里；
3. **空间/层级贡献**：Level、Category、Circuit 的当前期/上期贡献，回答谁在驱动；
4. **日内模式**：工作日/周末的 observed profile 与 Heatmap，回答什么时候发生；
5. **决策组装**：Finding → Evidence → Impact → Action → Verification，以及对应的 AI interpretation；
6. **A→B 更新证明**：Saved A 不变、Current B 更新、Snapshot/Evidence/AI Artifact 不混。

每个 Slice 必须先写具体方案、反证、验收和停止条件，再允许改代码。

## 5. 验收分层

- 自动化：Projection/ViewModel/Renderer/identity tests、typecheck、build、diff check；
- 真实运行：正式 API/Renderer、Published Snapshot、授权和 Evidence 回读；
- Chrome：1440、1920、tablet，检查可读性、无横向溢出、交互和 reload resume；
- 人工：Charles 判断信息逻辑、价值、语言与模板对齐；自动截图不能替代这一层。

## 6. 停止条件

出现任一条件时停止实施并回到矩阵复核：

1. 模块只能靠硬编码原型数据、阈值或费率实现；
2. 需要为 Ngee Ann 复制第二套计算口径或 Snapshot 系统；
3. 基础模块必须大改共享 Kernel 才能展示，且没有明确客户价值；
4. AI 被用来填补不存在的确定性数字或直接执行任意前端代码；
5. 不能说明第一张客户可见截图要证明什么决策价值。

## 7. Runlog

| 时间 | 状态 | 证据 / 决定 / 下一步 |
| --- | --- | --- |
| 2026-08-10 07:05 SGT | READY | 已固定目标、反证、审计字段、实现顺序与停止条件。下一步只读检查 4178 页面与源码，输出模块矩阵和截图基线；矩阵审核前不改正式 Ngee Ann Renderer。 |
| 2026-08-10 08:30 SGT | AUDITED | 已对给定 URL、真正的 Ngee Ann v1/v2 页面、原型源码及正式 Renderer/ViewModel 做只读复核，并保存整页、Section 和交互态截图。确认给定 URL 的 `pf-vg-hq` 是通用 VG HQ mock，不是 Ngee Ann；第一实现切片应复用正式 Snapshot/ViewModel 现有能力，不复制原型固定数字、费率、日期、阈值、Findings 或无效按钮。 |
| 2026-08-10 07:40 SGT | REVIEWED | Standards 与 Spec 双轴复核确认首屏顺序符合 Answer-first，但发现两个可信度风险：同向候选为空时不应回退反向项；Level 与 Category 不应拼成一个看似交集的 driver。实现已改为两个独立的同方向变化事实，无同向事实时局部 Unavailable，并抽取一次最大 anomaly 选择逻辑。Section-local AI interpretation 明确留到正式 Ngee Ann Signal Adapter/Artifact 薄适配，不在本切片用静态 detail 冒充 AI。 |

## 8. 审计对象校准

### 8.1 给定 URL 不是 Ngee Ann 专属页面

用户给定 URL：

```text
http://127.0.0.1:4178/analysis?utility=electricity&project=pf-vg-hq&level=Project&range=MTD&profile=Dormitory+Weekday&compare=Previous+Period
```

源码 `src/mock/portfolioProjects.ts` 将 `pf-vg-hq` 注册为 `VG HQ Tower`。该 URL 展示的 `124,567 kWh`、`S$33,640`、Cost Analysis、Forecast、模板化 AI Assistant 和 Efficiency Benchmark 属于通用 mock Analysis，不应作为 Ngee Ann 数值或模块验收基线。

真正的 Ngee Ann 原型入口是：

```text
http://127.0.0.1:4178/analysis?utility=electricity&project=proj-nap-energy-analysis&level=Project&range=MTD&profile=Dormitory+Weekday&compare=Previous+Period

http://127.0.0.1:4178/analysis?utility=electricity&project=proj-nap-energy-analysis-v2&level=Project&range=MTD&profile=Dormitory+Weekday&compare=Previous+Period
```

建议以 **v1 的章节顺序**作为复刻参考，以 **v2 的 Day Type、Scope 和设备热力图下钻**作为选择性补充。v2 将 Daily Total Trend 固定在 Executive Summary 之前，会让用户先读图再找结论，不符合当前“先 Takeaway、再 Evidence”的产品方向。

### 8.2 证据边界

- 4178 服务复用用户已启动的进程，没有启动第二套服务；三条 URL 均返回并完成真实 Chrome 渲染。
- 原型 Ngee Ann 数据来自编译进前端的 `napEnergyAnalysisData.ts` 常量；虽然常量由 Excel 生成，但页面运行时不读取正式 Published Snapshot，也没有正式 Evidence 身份。
- 正式能力对照基于当前 `ngee-ann-overview-renderer.tsx` 与 `ngee-ann-overview-view-model.ts`；它们已经使用 Published Snapshot、项目 Release、Query/Evidence 和 fail-closed 状态。
- 本节是只读架构和视觉审计，不是 Provider、正式 Renderer、部署或 Charles 人工验收。

## 9. 截图基线

截图目录：[`outputs/energyiq/ngee-ann-template-audit-20260810`](https://github.com/Zion74/energyiq-datafoundry/tree/main/outputs/energyiq/ngee-ann-template-audit-20260810)

### 9.1 真正的 Ngee Ann 页面

| 证据 | 文件 | 用途 |
| --- | --- | --- |
| v1 整页 | [`nap-v1-00-full-page.png`](https://github.com/Zion74/energyiq-datafoundry/blob/main/outputs/energyiq/ngee-ann-template-audit-20260810/nap-v1-00-full-page.png) | 推荐的章节顺序基线 |
| v1 Executive Summary | [`nap-v1-01-section-0.png`](https://github.com/Zion74/energyiq-datafoundry/blob/main/outputs/energyiq/ngee-ann-template-audit-20260810/nap-v1-01-section-0.png) | KPI、Breakdown、Distribution、Summary of Findings |
| v1 Day Profile | [`nap-v1-02-section-5.png`](https://github.com/Zion74/energyiq-datafoundry/blob/main/outputs/energyiq/ngee-ann-template-audit-20260810/nap-v1-02-section-5.png) | Day Type、24 小时曲线、Level 下钻 |
| v1 Time-based Behaviour | [`nap-v1-03-section-7.png`](https://github.com/Zion74/energyiq-datafoundry/blob/main/outputs/energyiq/ngee-ann-template-audit-20260810/nap-v1-03-section-7.png) | Daily Trend、baseline、anomaly list、health summary |
| v1 Circuit Category | [`nap-v1-04-section-10.png`](https://github.com/Zion74/energyiq-datafoundry/blob/main/outputs/energyiq/ngee-ann-template-audit-20260810/nap-v1-04-section-10.png) | Circuit 排名与 Category |
| v1 Recommendations | [`nap-v1-05-section-12.png`](https://github.com/Zion74/energyiq-datafoundry/blob/main/outputs/energyiq/ngee-ann-template-audit-20260810/nap-v1-05-section-12.png) | 固定建议卡与空 Action Log 按钮 |
| v2 整页 | [`nap-v2-00-full-page.png`](https://github.com/Zion74/energyiq-datafoundry/blob/main/outputs/energyiq/ngee-ann-template-audit-20260810/nap-v2-00-full-page.png) | 用于识别 Trend 前置带来的阅读路径问题 |

### 9.2 给定通用 mock 页，仅作补充灵感

`00-analysis-full-main.png` 至 `12-personalized-recommendations.png` 保存了通用页面的整页和各模块；`13` 至 `18` 保存了时间、Cost、Day Type、Distribution、模板 Prompt 和 Action 按钮交互态。它们可用于评估视觉形式，但不能作为 Ngee Ann 数据、Forecast、AI 或 Benchmark 的完成证据。

## 10. Ngee Ann 模块矩阵

估时定义：`S` 约半天内，`M` 约 1–2 天，`L` 超过 2 天且通常涉及服务端 Projection 或新数据输入。估时只用于切片排序，不是交付承诺。

| Section / module | Customer question / claim | Metric、visual、interaction | 当前正式 EnergyIQ 能力 | 数据 / Evidence 差距 | 决定 / 估时 | AI role |
| --- | --- | --- | --- | --- | --- | --- |
| Data context banner | “这份分析是哪一个项目、哪段数据，完整吗？” | Project、Level 6/7、19 May–17 Jun、30 天、15 分钟、Excel 文件名 | 已有统一 Project/Scope、Period、timezone、Snapshot、Release、Data Status、coverage、last seen、Evidence details | 原型没有 Snapshot/Release/Evidence；正式页面不应把 Excel 文件名放在主阅读路径 | **adapt / S**：保留正式 Context 和 Data Status；技术来源折叠 | 不需要 AI；这是确定性身份和可信边界 |
| Executive KPI | “本期用了多少、日均多少、峰值何时、与上期相比怎样、费用多少？” | Total、Daily Average、Peak 1h、Estimated Cost；点击 KPI 下钻 | 已有 Total、Daily、15-minute Peak、Comparison、Cost availability、Peak breakdown | 原型 Peak 用“1h consumption”，正式口径是 15-minute interval-average power；当前 Tariff 缺失时 Cost 必须 Unavailable | **retain + adapt / S–M**：保持正式口径，在首屏用人话解释差异；不伪造 Cost | AI 可写一句首屏综合 Takeaway；不得改变 KPI 或单位 |
| Consumption Breakdown | “变化发生在哪些日期、由什么 Category/Level 驱动？” | 按日堆叠 Category 柱、Cost 折线、空间/Tag/日期筛选 | 已有 Energy Trend、Level comparison、Category/Circuit composition，但不是一张 Category×Day 堆叠图 | 若要 Category×Day，需要服务端时间×Category Projection；Cost overlay 还依赖 Tariff | **adapt / M–L**：第一切片用现有 Trend + Level/Category contributor；不要为了复刻先建新 Projection | AI 解释转折点和 driver；确定性层提供日期、Category、Level 和差值 |
| Energy Distribution | “总能耗主要流向哪里，点某类后谁贡献最多？” | Category donut、占比、点击 Category 后看 Level 排名 | 已有 Energy Composition、Category/Circuit 排名和 accounting trace | 无关键缺口；当前正式 UI 形态未必是 donut | **retain capability, adapt visual / S–M**：只有当占比是核心论点时用 donut；否则 Top contributors 条形图更清楚 | AI 说明集中度为何重要；不要复读最大值 |
| Summary of Findings | “整份报告最值得先关注哪 2–4 件事？” | 六组固定主题和长 bullet，Generate Full Report | 已有 Decision Priorities、1d/7d/28d horizons、AI Slot、Evidence | 原型 Findings 是 `napEnergyAnalysisData.ts` 中固定字符串；新数据不会产生新角度 | **replace / M**：使用结构化 Signals + 一次 AI Artifact 生成优先级、意义和下一步，并按 Snapshot 持久化 | AI 负责选择、合并、排序和讲人话；Runtime 只验证引用事实 |
| Day Profile | “已观察到的工作日、周末和假日 24 小时形状如何不同？哪个 Level/Circuit 值得继续查看？” | 3 个 Day Type KPI、24h stacked profile、Level 表、选择 Level 后热力图 | 已有 Day Profile（Project/Level）、weekday/weekend/holiday、hour axis 和 Usage Heatmap | 正式数据已有核心能力；是否有 Calendar/holiday 覆盖必须按 Snapshot 状态显示 | **retain + reorganise / M**：标题直接给结论，图作证据；热力图作为下钻 | AI 解释峰谷、开关机行为和建议核查时段；不推断未提供的 occupancy |
| Daily Trend + Anomaly | “哪些日期偏离正常，是否重复，先查哪一天？” | 30-day bars、day-type baseline、115% threshold、anomaly dots/list、Scope/Day Type filter | 已有正式 daily totals、governed baseline overlay、Daily Anomalies、Incident/Evidence | 原型固定 15% 阈值并写死 21 Apr–17 Jun calibration；正式规则必须来自 Rule revision，不能从 JSX 复制 | **retain formal / S–M**：用正式 Rule，减少长列表，Top exceptions + 展开全部 | AI 解释异常的组合、复发和可能调查方向；不能把阈值变成因果结论 |
| Energy Health Summary | “工作日/周末/假日和 office/after-hours 的结构性差异是什么？” | 7 个 KPI：3 类日均、office/after-hours、Level 6/7 total | 已有 Day Profile、rolling horizons、Level comparison；Calendar 能力决定 office/after-hours 是否成立 | Ngee Ann 当前正式 Calendar/Operating-hours 覆盖需重新确认；缺失则不能复制 08–18、22–06 | **adapt / M**：将有效的 1d/7d/28d 或 Day Type 差异做成 2–3 个 takeaway，不堆 7 张孤立 KPI | AI 把指标组织成“即时/短期/结构性”解释；营业时段事实保持确定性 |
| Circuit Category Analysis | “最值得排查的 Circuit 是哪些，它们属于哪个 Level/Category？” | Top 10 表、kWh、相对 Top10 平均值 | 已有 Circuit/Category composition、Peak breakdown、derived meter trace 和 Evidence | “vs Avg of Top 10”基线容易误导，不等于正常或节能潜力；应同时显示 share、change 或 anomaly link | **adapt / M**：首屏 Top 3–5，其余展开；按决策优先级而不只是绝对量排序 | AI 可解释为什么某 Circuit 值得查；排名、share、delta 必须来自 Projection |
| Personalized Recommendations | “现在做什么，做了/不做会怎样，如何验证？” | 6 张固定卡：priority、reason、action、saving、owner、Add to Action Log | 已有 Decision Priorities、AI interpretation、Ask AI deeper 链路；暂无正式 Action Log workflow | 原型 saving/priority/reason/action 为固定字符串；Add to Action Log 点击后 DOM 不变 | **adapt; drop fake action / M**：先展示 2–4 个可验证行动；按钮在真实 workflow 前隐藏或标 Pending | AI 组织 Why/Action/Expected/If ignored/Verify；预计节省量无 Evidence 时写“待测量” |
| Generic Cost Analysis（仅给定 URL） | “哪个 Block/Room 花费最高？” | Total cost、previous、per-capita、block/room 表和 heatmap | 正式 Ngee 只有 Project Cost 状态；有 Tariff 才可计算 | 没有正式 block/room occupancy 与成本 Projection；通用页 table cell 以无语义 `<td>` 点击 | **unavailable / L**：不是第一阶段；先拿到 Tariff、空间和 occupancy 数据再评估 | AI 不补成本或 occupancy；只解释服务端已算结果 |
| Generic Forecast（仅给定 URL） | “月底用量、账单和 Peak risk 会是多少？” | 3 KPI + actual/forecast 折线 | 正式 Ngee Overview 没有相同 Forecast Projection | 原型使用前端 hash 生成未来点、固定 `0.30/kWh`，且实际线在 D26 后降为 0；没有误差带、训练窗口或 Evidence | **drop / unavailable / L**：不要进入首版；有足够历史、Tariff 和明确决策用途后再做服务端 Projection | AI 可以解释已验证 forecast，不负责生成权威 forecast 数字 |
| Generic AI / Benchmark（仅给定 URL） | “系统能否回答异常房间、效率和下一步？” | 预设 Prompt、固定回答、EUI percentile、4-bar benchmark | 正式已有 Ngee AI Slot、Evidence-backed tool run；EUI 依赖 area metadata | 原型 Prompt/回答来自 `mockData.ts`，没有 Provider 调用；Benchmark 标签不完整且可能缺 area/headcount | **replace / M**：继续使用正式 AI Artifact；EUI 缺 metadata 时 Unavailable | AI 自主发现并用声明式图表表达；不得使用原型 canned answer |

## 11. 需要保留、改造、删除和暂缓的内容

### 11.1 保留

- Executive Summary → Day Profile → Time Behaviour → Contributors → Actions 的总体叙事骨架；
- KPI 点击查看 Peak/Level/Circuit 细节的渐进式披露；
- Day Type、Scope、Category 的模块局部筛选，不恢复控制整页的全局 Period；
- 图表与列表组合，让老板能看到具体 Level/Circuit 名称并直接安排核查。

### 11.2 改造

- 所有“描述型标题”改成客户问题或结论型标题；例如不只写 `Energy Distribution`，而是写“Level 7 ventilation is the largest contributor this period”。
- Summary of Findings 从六块固定长文改为 2–4 个优先事项，每项遵循 `Takeaway → Evidence → Why it matters → Action → Verify`。
- Circuit 排名不再用 “vs Avg of Top 10”冒充异常基线；改用占比、上期变化、异常关联或明确标注“仅按用量排序”。
- 技术来源、规则 ID、Snapshot ID、Query ID 默认折叠，主页面只保留 Data as of、coverage 和可理解的限制。

### 11.3 删除或在正式能力完成前隐藏

- `Generate Full Report`：真实 Chrome 点击后页面无变化，组件没有 handler；
- `Add to Action Log`：真实 Chrome 点击后页面无变化，组件没有 handler；
- 通用 mock 页的 `Generate Report`、`Export Summary`：组件只有按钮外观，没有 handler；
- 通用 mock 页的 canned AI answer、hash forecast、固定 `0.30/kWh` 和无数据来源的 Peak Risk。

### 11.4 硬编码风险清单

- Ngee 原型日期固定为 2026-05-19–2026-06-17，比较期固定为 2026-04-21–2026-05-20；
- Tariff 固定为 `29.72¢/kWh incl. GST`；
- anomaly threshold 固定为 `baseline × 1.15`；
- office hours 固定为 08:00–18:00，after-hours 固定为 22:00–06:00；
- Findings、Recommendations、Priority、Saving 和 Owner 是数据文件中的预写文案；
- 通用页 Forecast 使用浏览器内 hash 和 fixed tariff 计算，AI 是模板选择器，不是真实模型运行。

以上内容可以作为设计参考，但正式实现必须从当前 Snapshot、Rule、Tariff、Calendar、Mapping 和 Evidence 解析；任何缺失项都局部 `Unavailable`。

## 12. 第一项最小客户可见切片

推荐下一步只做 **NAP-A1：Answer-first Executive Summary + Change over time**，不先复制整页。

### 12.1 页面结果

1. 首屏继续显示统一 Project cutoff、Snapshot 和 Data Status；
2. 显示正式的 Total、Daily Average、Peak、Comparison 和 Cost/Unavailable；
3. 在 KPI 下方给出 2–3 条确定性事实摘要：本期变化、Level 与 Category 各自最大的同方向变化、最重要异常日期；不得把两个维度拼成未经证明的交集 driver；
4. 将现有 Energy Trend 直接放在对应结论下，用 baseline、异常点和关键日期作证；
5. 本切片保留现有页面级 AI Slot；逐 Section 的简短 AI interpretation 等正式 Ngee Ann Structured Signal Adapter/Artifact 薄适配后再接入，不用静态 detail 冒充 AI；
6. 原型 Report/Action 按钮、Forecast、EUI 和新的 Cost 下钻不进入该切片。

### 12.2 为什么是最小方案

这个切片复用正式 ViewModel 已有的 Total、Daily、Peak、Comparison、Cost 状态、Trend、Anomaly、Level 和 Category 数据，不要求新的 Analytics Kernel 或第二套 Snapshot。真正工作集中在 ViewModel 组合、信息层级、AI Artifact 薄适配、Renderer 和 Chrome 验收，预计 `M`。

### 12.3 验收

- 1440 和 1920 下，用户在 60 秒内能回答：本期是否变差、谁在驱动、哪一天先查、下一步做什么；
- 所有显示数字都能打开 Evidence；Cost 等缺失项诚实显示 Unavailable；
- 页面刷新后恢复同一 Snapshot 的 AI Artifact，不重新生成另一份结论；
- 新 Snapshot 发布后 Current 更新，Saved Analysis 仍保留旧 Snapshot/AI Artifact；
- 人工验收只判断信息价值和 Charles 对齐，不把自动截图误报为 Charles 已通过。

## 13. 后续建议顺序

1. `NAP-A1`：首屏 + Trend + 短解释；
2. `NAP-A2`：Day Profile + Level/Hour Heatmap，形成“什么时候发生”；
3. `NAP-A3`：Level/Category/Circuit contributor 与 Peak breakdown，形成“谁在驱动”；
4. `NAP-A4`：2–4 个 Action/Verify 卡，隐藏假 workflow；
5. 只有真实数据和决策问题都成立后，再评估 Category×Day、Cost drill-down、EUI 或 Forecast。

## 14. NAP-A1 执行切片（2026-08-10）

### 14.1 本切片只做什么

1. 将首屏重排为 `Context / Data Status → Executive Summary → verified KPI → 3 个确定性信号 → Decisions / AI`；
2. 三个信号只复用当前 ViewModel 已验收的事实：当前期对上期、Level/Category 变化贡献、最高影响异常日期；
3. `Change over time` 用上述同一组事实先给一句论点，再展示现有 Trend、正式 baseline 和 anomaly Evidence；
4. 每个信号保留指向正式 Comparison Evidence、Contributor Section 或 Incident Evidence 的下钻；
5. 不改 Kernel、Snapshot/共享契约、Preschool/AI 文件，不加入原型固定日期、Tariff、阈值、Forecast、AI 文案或假按钮。

### 14.2 开发前反证与处理

- **最大用量不等于变化原因**：driver 必须优先按与 Project 变化方向一致的 `changeKwh` 选择，不用当前总量排名冒充驱动；
- **Level 与 Category 可能指向不同方向**：并列显示各自已验证的主变化，不声称两者存在因果关系；
- **Comparison、Contributor 或 Anomaly 可能缺失**：对应信号局部显示 `Unavailable` 或“没有触发正式规则”，不补零、不拼静态结论；
- **Trend 与异常可能来自不同规则**：趋势只展示 accepted usage；异常结论继续引用正式 Rule/baseline，不把 previous-period comparison 当作 anomaly baseline；
- **信息重排可能破坏旧阅读顺序测试**：测试公共 Renderer 输出顺序、可见文字和 Evidence href，不测试私有实现。

### 14.3 TDD 公共验收 seam

1. `buildNgeeAnnOverviewViewModel`：Golden Snapshot 产生动态 Executive Summary 和 Change-over-time claim；
2. `NgeeAnnOverviewRenderer`：Context/Data Status、KPI、signals、Decisions、Trend 的客户阅读顺序正确，Evidence 链接仍存在；
3. Unavailable/legacy Snapshot：只关闭缺失信号，其他正式模块仍可见；
4. 聚焦 Vitest、Web typecheck 与 `git diff --check` 通过后才交回主 Agent。

### 14.4 执行结果

- 状态：`DONE-ENGINEERING / PENDING-CHROME-AND-HUMAN-ACCEPTANCE`；
- Golden 首屏已按 Answer-first 顺序重排，并从正式 Comparison delta、Level/Category delta 与 governed anomaly 生成 3 个确定性事实摘要；
- Level 与 Category 分别显示各自同方向的最大变化，不拼成看似交集的 driver；任一维度没有与 Project 同方向的事实时，该卡局部 Unavailable；
- Comparison 或 anomaly 缺失时对应信号局部 `Unavailable`，不补零；
- 聚焦 Renderer 测试 `53/53` 通过，根 TypeScript build typecheck 通过，`git diff --check` 无错误；
- 尚未完成真实 Chrome 1440/1920 与 Charles 人工验收，不能据此宣称 NAP-A1 产品验收完成。

## 15. NAP-A2 执行切片：When energy occurs（2026-08-10）

### 15.1 客户问题与页面结果

本切片只回答：**用电高点通常出现在什么时候，工作日、周末、Level 6 与 Level 7 的形状是否不同，FM 应先检查哪个时段？**

1. 复用现有 `Day Profile`、Day Type、Project/Level Scope 与 `Date × Hour / Level × Hour Heatmap`，不增加新的 Kernel 或浏览器计算口径；
2. 在图表前给一个由已验证 profile cells 计算的简短事实摘要：所选 Day Type/Scope 的峰值小时、峰值均值、完整样本天数；
3. 只有同一 Snapshot 内存在两个可比且完整的 profile 时，才给工作日/周末或 Level 间的差异摘要；否则局部写明样本不足；
4. Heatmap 继续作为探索证据，不把颜色较深直接写成异常、浪费或原因；
5. 逐 Section AI interpretation 暂不在本切片硬接，等待正式 Ngee Ann Structured Signal Adapter/Artifact；确定性摘要不能冒充 AI。

### 15.2 开发前自我 Grilling

- **峰值小时是否等于应关设备的时段？** 否。它只说明平均 profile 的最高点；没有 Calendar、occupancy 或设备状态就不能推断浪费。
- **两天样本能否叫“典型周末”？** 不能。界面必须同时显示 `n complete-day samples`，样本少时使用 `observed` 而非 `typical`。
- **不同 Scope 的峰值能否相加或声称因果？** 不能。Project、Level 6、Level 7 只能分别陈述；若需要 contributor，使用现有 Evidence 下钻，不在前端用峰值时刻拼装因果。
- **是否为了对齐原型新增全局 Day Type/Scope 控制？** 否。它们保持模块局部状态，不改变整页统一 Snapshot/Period，也不触发整页 AI。
- **是否需要新图？** 第一切片不需要。现有 Day Profile 与 Heatmap 已覆盖表达；先改善论点和阅读路径，只有人工验收证明信息不足再增加视觉。

### 15.3 自动化验收

1. Golden Snapshot 的默认 Day Type/Scope 摘要来自同一组 profile cells，并能定位峰值小时和值；
2. 切换 Day Type 或 Scope 时，摘要与图同步变化，不保留旧选择；
3. `sampleDayCount=0/null`、缺 Day Type 或缺 Level 表示服务端 Day Profile 合同无效，整段 fail closed；Date × Hour grid 的 partial cell 不得反向压掉由完整日生成的独立 Day Profile；
4. 现有键盘、hover/focus、Snapshot refresh 和 Heatmap 测试保持通过；
5. 聚焦 Renderer tests、root typecheck/build、`git diff --check` 通过后才能提交。

### 15.4 停止条件

- 需要前端重算正式 anomaly、Calendar 或 occupancy；
- 只能通过硬编码原型日期、营业时间或峰值结论实现；
- 为一个模块建设通用图表 DSL、全局筛选器或新的 AI Run；
- 样本不足却仍必须写成“典型行为”才能获得视觉效果。

### 15.5 执行结果

- 状态：`DONE-ENGINEERING / PENDING-CHROME-AND-HUMAN-ACCEPTANCE`；
- 每个可用 Day Profile 都从同一组 24 个 server-provided profile values 生成峰值小时、峰值均值和完整样本天数；相同 Scope 的 Weekday/Weekend profile 均完整时才显示局部对照；
- Day Type 或 Scope 切换时，摘要跟随模块局部状态同步更新，不改变整页 Snapshot/Period，也不触发 AI；
- Public Holiday 缺 Calendar 时该 profile 摘要局部 unavailable；任一 available profile 样本数无效或缺少必要 Day Type/Scope 时，完整 Day Profile 合同 fail closed。Date × Hour grid 的 partial cell 不反向否定服务端由完整日生成的 profile；
- Heatmap 已明确标注颜色只代表当前视图内 accepted usage 的相对高低，不能单独证明异常、浪费或原因；
- 峰值小时是 Renderer ViewModel 对同一 profile 的 24 个服务端值所做的展示级排序，只用于当前图前摘要，不注册为服务端 Structured Signal，不进入 AI Artifact、Decision Priority 或跨模块计算；若未来需要用于决策排序或 AI Evidence，必须上移服务端合同；
- 聚焦 Renderer 测试 `56/56` 与根 TypeScript typecheck 通过；真实 Chrome 1440/1920 和 Charles 人工验收仍待主 Agent 完成。

## 16. NAP-A3 执行切片：Where measured energy changed（2026-08-10）

### 16.1 客户问题与页面结果

本切片只回答两个容易混淆的问题：**当前用量集中在哪里？相对上一个可比窗口，哪些 Level、Category 和 Circuit 的测得变化最大？**

1. 复用现有 Level、Category、Circuit current/previous/change/share、quality 和 Evidence；不新增 SQL、Projection 或前端业务公式；
2. `Main contributors` 先明确分成 `Current concentration` 与 `Measured change`，不再让当前占比排名看起来像异常或变化原因；
3. Level 与 Category 分别陈述，不能拼成 `Level × Category` 交集，也不能写成 proven cause；
4. Circuit 列表继续默认 Top 5，但明确它按 current usage 排序，只是调查入口；不能称为 anomaly、priority 或 saving；
5. comparison 不可用时仍可显示当前 share/usage，但所有变化结论局部 Unavailable；技术明细继续折叠。

### 16.2 开发前自我 Grilling

- **最大 current usage 是否等于最大增量？** 否。页面必须同时展示排序口径；不能用 share 回答 change。
- **Level 7 增加且 Load 增加，能否说 Level 7 Load 是 driver？** 不能。两个独立维度可能不相交；只可并列陈述各自变化。
- **最大的 Circuit 是否应先调查？** 只能说它是 current usage 的最大 component Circuit。若没有异常、变化或规则证据，不能把“大”升级为“有问题”。
- **是否要增加新的 Sankey、donut 或 stacked chart？** 当前不需要。现有 bars/list 已能表达 share 与 delta；先修语义和结论，人工验收后再判断图形是否不足。
- **客户端是否产生新的官方 Signal？** 否。任何新增摘要都只能是当前图内对 server rows 的展示级排序，不进入 AI Artifact、Decision Priority 或跨模块复用；若未来需要这些用途，上移服务端 Structured Signal Adapter。

### 16.3 自动化验收

1. Golden 分别显示 largest current Level/Category 与 largest same-direction Level/Category movement，名称、share、change 和单位来自同一行；
2. Level 与 Category 文案保持独立，不出现未经证明的交集或 cause；
3. Circuit 明确标注 `ranked by current usage` 和 `not an anomaly ranking`；局部 Level/Category filter 与 Top 5/All 行为不变；
4. missing comparison 只关闭 movement，不隐藏有效 current facts；missing Circuit/Accounting 保持现有局部 fail-closed；
5. 聚焦 Renderer tests、root typecheck/build、`git diff --check` 通过。

### 16.4 停止条件

- 需要在 React 重新计算服务端 comparison、anomaly 或 accounting；
- 需要把独立 Level/Category 行拼成未经证明的交集；
- 需要用 absolute usage 冒充异常、变化原因或节能潜力；
- 需要新增共享 Analytics/Signal/Chart 平台才能完成。

### 16.5 执行结果（2026-08-10）

- Level 与 Category 各自增加 `Current concentration` 和 `Largest measured movement` 摘要；摘要只对同一组服务端 rows 做展示级选择，名称、用量、占比和变化保持同一行来源，不生成 Level × Category 交集；
- comparison 缺失时，当前用量、占比、Circuit Top 5 与既有 filter 继续展示；Level、Category 和 Circuit 的 movement 分别局部标记 Unavailable，不再关闭整个 contributor 模块；
- comparison 对象存在但前期基线为零、`changePct=null` 时，也不把 current usage 写成有效 movement；current concentration 保留，movement 局部 Unavailable；
- Circuit 文案已明确为 `Ranked by current usage only. This is not an anomaly, priority or savings ranking.`，不再把 absolute usage 写成调查优先级；
- 未新增 SQL、Projection、服务端公式、Structured Signal、AI Artifact 或共享平台；展示级摘要没有进入 Decision Priority；
- ViewModel 测试 `150/150`、Renderer/interaction 测试 `59/59` 通过；零基线回归明确保留当前 contributor、只隐藏无法定义的百分比 movement。根 TypeScript typecheck、根 build 与 `git diff --check` 通过；真实 Chrome 1440/1920、视觉密度和 Charles 人工验收仍待完成。

## 17. NAP-A4 执行切片：Action → Why → Verify 决策闭环（2026-08-10）

### 17.1 开发前现状检查

当前正式链路已经具备这一切片的大部分事实能力，不应重复建设：

- 服务端 `decisionPriorities` 已把同一 Snapshot 的 daily exception、1d/7d/28d Horizon、最大支持 Scope、影响量、下一步检查和验证 Metric 组织为一个权威主题；
- ViewModel 会校验 Snapshot、Release、Rule、rank、Evidence、Action target 和 Verification metric，合同失配时 fail closed；
- Renderer 已有一句话结论、Why、Where、Next check、Verify 与折叠 Evidence，但漏显 ViewModel 已接收的正式 Action，且三时间尺度详情占据主卡较多空间；
- 当前 Golden 只有一条可证明的主题，因此显示 1 张卡是正确结果。`2–4` 是上限，不是必须填满的配额。

### 17.2 自我 Grilling 与决定

**Q1：为了对齐原型，是否应固定生成 2–4 张行动卡？**

不应。当前权威事实只支持一条合并后的 recurring daily-exception 主题。拆成多张卡会把同一问题重复三遍，或要求浏览器创造新的优先级。

**Q2：是否应复制原型里的 saving、owner 和 Add to Action Log？**

不应。当前 Evidence 没有节省量、责任人或已接入的 Action workflow。MVP 只显示可执行的 `next check` 和 `verification metric`；这些字段有正式事实或工作流之前继续隐藏。

**Q3：是否应由确定性代码解释根因和“不做的后果”？**

不应。确定性层只说明观测事实、影响量、可定位的 Scope/Circuit 和验证方法；根因、管理意义与后果属于 AI interpretation，但必须标为假设或建议并引用同一 Snapshot Evidence。

**Q4：现有 A4 是否需要立即改代码？**

先不假定需要。先做浏览器阅读路径、降级态和重复信息复核；若当前卡已能让用户在 30 秒内回答“发生了什么、先查哪里、怎么验证”，则把 A4 记录为复用既有能力的工程验收，不为制造提交而重写组件。

### 17.3 验收

- 只显示 Runtime/服务端接受的优先主题，不由前端补卡或重排事实；
- 每张卡必须同时回答 What、Why it matters、Where/Next check 和 Verify；
- 1d/7d/28d 使用同 Snapshot、统一 cutoff，缺失 Horizon 单独显示 Unavailable；
- 技术 Evidence、Rule、Snapshot id 和限制默认折叠，不占主要阅读路径；
- Explorer 跳转保留 Project、Scope、Period、Snapshot 和 Release；
- 不显示无 Evidence 的 saving、ROI、owner、承诺或已完成动作；
- `empty / partial / suppressed / unavailable` 不生成假行动卡。

### 17.4 停止条件

- 需要新增 Kernel、Action Log、节省计算或第二套 AI Run 才能完成；
- 为了卡片数量拆分同一主题或重复日、周、28 日结论；
- 需要让前端重新计算影响、排序或验证阈值；
- 把调查建议写成已证实根因、节省承诺或合规结论。

### 17.5 执行结果

- 未新建 A4 Renderer；直接在现有 Decision Priority 卡补显服务端已有的 `item.action`；
- 主路径固定为 `Takeaway → Evidence → Why → Recommended action → Where → Next check → Verify`；
- 1d/7d/28d 完整比较移入原生 `details`，保留全部数据、aria label 和 Unavailable 状态；
- 当前 Golden 仍只渲染一张真实卡；empty、suppressed、unavailable 和非法合同均不生成 Action；
- 未增加 saving、ROI、owner、Action Log、expected/if-ignored、根因或第二套计算；
- ViewModel + Renderer 共 `210/210`，root typecheck/build 与 `git diff --check` 通过；精确 1440/1920 和 Charles 人工验收仍单独待验收。

## 18. NAP-A4.1 首屏数字与普通语言小修复（2026-08-10）

### 18.1 触发证据

真实 1280px Saved 页面显示 `4904.87 kWh`、`S$1569.56` 和 `Primary Period daily average`。数值正确，但缺少千位分隔，说明文字偏内部实现语言，降低老板或 FM 的扫读速度。

### 18.2 自我 Grilling 与边界

**Q1：格式化会不会改变权威数字或 Evidence？**

不会。本切片只改变首屏字符串格式；原始数值、精确 Evidence、比较公式、Snapshot 与 Release 均保持不变。客户显示使用 `en-SG` 千位分隔和最多两位小数。

**Q2：是否趁机统一重写全页所有数值和字号？**

不做。全页机械替换会扩大回归面，也会碰到图表 axis、aria label、Evidence precision 和 UI/UX Agent 的职责。本切片只处理 Executive Summary 的总量、日均、峰值、比较详情和 Cost，以及两条明显技术化的小字。

**Q3：是否应隐藏单位或 active tariff 说明？**

不应。单位和 Tariff 是理解结果所必需；只把 `Official usage for this Project and Scope` 改为 `Total electricity used in the selected scope`，把 `Primary Period daily average` 改为 `Average electricity used per day in this Overview window`。

### 18.3 验收与停止条件

- Golden 首屏显示 `4,904.87 kWh`、`175.17 kWh/day`、`22.5 kW`、`S$1,569.56`；
- comparison detail 同样使用千位分隔；
- 精确 Evidence 仍保留原精度，不因首屏格式化改变；
- 不修改 UI 色系、字号系统、共享 Renderer、SQL、Tariff 或 Snapshot；
- 若改动要求全局格式化迁移或破坏既有 Evidence 文本，立即停止并改为独立后续 Ticket。

### 18.4 执行结果

- 首屏 customer-facing 总量、日均、峰值、比较详情和 Cost 使用独立的 `en-SG` 展示 formatter；Evidence exact fields 和其他模块继续使用原合同精度；
- Golden 显示由 `1531.17` 改为 `1,531.17`，真实 Saved Snapshot 对应为 `4,904.87 kWh` 和 `S$1,569.56`；
- 两条技术化小字已改为 `Total electricity used in the selected scope` 与 `Average electricity used per day in this Overview window`；
- 没有修改 SQL、Tariff、Snapshot、共享 Renderer、样式系统或 UI/UX Agent 的色彩/字号职责；
- ViewModel + Renderer 共 `210/210`，root typecheck/build 与 `git diff --check` 通过。

### 18.5 Web 生产构建预检修复

`next build` 在 Day Profile unavailable 分支发现 TypeScript 收窄缺口：复合条件的 else 同时包含 `profile.status === unavailable` 与 `summary.status === unavailable`，因此不能无条件读取 `summary.reason`。运行时已有 Public Holiday unavailable 回归，但生产构建会被阻断。

最小修复只把说明选择显式化：优先使用 `summary.reason`，否则使用 profile 已有的 `reason`，再以通用 unavailable 文字兜底。不得改变 Day Profile 状态、值、Calendar 判断、图表或 ViewModel 合同；现有 Public Holiday 测试必须保持通过。

第二次构建暴露的是一个既有架构漂移，而不是两个文本字段的简单漏传：真实 Provider 已由 API 端 `preschool-overview-ai-workflow` 单独负责，Web 端仍残留一套只被测试使用的旧 `resolvePreschoolAiWorkflowEventStreams`。旧流程允许 Editor 重写完整 Finding，当前权威 v13 则由 Investigator 提交完整候选、Editor 只做选择、Runtime 生成 canonical Artifact。继续给旧流程补字段会形成第二套不一致的 AI 合同。

最小、安全处理：

- 删除 Web 端已无生产调用者的旧两阶段 EventStream materializer 及其专属 parser；
- Web 单航班、恢复、重试测试改用明确的 v13 Artifact fixture，不再通过旧 Provider parser 伪造服务端结果；
- 保留服务端权威 workflow、Runtime validation、Artifact selector 和页面 UI 不变；
- 构建、Web AI focused tests、API workflow tests必须继续通过。

停止项：不把服务端 workflow 复制回浏览器；不为旧 helper 伪造 `action / expectedIfAct / ifIgnored / uncertainty`；不改变真实 Provider Prompt 或用户页面行为。

结果：旧 Web materializer/parser 及其专属测试已移除；Web 单航班、共享恢复与重试测试改为显式 v13 Artifact fixture。Web focused tests `137/137`、API 权威 workflow `28/28`、root typecheck 与 `next build` 均通过。

## 19. NAP-N5 执行切片：Category 24h 与 Level→Circuit 小时热图（2026-08-13）

### 19.1 客户问题与三层边界

参考模板的 Day Profile 不只需要官方 Scope 总量线，还需要回答：**一天内不同 Category 在什么时间发生，以及选中一个 Level 后，哪些 component Circuit 在哪些小时贡献较高？**

这不是第二套数据底座：

- 共享层继续使用 Published Release、Mapping、canonical interval facts、Scoped Data Source、DuckDB 只读查询、Snapshot/Evidence 与 `energy.total_usage_kwh@1`；
- Ngee Ann 项目分析包新增 `component_hourly_profiles_v1` Projection，定义该案例需要的 common-complete-day、Category 和 Circuit 组织口径；
- ViewModel/Renderer 只校验、格式化和呈现服务器 Projection，不从 period ranking、official total 或浏览器端公式猜小时值。

### 19.2 开发前反证与停止项

1. **能否把 Period Circuit 占比乘到 24h 总量上？** 不能。Period 占比不证明每小时构成，必须读取同一批 component interval facts。
2. **缺一个 Circuit/小时能否按零处理？** 不能。某日期只有在该 Scope 的全部 published component Circuits 均有 24 个质量合格小时后，才能进入共同完整日样本；否则该日期不参与平均。
3. **Category stack 能否冒充 official total？** 不能。它明确标为 `published_component_circuits`；official Scope 总量仍是独立线和独立 Evidence，两者不强行闭合。
4. **是否需要新建共享图表 DSL 或通用 Metric 平台？** 不需要。本切片只增加一个 Ngee Ann 项目专属 Projection 和两个已有 Renderer 模块的薄适配。
5. **性能是否线性增加串行等待？** 新查询使确定性查询数由 11 增至 12，但与既有 daily component Category 查询并行，不增加串行批次；不重复执行 Snapshot SHA 完整性计算。

### 19.3 实现结果

- API 新增 `componentHourlyProfiles`：Project、Level 7、Level 6；Weekday、Weekend 和显式 unavailable 的 Public Holiday；每个可用 profile 同时发布 Category×24h 与 Circuit×24h；
- 只纳入 Published Mapping 中 `componentMeterNodeIds` 对应的 14 条 component Circuits；official totals、standalone rows 和 Derived meter 不混入；
- Day Profile 在官方 Scope energy line 下叠加同样本的 component Category areas；样本天数不一致时，Category stack 局部 unavailable，官方 profile 仍可显示；
- Heatmap 的第二视图改为 `Level → Circuit`；Level 与 Date 视图使用独立本地选择状态，来回切换不会互相污染；
- ViewModel 校验 Snapshot Evidence、query id、accounting basis、Scope spine、Circuit identity、Category/Circuit 24 小时完整性及逐小时 reconciliation；合同不合法时只关闭 component stack/Circuit rows，Date×Hour 和 official Day Profile 保持可用；
- 新增独立 component Evidence disclosure；Web 不重新计算正式 Metric、Category、Circuit identity 或缺失值。

### 19.4 红测与验证证据

先加入公开 ViewModel 红测：Golden 缺少 `componentStack`/`circuitProfiles`，以及 Category 行少一个小时仍未 fail closed；实现前两项均按预期失败。Renderer 红测要求出现 `Published component Category shape`、`Level → Circuit` 和真实 Circuit 名称，并移除旧的“Snapshot 不发布 Circuit-by-hour”说明。

已通过：

- `npx vitest run apps/api/src/energy/energy-analysis.test.ts -t "repeats the selected Ngee Ann golden period|withholds component Category period totals|fails component hourly Profiles" --maxWorkers=1`：`3/3`；
- `npx vitest run apps/web/src/app/energyiq/_components/ngee-ann-overview-view-model.test.ts --maxWorkers=1`：`159/159`；
- `npx vitest run apps/web/src/app/energyiq/_components/ngee-ann-overview-renderer.test.tsx --maxWorkers=1`：`68/68`；
- `npm run build`：通过；
- `npm --workspace @datafoundry/web run build`：通过，17 个 Next.js routes；
- `git diff --check`：通过。

完整 `energy-analysis.test.ts` 单文件在 184 秒本地命令上限内未返回结果，因此不能把它记为完整通过；上述三个本切片 API Golden/fail-closed 用例单独在 49 秒内通过。

### 19.5 尚未完成的验收

- 在真实 Ngee Ann Snapshot 上完成 1440、1920、tablet Chrome 截图，检查 stack 可读性、Circuit 行密度、横向滚动与 hover/focus；
- 人工确认参考图中 Category 颜色、Level 切换和 Circuit 热图的信息层级是否达到 Charles 验收；
- 若真实数据因 component quality 导致 common complete-day 样本不足，应显示 Unavailable/样本数，不回退到浏览器估算。

### 19.6 权威线集成与实时链路验收（2026-08-13）

实现提交已快进推送到远程权威开发线 `origin/codex/t35-presentation-clean`，当前提交为 `e981f4e`。由于本地 Integration worktree 存在其他 Agent 的大量未提交 WIP，本次没有在该脏工作树内执行 merge、reset、clean 或覆盖文件；远程引用从独立干净 worktree 安全快进。

使用当前提交重建并启动独立 API/Web 后，完成了直接 API 与浏览器同源代理两条真实数据链路验收：

- Web：`127.0.0.1:3000`；API：`127.0.0.1:8788`；Web 通过 `API_PROXY_TARGET` 同源代理到该 API；既有 `8787` 进程未停止、未覆盖；
- Metadata/Auth 与 fact DuckDB 均显式指向权威 Integration storage；`STORAGE_ROOT_DIR` 只决定 Metadata 根目录，事实库必须另设 `ENERGYIQ_DUCKDB_PATH`，否则会正确返回 `ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE`；
- 直接 API 与 `3000 → 8788` 同源代理均返回 `ready`，固定 `dataSnapshotId=energy-snapshot-03499dcda183ae28c47f7d66`、`projectReleaseId=ngee-ann-polytechnic-template-v6`；
- `componentHourlyProfiles` 使用 `queryId=component_hourly_profiles_v1`、`accountingBasis=published_component_circuits`；发布 3 个 Scope、6 个可用 Weekday/Weekend profiles；
- Project 的 Weekday/Weekend 样本分别为 20/8 个完整日，均包含 2 个 Category、14 个 Circuit；Level 7、Level 6 也分别发布 Weekday/Weekend；所有可用 Category/Circuit series 均为完整 24 小时；
- 登录、Workspace `default`、Overview 查询和返回合同均通过真实 HTTP；没有使用 mock Artifact 或浏览器端补算。

本次浏览器自动化受到 Codex 内置浏览器对 localhost URL 的安全策略阻止，不能据此生成或声称 Chrome 截图通过，也没有换用其他 CDP/浏览器绕过。服务保留在 `3000`，待人工刷新后完成 1440、1920、tablet 与 Charles 视觉验收；该项仍是产品验收，不是数据/API 阻塞。
