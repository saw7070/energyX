---
title: "Project 通用 Report Time Context 与 Overview 复用决策"
summary: "平台以版本化 Report Time Context 组织 Managed Overview，并统一 AI Analysis 的 exact、all-available 与 Session 恢复语义。"
doc_type: decision
tags: [Overview, ReportTimeContext, OverviewDefinition, Stage5Agent, 时间语义, 平台复用]
updated_at: "2026-08-31"
related:
  - "CONTEXT.md"
  - "决策-项目Renderer-Recipe与时间上下文.md"
  - "2026-08-06-Charles系统价值复核与连续数据演示决策.md"
status: accepted
---

# Project 通用 Report Time Context 与 Overview 复用决策

## 1. 背景

Ngee Ann 需要自然月至今、最近完整日、完整历史月、同进度比较、Holiday 和下月预测；Preschool 需要最近 28 个完整日，同时 Monthly Outlook 又必须按自然月。它们证明了两件事：

1. 所有 Project 强制一个全页日期范围会损害业务意义；
2. 每个 Project 自己写日期算法，会让 Web、Saved、AI Artifact 和 What changed 的口径持续分裂。

EnergyIQ 当前采用“定制化服务通用化”：先在真实 Project 中验证管理问题，再把稳定机制沉淀为平台能力。需要统一的是运行合同，不是每个项目的分析内容。

## 2. 选项

| 选项 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. 全平台唯一日期范围 | 一个 `from/to` 控制所有 Overview Sections | 实现简单 | 运营、月度趋势、预测和异常基线被迫使用错误窗口 |
| B. 每项目自由实现 | 每个 Renderer/Web 自己计算时间 | 定制快 | projectId 分支、历史恢复和 AI identity 无法治理 |
| C. 任意日期表达式平台 | Project 上传表达式或代码 | 表面灵活 | 形成低代码日期引擎，难验证、难迁移、难解释 |
| D. 可信锚点 + 声明式 Overview Definition | 平台解析窗口，Overview Definition 只引用已注册策略与能力 | 同时保留业务意义、可复跑和跨项目复用 | 需要一次合同迁移 |

## 3. 决定

**选择 D：平台级 `Report Time Context` + 版本化 `Overview Definition Revision`。**

Overview 顶部只有一个可信锚点：`Data through`、`Last refreshed`、Timezone 和 Data Snapshot。各 Section 可以使用不同的 named windows，但必须显示用途、精确范围和 `Complete / Partial / Forecast` 状态。

Managed Overview 以自然月 `Report Edition` 为外层组织：当前月是会随 Data through 推进的 `in_progress` Edition，历史完整月是不可变的 `complete` Edition。每天可以对同一 Template Revision 做 `Overview Materialization Refresh`，也可以为新 Snapshot 做 `Insight Refresh`；这两者都不是重新生成静态 HTML 或 Template。只有 Overview Definition、公式能力引用或页面组织改变时，才发布新的 Template Revision。

普通用户不在 Overview 任意切换日期。任意区间、粒度和比较属于 Explorer；基于可信数据域的深入问题属于 AI Analysis；历史精确结果属于 Saved Analysis；前后变化由 What changed 表达。

### AI Analysis 窗口与 Session 身份

AI Analysis 有两种入口，不能互相静默降级：

1. Overview、Finding 和 Evidence 的深入分析使用 explicit exact context。链接必须原样保留 `period=Custom`、half-open `from/to`、Data Snapshot、Project Release，以及入口已经携带的发布 revision pins，只能在原 query 上追加 Finding/Evidence；不得重建为语义窗口或全局 Last 30 days。当前 URL 的强制显式 pins 是 Data Snapshot 与 Project Release；历史 Session 另保存并校验 hierarchy、meter mapping 与 meter formula revision identity。
2. 顶栏 AI Analyst 与 New data task 使用服务端解析的 `analysisWindow=all-available`。其范围只来自当前 Scope 的 `publishedMeterRoute.attachments`：保留 Scope 内已挂接 component（`officialAggregation` 不是 inclusion filter），排除 sibling、outside-scope 和 unattached meter；只统计 `quality_status=ok` 的 facts。Fact coverage 与 analysis-eligible coverage 是不同合同。没有 eligible facts 时返回 honest unavailable，不回退 Last 30 days。

`all-available` 与 `period/from/to` 同时出现是歧义请求，必须拒绝。普通 query-context GET/resolve 不调用 Provider，也不产生运行或持久化 mutation。

Session 恢复遵守以下规则：

- New data task 创建新 Session；server-owned exact context 完成前立即 `inert`/`aria-busy`，失败后保持 unavailable，不恢复旧交互；
- 已有 Session 是历史证据面：只要原始 exact Snapshot、Release、ISO half-open boundaries 与全部 revision pins 仍可验证，就在这些不可变 pins 上继续对话，并明确显示 `Historical data through <date>`；不得静默重绑到当前数据；
- pre-migration 历史 Session 没有 `energy_context_json` 时，服务端只能从该 actor-owned Session 最新的权威 Energy ContextPackage 恢复 exact binding；后写入的通用 ContextPackage 不覆盖它，伪装或损坏的 Energy ContextPackage fail closed。客户端省略 Energy request、传入 malformed persisted binding，或与 recovered binding 不一致时，都必须在 Run/Provider 之前拒绝；
- exact context 缺失、失配或无法解析时，原消息仍可见但输入/提交禁用。用户显式选择 `Continue on current data` 时，浏览器只提交 actor-owned source Session 与当前目标 Project/Scope/resource；服务端重新解析一次当前 `all-available`，在同一事务中创建并持久化一个新的 actor-owned Session 与 exact context，旧 Session、消息、Run、Artifact 不修改。source Run/ContextPackage 可验证时持久化 `available` exact lineage；不存在时持久化 `unavailable` + 原因，不伪造 Run/range，也不因此阻止继续。即使当前 URL 的 Snapshot/Release/range 不需要变化（例如只有隐藏 revision 已更新），浏览器仍必须激活服务端创建的新 Session，不得因没有 `router.replace` 而遗留 orphan Session。新 Session 在第一条 Run 之前也必须可刷新恢复，第一条及后续 Run 只核对新 Session 的 current exact pins；
- Workspace、Project、URL 与 Session transition 在 navigation/selection 开始时就使当前 surface inert。Interaction generation 在 disable 与 re-enable 两个边沿都推进，因此旧 Session 的 late retry、HITL、cancel 或 run callback 不能在新 identity 下提交。

## 4. 平台与 Project 的责任

| 平台统一拥有 | Project 保留定制 |
| --- | --- |
| Report Time Context 解析与版本 | Section 的管理问题和业务含义 |
| 注册的时间策略目录 | 指标、事实投影与 Section Pack |
| Data Snapshot/Release/Profile/Policy identity | 图表与 Renderer placement |
| Business Calendar readiness | AI angle、Method/SOP 组合 |
| Saved/AI Artifact 精确恢复 | 项目特有的限制与解释 |
| What changed compatibility | 对平台策略的新需求输入 |
| 普通读取零 Provider | 人工价值审核 |

Project 不能提供任意日期函数。它只能发布 Overview Definition，选择平台已注册的 strategy/capability，并把自己的 Section 绑定到 window roles。

## 5. 深模块接口

公共 seam 保持小而深：

```ts
resolveReportTimeContext({
  binding,
  timezone,
  asOf,
  acceptedDataEndExclusive,
  lastRefreshedAt,
  policy
}): ReportTimeContext
```

调用方无需知道月界线、完整日、DST、历史同进度或 Forecast horizon 怎么计算。输出包含：

- exact Workspace/Project/Scope/Snapshot/Release binding；
- policy id/revision；
- `dataThroughLocalDate`；
- named windows 的 role、strategy、`from/toExclusive`、segments、phase、complete-day count；
- 用于 What changed 的 comparison compatibility key。

Overview Definition 中的 Section 只消费：

```text
Section Time Binding
→ primaryWindowId
→ supportingWindowIds[]
→ 每条 Fact/Evidence 记录实际 windowId
```

## 6. Stage 5 Agent 的单一协议

Stage 5 的任务不是编写 React 页面，而是提出“Overview 应该表达什么”。Agent 面前只保留五个概念：

1. `Overview`：页面目的和可信时间策略；
2. `Section`：一个管理问题及其顺序；
3. `Block`：引用 Catalog 中已发布的分析/展示能力；
4. `Window`：引用 Report Time Context 的命名窗口；
5. `Presentation intent`：`primary / standard / supporting` 等少量语义意图。

```ts
type OverviewDefinition = {
  contractRevision: "energyiq-overview-definition@1";
  timePolicyRevisionId: string;
  sections: Array<{
    key: string;
    title: string;
    managementQuestion: string;
    primaryWindowId: string;
    supportingWindowIds?: string[];
    blocks: Array<{
      key: string;
      capabilityRevisionId: string;
      windowId?: string;
      emphasis?: "primary" | "standard" | "supporting";
    }>;
  }>;
};
```

Agent 返回完整的期望 Definition；服务端负责 canonicalize、校验、计算语义 Diff、编译 Render Plan、生成固定 Snapshot Preview。Overview 规模有限，完整声明比一串有顺序依赖的 `add/move/update placement` Patch 更稳定，也更容易审计。

以下内容不进入 Agent 协议：`placementId`、grid span/height、renderer key、React/CSS、图表库 option、SQL、Artifact Store、Provider 生命周期。它们是编译器和运行时实现细节。

Catalog 缺少能力时，系统返回 `capability_required` Development Proposal；Stage 5 不得为了满足请求临时生成页面代码。新增能力属于独立 Coding Agent/工程发布流程，发布为 Catalog Revision 后才能被 Overview Definition 引用。

现有 `EnergyIQ Template Revision` 不再与 `Project Overview Profile` 形成两套真相源。迁移目标是：Overview Definition 成为 Template Revision 的 authoring contract；Placement/Renderer 配置成为确定性编译产物，Render Plan 继续是临时结果。

## 7. 首批平台策略

| Strategy | 典型用途 |
| --- | --- |
| `rolling_complete_days(n)` | 最近运营表现 |
| `calendar_month_to_date` | 本月截至数据日 |
| `completed_calendar_months(n)` | 完整月份趋势 |
| `prior_equivalent_progress(n)` | 历史月份相同进度 |
| `next_complete_calendar_month` | 下一个完整自然月预测 |
| `same_day_type_baseline(n)` | Workday/Weekend/Holiday 异常基线 |

这些是平台算法，不是 Ngee Ann 常量。Ngee Ann 与 Preschool 分别通过 Overview Definition 选择不同组合。

## 8. 定制能力如何晋升为平台能力

```text
真实 Project 管理问题
→ Project Adapter/Overview Definition 中受控验证
→ 第二个场景证明可复用
→ 提交平台 Strategy/Capability Proposal
→ 自动合同测试 + 人工批准
→ 发布不可变 Revision
→ 其他 Project 通过配置引用
```

晋升判断看五点：

1. 输入和输出能否用 Project 无关术语表达；
2. 是否已有第二个真实使用场景；
3. 能否由服务端确定性验证；
4. 是否能进入 Saved/AI/What changed identity；
5. 删除公共模块后，复杂度是否会重新散落到多个项目。

不能满足时，能力继续留在 Project Adapter。平台不为了“看起来通用”而吸收项目专属指标或固定 Sections。

## 9. 具体项目映射

### Ngee Ann

- Managed Overview：默认打开最新自然月 Report Edition；当月显示自然月至 dataThrough，历史月只显示已封存完整结果；
- Recent operations：最近 28 个完整日；
- Completed month trend：最近 3 个完整自然月；
- Same-progress comparison：历史月份相同进度；
- Forecast：下一个完整自然月；
- Day-type reference：Workday / Weekend / Public holiday。
- School Holiday comparison：发布 `ngee-ann-report-time@2` 的 120 个完整日本地窗口，并把保留 Ngee Ann 工作日 `08:00–18:00` 运营边界的 `sg-calendar-holiday-v2`、`comparison.school_holiday_context@1` 与第五个 `school-holiday-comparison` Section 一起冻结进新的 Project Release。既有 `sg-calendar-holiday-v1`、`ngee-ann-section-v16` / `ngee-ann-section-pack-v2` 历史 Artifact 保持不可变。

现有 2026 年 4–6 月 Excel 批次按原文件保存并进入同一 Source Adapter。4 月 21 日才开始的数据只能作为 partial context；第一批单独使用时，最后一个可确认的完整日是 5 月 19 日；合并第二批后 5 月可以成为首个完整历史月；当前 6 月最后一个可确认的完整日是 6 月 16 日。

重叠数据按 Meter Point + timestamp 处理：同值记录合并；异值记录必须保留两边 Raw Reading 与 overlap-conflict 标记。只有当一批数据覆盖到更晚的时间时，才允许由覆盖更长的批次成为 canonical，并在 Readiness 中显示 warning；若冲突批次的覆盖范围相同，则必须 fail closed 并进入人工核对，不能使用文件名或批次 ID 的字典序决定业务真相。

### Preschool

- Current Overview：保留最近 28 个完整日；
- Monthly Outlook：继续使用自然月计划、实际和展望；
- Benchmark/operational Sections：按自己的管理问题绑定平台窗口，不复制 Ngee Ann Sections。

## 10. Holiday 状态

Business Calendar 是平台能力。任何 Project 都必须区分：

1. `calendar_not_configured`：没有发布 Calendar；
2. `sample_unavailable`：Calendar 已配置，但当前 Evidence 窗口没有完整 Holiday sample；
3. `available`：Holiday profile 可用，并显示 sample count 与限制。

不得把后两种状态都写成“Holiday 未配置”。

Ngee Ann 的当前发布合同还要求：Calendar 必须含 academic phase 与新加坡 Public Holiday exception；Overview Definition 必须引用同一个 `school-holiday-comparison` named window；持久化 comparison 的本地 `[from,toExclusive)` 必须与 Release-pinned Report-Time window 精确一致，否则整个 Holiday 投影 fail closed。可用时 Web 展示 00:00–23:00 全部 24 个 Holiday/Teaching 小时点，不能用三个任意时段均值代替完整曲线。普通 Overview GET 只读已发布投影，不调用 Provider，也不修改 Metadata。

当前五 Section Release 的用户可见合同进一步固定为：标题始终是英文 “School Holiday Comparison”；确定性的 `What changed / Pattern / So what / Next check` 与 Explorer/AI action 不依赖 Provider；24 小时曲线只比较同一个 weekday/weekend/Public Holiday cohort。缺少 Calendar、Snapshot、Release 或 Rule pin 时仍显示该 Section 和明确 unavailable reason，不能静默隐藏。Holiday fact query 或 Rule 失效时不得把 candidate 发布成 current 覆盖上一份完整投影；资料覆盖不足可以发布为诚实 unavailable，但不会伪造指标。

新 current Release 沿既有 `ngee-ann-section-pack-v2` → Section interpreter → Overview AI Artifact → Web read-model 链路增加真实 `school-holiday-comparison` 第五 Artifact。它只解释服务端已算好的 comparison，可以增强标题与解释，不能重算、求和或替代权威指标。没有可用 AI Artifact 时上述确定性内容仍完整可读。旧四 Section Saved Analysis 继续按其原 Snapshot/Release 和四个 target 只读恢复，不重写、不迁移，也不注入第五 Section。

## 11. 后果与失效条件

### 正面后果

- 新项目接入不再修改 Web 日期代码；
- Stage 5 只操作稳定业务语义，不依赖当前 React/图表库实现；
- AI/Saved/What changed 可以解释每条结论使用了哪个窗口；
- Excel 和 API 持续进数共享同一 Snapshot → Time Context → Overview 流程；
- 每日数据与 AI 可以重算，而不会每天重建页面或制造新 Template Revision；
- 新定制可通过 Overview Definition 快速验证，稳定后再提升为平台 revision。

### 代价

- 现有 Ngee Ann/Preschool period 逻辑需要迁移；
- Artifact identity 必须纳入 Policy/Overview Definition revision；
- UI 需要在 Section 级显示时间标签，不能只显示一个含糊全页日期。
- What changed 必须区分数据/结论变化与 Template 变化；仅换措辞、Evidence ID 或生成时间不能冒充业务变化。

### 失效条件

出现以下信号时复审本决策：

- 大量 Project 需要平台策略目录无法表达的实时/事件窗口；
- Overview 的核心任务从管理报告转成自由探索；
- 同一 Section 的窗口组合无法通过静态 Definition 表达；
- 第二种真正独立的 Calendar/Forecast 实现出现，需要形成新的 Adapter seam。

## 12. 执行入口

- Map：GitHub #75
- Contract/resolver：#79
- Agent-friendly Overview Definition：#80
- Ngee Ann/Preschool migration：#81
- Saved/AI/What changed provenance：#82
- 持续 API 数据复跑：#83
