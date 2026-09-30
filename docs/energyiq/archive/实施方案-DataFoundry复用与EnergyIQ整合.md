---
title: "Data Foundry 复用与 EnergyIQ 整合实施方案"
summary: "复用 Data Foundry 的账户、问数工作台和技术配置能力，新增 EnergyIQ 的 Workspace、项目配置、能源查询上下文和确定性分析闭环。"
doc_type: decision
tags: [DataFoundry复用, EnergyQueryContext, 账户, 管理后台, 实施顺序]
updated_at: "2026-08-01"
related:
  - "../decisions/阶段技术选型-基于DataFoundry二次开发.md"
  - "../decisions/决策-双角色与管理后台.md"
  - "../plans/流程-项目配置与模板发布.md"
  - "../decisions/决策-Preschool-Portfolio数据集接入.md"
status: superseded
---

# Data Foundry 复用与 EnergyIQ 整合实施方案

> **历史实施记录。** “继续在 DataFoundry 内二次开发、不建第二套账户和问数前端”仍然有效；本文的旧层级映射、阶段顺序和实现状态已由[当前共识](../decisions/当前共识与新会话入口.md)与[新开发计划](../plans/开发计划-Admin与模板运行闭环.md)替代。后半部分只代表 2026-07-31 的实现快照。

> 2026-07-31 已确认。本文是后续二次开发与验收的基准，不再把 EnergyIQ 拆成独立于 Data Foundry 的第二套应用。

## 1. 结论

继续在 `energyiq-datafoundry` 上开发，但不把 EnergyIQ 做成 Data Foundry 之外的第二套应用。

- **直接复用**：登录与 Session、AI 对话、会话历史、文件、知识库、数据源、模型与工具配置、Task Console、Evidence、Trace。
- **EnergyIQ 新增**：客户 Workspace、Project 与动态层级、Meter Mapping、能源事实层、Energy Query Context、结构化模板、项目配置与发布后台。
- **客户界面**：默认英文，主导航为 Overview、Project Explorer、AI Analyst、Data Map。
- **管理员界面**：复用 Data Foundry 技术配置能力，并增加 EnergyIQ 项目交付配置。
- **不做**：第二套账户、第二套聊天前端、iframe、客户可见的复杂技术配置、首期复杂 RBAC。

## 2. 为什么不另造一套

当前 Data Foundry 已经具备真实实现：

- 密码注册、登录、邮箱验证、重置密码、Session 和认证审计；
- Chat、Session、文件、Artifact、Task Console、Evidence 和 Trace；
- Datasource、Knowledge Base、LLM、MCP、Skill 的配置与运行能力；
- `user_id`、`workspace_id` 数据范围字段。

缺口不是“有没有账户或知识库”，而是当前账户默认创建个人 Workspace，尚未形成 EnergyIQ 所需的客户 Workspace、Project 授权与能源数据范围。

因此选择：

```text
Data Foundry Platform
├── Identity & Session
├── AI Analysis Workbench
├── Data / Knowledge / Model / Tool Configuration
└── Audit & Evidence
        +
EnergyIQ Domain
├── Customer Workspace & Project Access
├── Project Hierarchy & Meter Mapping
├── Energy Fact & Deterministic Metrics
├── Energy Query Context
└── Template Run / Preview / Publish
```

## 3. 英文界面策略

### 当前决定

- 客户界面和管理后台均以英文为默认语言；
- EnergyIQ 可见文案、空状态、错误提示和数据标签不得混入中文；
- 保留现有 Locale 基础，为以后增加中文或其他语言留接口；
- 首期不做语言切换器，避免增加翻译维护和验收面。

### 英文主导航

客户：

```text
Overview | Project Explorer | AI Analyst | Data Map
```

管理员：

```text
Projects | Accounts | Data & Quality | Templates | Technical Settings | Audit
```

### 规范路由

| 入口 | 规范路由 | 说明 |
| --- | --- | --- |
| Overview | `/energyiq/overview` | 已发布的项目专属决策模板 |
| Project Explorer | `/energyiq/explorer` | 层级、计量点、横纵向对比与下钻 |
| AI Analyst | `/energyiq/ai` | 复用 Data Foundry 问数工作台 |
| Data Map | `/energyiq/data-map` | 客户只读的业务语义图 |

旧路由 `/energyiq/analysis` 和 `/energyiq/ask` 只用于兼容历史链接，分别重定向到规范路由。`/data-tasks` 暂时保留为内部技术入口，等 `admin` 服务端权限门槛完成后再迁移到 `/energyiq/admin/technical-settings`。

## 4. Data Foundry 功能如何接入

“接入全部能力”不等于把全部技术按钮展示给客户。能力归属如下：

| Data Foundry 能力 | `user` | `admin` |
| --- | --- | --- |
| AI 对话、会话、图表预览 | 使用 | 使用 |
| Task Console、Evidence、Trace | 查看 | 查看与诊断 |
| 已发布知识库 | Agent 自动使用 | 配置、上传、重建索引 |
| Workspace 文件 | 使用已授权内容 | 上传、维护 |
| Data Sources / Schema | 不配置 | 配置、测试、查看 Schema |
| Models / MCP / Skills | 不配置 | 配置、测试 |
| Run configuration | 使用项目预设 | 查看和维护 |

客户的 Energy Analysis 继续复用同一个 `DataTasksApp`。`admin` 通过专属后台进入完整配置；不复制组件，不使用 iframe。

## 5. Knowledge、Assets 与 Data Map 的边界

### Knowledge Base

Data Foundry 的 Knowledge Base 不是只有向量数据库，而是完整的：

```text
Document → Parse → Chunk → Full-text / Vector index → Retrieval → Citation
```

MVP 使用三种作用域：

1. `platform`：新加坡能源政策、通用方法、产品说明；
2. `workspace`：客户公司内部说明与共同知识；
3. `project`：项目设备说明、营业规则、现场记录和报告解释。

面积、人数、费率、层级、计量点映射、虚拟表公式等确定性配置不得放进 Knowledge Base。数值回答只能以 Energy Fact 与可追溯 SQL 为准；Knowledge 只用于解释、建议和引用。

### My Assets

- AI Analyst 支持个人临时上传，归入 `My Assets`；
- 默认仅上传者可见，不自动成为 Project Data 或 Project Knowledge；
- 管理员执行 Promote 后，才能进入正式项目数据或知识库；
- MVP 不做复杂的个人资产管理，仅保留上传、引用、查看和删除。

### Data Map / Data Link

Data Map 复用 Data Foundry 的 Data Link 图、探索器和详情面板，但 EnergyIQ 的可信语义来源分两层：

1. **Local Energy Semantic Graph**：Project 层级、Meter Mapping、总表/分表/虚拟表关系、`load` / `aircon` / `light` 分类，由管理员确认，是权威关系；
2. **External DataLink**：从技术表、列和语义服务得到的关联，只作为 `verified` 或 `inferred` 关系，不得覆盖本地权威关系。

客户可查看和探索 Data Map，但不能新增表、删除表、重建图或配置 MCP。管理员可查看正文和技术详情，并负责确认 AI 推断的新关系。

## 6. 统一账户与 Workspace

### 选择

改造 Data Foundry 现有账户系统作为 EnergyIQ 的唯一账户系统，不再新增一套登录。

### MVP 权限

- `user`：FM 与 Boss，共用相同权限；查看获授权的 Workspace/Project，运行报告、下钻、问数。
- `admin`：我方与首期涂鸦实施人员；管理账户、Workspace、Project、数据配置和模板发布。

### 必须改造的地方

当前登录后会解析到个人 Workspace。需要改为：

```text
User
  → Workspace Membership
  → Allowed Projects
  → Allowed Project Scope
```

规则：

1. 一个客户物业对应一个 Workspace；
2. 一个 Workspace 可以包含多个 Project；
3. 一个用户首期默认看到该 Workspace 内全部已发布 Project；
4. 所有后端查询根据登录身份重新解析 Workspace 与 Project，不相信前端传入的 ID；
5. 保留 Membership 接口，未来再扩展“部分 Project 可见”和 `partner_admin`，首期不实现。

### 已确认的账户开通流程

```text
Admin 创建 Organisation
→ Admin 邀请 User 并选择一个或多个 Organisation
→ User 打开 7 天有效邀请链接
→ 设置姓名和至少 8 位密码
→ 自动登录
→ Organisation selector
→ 仅加载该 Organisation 的 published Projects
```

公开注册关闭；邮箱作为 MVP 唯一登录标识。个人 Workspace 继续承载 My Assets，但不会出现在客户 Organisation 选择器中。停用 Organisation 时 user 立即失去访问，admin 仍可进入排查和修复。

## 7. 两个项目案例的首期映射

### Ngee Ann Polytechnic

```text
Project: Ngee Ann Polytechnic
└── Block: Block Test
    ├── Level: Level 6
    │   ├── Total Office Light
    │   ├── Total Office Load
    │   └── Sub-circuit meters
    └── Level: Level 7
        ├── Total Office Light
        ├── Total Office Load
        └── Sub-circuit meters
```

- 总表可以直接挂在 Level；
- 小回路继续挂在同一 Level 或更细节点；
- 通过 meter role 区分 `total`、`submeter`、`virtual`，避免总分表重复相加；
- 业务分类统一映射为 `load`、`aircon`、`light`。

### Preschool Portfolio

```text
Project: Preschool Portfolio
└── Centre: A ... AD
    └── Meter / Circuit
```

- Charles 数据中的 Aircon 映射为 `aircon`；
- Lighting 映射为 `light`；
- Plugload 与 Heater 首期归入 `load`，保留原始设备标签用于下钻；
- 当前报告的营业时间为新加坡时区工作日 `07:00–19:00`；
- 当前电价采用数据集已有的 May 2026 费率版本，报告中必须显示费率、生效时间和是否含 GST。

## 8. 暂定业务元数据

在甲方补齐真实资料前，所有值都标记为 `provisional`，不能伪装成已确认数据。

| 配置 | 首期默认 |
| --- | --- |
| 时区 | `Asia/Singapore` |
| 节假日 | Singapore public holiday calendar，按年份版本化 |
| Preschool 营业时间 | 周一至周五 `07:00–19:00` |
| Ngee Ann 营业时间 | 暂用周一至周五 `08:00–18:00`，待确认 |
| 电价 | 按 Project 配置费率及生效时间；Preschool 演示沿用数据集费率 |
| 面积、人数 | 支持按节点填写并带生效时间；缺失时隐藏对应指标 |
| 业务分类 | `load`、`aircon`、`light` |

面积、人数、营业时间、费率都必须带 `effective_from` / `effective_to`，否则历史复跑会使用错误口径。

## 9. 简化异常规则

首期不使用机器学习，只做可解释、可配置的确定性规则。每条异常都必须带时间、范围、实际值、基线、偏差和数据来源。

1. **用电量异常**
   - 同一 Scope、相同星期类型、相同时间段与自身历史均值比较；
   - 默认高于基线 20% 为 warning，高于 50% 为 high；
   - 增加最小绝对用电差，避免小数值产生夸张百分比。
2. **非营业时间用电**
   - 营业时间外、周末或新加坡公共假期出现持续负荷；
   - 优先指出影响最大的 Scope 和 `load` / `aircon` / `light` 分类。
3. **人均异常**
   - 仅在人数及其生效时间有效时计算 `kWh/person`；
   - 优先与该 Scope 自身历史比较，再提供同类型节点横向比较。
4. **单位面积异常**
   - 仅在面积及其生效时间有效时计算 `kWh/m²`；
   - 优先与自身历史比较，再提供同类型节点横向比较。

异常只表达“发现了什么”和“建议核查什么”，不在缺少设备状态、门禁或现场反馈时声称已经确认根因。

## 10. Energy Query Context

当前前端已经可以传 Project、Scope、Resource 和 Period，但这只是显示上下文，不是可信查询范围。下一步增加后端解析后的 `EnergyQueryContext`：

```ts
type EnergyQueryContext = {
  userId: string;
  workspaceId: string;
  projectId: string;
  scopeId: string;
  resource: "electricity" | "water";
  timezone: "Asia/Singapore";
  from: string;
  to: string;
  hierarchyRevisionId: string;
  meterFormulaRevisionId: string;
  dataSnapshotId: string;
  metricVersion: string;
  businessCalendarVersion: string;
  tariffScheduleVersion?: string;
};
```

查询链：

```text
Overview / Explorer
→ 传递用户当前选择
→ 后端按身份解析并校验 EnergyQueryContext
→ Agent 只获得该 Context 允许的 Energy Fact 数据源
→ read-only SQL
→ answer / chart / Evidence / Trace
→ 保存实际使用的 Context 与 SQL
```

这个 Module 的 Interface 应保持很小：

```ts
resolveEnergyQueryContext(input): EnergyQueryContext
executeEnergyQuery(context, querySpec): EnergyQueryResult
```

权限、层级、时区、指标版本和虚拟表计算隐藏在实现中，不分散到页面和 Prompt。

## 11. 管理后台

后台分为两组，保持同一套英文视觉风格。

### EnergyIQ Project Setup

1. `Accounts & Access`
2. `Project Profile`
3. `Hierarchy & Meter Mapping`
4. `Business Calendar & Tariff`
5. `Data Sync & Quality`
6. `Metrics & Anomaly Rules`
7. `Template Preview & Publish`
8. `Runs & Audit`

### Data Foundry Technical Settings

直接复用：

- Data Sources；
- Knowledge Bases；
- Workspace Files；
- Models；
- MCP / Skills；
- Connection tests、Schema explorer、index status。

两组后台共用账户、Workspace 和审计，不建立两套配置数据库。

这里的“二次开发”是：保留 Data Foundry 已有技术配置页与运行能力，在相同代码和账户体系内增加 EnergyIQ 项目配置，不重做同类页面。

### 审计与调试可见性

- `user` 只能查看自己的对话、Task Console、Evidence 和 Trace；
- `admin` MVP 可查看所有 Workspace 的完整对话正文和运行记录，用于数据准确性排查；
- 每次管理员查看客户对话都写入审计日志；
- 登录与隐私说明中明确告知该调试可见性；
- 后续再按需要缩小到指定支持人员或临时授权。

## 12. 推荐实施顺序

| 阶段 | 交付 | 验收点 |
| --- | --- | --- |
| 1. 统一入口与英文界面 | EnergyIQ 品牌、英文 Shell、规范路由、唯一登录入口 | 客户界面默认英文；旧 EnergyIQ 路由兼容跳转 |
| 2. 账户与 Workspace | 改造现有 Auth，增加 `user/admin` 和 Project 授权 | 不能通过改 URL 越权访问其他 Workspace/Project |
| 3. 管理后台骨架 | 复用 Technical Settings，新增 Project Setup | admin 能进入全部配置；user 看不到配置入口 |
| 4. 两个 Project 样板 | Ngee Ann 与 Preschool 层级、表分类、营业日历、费率 | Analysis、Explorer 使用同一 Project 选择与口径 |
| 5. Energy Query Context | 后端解析、查询约束、会话保存和溯源 | 从 Explorer 进入对话后，范围与时间不丢失 |
| 6. Data Map | 合并本地权威语义与外部 DataLink 推断 | 客户只读；关系显示来源与可信级别 |
| 7. 确定性异常与模板复跑 | 四类简单异常、Template Revision、Analysis Run | 相同版本和 Snapshot 可复跑；SQL 与口径可追溯 |
| 8. Tuya / Excel 数据接入 | 每日同步、质量报告、失败重试 | 两种来源进入同一 Energy Fact，不出现两套计算 |

阶段 1–2 是基础，不能为了先看到页面而跳过 Workspace 校验；阶段 4–6 完成后，才算“两端真正打通”。

## 13. 首轮开发范围

第一轮只做：

1. EnergyIQ 客户界面全英文；
2. 将现有 Data Foundry 登录改为 EnergyIQ 唯一入口；
3. 建立规范路由，并保留旧 EnergyIQ 链接兼容；
4. AI Analyst 直接复用 `DataTasksApp`，不复制聊天、预览和 Task Console；
5. Data Map 直接复用 Data Link，但客户入口只读；
6. 保留 `/data-tasks` 作为过渡期内部技术入口。

第二轮建立服务端 `user/admin` 权限、Workspace Membership、Project Access 和 Admin Shell。完成这些服务端门槛后，才把 Technical Settings 正式挂到 `/energyiq/admin/*`。

### 第二轮实现记录（2026-07-31）

第二轮已落地以下可运行骨架：

1. 保留 Data Foundry 原有 `users`、个人 Workspace、Session、Knowledge、Assets 与技术配置表；
2. 新增隔离的 EnergyIQ 领域表：
   - `energyiq_user_roles`
   - `energyiq_projects`
   - `energyiq_project_nodes`
   - `energyiq_project_access`
3. `workspace.kind` 支持 `customer`，Membership 支持 `owner/member`；
4. 本地 `dev-user` 默认是 `admin`；正式环境管理员通过 `ENERGYIQ_ADMIN_EMAILS` 白名单确定；
5. 两个样板按真实客户边界拆成独立 Organisation：
   - `default / Ngee Ann FM` → `ngee-ann-polytechnic`；
   - `preschool-demo-org / Preschool Demo` → `preschool-demo`，含 30 个 Centre、270 个 Circuit 与 May 2026 小时事实；
6. 两个 Organisation 分别使用 `storage/energy/<workspace_id>/energy.duckdb`，查询文件和服务端 Workspace/Project 校验形成双重隔离；
7. Ngee Ann 的 Project、Level 6、Level 7 和当前 Explorer 电表节点已写入同一层级存储，旧 `Block Test` 包装已移除；
8. `/energyiq/admin` 的 Organisations、Users 与 Project 配置入口使用同一 Admin Shell；仅 `admin` 显示入口，API 仍负责最终权限校验；
9. 顶栏先选择 Organisation，再显示其 `published` Project；Project 选择按 Organisation 独立保存。

当前管理员页面是后台导航和真实状态骨架，不代表 Accounts、数据接入、层级编辑、模板发布已经全部开发完成。

### 已实现的 Energy Query Context

前端只提交 `projectId/scopeId/resource/period/from/to` 请求。服务端执行：

```text
authenticated user
→ resolve user/admin role
→ resolve allowed customer Workspace
→ resolve allowed Project
→ verify Scope belongs to Project
→ convert period to project timezone boundaries
→ pin hierarchy/formula/snapshot/metric/calendar/tariff versions
→ inject authoritative context into Agent context package
```

日期范围采用左闭右开 `[from, to)`，事实归属按 `interval_start` 判断：

- `Yesterday`：上一个新加坡自然日；
- `Last 7 days`：最近七个已完成的新加坡自然日；
- `Last 30 days`：最近三十个已完成的新加坡自然日；
- `Custom`：日期型结束值按用户习惯包含当日，服务端转换为次日 00:00 的排他边界。

AI Analyst 首次进入时会先解析上下文；正式 Agent Run 还会再次服务端解析，不能以浏览器解析结果代替安全校验。解析后的上下文作为高优先级、服务端可信的 Context Item 进入 Data Foundry Context Package，因此项目、范围、时间和版本固定信息可进入后续 Trace 与复跑链路。

2026-07-31 已接入 Ngee Ann 与 Preschool Energy Fact、Scope 后代 Meter/Circuit 解析、按 Project/Resource/`interval_start ∈ [from,to)` 过滤的 DuckDB 受限视图，以及 Data Gateway SQL allowlist 与现有 SQL 审计。AI 问数已经具备真实事实查询和数据库级范围约束。Preschool 默认锁定 May 2026 数据窗口；Centre A 专项验证只开放 9 个 Circuit、6,696 个小时区间和 843.0985 kWh。尚未完成的是给 Overview/Explorer 使用的确定性 `executeEnergyQuery(context, querySpec)` 接口，以及 Template Revision / Analysis Run 的正式复跑清单持久化。

## 14. 已确认的简化约束

- 角色只有 `user` 和 `admin`；FM 与 Boss 当前权限相同；
- 所有管理员 MVP 可查看所有 Workspace；
- 一个用户可以属于多个 Workspace；
- 对话和临时图表默认个人私有，正式 Project Data 与发布报告为 Workspace 共享；
- 正式 Excel 数据仅管理员上传，个人文件只进入 My Assets；
- Tuya 每日同步使用业务 Connector，不伪装成 MCP；
- 每个 Workspace 使用一个独立 Energy DuckDB；同一 Workspace 内再通过 `project_id` 隔离多个项目；
- AI 可以理解用户在对话中修改的范围和时间，但后端必须重新解析 `EnergyQueryContext`；
- Knowledge 使用版本与归档，不直接硬删除已发布内容；
- 用户不选择模型、数据源、MCP 或 Skill，运行配置由项目预设。

## 15. 重新评估条件

出现以下情况时重新评估本方案：

- 需要企业 SSO、SCIM 或涂鸦统一身份；
- 同一 Workspace 内出现复杂的 Project/节点级权限；
- 涂鸦人员不得接触平台级模型和密钥配置；
- 知识库需要客户自行维护而不只是管理员维护；
- 项目数量或并发量要求从单机 SQLite/DuckDB 升级。
