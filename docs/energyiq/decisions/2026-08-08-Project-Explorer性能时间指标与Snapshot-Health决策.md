---
title: "Project Explorer 性能、时间、指标与 Snapshot Health 决策"
summary: "将 Explorer 收窄为快速的设备与数据核查界面，默认使用 Project 统一 cutoff 前的滚动 28 天，并按节点类型展示指标、自身平均线和诚实的 Snapshot Health。"
doc_type: decision
tags: [energyiq, project-explorer, performance, data-health, ux]
updated_at: "2026-08-08"
related:
  - "../product/三类核心界面设计.md"
  - "../product/PRD-EnergyIQ-MVP.md"
  - "2026-08-08-四界面UI-UX一致性与功能保护决策.md"
status: accepted
---

# Project Explorer 性能、时间、指标与 Snapshot Health 决策

## 1. 背景

Project Explorer 的任务是帮助用户找到 Project、Scope、Circuit 和 Meter，并核查所选节点的能耗趋势、来源、覆盖率与数据质量。当前实现存在四个问题：

1. 首次进入先取层级、再执行完整 Scope Analysis，URL 补全还可能触发组件重挂载和重复分析；
2. Explorer 复用了 Overview 级完整分析，连带计算前期比较、异常、营业时段、Tariff 和大量子 Scope 时序，而页面没有使用这些结果；
3. Project/Scope 与单 Meter 使用同一组五张指标卡，导致 Latest cumulative reading、Source 和 Data health 在聚合层级占据首屏；
4. 树中没有节点状态，主区 Selected-period quality 也不足以代表设备在线状态。

2026-08-08 本地 SQL Audit 显示，一次 Preschool Project Scope Analysis 约为 4.2 秒；其中未被 Explorer 消费的计算批次各占约 1.4–1.6 秒。性能修复必须先减少无用工作和重复请求，再讨论通用缓存。

## 2. 选项

| 选项 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A：维持完整分析 | Explorer 继续执行完整 `EnergyScopeAnalysis` | 无需增加投影语义 | 首屏慢；计算大量未展示结果；相同入口可能重复运行 |
| B：Explorer 窄投影 | 复用同一权威 Kernel，但只装配 Explorer 必需字段，并消除重挂载 | 保留权威计算；减少查询和负载；边界明确 | 需要增加受测试保护的 Surface Profile |
| C：前端自行计算 | 只取原始事实，由浏览器计算 KPI、趋势和健康状态 | 服务端改动少 | 破坏服务端权威计算、Evidence 和 Snapshot 边界 |

健康状态另有三种选择：实时在线状态、完全未知、Published Snapshot 数据质量。当前 Ngee Ann 与 Preschool 没有同步频率或 heartbeat，且使用历史 Snapshot，因此不能冒充实时在线。

## 3. 决定

选择 **B：Explorer 窄投影**，并固定以下产品语义。

### 3.1 性能与加载

- 层级树、页头和时间控件优先显示；指标、趋势和 Evidence 使用局部 Loading；
- URL 补全不得通过 React `key` 令整个 Explorer 自我重挂载；
- Explorer 首屏只计算所选 Scope 汇总、日/周/月趋势、24 小时 Profile、Peak、Circuit/Meter 列表、Coverage、Selected-period quality、Provenance 和 Snapshot Health；
- 不为首屏计算 Overview 异常、Tariff、营业时段、完整前期比较、全部子 Scope 日序列或无关 Heatmap；
- Source、Import Batch、质量事件和原始 Evidence 保留，但在下方按需加载或展开；
- MVP 只允许窄范围进程内缓存，不建设通用缓存平台。

确定性结果缓存键至少包含：`Workspace + Project + Scope + Resource + Date Range + Snapshot + Project Release + Metric Revision`。权限检查发生在缓存读取前；Refresh 绕过缓存。Snapshot Health 的事实可以缓存，但不能跨 Workspace 复用。

### 3.2 默认时间

- 未指定 Period 时，默认使用 Project Official Aggregation Route 统一 cutoff 前的滚动 28 天，避免 Daily/Weekly 图只拿到一个点；
- cutoff 仍由 Project timezone 下的最新完整自然日确定；完整日需要 100% Coverage 且无阻断性 Invalid 事件；
- 所有 Scope 使用同一个 Project 日期和 Snapshot；切换节点不得各自寻找日期；
- Explorer 不提供控制整页的全局时间选择器；Daily、Weekly、Monthly 与 Typical 24h 只作为趋势模块内部视图；
- 子 Scope 在统一窗口内不完整时诚实显示 Partial/No data，不静默跳到更早窗口；
- 如果 Snapshot 无法形成 28 天窗口，则显示最近有数据的 `Latest available day`，并标记 `Partial · xx% coverage`；
- 明确 URL 或 Overview handoff 的 Period 优先于默认值，并可刷新、分享和恢复。

### 3.3 顶部指标

Project、Level、Centre 等聚合 Scope 显示：

1. Total energy；
2. Daily average；
3. Peak interval-average power 及发生时间；
4. Coverage 作为紧凑状态 Badge，不占一张大卡。

Physical Meter/Circuit 显示：

1. Period energy；
2. Average power；
3. Peak interval-average power；
4. Coverage 作为紧凑 Badge。

`Latest cumulative reading`、`Last data received`、`Source` 与详细 `Data health` 移到下方 Evidence/Data Health 区域，不占据用户首要阅读路径。Average power 必须是能耗除以实际覆盖小时数，不得用 `24h profile` 文字冒充数值。

### 3.4 趋势平均线

- 平均线只使用当前选中 Project/Scope/Circuit 自身数据，不计算“所有 Circuit 平均”；
- Daily 使用完整日的 `Selected-period average`；
- Weekly/Monthly 至少有两个完整 Bucket 才显示平均线；Partial Bucket 不参与平均；
- 24h 曲线本身是同一小时跨日平均 Profile；另用虚线显示整段时间的 `Overall average power`；
- Tooltip 显示当前点相对自身平均值的差值和百分比；
- 当前窗口平均只用于描述本周期高低点，不得命名为“正常基线”。历史工作日/周末 Baseline 延后到有足够历史时再做。

### 3.5 树状态与主区质量

树状态与时间选择器解耦：

- 树显示最新 Published Snapshot 的数据质量；
- 主区显示 Selected-period quality；
- 绿色：Snapshot 数据完整有效；
- 琥珀色：Partial、Flatline 或非关键数据需要复核；
- 红色：Invalid，或 Official Aggregation Route 的必要数据不可用；
- 灰色：Unknown；
- Virtual Meter：Derived；
- Scope 仅在 Official Aggregation Route 受严重问题影响时标红；其他子表问题只令 Scope 标黄；
- Tooltip 显示 `critical/warning` 数量、Snapshot 状态，并明确 `Connectivity unknown`。

这里的绿色不表示设备实时在线。以后只有配置预期同步频率或来源提供 heartbeat/online/offline/last_seen 后，才能增加真正的 Current Connectivity/Delayed/Stale 判断。

用户已确认正式运行的预期同步频率为每天一次：真实连续接入后，错过 1 次日同步进入 Delayed（黄），连续错过 2 次进入 Stale（红）。当前 Ngee Ann 与 Preschool 为历史 Demo Snapshot，仍按 Snapshot Health 展示并标记 `Connectivity unknown`，不使用当前墙上时间把历史 Demo 伪装成实时断连。

### 3.6 Partial 图表

- 有有效数据就继续画图，缺失点保持空缺，不补零；
- 图表和指标标记 `Partial · xx% coverage`；
- Tooltip 标明 Bucket 完整性；
- 0% Coverage 才显示空状态；
- Partial 图表不得被文案描述成完整结论。

## 4. 理由

1. Explorer 的用户任务是核查单个节点和数据来源，不需要运行完整 Overview 分析；
2. 统一 Project 日期避免切换 Scope 时日期偷偷变化；
3. 动态指标减少聚合层级的无意义技术信息，同时保留 Meter 核查能力；
4. 自身平均线可帮助用户识别所选设备的高低点，跨 Circuit 平均没有稳定业务意义；
5. Snapshot Health 为当前 Demo 提供诚实可见的质量信号，同时不伪造实时连接状态。

## 5. 后果

### 实施顺序

1. 建立重复请求与查询投影回归测试；
2. 消除 URL 自重挂载，增加 Explorer Surface Profile；
3. 实现 Project 统一 Latest complete/available day；
4. 重构动态指标与自身平均线；
5. 增加 Snapshot Health 树状态；
6. 进行 Project、Centre/Level、Circuit/Meter 三层 Chrome 验收和前后性能对比。

### 停止项

- 不建设新的通用 Query Planner、Scheduler、Health DSL 或持久化 Cache 平台；
- 不让浏览器重新计算权威 KPI；
- 不用 Selected-period quality 冒充实时 Connectivity；
- 不以固定 SQL 上限牺牲正确性；
- 不为没有足够样本的 Weekly/Monthly 图强行画平均线。

### 失效条件

出现以下任一情况应复审：

- 真实设备接入并提供 heartbeat/online/offline；
- 项目配置正式同步频率，需要 Current Health/Delayed/Stale；
- Explorer 窄投影无法复用同一 Snapshot、Metric 和 Evidence 权威层；
- 性能测量证明主要瓶颈不再是重复请求或未使用查询。

## 6. 关联

- 产品边界：[三类核心界面设计](../product/三类核心界面设计.md)
- MVP 验收：[PRD-EnergyIQ-MVP](../product/PRD-EnergyIQ-MVP.md)
- 视觉与功能保护：[四界面 UI/UX 一致性与功能保护决策](2026-08-08-四界面UI-UX一致性与功能保护决策.md)
- 当前实现：`apps/web/src/app/energyiq/_components/project-explorer.tsx`
- 权威计算：`apps/api/src/energy/energy-analysis.ts`

## 7. 2026-08-08 实施记录

已完成：

- 默认窗口最终校准为 Project 统一 cutoff 前的滚动 28 天；无可用 28 天窗口时选择最新有有效事实的日期并诚实保留 Partial；
- 移除页头全局时间选择器；Overview handoff 的显式 Period、Snapshot 与 Release pin 仍原样保留；
- 移除内部 URL `replaceState` 引起的 Scope/Period 自重挂载条件；
- 增加 Explorer 专用分析 Profile，保留 Summary、Hourly、Daily、Comparison、Operational scope 与 Evidence，跳过未使用的 Time bucket、Anomaly、Peak breakdown 和 Meter operational 展开；
- Project/Scope 与 Meter/Circuit 使用不同顶部指标；Coverage 改为紧凑 Badge，Source 与详细 Data Health 保持在下方；
- Daily/Weekly/Monthly/24h 图增加选中节点自身平均线与相对差值 Tooltip；
- Source & Data Health 移到趋势图下方独占一行；不足两个 Bucket 的 Weekly/Monthly 不再展示为误导性的单点趋势；
- 树状态显示 Published Snapshot Health，并明确 `Connectivity unknown`；每日同步的 Delayed/Stale 只记录规则，当前历史 Demo 不启用；
- 增加仅进程内、按用户/Workspace/Project/Scope/Snapshot/Release/Revision 隔离的窄缓存；不引入持久化 Cache 平台。

自动证据：

- Project Explorer 纯函数回归：14/14；
- Ngee Ann DuckDB Golden：通过，完整分析保持 10 条查询；Explorer Profile 为 7 条查询；
- 同一 Golden Payload：约 174,083 bytes 降至 29,590 bytes，减少约 83%；
- API TypeScript Build 与 Next.js Production Build：通过。

未完成证据：

- 当前 in-app Browser 会话停在登录页，因此尚未形成登录后的 Project/Level/Circuit 视觉验收截图；这不影响自动证据，但不能标记为人工浏览器验收完成。
