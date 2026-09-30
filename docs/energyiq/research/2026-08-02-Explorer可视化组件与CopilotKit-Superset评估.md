# Project Explorer 可视化组件与 CopilotKit / Superset 评估

- 调研日期：2026-08-02
- 调研范围：EnergyIQ Project Explorer 的数据浏览、状态呈现、时间序列与明细表格
- 资料边界：只采用项目源码和各项目官方文档、官方 GitHub 仓库

## 一句话结论

Project Explorer 不需要引入 Superset，也不应把 CopilotKit 当作图表组件库。当前最省成本、最清晰的路线是：**继续使用项目已经安装并投入使用的 Recharts，围绕 EnergyIQ 数据契约封装自己的通用展示模块；CopilotKit 只负责把当前 Project、Scope、Meter 和 Time Range 带入 AI Analyst。**

ECharts 作为未来的升级选项：等真正出现高密度热力图、多维切片、复杂缩放或大量点位交互需求时再引入。Superset 更适合作为未来内部分析人员的自助 BI 工具，而不是客户侧 Project Explorer 的实现基础。

## 1. 本地现状

当前 `apps/web/package.json` 已直接依赖：

| 依赖 | 当前版本 | 已有用途 |
| --- | --- | --- |
| `@copilotkit/react-core` | `1.60.1` | Data Foundry AI 工作台、聊天、流式 Agent 交互 |
| `recharts` | `^3.9.0` | EnergyIQ Overview、Project Explorer、Task Console 图表 |

当前 Project Explorer 已在 `apps/web/src/app/energyiq/_components/project-explorer.tsx` 使用 `AreaChart`、`ResponsiveContainer`、`Tooltip`、`XAxis`、`YAxis` 等 Recharts 组件。仓库没有直接依赖 Apache ECharts、Superset Embedded SDK 或 TanStack Table。

这意味着，继续使用 Recharts 不增加新的运行时、主题系统或图表数据适配层；切换到其他方案则需要同时承担组件迁移、视觉统一、测试和包体积治理。

## 2. CopilotKit 到底解决什么

### 2.1 官方事实

CopilotKit 将自己定义为 agentic frontend stack，主要提供聊天界面、Generative UI、shared state、human-in-the-loop，以及前端、应用内 runtime 和 Agent 后端之间的 AG-UI 连接。[CopilotKit 官方文档：首页](https://docs.copilotkit.ai/)；[官方架构说明](https://docs.copilotkit.ai/concepts/architecture)

官方列出的现成界面是 `CopilotChat`、`CopilotSidebar`、`CopilotPopup`，也可以通过 headless API 或组件工具让 Agent 渲染业务方自己写的 React 组件。[CopilotKit React API](https://docs.copilotkit.ai/reference)；[Generative UI 说明](https://docs.copilotkit.ai/a2a/concepts/generative-ui-overview)

### 2.2 对 EnergyIQ 的推论

CopilotKit **不是**：

- 时间序列图表库；
- 电表数据网格或 Project Tree 组件；
- 日期区间选择器；
- 数据计算、语义层或 BI 查询引擎。

所以它不能替代 Project Explorer 的树、状态灯、读数摘要、趋势图和原始数据表。它适合做的是把这些页面产生的可信上下文交给 AI：

```text
projectId + releaseId + scopeId + meterId + timeRange + metric + dataSnapshotId
                                      ↓
                              AI Analyst / Task Console
```

推荐保留一个明确入口，例如 `Investigate with AI`。点击后进入完整 AI Analyst 页面，并携带当前选择范围；不要让 CopilotKit 接管 Explorer 的基础数据呈现。

### 2.3 许可与商业风险

CopilotKit GitHub 源码使用 MIT License。[官方 GitHub 仓库](https://github.com/CopilotKit/CopilotKit)；[官方 License](https://github.com/CopilotKit/CopilotKit/blob/main/LICENSE)

但 CopilotKit Intelligence Platform 的云托管、线程保留、Inspector、团队与企业能力存在单独付费方案。[官方 Pricing](https://www.copilotkit.ai/pricing)

因此，当前可继续使用已经集成的开源前端和自有后端链路；不要把 Project Explorer 的核心运行依赖绑定到其托管平台能力。

## 3. Superset 到底解决什么

### 3.1 Explore

Superset 的 Explore 是一个基于 Dataset 的无代码可视化配置器：用户选择时间列、时间范围、指标、分组、图表类型和样式，执行查询，再把图表保存到 Dashboard。它还配套 SQL Lab、Dataset/Metric 定义和 Dashboard 管理。[Superset：Creating Your First Dashboard](https://superset.apache.org/user-docs/using-superset/creating-your-first-dashboard/)；[Superset：Exploring Data](https://superset.apache.org/docs/6.0.0/using-superset/exploring-data/)

这解决的是**通用自助 BI**，而 EnergyIQ Project Explorer 解决的是**固定业务契约下的层级导航、计量点状态、读数质量与可追溯浏览**。两者看起来都有图表和时间筛选，但产品职责不同。

### 3.2 Visualization Plugin

Superset 的 visualization plugin 用于向 Superset 自身注册新的图表类型。官方流程要求按 Superset 的 plugin/preset 机制接入；对高度定制的图表，官方甚至建议维护 Superset fork 并手工加入插件。[Superset：Creating Visualization Plugins](https://superset.apache.org/docs/6.0.0/contributing/howtos/#creating-visualization-plugins)

因此，Superset 的 chart plugin 不是一个可以低成本拿进现有 Next.js 页面、直接读取 EnergyIQ DTO 的通用 React 组件包。强行复用会把 Superset 的查询表单、数据格式、构建和主题耦合带入产品前端。

### 3.3 Embedded SDK

Superset Embedded SDK 的官方边界是把一个 Superset Dashboard 以 iframe 嵌入宿主应用。它需要另行部署 Superset，启用 embedding，配置允许域名，并由后端获取 Guest Token；Guest Token 可携带 Row Level Security 规则。[Superset Embedded SDK README](https://github.com/apache/superset/blob/master/superset-embedded-sdk/README.md)；[Superset Embedding 文档](https://superset.apache.org/user-docs/6.1.0/using-superset/embedding/)

它不是把单个日期选择器、图表或 Explore 编辑器无缝变成现有 EnergyIQ React 组件。对当前 MVP，引入它会额外增加：

- 一套独立 Superset 服务和元数据库；
- Guest Token、RLS 与现有 Workspace 隔离的双重权限映射；
- iframe 主题、路由和上下文同步；
- EnergyIQ Metric、Hierarchy、Project Release 与 Superset Dataset 的双份配置。

### 3.4 对 EnergyIQ 的建议

当前不嵌入 Superset。未来如果出现“内部分析师需要自由选字段、写 SQL、临时组合图表”的明确需求，可以把 Superset作为**内部自助分析台**单独评估；客户侧 Overview、Explorer 和 AI Analyst 仍使用同一 EnergyIQ 事实层和权限边界。

Superset 仓库使用 Apache License 2.0，本身没有 DataEase 式按用户商业授权门槛；主要成本是部署、维护和二次集成，而不是开源许可证费用。[Superset 官方 License](https://github.com/apache/superset/blob/master/LICENSE.txt)

## 4. Recharts 与 ECharts 的最小选择

| 维度 | Recharts | Apache ECharts | 对当前项目的判断 |
| --- | --- | --- | --- |
| React 集成 | React 组合式组件 | 通用 JS 图表引擎，需要 React 包装或自行管理实例 | Recharts 与现有代码最贴合 |
| 当前依赖 | 已安装、已有三处以上使用 | 未安装 | 先不增加新栈 |
| 基础趋势 | Line/Area/Bar/Composed/Tooltip/Reference 等 | 同样支持 | 两者都够用 |
| 时间窗口交互 | `Brush` 可做横轴范围缩放，并可同步多个图表 | `dataZoom` 等交互更完整 | Explorer 当前 Recharts 足够 |
| 热力图/视觉映射 | 可自定义组合，但需要自己做较多呈现逻辑 | 官方提供 Cartesian Heatmap、`visualMap`、Dataset 映射 | 复杂热力图成熟后再考虑 ECharts |
| 高密度渲染 | SVG/React 组合更直观 | Canvas/SVG、渐进渲染能力更强 | 当前单项目/单 meter 浏览无需提前升级 |
| 许可 | MIT | Apache License 2.0 | 都可用于商业产品，保留许可声明 |

Recharts 官方定位是基于 React 组件的可组合图表库，并提供 `ResponsiveContainer`、`ComposedChart`、`Brush` 等能力。[Recharts 首页](https://recharts.github.io/en-US/)；[ComposedChart API](https://recharts.github.io/en-US/api/ComposedChart/)；[Brush API](https://recharts.github.io/en-US/api/Brush/)

Apache ECharts 官方提供二十多种图表、Canvas/SVG 渲染、Dataset、`visualMap` 和热力图示例，适合更高密度、多维视觉编码场景。[Apache ECharts 首页](https://echarts.apache.org/en/)；[Dataset](https://echarts.apache.org/handbook/en/concepts/dataset/)；[Visual Map](https://echarts.apache.org/handbook/en/concepts/visual-map/)；[Cartesian Heatmap 示例](https://echarts.apache.org/examples/en/editor.html?c=heatmap-cartesian)

许可来源：[Recharts MIT License](https://github.com/recharts/recharts/blob/main/LICENSE)；[Apache ECharts License](https://github.com/apache/echarts/blob/master/LICENSE)。

## 5. 表格是否需要 TanStack Table

TanStack Table 是 headless table engine，负责排序、过滤、分组、分页、列可见性等状态和计算，但不提供现成样式或 DOM。[TanStack Table 官方说明](https://tanstack.com/table/latest/docs/overview)

当前 Explorer 如果只展示几十个 meter 和选中 meter 的有限区间读数，普通语义化 `<table>` 加服务端分页就足够。只有当以下需求真实出现时再引入 TanStack Table：

- 数百至数千 meter 的组合筛选；
- 用户自定义列、固定列、排序和分组；
- 大量原始 interval 记录的分页浏览；
- 同一表格交互要在 Admin 和 Explorer 复用。

## 6. 推荐的共享展示模块

这里的“通用模块”应当是 EnergyIQ 自己的数据契约组件，而不是把通用 BI 产品嵌进来：

| 模块 | 输入 | Explorer 用途 | Overview 用途 |
| --- | --- | --- | --- |
| `AnalysisContextBar` | Project、Scope、Time Range、Resource | 选择浏览区间 | 选择分析/复跑区间 |
| `MeterHealthBadge` | status、lastSeen、reason | meter 树和详情状态 | 只在 Data Status 摘要引用 |
| `ReadingSummary` | latest、24h energy、24h avg kW、peak interval kW | 展示事实 | 可作为决策证据引用 |
| `EnergyTrendChart` | interval/daily series、unit、coverage | 读数与导出数据核查 | 历史/基线对比 |
| `DataQualityPanel` | freshness、coverage、duplicates、reset、flatline | 核查数据可信度 | 分析结论的置信条件 |
| `SourceProvenance` | source、batch、snapshot、timestamp | API/Excel 来源追溯 | Analysis Run 证据 |
| `IntervalDataTable` | timestamp、raw cumulative、delta kWh、avg kW、quality flags | 原始/处理后事实浏览 | 默认不展示 |

这些组件可以共享视觉、单位格式和空状态，但不能共享页面职责：

- Project Explorer：层级、API/Excel 返回事实、meter 健康、数据质量、趋势与来源；
- Overview：历史与同级比较、业务异常、解释、建议和行动优先级；
- AI Analyst：基于可信 Project/Scope/Time/Metric 上下文进行追问和溯源。

## 7. 精准落地建议

### 现在复用

1. 继续使用现有 `recharts`，先抽出 `EnergyTrendChart` 和统一 Tooltip/Axis/Unit formatter。
2. 复用现有 EnergyIQ Shell、Project 选择器、Hierarchy API 和 Analysis Context；不要新建第二套页面状态。
3. CopilotKit 继续只服务 AI Analyst，并接收 Explorer 当前 `projectId/scopeId/meterId/timeRange`。
4. Explorer 的表格先用现有 React/CSS；数据分页和聚合优先放在 API，而不是浏览器一次加载全部 interval。

### 暂不引入

1. 不部署或嵌入 Superset。
2. 不把 Superset visualization plugin 拆出来用于 Explorer。
3. 不为了一个趋势图引入 ECharts 与 React wrapper。
4. 不为几十条 meter 明细提前引入 TanStack Table。
5. 不让 Agent 动态生成 Explorer 的基础运维页面；基础事实必须是确定性渲染。

### 未来升级触发条件

| 触发条件 | 升级方向 |
| --- | --- |
| 需要 5×10×24 等成熟多维热力图、跨图联动和高密度缩放 | 在单独的 `EnergyHeatmap` 边界试用 Apache ECharts，不迁移所有 Recharts 图 |
| meter/interval 表格需要复杂筛选、分组、自定义列 | 引入 TanStack Table，并保持现有 EnergyIQ 样式 |
| 内部分析师需要自由选字段、SQL、自建临时 dashboard | 独立评估 Superset 内部分析台，共享事实库但不取代客户页面 |
| AI 需要从 Explorer 发起解释、诊断或生成证据卡 | 通过 CopilotKit Generative UI 渲染我们已经定义的 EnergyIQ 组件 |

## 8. 最终判断

当前问题不是缺一个更大的开源 Dashboard，而是需要先把 EnergyIQ 的数据契约和页面职责稳定下来。最小方案如下：

```text
EnergyIQ Facts/API
        │
        ├── Project Explorer ── 自有 React UI + Recharts
        │      └── 层级 / meter health / reading / quality / provenance
        │
        ├── Overview ────────── 自有结构化 Preset + Recharts
        │      └── comparison / anomaly / evidence / action
        │
        └── AI Analyst ──────── Data Foundry + CopilotKit
               └── trusted scope / tools / trace / generative evidence UI
```

这条路线既利用了 Data Foundry 和 CopilotKit 已经做好的 Agent 交互，也避免为了普通数据浏览再引入一整套 BI 平台。Superset 的产品思路可以参考，但当前不应成为实现依赖。

> 许可结论仅用于工程选型，不构成法律意见；正式发布时仍应维护第三方依赖清单、License 与 NOTICE。
