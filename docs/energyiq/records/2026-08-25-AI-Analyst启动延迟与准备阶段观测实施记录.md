---
title: "AI Analyst 启动延迟与准备阶段观测实施记录"
summary: "记录 Send 到首个模型输出之间的真实阶段、无敏感内容的 RUN_PREPARING 事件，以及 #173 Context Package 复用和 #200 发布后预热边界。"
doc_type: implementation
tags: [ai-analyst, performance, run-event, observability, project-analysis]
updated_at: "2026-08-30"
status: in-progress
---

# AI Analyst 启动延迟与准备阶段观测实施记录

## 结论

用户看到的约 10–15 秒静默并不主要来自模型。只读生产证据显示，最近可核对的 Runs 从 `runs.started_at` 到首个 reasoning 约为 1.4–2.8 秒；其中一个完整样本从 Run claim 到 `RUN_STARTED` 为 116 ms，到 `model.request.prepared` 为 446 ms，到首个 reasoning 为 2.215 秒。当前最大盲区位于 Run claim 之前：服务端依次解析精确 Query Context、Published Meter Route、Snapshot-scoped datasource，并执行完整 `resolveProjectAnalysis`。冷路径需要准备 DuckDB 视图和多组确定性分析，因此可能占用剩余 7–13 秒。

当前候选已经补齐统一的 `send_clicked → request_received → run_claimed → first model content → browser paint` correlation；但尚未部署到真实浏览器/Provider，所以旧生产样本仍只能证明 Run claim 之后约 2.2 秒，不能把候选 instrumentation 冒充为生产逐阶段实测。Issue [#173](https://github.com/Zion74/energyiq-datafoundry/issues/173) 关闭可观测性和诚实反馈；Issue #172 负责把 Overview 已物化的确定性投影与 Evidence refs 沉淀成 immutable `OverviewContextPackage`，避免交互式问答每次强制重算完整 Overview。

## `energyiq-run-preparation@1`

Energy 请求通过基础解析后，AG-UI 立即发送 `energy.run.preparation`，并按顺序报告：

1. `request-accepted`；
2. `query-context-resolved`；
3. `meter-route-resolved`；
4. `analysis-context-package-resolved`；
5. 按需出现的 `scoped-datasource-ready`；
6. 冷路径的 `project-analysis-resolved`；
7. `run-claimed`。

事件只包含 `phase`、相对请求起点的 `elapsed_ms`，ProjectAnalysis 的 `computed|reused`、声明式 Evidence query 数量，以及 `package_hit|targeted_query|full_materialization_missing`。它不包含 Prompt、SQL、Evidence 正文、凭据或客户原始数据。Run identity 尚未建立时，AG-UI transport 先用 request Run identity 发出 `RUN_STARTED`，再让 preparation 事件立即流向当前请求；Run claim 后，同一组事件才补写入 canonical Run Event ledger，真实 runtime `RUN_STARTED` 仍保留在 durable ledger。Web 允许 transport envelope 后的 preparation 激活“正在准备分析”，并由 canonical `agent-runtime-started` latency milestone 关闭；关闭后到达的 preparation 仍可更新 phase/correlation，但不能重新激活 Preparing。

ProjectAnalysis 的 `cacheStatus` 只描述当前精确 Resolver cache 是否计算或复用；`evidenceQueryCount` 是最终投影声明的确定性 Evidence query 数，不是物理 SQL 调用次数。这两个值用于判断重复问题是否仍触发完整分析，不能替代数据库级 query timing。

## `energyiq-run-latency@1`

`Preparing` 只能诚实显示准备状态，不能回答耗时究竟发生在服务端准备、Agent 装配还是模型首输出。现有 preparation tracer 因此继续保持纯准备语义；同一个服务端请求起点另外记录只含时间的 `energy.run.latency` 事件：

1. `request-received`：API 开始处理本次 EnergyIQ Run；
2. `agent-runtime-started`：真实 `RUN_STARTED` 已进入 Run Event pipeline；
3. `model-request-prepared`：Provider boundary 的 `model.request.prepared` 已形成；
4. `first-model-event`：首次 reasoning/text 流事件到达；
5. `first-model-content`：首次可显示的 reasoning/text 内容到达。

每个阶段在一个 Run 内只记一次，重复/恢复事件不会重复计数。事件只携带 `contract / correlation_id / phase / elapsed_ms / output_kind`，不保存 Prompt、SQL、Evidence 正文、凭据或客户原始数据；Run claim 前后都沿用原 preparation trace 的即时流出与 canonical Run Event 回填机制。Web 仍只把 `energy.run.preparation` 投影为 Preparing，后续 latency 事件不会把已经 Running 的 UI 重新切回 Preparing。

Web 在真正接受 Send 时生成 `energyiq-run-correlation@1`，同一安全随机 id 随 forwarded props、排队和同一次 retry 原样携带。服务端只接受 16–96 字符的字母、数字、`_`、`-`，并把 id 回显到 preparation/latency 事件。浏览器据此记录首个 SSE，并在真实 reasoning/text content 进入 reducer 后于下一帧记录 first content paint；`Performance` marks/measures 可直接量出 Send→首 SSE 与 Send→首内容绘制。历史 replay 若没有本次 Send ledger 会被忽略。真实 Provider TTFT 仍必须用部署环境中的 `model-request-prepared → first-model-event/content` 差值验收。

## 精确 `AnalysisContextPackage` 复用

General AI Analyst 的 `all-available` 可能宽于当前 Overview Report Edition；例如 Preschool 可分析 May–June 61 天，而 Overview 主报告期只有 June 30 天。因此交互式 AI 不直接拿较窄的 `OverviewContextPackage` 冒充完整证据，而是在既有 `ProjectAnalysisResultCache` 物化机制中保存独立的 `energyiq-analysis-context-package@1`。其 key 同时绑定 Workspace、Project、Scope、resource、from/to、Snapshot、Project Release、Report-time policy、hierarchy、mapping、formula、metric/Calendar/Tariff、Renderer、Recipe 与规则版本。任一身份不同都会 miss，旧包保持不可变。

请求分三条路径：

- `package_hit`：问题可由包内 released Evidence 回答，直接把 package facts 交给 requirements grounder，不创建 DuckDB workspace，也不重复完整 ProjectAnalysis；
- `targeted_query`：精确包存在，但问题超出包内事实，只创建当前 Scope/window 的 datasource 供针对性只读查询，仍不重复完整 ProjectAnalysis；
- `full_materialization_missing`：精确包不存在，沿用一次完整计算，并把该次 ready resolution 以 system actor 物化；相同 immutable identity 的后续请求严格复用。

物化函数只投影已经算好的 `ReadyProjectAnalysisResolution`，不拥有指标计算，也没有第二套 Store。读取先重新做用户/Workspace/Project 授权，并以完整 projection key 查找；它不打开 DuckDB、不调用 Provider、不改业务数据。

## 与 #172、#165 的边界

- #172 继续拥有 current Overview 的 immutable `OverviewContextPackage`；#173 复用同一物化引擎，为可能更宽的 AI window 建立 exact `AnalysisContextPackage`，没有平行计算栈。
- Snapshot、Project Release、Report-time policy 及 revision identity 未变化时，不应因定时任务或普通页面访问重新计算；数据导入只能提出新 package candidate，不能改写旧 identity。
- Top navigation 错误落到 Last 30 days 属于 #163/#165。本实施只观测 exact Explore / Ask AI 路径，不改变时间窗口、Session 或路由行为。
- 本地测试和构建不等于真实浏览器、Provider、生产部署或多账户验收。本实现不调用 Provider，不发送真实消息，也不写业务数据。

## 自动化证据

- preparation tracer：验证阶段立即流出、elapsed 单调、Run claim 后原事件回填，以及敏感字段不在 payload；
- `DataFoundryAgUiAgent.run` 本地 server seam：使用 fully mocked Agent assembly（不调用 Provider）证明 client stream 先以唯一 `RUN_STARTED` 打开 AG-UI transport，随后 `request-accepted` 早于 scoped datasource / ProjectAnalysis；Run claim 后 preparation events 只回填一次且在 durable ledger 中位于真实 runtime `RUN_STARTED` 之前；精确 context 失败时已发出的 preparation evidence 仍写入 failed Run，并以唯一 `RUN_ERROR` 诚实终止；
- ProjectAnalysis cache：cold exact request 为 `computed`，相同 immutable identity 重复读取和进程重启后的持久恢复为 `reused`，且不增加 Gateway SQL；
- exact Analysis package：61 天包只命中相同 from/to/Snapshot/Release/revision identity，30 天窗口返回 miss；首次 ready ProjectAnalysis 只物化一次，相同身份再次 materialize 为 no-op；
- server orchestration：包内可回答的问题不调用 datasource workspace 或完整 ProjectAnalysis；超出包内 Evidence 的问题只进入 targeted datasource；cold miss 计算一次后物化；
- client correlation：本次 Send、首个 correlated SSE、服务端 milestone、package status 与真实 content 后浏览器帧使用同一 id；Performance ledger 不写 Prompt/SQL/Evidence/secret；
- Web reducer：pre-Run/legacy custom event 与 transport `RUN_STARTED` 后的 preparation 都可单独进入 Preparing；canonical `agent-runtime-started` latency milestone 关闭 Preparing，后续 preparation 只更新受控 phase/correlation metadata 而不重新激活；terminal event 同样保持关闭，避免误判 duplicate Run 或破坏历史分段；
- TypeScript root build、API build、Web production build、文档 strict/link smoke 与 `git diff --check` 作为候选门分别记录，不提升为外部验收。

## 端到端 instrumentation

候选已用同一安全 id 关联浏览器 `send_clicked`、API `request_received`、各 preparation phase、package status、`run_claimed`、`RUN_STARTED`、`model.request.prepared`、首个 reasoning/text、首个 SSE 与第一帧 content paint。它只保存相对时间和受控枚举，不保存 Prompt、SQL、Evidence 正文、凭据或客户数据。部署后应分别设置 package-hit 准备、Provider first-token 和前端渲染 SLO，而不是继续用“用户感觉十几秒”猜测瓶颈。

## #200：新发布身份的预热

PR #199 合并后，重复问题已经可以通过 exact `AnalysisContextPackage` 命中 `package_hit`；剩余冷点是新
Snapshot 或 Release 发布后的第一条用户问题。Issue #200 把这次完整计算前移到写侧生命周期，而不是在
Overview GET 或用户 Send 时重算：

- 人工 Import materialization、Tuya 手工/定时同步，以及 Project Release publish 都调用同一个
  `prewarmProjectAnalysisContextPackage`；
- 先解析 server-owned `all-available` window 和完整 published identity，再进入既有
  `ProjectAnalysisResultCache.materializeCurrent`；完整 `resolveProjectAnalysis` 位于原有跨进程锁内，
  因此同身份并发触发只计算和原子发布一次；
- 相同 immutable identity 返回 `unchanged`，不执行完整 ProjectAnalysis SQL，也不重写 package；
- 缺 Release、缺 coverage 或发布映射尚未 ready 时返回带原因的 `not_ready`，不拿半成品替换旧 package；
- 新 package 仍是 `energyiq-analysis-context-package@1`，没有第二套指标计算、Store 或 Provider 路径。

写侧 API 返回 `analysisContextPrewarm` 的 `materialized|unchanged|not_ready` 状态；成功状态同时返回
`projectionRef` 与完整 identity。定时 Tuya 路径把 Snapshot 与状态写入服务日志。Managed package、current
pointer 及其 payload SHA 是成功预热的持久证据；普通 Overview/AI GET 仍保持 0 Provider、0 materialization
write。历史 package 的保留与可达性清理由独立 Issue #201 决策，本切片不顺手删除旧文件。

新增 TDD 证明：同一 exact identity 两个并发预热调用只进入一次完整 Resolver；随后再次预热为零 SQL 的
`unchanged`；失败 candidate 返回 `not_ready` 后，上一份 exact ready package 仍可读取；Import、Tuya sync
和 Release publish 的响应都暴露预热结果；既有首问 `package_hit` orchestration 继续跳过 DuckDB workspace
和完整 ProjectAnalysis。上述仍是本地自动化证据，不等于 CI、浏览器、Provider 或部署验收。

### 已发布 identity 的显式 backfill

若功能部署时三个 Project 已经拥有 current Snapshot/Release，但之后没有新的 Import、Tuya sync 或 Release
publish，运维可以显式调用管理员操作：

`POST /api/v1/energy/projects/<projectId>/analysis-context-package/prewarm`

该入口复用同一个 `prewarmProjectAnalysisContextPackage`，不接受自定义 window/identity，不 `forceRecompute`；
服务端从 current published identity 解析 `all-available`。首次缺包返回 `201 materialized`，已存在完全相同
identity 返回 `200 unchanged`，缺 Release/coverage/mapping 等返回带原因的 `409`。响应只返回
`status / projectionRef / identity`，并由既有管理员项目授权和 HTTP access log 审计。普通 Overview GET、AI GET
和用户 Send 不调用这个入口。

当前三 Project 的执行与验证清单（只在候选部署后，由授权管理员执行）：

1. 依次对 `preschool-demo`、`ngee-ann-polytechnic`、`tuya-office` 调用一次上述 POST；
2. 逐一核对响应 identity 的 Project、from/to、Snapshot、Project Release、Report-time、hierarchy、mapping、
   formula 与当前 published identity 完全一致；不得只看 `200/201`；
3. 对相同 Project 立即再调用一次，必须为 `200 unchanged`，并核对 Projection ref 不变；
4. 每个 Project 新建一条 AI Analysis Run，首个 `analysis-context-package-resolved` 应为 `package_hit`；该热路径
   必须 0 `ensureEnergyIqAnalysisWorkspace`、0 `resolveProjectAnalysis`；
5. 只有问题超出 package facts 时允许 `targeted_query`，且浏览器必须先收到 correlated
   `request-accepted`/Preparing，再出现 `scoped-datasource-ready`；不得在 Send 同步执行完整物化；
6. 保存三组 correlation timeline 与 HTTP 响应作为候选验收，不能用本地 mock 代替浏览器/Provider 证据。

## #185：普通 AI Analysis 的 evidence-first Skill 边界

`energy-insight-investigation` 是 Overview 明确调查流程使用的 Method Skill，不是普通 AI Analysis 的被动默认值。
此前 Web 会把禁用的 Skill 继续放入 Session enabled set，并在没有用户选择时退回第一个 Skill；服务端又会照常
装配该资源。结果是直接从顶栏进入的普通问答也可能加载 Overview 专属调查方法，重复宽范围查询并放大
`SQL_TIMEOUT` 风险。

当前修订保持一条 selection seam，而不在 AI Analyst 内新增另一套 Skill 机制：

- Web 只把 Workspace 中实际启用的 Skill 放入 run config；没有可用 Skill 时不伪造 active Skill；
- Workspace 的 server-owned default Skill 会显式传入两条 run-config 构建路径；
- 服务端只对普通 EnergyIQ AI Analysis 设置 `energy-insight-investigation` 的 implicit denylist，并在 Agent
  assembly 前移除被动泄漏的 Skill；
- 用户本次通过 `mentioned.skill` 明确选择时保留该 Skill；`skillMode=none` 继续保持无 Skill；
- Overview AI workflow 具有独立的 server-owned stage options，不应用这条 denylist，既有显式 Method Skill
  绑定不变。

TDD 先复现普通 run、禁用 Skill 与全禁用 Workspace 仍产生 active Skill 的失败，再证明普通 server orchestration
进入 Agent assembly 时不包含 `energy-insight-investigation`，而显式选择、显式 no-Skill 和 Overview workflow
语义均不回退。该修订减少的是错误 Skill 装配和由此触发的冗余执行，不替代 #168 的 DuckDB cleanup/resource
边界修复，也不代表真实 Provider 首 token、浏览器交互或生产部署已经验收。

## #214：Run 级关联、真实 paint 与 package-hit 延迟闭环

Issue #214 收紧了 instrumentation 与热路径的语义，避免“有时间戳”却无法解释真实用户等待：

- 浏览器只生成 UUID v4 correlation envelope；服务端共享 contract 验证后才接受。correlation 只用于把
  浏览器等待与服务端 Run 串联，不参与授权或 durable 去重；里程碑 `eventId` 只绑定服务端 Run id 与
  phase，因此 retry、resume 或缺失/变化的 correlation 都不会为同一 Run/phase 生成第二条首事件；
- pending protocol journal 的旧输出只经 canonical event pipeline 重放，不进入 live latency observer。因此旧进程
  的 replay 既不能伪造 first-model，也不能压掉恢复后 live model 的第一个里程碑；
- Web 为同一 thread 保留有界的 per-correlation pending ledger，queued Send 与 retry 不会互相覆盖。只在
  非空且没有被 orphan-preamble/absorbed 过滤的 reasoning/answer 已进入 React commit 后登记 content，
  再跨两个 `requestAnimationFrame` 边界记录 first content paint。收到 SSE、空 chunk 或隐藏内容不再冒充
  用户已经看到内容；
- `package_hit` 首次装配仍为 0 scoped workspace、0 完整 ProjectAnalysis，并明确要求先使用 immutable package
  Evidence 回答。只有问题确实需要包外事实时，Agent 才使用既有授权、只读、SQL 预算和 allowlist
  DataGateway tools；lazy proxy 在第一次真实 tool call 才打开 exact scoped workspace，且绝不调用 full resolver；
- `not_ready` 继续保留上一份 ready package，并在 API response 中返回完整的既有
  `ProjectOverviewProjectionIdentity`；若完整 identity 尚不能形成，则返回 server-owned Project record 与
  canonical pointer，而不是另造一份不完整 identity。仓库当前没有可合法复用的 canonical prewarm lifecycle
  durable event seam，因此本轮没有伪造 audit Store/schema；已知失败由受控 response 暴露安全 outcome，意外错误
  仍 rethrow，设计边界记在本实施记录中。

第四轮复审后继续收紧：

- canonical EnergyIQ policy 在 `package_hit` 下不再同时要求“initial inspect_schema”；模型先从 bound immutable
  Evidence 回答，只有明确指出 package gap 才打开 lazy datasource；
- 浏览器在 SSE reducer 收到真实非空 message delta 时建立 `messageId → correlation`，React commit 用同一
  messageId 记账，double-rAF 到达时再次检查组件仍 mounted/visible。queued、resume、隐藏 timeline、orphan、空
  chunk 或已卸载内容均不能借用另一 Run 的 paint；Web 还会先验证共享 preparation/latency contract revision；
- Tariff 与 Operating Calendar publication 路径也调用同一个幂等 prewarmer；若 Release-pinned identity 未变，
  返回 `unchanged`，不启动第二套物化引擎；
- HTTP 与 operational event 只公开安全白名单：contract/outcome、Workspace/Project/Scope/resource、window/from/to、
  Snapshot/Release/report-time/hierarchy/mapping/formula/Calendar/Tariff/renderer/recipe/revision fingerprints、target
  pointer，以及存在时的 prior-ready projection ref + safe identity。绝不包含 `databasePath`、绝对路径、完整 mutable
  Project record、Prompt、SQL、Evidence 或 secret；每次 trigger/outcome 使用既有结构化 console event，交由生产
  systemd journald 留存，不创建新的 DB/schema/store。异常路径先写同一安全 outcome，再 rethrow。

真实生产顺序是 model delta 先到，服务端随后从同一 canonical event 派生 `first-model-content`。因此 client 不再
等待“下一个 delta”：服务端 milestone 携带同一 Run message id，浏览器无论先收到已 commit 的单 chunk 还是先收到
milestone，都在两者汇合时建立唯一 ownership。React 的 component-mount cleanup 与逐 token content effect 也已
分离，流式更新不会把组件误判为 unmount；若 double-rAF 期间 timeline 被折叠或隐藏，本次不记 paint，并允许后续
真正可见的 commit 重新调度。

prewarm 的 `materialized / unchanged / not_ready` 状态由 shared contract 统一解析。success 与 not-ready HTTP 均通过
同一 safe identity DTO；测试特意给内部 identity 注入绝对 `databasePath` 并证明响应不泄漏。unexpected failure
保留 current prior-ready pointer 原文，先向既有 operational logger 写一条带 prior-ready safe identity 的
`failed / UNEXPECTED_ERROR`，随后 rethrow；不会用失败 candidate 覆盖上一份 ready package。

本地 TDD 分别覆盖 UUID 拒绝、Run/phase deterministic eventId、queued correlation、replay→live resume、React
commit/非空可见 content/paint 顺序、package-first 与 lazy tool 首次打开 workspace、not-ready 与 unexpected
failure 的安全 identity/pointer 及旧 ready package 保留。真实浏览器 paint、
Provider 首 token 与 production prewarm/backfill 仍需部署后的三个 Project 验收，不能由这些自动化测试替代。

第五轮复审后的最终收口进一步区分“Run 可见”与“包外查询已经执行”：

- 对 package 无法直接回答的趋势、逐日或 SQL 问题，服务端仍先鉴权并创建可见 Run，发送
  `RUN_STARTED` / `request-accepted`；此时为 0 scoped workspace、0 完整 ProjectAnalysis。只有 Agent 随后明确调用
  既有 governed read-only tool 时，lazy datasource 才首次打开 workspace，并只执行一次受预算约束的定向查询。
  `targeted_query` 是包缺口的准备状态，不再等同于发送热路径上的 eager workspace 初始化；
- exact package pointer 升级为完整 binding key，包含 Scope、window、from/to、Snapshot/Release、Report-time、
  hierarchy/mapping/formula、Calendar/Tariff、renderer/recipe 等安全 revision fingerprint。同一 Project 的不同 Scope
  或不同 window 各自可达，不再互相覆盖；另保留按 request Scope/window 的 latest index，只用于寻找正确的
  prior-ready projection，不替代 exact binding；
- 在既有 `project-analysis-cache` 目录内增加按 target key 原子写入的 latest prewarm outcome sidecar。它不是新
  Store/schema，只记录安全 attempted identity、outcome/reason/trigger/timestamp，以及存在时的 prior-ready ref 和
  safe identity。`not_ready` 与 unexpected `failed` 均可在进程重启式重读后核验；失败 candidate 不改变 ready
  pointer。Windows 并发替换同一 sidecar 由进程内 per-target 写队列串行化，Linux 仍使用既有 atomic rename；
- Web 的 committed-message ledger 不再保存 assistant 正文，只保留 message id、correlation、非空标志与必要的
  visibility handle；按 thread 有界淘汰，并在 paint、terminal 或 thread cleanup 后逐出，避免长对话把完整模型
  内容和闭包长期留在内存；
- Import、Tuya、Project Release、Tariff 与 Calendar 都复用同一 prewarmer 和 outcome event。Tuya 不再另打一条
  重复 ad-hoc 日志，避免同一 lifecycle 被误读为两次物化。

对应本地门证明：真实 package-gap 测试中 Run 可见早于 workspace，workspace 只打开一次且 full resolver 为 0；
root/alternate-window/child-Scope 三份 package 同时可读；并发 prewarm sidecar、`not_ready` 与 `failed` restart-style
重读通过；Web content-free bounded ledger 通过。以上仍不等于生产首 token 或浏览器 paint 证据，发布后必须用同一
correlation timeline 单独验收。

第六轮复审后的入口与零写约束：

- composer、branch rewrite 与 deferred branch run 统一经过 `prepareEnergyRunDispatch`。每次真实 Send 只生成一次
  correlation；queue/retry 继续携带原 id，不再次 begin latency ledger；
- paint 除了消息自身非空、未折叠和 React committed，还要求 owning Session 是当前 active thread，且它的真实 DOM
  surface 已连接、参与 layout、不是 `display:none`/`visibility:hidden`。后台 Session 即使继续收到 stream，也不会提前
  记用户可见 paint；切回且真正可见后才可重新调度；
- exact identity 的 `unchanged` prewarm 现在只发结构化 operational log，不重写 package、pointer 或 outcome sidecar。
  TDD 对 cache 目录文件集合、SHA-256 与 mtime 做调用前后 fingerprint，证明 0 full SQL 且 0 write；
- Web live-run reducer 复用 contracts 中 preparation event、contract revision、phase 与 package-status guards，不再维护
  第二套字符串 decoder。

第七轮复审继续补齐恢复与可见性：inactive Session 的 one-chunk Run 即使已经 terminal，仍保留尚待首次 paint 的
message ownership；切回 active 时由 Session activation 显式触发 visibility retry，不要求模型再发一段 token，也不
人工重提 content commit。成功 paint 后或没有 pending paint 的 terminal Run 才清理关联 ledger。live/restored HITL
把原始 UUID correlation 写入 checkpoint-restorable agent state，resume 从该状态解析并复用，绝不为同一 Run 新建 id。
Analysis package binding fingerprint 还会先排序 metric/rule revision id 集合；相同语义集合仅顺序变化仍命中同一 exact
package，保持 `unchanged`、0 SQL、0 write。

第八轮复审将 terminal lifecycle 收口到服务端 Run identity：client 从已验证的 deterministic milestone `eventId`
建立 `Run id → correlation` 绑定，`RUN_FINISHED / RUN_ERROR` 只清理该 Run 自己的 snapshot，绝不再用 thread 中
“最后一个 Send”猜测归属，因此并行 Run 即使乱序结束也不会删掉较新的 queued Send。HITL 的 suspended state 继续
沿同一 checkpoint correlation；其 transport `RUN_FINISHED` 不作为 durable terminal，resume 后首次正文仍归属于原
Run。后台 Session 的单段答案在 terminal 时保留待 paint ownership，切回可见后完成真实 double-rAF paint 即同时
清理 terminal snapshot，不需要第二个 finish event。metric/rule revision fingerprint 则统一复用 canonical sort
normalizer，在保留完整 revision multiset identity 的同时消除仅由输入顺序造成的 cache miss。

最终协议收口由服务端为 completed、failed、canceled 三类 durable terminal 统一附加 authoritative `runId`、
`runTerminalKind=durable` 与 canonical status；HITL 暂停时为了结束本次 transport 而发送的 finish 则明确标为
`transport-suspended / suspended`。client 不接受缺少 `runId` 的 terminal，也不以最新 Send 补猜归属。这样真实
RunFinalizer、early failure、runtime forwarding 与浏览器 ledger 使用同一终态语义；result-cache key 与 resolver safe
fingerprint 也改为复用唯一的 revision-set canonicalizer，不再分别维护两份排序实现。

## 2026-08-31：浏览器断连与 60 秒误回收修复

生产复现把两类等待分开：缺少 exact Analysis Context Package 时，发送后先执行完整 ProjectAnalysis，首段模型内容约
36 秒；同一 identity 的 package 已物化后，下一次新任务约 1.7 秒出现首段模型内容。说明主要启动空档来自 Run 前的
完整分析准备，而不是 DeepSeek 首 token。发布/身份切换后必须显式预热，普通提问热路径只读取 immutable package；
包外问题仍在 Run 可见后使用受控只读定向查询。

同一生产验证还发现长 Run 在约 60 秒后被标成 `STALE_ACTIVE_RUN_RECLAIMED`。根因不是模型超时或服务重启，而是
AG-UI 浏览器 transport 断开时错误地释放后端 Run cancel ownership；完成/取消的异步持久化窗口也会过早释放 ownership，
使 Session poller 把仍在运行或正在收尾的 Run 当成孤儿。修复后 transport teardown 不再取消后端 Run，且 ownership
持续到 completed/canceled terminal finalization 真正 settle 后才释放。TDD 覆盖 transport unsubscribe 后 Run 仍可取消、
cancel finalization 阻塞期间 ownership 仍存在、settle 后才释放，以及 stale-run reclaim 与 Run identity 回归。该证据是
本地自动化；部署后仍须让一个超过 60 秒的真实 Run 完成，并核对 UI/Metadata 均为 `completed`。
