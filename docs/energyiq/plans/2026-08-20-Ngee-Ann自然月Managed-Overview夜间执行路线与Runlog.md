---
title: "Ngee Ann 自然月 Managed Overview 夜间执行路线与 Runlog"
summary: "把 Charles 的自然月、持续更新、What Changed 和论点驱动反馈落实为可测试、可复跑、可发布的交付路径。"
doc_type: playbook
tags: [NgeeAnn, ManagedOverview, ReportEdition, AtoB, WhatChanged, NightRun]
updated_at: "2026-08-21"
related:
  - "../decisions/2026-08-19-Project通用Report-Time-Context与Overview复用决策.md"
  - "../decisions/2026-08-06-Charles系统价值复核与连续数据演示决策.md"
status: in-progress
---

# Ngee Ann 自然月 Managed Overview 夜间执行路线与 Runlog

## 1. 今晚要交付的产品结果

同一套已发布 Overview Definition 能在持续到达的数据上反复运行：

1. 默认展示最新自然月 Report Edition；当月为 MTD，历史月为完整月；
2. 每天可重算数字、图表、状态和 AI Artifact，不重做静态 HTML 或 Template；
3. 页面先表达 1–3 个管理论点，再用图表、Evidence 和行动建议论证；
4. What Changed 保守展示 retained / updated / new / removed，并区分数据变化与 Template 变化；
5. 四份现有 Ngee Ann Excel 能形成可追溯的多批次数据与 A/B/C 连续验收；
6. 本地自动门、真实浏览器、真实 Provider、多账户和生产部署分别留证，不互相代替。

## 2. 术语纠正

本任务允许“重跑”，但必须说清重跑什么：

| 动作 | 可以每天发生 | 是否改变 Template Revision | 结果 |
| --- | --- | --- | --- |
| Overview Materialization Refresh | 是 | 否 | 在新 Snapshot 上重算确定性数据和图表 |
| Insight Refresh | 是 | 否 | 在新 Snapshot 上生成精确绑定的 AI Artifact |
| Template Regeneration | 否，只有设计变更时 | 是 | 改 Section、能力、公式引用或视觉组织并重新发布 |

Token 成本不是今晚阻止 AI 每天运行的理由。真正的产品门是：新 AI 是否提供有价值的新角度；是否只换了措辞；是否错误复用旧 Artifact；是否导致 What Changed 噪声。

## 3. 产品选项与决定

| 选项 | 做法 | 结论 |
| --- | --- | --- |
| A. 每次数据更新重新生成静态 Overview | AI 重新写 HTML/页面 | 拒绝；不可稳定复跑和治理 |
| B. 所有内容强制同一时间范围 | 全页自然月或全页最近 28 天 | 拒绝；预测、运营和趋势语义冲突 |
| C. Overview 变成任意日期 BI 编辑器 | 用户自由改所有窗口 | 拒绝；破坏稳定报告口径 |
| D. 自然月 Report Edition + Section 命名窗口 | 同一 Definition 持续物化，探索另放 Interactive Analysis | 采用 |

## 4. 今晚任务路径

### M0 — 决策与边界（当前）

- [x] 区分 Template Regeneration、Materialization Refresh、Insight Refresh；
- [x] 固定自然月 Report Edition 与 Section named windows；
- [x] 把旧的“全页单一 Period”共识标记为被 Managed Overview 决策替代；
- [x] 将下列验收边界同步到 GitHub #81、#9、#83、#56。

### M1 — #81 Report Time Context 收口

- [x] 通过 public `resolveProjectAnalysis` seam 增加完整历史月与同进度比较的 server-owned bounded projection；
- [x] 当前月比较历史相同进度，完整月比较上一个完整月；不足数据时诚实 unavailable；
- [x] Calendar/Holiday、Tariff、Data through 和 Section 窗口标签使用精确 revision；
- [x] Overview Definition 语义变化时发布新的 Ngee Ann Template Revision，旧 Revision 保持不可变且重复启动幂等；
- [x] focused tests、API build、Web production build、diff-check 全绿。

### M2 — 多批次 Excel 与 A/B/C 数据基线

- [x] 原始四份 workbook 保持不可变，并已记录文件 SHA、行数、设备数和覆盖范围；生产导入仍须各自创建 Import Batch；
- [x] 审计 5 月 19–20 日重叠：同值合并；异值保留 Raw Evidence，由覆盖更长的批次成为 canonical 并产生 warning；同覆盖范围的异值必须 fail closed；
- [x] Level 6/7 Mapping 与 Source label 通过发布 Mapping 解析；四批 materialization 为 0 unmapped、18 canonical meter series，不按文件名生成 Meter identity；
- [x] A = data through 19 May，B = data through 31 May，C = data through 16 Jun；
- [x] A 证明 4 月 partial + 5 月 MTD；C 证明 6 月 MTD，并从同一 Snapshot 封存 B = May complete 与 May same-progress comparison；
- [x] 已生成人工核对 workbook；它只包含 batch manifest、conflict audit、A/B/C 验收矩阵和 canonical reading 核对表，不成为生产事实源。

### M3 — #9 论点驱动 Overview

- [x] 页首只保留 1–3 个管理主题，回答“发生什么、为什么重要、先核查什么”；
- [x] 每个主题使用 `Claim → Visual proof → Meaning → Next check → Evidence/limitation`；
- [x] 图表和表格降为论据或 supporting diagnostics，不再平铺数据；
- [x] Key Findings 不复制单个 Section Interpretation；
- [x] 无合格跨 Section 结论时只允许明确 `empty`，不能以 Summary 或单 Section 复述伪装 `available`；
- [ ] 1440 / 1920 / tablet 浏览器核对信息层级、折行、Evidence 和可访问性。

### M4 — #83/#56 持续数据与 What Changed

- [ ] 同一 Template Revision 下新 Snapshot 可重算确定性结果和 AI；
- [x] Artifact identity 包含 Snapshot、Release、时间窗口和生成合同，旧结果不能冒充 current；
- [x] 变化按事实/结论语义保守分类；随机措辞、Evidence ID 或生成时间变化不算 updated；
- [x] 记录数据变化与 Template 变化为两条不同 change axes；
- [x] 普通读取只恢复精确已存 Artifact，零 Provider；明确 refresh/generation 才触发 Provider；
- [ ] A→B→C 验证旧结论 retained/updated/removed 与新异常/new insight。

### M5 — 发布与客户门

- [x] Integration 运行高层 seams、focused suites、API/Web build；
- [x] 本地浏览器核对 Ngee Ann/Preschool，不把源码推断当浏览器证据；
- [x] 真实 Provider 只在明确 generation acceptance 中运行，记录 Run/Artifact；
- [ ] Charles admin 可见全部项目；Ngee-only user 只能看 Ngee Ann；
- [ ] 使用不可变 Release Artifact 部署，核对精确 SHA、健康、登录、数据库和回滚点；
- [ ] Charles 人工判断页面是否真正形成论点、AI 是否值得看。

## 5. 开发前必须关闭的潜在问题

| 风险 | 错误表现 | 今晚的防线 |
| --- | --- | --- |
| 当月与完整月误比 | 17 天 June 对完整 May，制造假下降 | MTD 只与历史同进度比较 |
| 月初样本太少 | 1–2 天被放大成月结论 | 标记 in_progress + 最小完整日门 |
| Excel 重叠静默覆盖 | 19–20 May 重复或冲突 | Raw 两边保留；later-coverage canonical + warning；same-coverage conflict fail closed |
| 4 月被误称完整月 | 数据从 21 Apr 才开始 | partial 状态，不进入完整月趋势 |
| AI 每天随机改写 | What Changed 每天都是“更新” | 语义/lineage 保守 diff，文本变化不单独升级 |
| AI 旧结果复用 | B 页面显示 A 的结论 | exact Snapshot/Release/Window/Contract identity |
| 每天无条件 AI 带来噪声 | Token 不贵但页面不稳定 | 允许每日运行；发布仍经过价值、去重和事实强度门 |
| Template 与数据版本混在一起 | 无法解释变化来自哪里 | Template axis 与 Report Edition/Snapshot axis 分离 |
| Holiday/Tariff 漂移 | 本地和生产口径不同 | Release-pinned revision + 部署后配置核对 |
| 页面只是图表堆叠 | 用户不知道系统想表达什么 | 管理论点优先，图表服务于 Claim |
| 深层投影膨胀 | API payload、浏览器和上下文爆炸 | server-bounded summary；深层明细按需读取 |
| 部署成功被误当产品通过 | 服务在线但内容/权限错误 | 构建、浏览器、Provider、账户、人工验收分开留证 |

## 6. Public test seams

在写实现前只通过以下可观察边界建立 RED：

1. API：`resolveProjectAnalysis` —— 时间窗口、月度 projection、Snapshot/Policy provenance；
2. Web：`buildNgeeAnnOverviewViewModel` —— Claim-first 组织、窗口标签和 unavailable 语义；
3. Renderer：公开 Ngee Ann Overview Renderer —— 真实用户看见的主题、图表、Evidence、What Changed；
4. Data ingest：现有公开 Excel import / source-to-fact seam —— Import Batch、SHA、重叠去重、Raw conflict、canonical winner 与 same-coverage 拒绝；
5. AI：公开 Artifact read/generate seam —— exact identity、普通 GET 零 Provider、A/B/C 不复用旧结果。

## 7. Stop conditions

- 需要改写或清理脏主目录、删除用户文件、重置其他 Agent WIP；
- 需要把四份原始 Excel 合并覆盖成唯一真相源；
- 需要新增依赖或升级 Node 版本；
- 现有高层 seam 回归且无法在本 ticket 的产品边界内解释；
- 需要猜测 Calendar、Tariff、Level Mapping 或生产凭据；
- 生产发布前自动门未绿，或无法建立可恢复的上一 Release/Storage 备份。

## 8. Runlog

### 2026-08-20 夜间启动

- Worker：`D:\Projects\energyiq-datafoundry-worker-3`
- Branch：`codex/81-multi-window-block-materialization`
- Baseline：`0d147b58d905ed050e617941a85a5b8f1fd1d148`
- 状态：clean；主目录脏改动未触碰。
- 已完成基线切片：Report Time Context、`current-month-progress`、`recent-operations`、趋势/小时/Circuit window binding 与标签一致性。
- Issue：#81、#9、#83、#56 已同步 Charles 会议后的术语、A/B/C 与验收边界。
- Docs smoke：本次新增文档没有新断链；全仓命令仍被既有 reference HTML 伪链接、历史 source-sensitive wording 与既有 evidence 绝对路径阻塞，未放宽规则或修改无关历史文件。
- 本轮第一 RED：完整历史月与同进度比较必须由 API public seam 提供，Web 不得自行从任意日期拼算。

### 2026-08-20 M1 tracer 1 — 历史月段 projection

- RED：`resolveProjectAnalysis` 没有 `reportWindowSegmentSummaries`，public seam 精确失败；
- GREEN：输出最近 3 个完整月与最近 3 个历史同进度段；每段绑定 Snapshot、Query、Period、expected/complete day count 与 complete/partial/unavailable；
- 生产边界：历史明细只在服务端计算，浏览器只收 bounded summary，六段 JSON 小于 8 KB；
- 验证：Report Time Context + Project Analysis Resolver 15/15，API build、Web production build、diff-check 全绿；
- Commit：`ce7f885 feat(energyiq): project historical report segments`。

### 2026-08-20 M2 preflight — 四份真实 Excel

- 四份 source workbook 均只有 `Sheet1`，字段为 `Device Name / Time / Active Energy`；Level 6/7 各 9 个设备；
- 第一批覆盖 21 Apr–20 May，第二批覆盖 19 May–17 Jun；文件内无重复和内部缺口；Level 6 的 `Office Light-Right: Internal` 各少最后一个 15-minute point；
- Level 6 overlap 1,727 条，其中 1,720 同值、7 条异值；Level 7 overlap 1,728 条，其中 1,719 同值、9 条异值；
- 16 条异值全部位于 20 May 23:45，并且第二批继续覆盖到 17 Jun，因此现有 later-coverage canonical 规则适用；Raw 两边仍必须保留并报告 warning；
- 日期校准：第一批单独只能确认到 19 May 完整日；合并两批后可封存完整 May；当前 June 可确认到 16 Jun；
- 后续 RED：真实 source-to-fact/import seam 必须证明 A/B/C、16 条 warning、Level mapping exact，以及同覆盖范围的冲突不会靠 lexical tie-break 静默裁决。

### 2026-08-20 M2 GREEN — Import、Report Edition 与歧义冲突门

- Canonical risk RED：两个冲突来源若具有相同 coverage end，旧实现按 `source_file/import_batch_id` 字典序选 winner，public writer 测试精确失败；
- GREEN：Canonical 发布前检查 Normalized Reading 与 Interval Fact；同 coverage end 且事实不同会抛 `ENERGYIQ_OVERLAP_CONFLICT_AMBIGUOUS`，later-coverage 规则和同值 dedupe 保持不变；
- 真实四文件 public seam：第一批 materialization 产生 Snapshot A，`dataThrough=19 May`；四批 materialization 产生 Snapshot C，`dataThrough=16 Jun`；
- A/C 之间没有第三次真实数据摄取，所以 B 不伪装成第三个 Snapshot：B 是 C 中 `1–31 May` 的 sealed complete Report Edition；
- C 的 completed-month May 为 31/31 complete，same-progress May 1–16 为 16/16 complete；两者 Evidence 均精确绑定 Snapshot C 与 `daily_totals_v1`；
- 3,455 个 overlap keys 中 3,439 个同值；16 个异值 pair 对应 32 个 Raw conflict rows，Readiness warning 使用 Raw row count；
- Saved A 在 C 发布、读取和 rerun 后仍保留 A 的 Snapshot、analysis/query/snapshot JSON 与 Release identity；
- 验证：Data Gateway writer 16/16；真实 Ngee Ann two-Snapshot acceptance 1/1（约 4.9 分钟）；未调用 Provider、未启动浏览器、未修改生产数据库。

- RED：`resolveProjectAnalysis` 未返回 `completed-month-trend` 与 `same-progress-comparison` 的月段摘要，focused 1 test failed。
- GREEN：增加受 Scope/Snapshot 约束的轻量 `executeEnergyDailyTotalsProjection`，历史窗口只跑 health + daily totals 查询；相同日映射逻辑与完整 Scope analysis 共用。
- 输出：3 个完整月段 + 3 个历史同进度月段；每段含 exact Period、complete/partial/unavailable、完整日计数、可用时的用量摘要和 Snapshot/query provenance。
- 安全：partial/unavailable 段不发布月总量；历史日明细不进入客户端 payload，6 段 JSON 小于 8 KB。
- 验证：Report Time + Resolver 2 files / 15 tests；API build；Web production build；`git diff --check`。
- 剩余：现有 compact fixture 只有 June 数据，因此历史月应 unavailable；M2 必须用四份真实 workbook 证明 May complete 和 June same-progress，不得用 synthetic 结果冒充。

### 2026-08-21 M3 tracer 1 — 论点驱动的阅读顺序

- RED：公开 Renderer 还将 `Daily Total Trend → Executive Summary → Summary of Findings → 深层诊断 → Recommendations → AI` 作为 DOM 顺序，管理用户需要穿过大量数据才能看到结论；
- GREEN：重排为 `Management themes → Executive Summary → verified breakdown → Key Findings → Daily Trend → supporting diagnostics`，保留原 Snapshot、Period、Evidence 和 AI Artifact 恢复合同；
- 视觉组织：既有 1–3 个决策主题继续承担 `Claim → Visual proof → Meaning → Next check → Evidence/limitation`；原六张平级 Summary cards 收入默认关闭的 `Supporting diagnostic index`，不删除任何真定性结果；
- 可访问性：折叠层使用原生 `details/summary`、键盘 focus ring 与现有 icon system，DOM 与阅读顺序一致；
- 验证：Renderer 74/74；Ngee Ann Renderer/ViewModel/AI slots 合跑为 241 pass + 1 个 5s timeout，该用例单跑 1/1 通过；Impeccable layout detector `[]`；
- 未声称：尚未在 1440/1920/tablet 真实浏览器检查折行、折叠与阅读节奏，亦未经 Charles 人工判断。

### 2026-08-21 M1 tracer 2 — 自然月语境进入 Overview

- RED-1：API 已返回 `completed-month-trend` 和 `same-progress-comparison`，Web ViewModel 却没有 `monthlyContext`，因此用户看不到月间语境；
- GREEN-1：增加受控 monthly projection；当前月只与历史相同完整日数比较，完整历史月独立展示，partial/unavailable 月不发布总量；
- RED-2：当当月 window projection 缺失时，旧实现会把较短的 primary analysis 换标为月度数值；
- GREEN-2：只接受 exact `current-month-progress` projection，或 primary Period 与该 window 完全相等；其他情况 fail closed 为 unavailable，不借用数字；
- UI：`Monthly context` 在 Executive 后、AI Key Findings 前；左侧回答同进度差异，右侧只发布完整自然月，每行保留 complete-day count 与 Snapshot/query Evidence；
- 自动证据：ViewModel 新增 2 个边界用例、Renderer 新增用户可见用例均 GREEN；Renderer 75/75；ViewModel 165 pass + 1 个累计运行时 5s timeout，该用例单跑 1/1；Web production build 通过；浏览器证据待后续总门。

### 2026-08-21 M1 tracer 3 — Overview Definition 不可变发布

- RED：Pilot bootstrap 只要最新 Template Revision 已附着 Overview Definition 就直接返回；即使管理问题、Section 标题和页面论点已经改变，Template identity 仍不旋转，旧 Artifact 可继续被误认作 current；
- GREEN：bootstrap 先用 Component Catalog 与 Report Time Policy 编译 canonical Definition 并比较 fingerprint；只有语义变化才从最新 Revision 发布新 immutable Revision，旧 Definition 继续可读；Renderer 不匹配 fail closed；
- 幂等：相同 Definition 再次 bootstrap 不创建新的 Revision；每日数据物化和 Insight Refresh 不经过该发布路径，因此不会每天制造 Template Revision；
- 本轮 Ngee Ann Definition 将首两节明确为 `Management overview` 与 `Monthly context`，Section keys、Capability revisions 和 named windows 保持稳定；
- 自动证据：先建立带 legacy 管理标题的旧 Revision，public bootstrap 后生成新 Revision；旧 Definition 未被改写，新 Revision 命中新标题；再次 bootstrap Revision 不变。Focused 6/6、API build、diff-check 通过；生产 v6 是否旋转须在 Integration/部署时以真实数据库与 Release identity 核对，未在本切片声称完成。

### 2026-08-21 M4 tracer 1 — What Changed 的两条版本轴

- 新风险 RED：同一 Data Snapshot 上发布新 Template Revision 时，旧候选会因“Snapshot 与时间口径都没变”被过滤，用户无法看到这次变化来自分析/页面口径；
- GREEN：previous candidate 与兼容门现在同时承认 Project Release 变化；同 Snapshot、同 Report Time、不同 Release 被归为 `analysis-basis`，不会冒充数据变化；
- 原有门保持：新 Snapshot、相同 Report Time/Release 归为 `data`；Report Time 或确定性 Metric basis 不兼容时不发布误导性数值 delta；Artifact 的 Snapshot/Release/Report Time/生成合同必须 exact；Finding 的 Evidence ID 单独变化不伪装成结论更新；
- 普通 Overview GET/readExact 的零 Provider/零 queue/零 ensure 已由既有 API 与 Ngee Ann Adapter public tests锁定，本切片没有新增读取副作用；
- 自动证据：What Changed 3 files / 23 tests、Web production build、diff-check 通过。A→B→C 的真实 AI 内容 retained/updated/new/removed 仍须明确 generation + Provider + 人工价值审核，不能由纯函数测试代替。

### 2026-08-21 M3 tracer 2 — Key Findings 不能复制单个 Section

- RED-1：`status=available + supported Summary + findings=[]` 被接受并持久化，页面看似有 Key Findings，实际没有结论；
- RED-2：只引用 `trend-and-demand` 的 Section 原句可作为 Key Finding 发布，重现“Key Findings 与 Section Interpretation 一样”的产品缺陷；
- GREEN：`available` 必须至少保留 1 条本地审核通过的 Finding；每条 Finding 必须引用至少 2 个不同 Section，并从每个 Section 引用真实 source Insight；没有跨 Section 价值时 Provider 必须明确返回 `empty`；
- Identity：Ngee Ann Executive 从 v6/acceptance-v5/prompt-v1 旋转到 v7/acceptance-v6/prompt-v2，避免旧 Artifact 被当作新规则产物；Store 对 v7 重复执行同一跨 Section 门，v1–v6 历史结果保持可读；
- 自动证据：Executive、identity、workflow、Metadata Store 4 files / 35 tests，Metadata/API build、diff-check 通过。真实 Provider 是否能稳定生成有价值的跨 Section Finding 仍待明确 generation 与人工内容审核。

### 2026-08-21 M3/M5 真实运行验收 — 依赖隔离、事实方向与 6/6 AI

- 运行边界：原 clean Integration 的 `node_modules` 与 `apps/web/node_modules` 实为指向旧 Worker 的 Junction；源码测试加载新 v12，但生产 API 解析到了旧 Metadata 构建，导致四个已完成 Provider Run 在 Store 落库时全部被旧合同拒绝；
- 修复方式：没有删除 Junction 或修改旧 Worker，而是从精确提交创建 `D:\Projects\energyiq-datafoundry-night-runtime` / `codex/night-runtime-20260821`，独立 `npm ci`；Workspace package links 已验证指向该 Worktree 自己的 `packages/metadata`、`packages/contracts` 与 `apps/api`；
- 内容 RED：真实 Provider 曾把 Public Holiday 写成“与 Weekend 相似但略低”，而确定性 day-type profile 的 Project-scope 方向相反；新增 public materializer RED，按 candidate 局部拒绝写反的 ranking/direct/contrast comparison，保留同批正确 sibling；
- Identity：Ngee Ann Section 旋转为 `ngee-ann-section-v12`、`energyiq-project-section-acceptance-v10`、`energyiq-project-section-discovery-v6`；v11 继续历史可读；Commit `835fa11 fix(energyiq): validate day-type comparisons`；
- 自动门：相关 API/Metadata 5 files / 74 tests；root `npm ci` 所触发的 TypeScript project build；Web production build；`git diff --check` 均通过；
- 真实 Provider：第一次明确 generation 将四个 Section 全部恢复为 available；最终 Executive 曾因 DeepSeek 10 秒 connect timeout 失败，第二次只重试 Executive 后达到 `6/6 ready`；Additional Insights 为诚实的 `no-new-insight`；
- 内容审核：浏览器显示 `4 of 4 Sections ready`；Key Findings 引用跨 Section 的 Level 7、off-hours 与 Circuit concentration；Time behaviour 不再出现“Public Holiday lower than Weekend”的反向结论；
- 读取副作用：生成完成后普通 `Refresh current overview` 前后 `runs` 均为 114；EnergyIQ Admin Demo 与 Ngee Ann FM Demo 均可 GET 同一 4-Section + Key Findings Artifact，Ngee Ann FM 对 Preschool 返回 403；
- 账户缺口：账户清单中的 `Charles Demo` 与 `Ngee Ann Client 01` 在当前本地 Metadata DB 中不存在，因此不能用它们伪造登录通过；已存在且密码与清单一致的 EnergyIQ Admin Demo / Ngee Ann FM Demo 完成角色等价验收。Charles 具名账户与四个 Ngee Ann Client 账户必须在目标发布环境确认已 provision 后再验收；
- 浏览器事实：自然月 Report Edition 为 `1–16 Jun 2026`、Data through `16 Jun`；June MTD 比 May 同进度 +14.7%；May 31/31 complete、April 10/30 partial；Tariff 为 29.72¢/kWh incl. GST；1 Jun Public Holiday 已进入图表与 Holiday insight；
- What Changed：真实浏览器比较入口明确声明零模型调用；当前 DB 没有 compatible previous Saved Overview，页面诚实提示先保存本版，而没有伪造 retained/updated/new/removed。A→B 可视比较仍须在下一批 Snapshot 与至少一份 frozen Saved Overview 后完成。

## 9. 完成定义

夜间任务只有在以下证据分别存在时才可称为完成：

1. 决策、术语、Issue 与 Runlog 同步；
2. #81、数据导入、#9、#83/#56 各自有 RED→GREEN 与精确 commit；
3. Integration 全门通过，分支无意外脏文件；
4. 浏览器、真实 Provider、多账户、生产部署和 Charles 人工验收各自有真实证据；
5. 未完成的人类判断或缺少 July/August 数据必须明确标记 `ready-for-human`，不得用 synthetic fixture 冒充完成。
