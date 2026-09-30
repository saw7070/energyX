---
title: "Ngee Ann 现有模板吸收方案"
summary: "确认同事原型的数据真实性，定义可直接吸收、需参数化与暂缓的模块，并落到 EnergyIQ 的项目专属模板体系。"
doc_type: decision
tags: [NgeeAnn, 结构化模板, 指标口径, 回归基准]
updated_at: "2026-08-02"
related:
  - "决策-项目专属模板与决策型分析.md"
  - "../records/2026-07-31-可信查询范围与Energy-Fact接入记录.md"
  - "../plans/流程-项目配置与模板发布.md"
status: accepted
---

# Ngee Ann 现有模板吸收方案

## 结论

同事制作的 Ngee Ann 原型可以吸收，但不应整套复制进生产系统。

最合适的用法是把它同时作为：

1. **Ngee Ann 项目的模板种子**：保留已经打磨过的分析问题与页面顺序；
2. **通用能源组件的规格来源**：把 Level、日期、费率、营业时间和分类规则改成配置；
3. **真实数据回归基准**：使用同一批 Excel 校验 Energy Fact、Metric 和 Template Run 的结果；
4. **Admin 模板预览样例**：管理员可以从该预设创建项目模板，再按项目实际情况调整并发布。

这与 Charles 的 Preschool 模板不冲突：

- **Preschool**：三层空间结构 `Block → Room → Circuit`，重点是面积、人均、待机浪费、营业时段和同类 Room 对比；
- **Ngee Ann**：两层空间结构 `Level → Circuit`，重点是 Level 横向比较、时间行为、Circuit 构成与异常下钻；
- 两者共用同一套 Metric、Rule、Evidence 和 Template Run 引擎，只使用不同的项目专属模板配置。

## 已验证事实

- `docs/Net-Zero Product/Net-Zero Product/` 中 4 份 Ngee Ann Excel，与 `data/raw_excel/` 中对应文件的 SHA-256 完全一致。
- 原型的 `scripts/generate_nap_analysis_data.py` 确实使用 pandas 读取 Excel，并执行去重、按设备排序、累计读数差分和聚合，再生成前端数据；它不是纯视觉 Mock。
- 当前周期为 2026-05-19 至 2026-06-17。原型计算总用电量为 **5,328.2 kWh**，其中 Level 6 为 **2,014.0 kWh**，Level 7 为 **3,314.2 kWh**。
- 原型使用 Aggregate Meter 计算总量、用 Sub-meter 做构成分析，从而避免总表与分表重复相加。这个口径应保留。
- 当前 EnergyIQ API 使用 Snapshot `ngee-ann-4bac1177eca62cdb` 复算得到 **5,328.2073 kWh**；Level 6 为 **2,013.9707 kWh**，Level 7 为 **3,314.2365 kWh**，质量事件为 0。正式事实层与旧原型结果一致。
- 当前 Demo Bootstrap 仍保留 `Project → Block Test → Level → Meter`。`Block Test` 只有一个节点且没有独立分析属性，不符合已确认的加层原则；正式 Ngee Ann 两层配置应展平为 `Project → Level → Circuit`。

## 原型现在是怎么做的

原型的主线不是简单展示图表，而是：

`Excel 累计读数 → 15 分钟差分 → 总表汇总 / 分表拆解 → 时间与同级比较 → 确定性异常 → 建议与证据`

页面已有五组核心内容：

1. Executive Summary；
2. Day Profile Analysis；
3. Time-based Behavioral Analysis；
4. Circuit Category Analysis；
5. Personalized Recommendations。

此外还有 Data Source、Daily Trend、Anomaly List、Level/Circuit Heatmap 等辅助模块。

## 模块取舍

| 现有内容 | 处理方式 | 在 EnergyIQ 中的落点 |
| --- | --- | --- |
| 数据范围、来源和质量说明 | 直接吸收 | Scope & Data Quality 模块 |
| 总用电、日均、峰值、历史变化 | 直接吸收 | Executive Summary；费用仅在费率已配置时显示 |
| Level 6 / Level 7 对比 | 参数化吸收 | 通用 `Tier Comparison`，展示项目配置的别名 |
| 工作日、周末、节假日 24 小时曲线 | 直接吸收 | Day Profile 模块 |
| 每日趋势和确定性异常 | 参数化吸收 | 自身历史同类日期基线 + 可配置阈值 |
| Light / Load / Fan 构成 | 参数化吸收 | `light/load/aircon/other` 业务分类注册表 |
| Circuit 排名、热力图和下钻 | 直接吸收 | Tier 模板中的 Child Ranking / Time Heatmap |
| 建议与证据 | 重写后吸收 | Rule 输出 Fact、Baseline、Impact、Possible Cause、Action、Evidence |
| 固定 08:00–18:00 营业时段 | 不直接吸收 | 改为 Project Operating Schedule；可带新加坡默认值 |
| 固定费率和费用节省 | 不直接吸收 | 改为 Project Tariff；未确认时隐藏费用结论 |
| 写死的设备名、日期和推荐文案 | 不吸收 | 由 Scope、Metric 和 Rule 的运行结果生成 |
| Forecast | 暂缓 | 至少具备 3 个月完整历史并完成回测后再发布 |
| Bell Curve | Ngee Ann 暂缓 | 两个 Level 样本不足；可用于具有较多可比 Room 的 Preschool |

## 推荐的 Ngee Ann 模板

### Project 模板

1. **Action Summary**：先展示最值得处理的 1–3 件事、影响范围和优先级；
2. **Data Status & Scope**：Project/Scope、时间段、15 分钟频率、数据新鲜度、完整度、来源批次与版本；
3. **Energy Overview**：总用电、日均、峰值及时间、自身历史变化；
4. **Level Comparison**：Level 6 与 Level 7 的总量及 `light/load/aircon/other` 构成；
5. **Day Profile & Heatmap**：每日趋势、工作日/周末/节假日 24 小时曲线和日期×时间热点；
6. **Exceptions & Evidence**：异常日期、异常 Level、贡献 Circuit 和可追溯证据；
7. **Recommended Actions**：按影响排序，支持跳转到对应 Scope 或 AI Analyst。

Circuit Ranking 不再单独堆成长章节：正常排名嵌入 Level Comparison，用于解释 Level 差异；异常贡献排名嵌入 Exceptions & Evidence，用于定位具体 Circuit；逐表读数和数据健康核查再跳转 Project Explorer。

### Level 模板

- 本 Level 与自身历史比较；
- 本 Level 的分类构成；
- 子 Circuit 排名与时间热力图；排名用于解释本 Level 构成，不另建独立长章节；
- 非营业时段消耗与异常；
- 对应建议和证据。

### Circuit 模板

- 时间段用电量、对父级贡献率；
- 15 分钟/小时/日趋势和典型日曲线；
- 与自身历史同类时段比较；
- 数据缺失、负差值、跳变和确定性异常；
- 设备分类、物理/虚拟表角色和来源记录。

## 如何进入现有 EnergyIQ

不复制旧原型的整个 React 页面，而是抽取下列通用组件契约：

- `ExecutiveSummaryModule`
- `TierComparisonModule`
- `DayProfileModule`
- `TimeHeatmapModule`
- `AnomalyModule`
- `ChildRankingModule`
- `RecommendationModule`

每个组件只接受统一运行上下文：

```text
project_id + scope_id + tier_id + time_range + metric_id + template_revision
```

旧原型中生成的静态 TypeScript 数据改为 Energy Query Context 的确定性查询结果；所有组件从同一个 Energy Fact、Metric Registry 和 Rule Registry 取数。这样 Overview、Project Explorer 和 AI Analyst 得到的是同一事实，不会出现三个页面三套算法。

## Admin 中的使用方式

创建项目时，管理员先配置层级和 Meter Mapping，再选择模板种子：

- `Preschool / Charles preset`
- `Ngee Ann / Level-Circuit preset`
- `Blank preset`

系统根据项目可用属性检查模块：

- 没有面积，不启用 EUI；
- 没有人数，不启用 per-pax；
- 没有营业时间，不发布 Standby Wastage；
- 没有已确认费率，不显示费用和节省金额；
- 可比节点不足，不显示 Bell Curve；
- 历史数据不足，不发布 Forecast。

管理员只需要开关模块、调整顺序、确认阈值和预览结果，不需要自由拖拽设计整张页面。

## 不能照搬的技术口径

1. 原型依靠名称字符串把电表分为 Aggregate、Lighting、Office Load、Ventilation/Fan；生产系统必须使用 Admin 已确认的 Meter Mapping。
2. 原型的异常阈值是“同类日期均值的 115%”，可作为 Ngee Ann 初始规则，但必须进入 Rule 参数，不能写死在组件中。
3. 原型用 Top 10 Circuit 平均值做部分比较，容易混合不同业务分类；生产系统优先比较自身历史，其次比较同分类节点的中位数或归一化值。
4. 原型写死新加坡节假日、营业时间和费率；生产系统放入 Project Calendar、Operating Schedule 和 Tariff 配置。
5. 原型中的部分推荐写死了设备名和日期；生产系统只能根据可追溯 Fact 和 Rule 生成，并把现场原因标为待 FM 核实的假设。
6. 原型生成脚本不能替代正式数据管线。累计读数复位、负差值、重复点、缺失点、异常跳变和虚拟表计算应继续由统一 Energy Fact 管线处理。
7. 旧原型与当前 API 使用的临时电价并不相同，且 Ngee Ann 的正式商业费率尚未确认；在 Tariff 配置确认前隐藏费用和节省金额，不把任一临时常量当成正式结论。

## 回归验收基准

同一批 Excel 在正式管线中的首次验收至少检查：

| 检查项 | 期望值或规则 |
| --- | --- |
| 当前总用电 | 约 5,328.2 kWh |
| Level 6 | 约 2,014.0 kWh |
| Level 7 | 约 3,314.2 kWh |
| 总量口径 | 只使用配置为 Aggregate/official 的总表，不与分表重复相加 |
| 时间粒度 | 累计读数先形成 15 分钟 `interval_kwh`，再向小时、日和时间段聚合 |
| 复跑 | 相同 Fact Snapshot、Metric Version、Rule Version、Template Revision 和时间范围产生相同结果 |
| 溯源 | 每个指标和建议可回到 Scope、输入文件/批次、映射、公式与规则版本 |

允许因边界读数、时区或缺失值策略产生极小差异，但必须在运行证据里说明原因，不能通过改前端常量“对齐”。

## 当前推荐决定

- 确认 Ngee Ann 为 `Level → Circuit` 两层模板种子；
- 确认 Preschool 为 `Block → Room → Circuit` 三层模板种子；
- 先实现 Ngee Ann 的 Project、Level、Circuit 三个模板视图，再用同一组件目录承接 Preschool；
- 把旧 Ngee Ann 原型保留为参考和 Golden Dataset，不作为新的并行前端长期维护；
- 第一版先完成确定性分析和复跑，Forecast、机器学习异常和自由画布继续暂缓。
