---
title: "Overview 夜间执行路线：Preschool、AI Slot、连续数据与 Ngee Ann"
summary: "记录 2026-08-10 夜间四段主线的方案、反证、执行状态、验收证据和停止条件。"
doc_type: implementation
tags: [Overview, Preschool, AI Slot, A/B, Ngee Ann, 夜间执行]
updated_at: "2026-08-10"
related:
  - "../records/2026-08-06-Overview夜间执行清单与Runlog.md"
  - "../decisions/2026-08-06-Charles系统价值复核与连续数据演示决策.md"
  - "2026-08-08-AI-Analyst-Harness与AI-Slot执行路径.md"
  - "../handoff/agent/2026-08-09-Preschool-Overview-AI-服务端可信闭环合并交接.md"
status: active
---

# Overview 夜间执行路线：Preschool、AI Slot、连续数据与 Ngee Ann

## 1. 北极星与执行纪律

今晚不以代码量、图表数量或 Ticket 关闭数量衡量进度。每一项交付必须帮助 Boss/FM 更快回答：

1. What：发生了什么，什么值得关注；
2. Why：影响多大，哪些 Evidence 支持 driver，哪些仍是假设；
3. How：下一步做什么，不做可能怎样，如何验证。

执行纪律：

- 每个切片先写方案、反证、验收、停止条件，再开发；发现新情况就更新本文，不依赖聊天上下文。
- 主 Agent 负责范围、架构、合并、证据和停止决策；独立子任务可交给执行 Agent，主 Agent 必须复核。
- 保护 Integration 现有脏工作树；只提交明确归属的文件，不 reset、clean、覆盖或吸收并行 WIP。
- 自动测试、真实 Provider、真实浏览器和 Charles/用户人工价值验收分栏记录，不互相冒充。
- 不弱化 Workspace/Project/Snapshot、只读 SQL、Evidence 或授权守卫来换取“成功”。

## 2. 今晚固定顺序与依赖

| 顺序 | 主线 | Ticket | 初始状态 | 完成定义 |
| --- | --- | --- | --- | --- |
| 1A | Preschool Section 5 与 Charles 全页复刻复核 | #13 | PRECHECK | Section 5 的呈现与边界清楚；Section 1–5 逐项对照；1440/1920/tablet、测试和截图通过 |
| 1B | AI Slot 价值、可解析表达与 DeepSeek 超时 | #18 / #35 / #30 / #36 | PRECHECK | 关闭长思考或证明其下发；减少无价值循环；固定 Profile/Snapshot 的真实 Provider 2/3 useful；页面表达不复读 |
| 2 | Preschool 连续数据 A→B 演示 | #39（并回填 #13/#21） | BLOCKED BY 1A+1B | 正式导入链路完成 1d/7d/30d 三个更新检查点；Current 更新、Saved A 不变、AI Artifact 同 Snapshot |
| 3 | Ngee Ann Analysis 模板复刻与 AI Slot 适配 | #9 | BLOCKED BY 1–2 | 先形成模板矩阵和最小 Slice；吸收 Preschool SOP，不复制静态数据或硬编码算法 |

允许 1A 与 1B 并行；2 必须等待确定性模板和 AI Run 均稳定，否则无法判断 A→B 失败属于哪一层；3 在前三项形成可复用证据后开始。

## 3. 自我 Grilling：关键反证与夜间默认决定

### Q1：Section 5 是否应伪装成正式 Forecast？

**决定：否。** 当前只有一个月事实，最多交付 Charles 视觉结构相近的 `Demo planning baseline`：公开公式、历史完整周/日型平均、假设和区间。不得把伪随机曲线、模拟 actual 或公开电价写成 Published Forecast、客户账单或已发生事实。

### Q2：把累计表每一行随机加百分比，能否形成可信 B？

**决定：不能直接这样做。** 累计读数逐行随机扰动会破坏单调性，制造负差、假 Spike 和不一致的 Centre/Circuit 关系。B 必须先从 A 生成 Interval deltas，再做带固定 seed 的小幅扰动和少量可解释场景，最后按 Meter 重新累加成 cumulative readings。

### Q3：纯随机小波动能否证明系统有价值？

**决定：不足。** 为了让 A/B 差异可以精确回归，首轮不加入全局随机噪声；使用固定 weekday 28 天平移基线，再加入三个已知但不写死到分析逻辑的确定性场景：Jun 3–23 工作日所有 Centre 的 Aircon 1 长窗改善、Jun 24–29 Centre L closed-hour load 持续上升、Jun 30 Centre G 的短期工作日 Spike。系统必须通过正常计算与 Agent 查询重新发现它们；前端和测试不得直接读取“答案标签”。若后续需要稳健性测试，再在独立 lane 加固定 seed 的小噪声。

### Q4：1d、7d、30d 如何测试，而不建设实时平台？

**决定：使用同一份可复现的 June B 数据，形成 Day 1、Day 1–7、Day 1–30 三个 staged source 检查点。** 页面分别验证 `latest-complete-day`、`latest-complete-7d`、`current-overview-28d`；30 天是 Source coverage，不冒充现有产品合同中的 28 天长窗。首次配置走 Register → Mapping → materialization → Publish；纯数据 B 继续走 Register/manifest → Mapping 复核 → materialization/激活 → Overview → AI Artifact，避免为了数据变化无意义生成第二个 hierarchy/template revision。

### Q5：新 Snapshot 后是否由第一个用户触发 AI？

**决定：否。** 成功发布后只为 Project-level Current Overview 预生成一次共享 Artifact；页面只恢复 matching Artifact。授权读取仍逐次检查，Saved A 永不被 Current B 改写。

### Q6：如何解决 300 秒超时，又不把 Agent 限制成固定 SQL Pipeline？

**决定：先验证 Profile → Run Context → Provider options 的 `reasoningModel=false` 全链路，再用 Harness 识别重复 Schema/SQL/Reasoning。** 不先增加超时，不规定固定分析主题和 SQL；只删除重复上下文、重复查询与无价值长输出，保持 Agent 自主选择分析角度。质量门仍是 Evidence、Insight 和安全，耗时/轮数只做诊断。

### Q7：DeepSeek 仍失败时是否静默切 StepFun？

**决定：否。** 当前验收固定 Profile 且 fallback 关闭。可以单独跑 StepFun 对照定位 Provider 问题，但不能用 fallback 成功冒充 DeepSeek 稳定通过。

### Q8：Ngee Ann React 原型能否直接复制？

**决定：只能复用信息结构和组件意图。** 原型中的静态 TypeScript 数据、硬编码费率/阈值、固定日期和未完成按钮不能进入正式 Renderer。每个模块必须映射到已有 Snapshot/ViewModel/Evidence，缺输入就局部 Unavailable。

## 4. 切片 1A：Preschool Section 5 与全页复刻

### 方案

1. 对照 Charles Section 5 的标题、KPI、日/周/月、Centre filter、主图、说明和交互，列出 `retain / adapt / drop / unavailable`。
2. 先核对当前服务端 Projection 和 May 1–31 Snapshot；React 不重算 Forecast、Tariff 或周平均。
3. 对齐用户阅读路径：结论/规划意义 → 关键数字 → 趋势图 → 局部切换 → 假设与 Evidence。
4. Section 5 完成后，从 Section 1 到 5 做一次全页 60 秒阅读和 Charles 截图对照，缺口进入同一 #13 checklist。

### 潜在问题

- 当前页面 URL 的 May 1–31 不保证底层 Artifact 也是 May 1–31；必须核对 Snapshot/Period，不能只看 query string。
- June 无真实 Calendar、事实或已发布 Forecast Recipe 时，只能展示 Demo baseline，不得填充假的 `actual`。
- Centre filter 若改变局部图，只能使用同一 Snapshot，不得重跑整页或 AI。
- Charles 模板内部存在 30/31 Centres 矛盾，以真实 fixture 30 Centres 为准。

### 验收

- 聚焦 Projection/ViewModel/Renderer tests；typecheck/build/diff check。
- 已登录真实页面 1440×900、1920×1080、tablet；无全页横向溢出与 console error。
- 保存 Charles/Current 对照截图和一份逐模块矩阵。
- 人工复核仍只记录为 `ready-for-human`，不替 Charles 签收。

### 停止条件

- 需要伪造 June actual、正式 Forecast、客户 Tariff 或第二套 Forecast 平台；
- 必须在浏览器重算服务端权威数字；
- 为视觉复刻破坏 Snapshot/Evidence 或当前 Section 1–4 Golden。

## 5. 切片 1B：AI Slot 价值与 300 秒超时

### 方案

1. 复盘最新真实 Run 的每轮 reasoning、tool、SQL、commit 和最终输出阶段，区分 Provider 慢、thinking 未关闭、上下文重复、工具循环和合同修复。
2. 验证统一 Model Profile 的 `reasoningModel=false` 是否一路进入 Provider-specific options；补自动化断言和真实 event 证据。
3. 保持一次页面级 Run，同时输出 section interpretation、page synthesis、autonomous insights 和可选 Presentation Blocks；Runtime 只校验可信展示资格。
4. Prompt/Skill 明确淘汰“复读 KPI、数据质量正常、总量已验证”等低价值候选，要求额外比较、模式、转折、集中度、持续性、反证或可执行验证；允许 0 条。
5. 以 #30 Harness 做固定 Snapshot/Profile 三轮记录，保存 Run id、耗时、工具序列、失败类别、Finding 质量和是否有图；至少 2/3 useful。

### 潜在问题

- 关闭 Provider thinking 不等于禁止 Agent 多步工具推理；要区分模型隐藏思考开关与自主 ReAct 工具循环。
- 过度压缩 Context 可能让 Agent 忘记 Schema/Evidence pins；任何删减必须通过 deletion-invariance。
- 为减少延迟设置固定 SQL/轮数上限可能导致浅分析；轮数只能诊断，Runtime timeout 仍是故障保护。
- 输出可解析不等于有价值；确定性 grader 和人工 Insight rubric 必须分开。
- Artifact 发布不能依赖浏览器 GET、副作用或 per-user cache。

### 验收

- Provider options 单元/集成测试；AI Artifact、Saved/Resume、Typed Evidence 与 Presentation fallback 回归。
- 固定 Preschool Snapshot 的三次真实 Provider 运行，fallback 关闭。
- 1440/1920/tablet 验收 analyzing/available/unavailable、有图/无图、Evidence 和 reload resume。
- Finding 必须给新决策价值；仅改写 visible KPI 判为 not useful。

### 停止条件

- 需要弱化 Evidence、Snapshot、授权或只读 SQL；
- 需要通用 Prompt optimizer、第二 Runtime、任意 HTML/JS/React；
- DeepSeek Provider 本身持续超时且 thinking=false 已确认下发：记录为 Provider 对照问题，不用无限 timeout 掩盖。

### 真实 Run 后最小修复校准（02:05 SGT）

已取得反证：DeepSeek 在约 115 秒内完成，`reasoning_model=false` 已下发，最终回答内部也包含候选 JSON；失败原因是它在 JSON 前后输出了长篇工作流说明。当前通用 EnergyIQ policy 在 `analysisRequirementsMode=omit` 时仍提到 requirement/commit，诱导模型寻找不存在的 requirement id 和 commit tool。

本轮实施边界：

1. 通用 Analyst 保持原有 Requirements 协议；只有 `analysisRequirementsMode=omit` 的 Overview Stage 删除 requirement/commit 语言，明确该 Stage 没有 commit 步骤。
2. Investigator Prompt 升版，并要求最终响应从 `{` 开始、以 `}` 结束，禁止 Markdown fence、过程说明和前后总结；仍允许在工具循环中自主探索。
3. Parser 只在最后一个 Assistant message 内寻找受长度限制的 Candidate envelope；不再跨整个 Run 扫描所有思考消息。找到 envelope 后仍执行完整字段、Evidence、实体、单位和 Snapshot 验证。
4. 不降低 Evidence、实体、单位或 Snapshot 校验，不提高 300 秒上限，不给 SQL 设置硬配额。
5. Prompt revision 变化必须生成新 Artifact identity；修复后只跑一次真实 Provider 验证，再根据明确错误决定是否继续。

潜在问题检查：

- 若只强化最后一句 Prompt，而保留上游矛盾 policy，模型仍可能绕路；两处必须同时校准。
- 若跨整个 Run 宽松提取 JSON，可能误拿工具轮次中的草稿；只允许最后一个 Assistant message 作为提交边界。
- revision 未同步 API、Web 与 Saved Analysis 会造成新结果被客户端误判为旧合同。
- 去掉 commit 语言不能影响普通 AI Analyst；需要一条默认模式回归和一条 omit 模式测试。

## 6. 切片 2：Preschool 连续数据 A→B

### 数据生成方案

- 固定 seed 和 generator revision；输入、输出 SHA、规则、日期移位、noise 和场景参数全部写入 manifest。
- 从 May 原始累计数据计算 interval deltas；用固定 weekday 28 天平移映射到 June，并应用三个确定性业务场景；限制非负并重新累计。首轮不加全局随机噪声，以便精确归因和回归。
- 输出一份完整 June Excel，以及 Day 1、Day 1–7、Day 1–30 三个 staged fixture/manifest。Fixture 是模拟 Source 数据；materialization、Snapshot、Overview、AI SQL 和 Artifact 必须走真实代码。

### 正式链路与判据

1. 在隔离服务/存储运行，不覆盖共享 8787/3102 或现有客户数据。
2. 建立并保存 A；导入 Day 1、Day 7、Day 30，逐次完成正式 Materialization/激活。A 的配置只 Publish 一次；B 不因为纯数据变化而生成无意义的新 Template Revision。
3. 每一步验证 Current deterministic metrics、Section 5、AI Artifact identity 和页面恢复。
4. 最终证明：Saved A fixed；Current B updated；A/B Snapshot、Release、Evidence、AI Artifact 不混；同 Artifact 两个授权用户读取不产生第二次 Provider Run。
5. 记录 materialization、Overview resolve、AI time-to-available 和 cold/warm page timing；不以性能优化替代正确性。

### 停止条件

- 需要直接改 SQLite/DuckDB 或复制生产公式到测试；
- 生成数据出现负差、重复键、孤儿事实、跨 Meter 不连续或业务场景无法通过 SQL 证明；
- Saved A 被 B 改写，或 Current 数字与旧 AI Artifact 混用。

## 7. 切片 3：Ngee Ann 复刻与 SOP 复用

### 方案

1. 只读审计 `127.0.0.1:4178/analysis` 与源码，保存模块截图和交互矩阵。
2. 使用叙事顺序：数据可信度 → 异常发现 → KPI → 时间/空间/设备下钻 → Findings → Actions；不要复制原型静态实现。
3. 对每个模块回答：客户问题、确定性 Metric/Projection、ViewModel、Renderer、Evidence、AI interpretation、Unavailable 行为、实现估时。
4. 先完成 Charles/NAP 模板基础对齐，再加入与 Section 对应的 AI Slot；不让 AI Slot 替代缺失图表或确定性计算。
5. 把 Preschool 得到的模板矩阵、section interpretation、Presentation Blocks、Snapshot Artifact 和 A→B SOP 提炼成可复用 Pattern Cards；第三个真实项目之前不抽通用 Renderer 平台。

### 停止条件

- 原型指标需要当前 Kernel 大改或依赖未知真实数据；
- 只能通过硬编码静态数据/阈值/费率实现；
- 为两个案例相似外观提前建设 Dashboard DSL 或自动模板生成平台。

## 8. 夜间 Runlog

状态词：`PRECHECK / READY / DOING / DONE-ENGINEERING / BLOCKED / READY-FOR-HUMAN`。

| 时间 | 切片 | 状态 | 证据 / 决定 / 下一步 |
| --- | --- | --- | --- |
| 2026-08-10 01:20 SGT | 总路线 | READY | 已完成自我 Grilling、依赖排序、验收与停止条件；等待三个只读预检回报后校准各切片并开始 1A/1B。 |
| 2026-08-10 01:24 SGT | 1A Section 5 | DOING | 真实 3102 页面与 Projection 复核确认：May 1–31、30 Centres、4 个完整周、June planning baseline 26,240 kWh / S$7,156 均来自同一 Snapshot。旧实现只完成诚实 Planning Baseline，不是 Charles Forecast 复刻；A/B 已补出真实 Plan/Actual 后，Task A 必须继续完成状态条、四 KPI、Estimate-vs-Actual、日/周/月和 Portfolio/Centre 局部切换。详见 `2026-08-10-Preschool-Section5-Charles复刻执行方案.md`。 |
| 2026-08-10 01:25 SGT | 1A 全页复核 | DOING | Sections 1–5 基础模块均已存在；剩余检查集中在 60 秒阅读路径、英文价值表达、responsive/browser evidence，以及 A/B 后的 Section 5 Actual-vs-plan。 |
| 2026-08-10 01:27 SGT | 1B DeepSeek 预检 | READY | 已独立复核代码：Overview Stage 仍使用通用 `data-analysis` protocol；Runtime 会额外注册 `analysis_requirements_commit`，而 `reasoning_model=false` 未在 Stage input 明确下发；Web revision 仍为 v1，服务端已为 v2。执行边界确定为：复用现有 assembly 增加窄范围 Stage 选项，移除无关 Requirements commit、显式关闭 Provider thinking、同步 v2；不加超时、不设固定 SQL/思考轮次、不弱化 Evidence。 |
| 2026-08-10 01:30 SGT | 2 A/B 预检 | READY | 现有旧 B 仅 7 天、只改 14 个 interval，可作为格式探针但不足以验收。新 B 采用 30 天 source coverage + 1d/7d/28d 产品窗口，固定 weekday 基线和三个可解释场景；纯数据 B 不重复 Publish 配置。Saved A、Current B、Evidence、AI Artifact 必须逐字段证明不混。 |
| 2026-08-10 01:31 SGT | 3 Ngee Ann 预检 | READY | 4178 是约 3.8 万行静态 mock，结构可参考但固定数字/费率/营业时间/15% 阈值/建议不可搬运。当前正式 Renderer 图表底座已较完整；最小下一切片优先补 Ngee Ann 服务端 Overview AI Artifact 与 A/B identity，不先建设第二套 Renderer/Runtime。 |
| 2026-08-10 01:57 SGT | 1B 真实 Provider | BLOCKED | Chrome 管理员会话已真实触发 v2 Artifact attempt 2；Run `overview-ai-investigator-e99fb76f-7fe7-48cb-b179-87acc9aaf963` 在 2ms 内以 `CONFIG_RESOURCE_NOT_FOUND:model-profile:energyiq-deepseek-v4-flash` 失败。反证了“仍是 DeepSeek 长思考”的假设：本次卡点是 Overview 仍把系统统一 Profile 当成调用用户私有 Profile 解析。最小修复是复用现有 `workspace-default` 虚拟 Profile 与 system binding；不得复制 Key、为每个用户建 Profile 或静默换模型。修复后创建新 Artifact identity，再验证 `reasoning_model=false` 和工具序列。 |
| 2026-08-10 02:05 SGT | 1B 真实 Provider | DOING | 系统统一 Profile 修复后，Run `overview-ai-investigator-2d3b529f-2237-432b-a897-14f9d8665091` 已真实调用 DeepSeek 并在约 115 秒完成，未触发 300 秒 timeout；Trace 确认 `reasoning_model=false`、未注册 `analysis_requirements_commit`，执行 16 次只读 SQL。当前 Artifact 以 `OVERVIEW_AI_INVESTIGATOR_RESULT_INVALID` 失败，说明连接、授权与长思考已不再是本轮卡点，剩余问题位于最终 Candidate JSON 的格式或字段合同。下一步只定位最后一条 Assistant 输出与 parser 差异；不得用放宽 Evidence 验证或无限重跑掩盖。 |
| 2026-08-10 02:17 SGT | 1B JSON 提交边界 | BLOCKED | v3 首轮约 112 秒完成，但最终仍把过程说明放在 Candidate JSON 前。随后发现第一次重启只重建了 API，未重建共享 `agent-runtime`，导致旧的 requirement/commit policy 仍在运行；补构建后 v3 第二次仍暴露更深卡点：`analysisRequirementsMode=omit` 只隐藏了 Prompt/commit tool，却没有跳过 Protocol 的 user requirement extraction，所以 SQL 仍要求 Agent 猜 `requirement_ids`。这不是模型质量问题，而是 Stage mode 语义未闭合。 |
| 2026-08-10 02:22 SGT | 1B Stage mode 修复 | DOING | 最小修复确定为：omit 模式从 Protocol 创建前就返回空 user requirements，使只读 SQL 可在 Project/Scope/Snapshot allowlist 和原有 SQL validator 下执行但不需要预定义 requirement id；普通 AI Analyst 保持原 extraction/commit 流程。有效 Stage 合同升为 `preschool-investigator-v4`，待 Runtime/API 重建后只进行一次新身份 Provider 验收。 |
| 2026-08-10 03:05 SGT | 1B Stage submission 识别 | DOING | v4 已证明真实模型能够在 75 秒左右产出合规 `candidates` envelope，但 Runtime 可能在模型提交后追加没有 envelope 的状态消息。v5 只在独立 Assistant message 边界内从后向前选择最近一个含目标 envelope 的提交，再继续既有 Evidence/typed validator；不扫描任意 Run 文本，不放宽事实校验。若 v5 仍失败，则停止继续改协议并登记阻塞。 |
| 2026-08-10 03:14 SGT | 1B 真实事件格式校正 | DOING | v5 首次真实 Run 在约 65 秒完成 8 次工具事件并产出 3 条 `candidates`，但线上 AG-UI 流使用现有 `TEXT_MESSAGE_CHUNK`，Stage 归一化器只接收测试里的 `TEXT_MESSAGE_CONTENT`，导致合法提交未进入 parser。最小修复仅兼容这两种仓库已存在的文本事件；同一 v5 只允许再 retry 一次，仍失败即停止。 |
| 2026-08-10 02:26 SGT | 1B AG-UI 提交消息边界 | DOING | v4 真实 Run 已证明 SQL 可成功执行且不再出现 requirement/commit 绕路。新发现：`normalizeStageEvents` 把一个 Run 内所有 `TEXT_MESSAGE_CONTENT` 拼接解析，错误地把工具轮次间的 Assistant 说明与最后提交 JSON 混为同一 payload。最小修复为按 `messageId` 聚合并只解析最后一个非空 Assistant message；保留现有最终消息内的 bounded envelope extraction，随后仍执行完整结构与 Evidence validator。已补“前序说明 + 最终 JSON”回归测试，不把工具轮次草稿当提交。 |
| 2026-08-10 03:54 SGT | 1B v5 真实 Provider | BLOCKED | Artifact `overview-ai-artifact-c20db67b9cc399c0df083687` 已在 attempt 2 完成；Investigator `overview-ai-investigator-5ab55cba-1018-44a1-b829-b788049b466d` 约 69 秒、Editor `overview-ai-editor-099f1d77-c1c6-438a-961b-e792a0ec7e99` 约 61 秒，均使用 `deepseek-v4-flash` 且 `reasoning_model=false`，未再触发 300 秒 timeout。Artifact 虽为 `available`，但 `findings=[]`：Editor 把 Centre H 内容标成 `candidate-1`，而 Investigator 的 `candidate-1` 实际是 G/M/J；同时 Editor 丢失原候选 SQL indexes 并生成不存在的 Evidence id。Runtime 拒绝是正确行为，不能放宽 validator。 |
| 2026-08-10 03:58 SGT | 1B Editor 身份修复 | READY | 最小修复不建设 Typed Evidence 平台，也不让 Runtime 猜测错误文本属于哪个候选。Investigator 继续自由发现并提交完整候选；Editor 只做 accept/reject、优先级、Section placement 和关系判断，不再重写候选事实或重新填写 Evidence。Canonical Finding 的标题、takeaway、解释、下一步、Presentation 与 Evidence 全部从被选中的 Investigator candidate 继承；MVP 每个 Finding 只允许一个 source candidate，避免无法确定的跨候选合并。修复后先做 ID/内容错配红测、Evidence 继承和零候选回归，再只跑一次真实 Provider。若候选本身文案仍不够人话，后续调 Investigator Prompt，不把自由改写权重新塞回 Editor。 |
| 2026-08-10 04:02 SGT | 1B Chrome 回读 | BLOCKED | 已在真实管理员 Chrome、3102 Preschool Overview 回读：页面显示 `AI analysis unavailable`，没有把 `available` 但零 Finding 的 Artifact 冒充为有效分析。这与 Runtime fail-closed 一致；待 Editor 身份修复后复跑一次 Provider，并同时验收 Section 插入、页面级 synthesis 与 reload resume。 |
| 2026-08-10 04:05 SGT | 1A 全页回归 | DONE-ENGINEERING | 真实 3102 页面确认 Section 1–5 顺序完整，Section 5 仍明确区分 Planning baseline、Live Forecast unavailable 与尚不存在的 Actual；1280px 页面无 document-level 横向溢出。Registry 旧断言已从 4 类 Appliance aggregation 校准为 standby/operating 各 9 个 Circuit-alias donut segment 与 9 个 ranking row。ViewModel、Renderer、Registry 共 24/24 测试通过。仍保留 Charles 人工阅读验收，以及 A→B 后 Actual/Pace 数据态验收。 |
| 2026-08-10 04:12 SGT | 2 A/B Projection 风险 | PRECHECK | 代码复核发现 `preschool-operational-projection.ts` 仍硬性要求 May 1–31、31×24 cells，并把 Planning target 固定为 June。真实 B 即使成功推进 Snapshot，June 的 Section 3/4 仍可能 fail closed，Section 5 也未必能把 June actual 与 A 的 June plan 对照。先等待隔离 API run 证明实际行为；若命中，只允许做 Preschool 项目专属的当前完整窗口泛化与 A-plan/B-actual 薄适配，不建设通用 Forecast/Scheduler 平台，也不把 unavailable 改成伪数据。 |
| 2026-08-10 04:18 SGT | 2 A/B 首轮正式 HTTP | BLOCKED | Clean 8788 API 在约 95 秒后 ready，May A materialization 服务端持续 CPU 活跃且无应用/OOM 日志；请求在约 307 秒收到 `fetch failed`，随后 runner 的 finally 才终止自有 API。时间与 Node/Undici 默认约 300 秒 response-header timeout 一致，而不是 15 分钟业务超时或数据错误。保留失败 run；runner 将补 method/path/phase/error.cause telemetry，并仅对长 materialization acceptance transport 使用 15 分钟 `node:http` socket timeout，不修改 API/Provider 产品 timeout。测试后只重跑一次。 |
| 2026-08-10 04:25 SGT | 夜间自我 Grilling | DONE-ENGINEERING | 反问并固定两条边界：不能为“页面有 AI”而放宽事实校验；也不能把 Snapshot 已更新但 Section 2–5 失效的 A/B 当成功。AI 以“自由发现、Runtime 证明”为准，A/B 则拆成 deterministic provenance 与客户可见模块可用性两组判据。 |
| 2026-08-10 04:34 SGT | 1B Editor v2 真实根因 | DOING | v2 Investigator `overview-ai-investigator-ba8587ce-3fd2-4ec8-9d9b-ebbe3374c718` 约 55 秒，已产出有增量价值的假设：G/J/M 的 priority 主要由 provisional area/headcount 小分母放大，而非绝对耗能领先。Editor `overview-ai-editor-e276b567-3fa2-425f-b471-9506bf0b45c5` 约 17 秒返回空结果，精确原因不是模型能力或 Evidence：Editor 输入 29,752 字符，Conversation Memory 的当前消息边界只保留前 6,000 字符；原 Prompt 把 19k 的重复 Overview Coverage 放在候选前，候选完全未送达模型。最小修复把 Editor 输入收窄为 candidate selection view + compact coverage，canonical 内容仍留在服务端，Runtime 校验不变；Prompt 增加 6,000 字符 fail-fast。15/15 Workflow 测试已通过，待相关回归和一次真实 Provider 验收。 |
| 2026-08-10 04:38 SGT | 2 A/B Day 1 | BLOCKED | 正式 Source→Materialize→Publish/Resolve 已证明 Snapshot 更新、Saved A byte-stable，Release/Mapping 未漂移；但同时暴露两个不能掩盖的产品缺口：`latest-complete-day` 仍锚定系统当天 2026-08-09，历史/模拟 B 的 1d 窗口返回 0；28d Operational 因 `PRESCHOOL_OPERATIONAL_EVIDENCE_MISMATCH` fail closed，Section 3/4 unavailable，Section 5 也没有 A-plan/B-actual。AI 还因隔离环境缺统一模型 Profile 未启动，未使用 mock Provider。Day 7/30 继续只为完成 Snapshot/Saved-A 证据；客户可见 A/B 必须另做 Preschool 项目专属窗口锚点与 Operational/Planning 薄适配。 |
| 2026-08-10 04:46 SGT | 1B v2 唯一重试 | BLOCKED | Investigator `overview-ai-investigator-6e983230-ea98-4507-bc32-01045f5aa991` 约 89 秒完成，未超时，并再次产出 G/H 双归一化对照洞察；失败点是可选 Presentation 第一个 text block 后多出一个 `]`，导致整个严格 JSON 无法解析，Editor 未启动。不得继续盲重试。最小可靠性修复只允许在 Candidate 必填 JSON 可保持原文时，丢弃末尾语法损坏的可选 `presentation`；不修复任意 JSON、不改写 Finding、不跳过后续 Runtime Evidence 校验。并行 8788 全量 materialization 使本轮本地测试明显变慢，先等待隔离链结束再做完整绿色回归和新 identity 的一次 Provider 验收。 |
| 2026-08-10 04:58 SGT | 2 动态窗口复核 | READY | 1d 返回 0 的精确根因是 Project Analysis Resolver 漏把 `latest-complete-day` 送入现有事实日期锚定分支；不需要重写 selector。Section 3/4 的独立根因是 May 1–31 与 `30 × 31 × 24` 硬编码；最小修复只泛化 Preschool 当前 28 天，并保留 Calendar、完整性、Circuit reconciliation 和全部 Evidence pins。Section 5 另做 Saved A plan / Current B actual 双 provenance 薄适配；Day 1/7 只显示 partial actual，Day 30 才计算完整 delta。完整边界已写入连续数据 A-B 实施记录。 |
| 2026-08-10 05:04 SGT | 1B v3 真实 Provider | BLOCKED | 新 Artifact `overview-ai-artifact-54c80f43e2a81be70c9958ba` attempt 1 完成；Investigator `overview-ai-investigator-4f54b3d2-1149-4301-b99d-586ba0e3db7b` 约 83 秒，Editor `overview-ai-editor-9d0ece53-3e4d-4f4b-8fb9-c06ff53995de` 接受候选，证明 optional Presentation 降级与 compact Editor 输入均生效。但 Runtime 最终正确产出 `findings=[]`：候选把 Coverage 的 claim path（如 `preschool.benchmark.centres...`）误填成 Evidence id，并用心算的 `~9%`，而不是精确引用 `portfolio:window` / `benchmark:priority-centre:*` 或让 SQL 返回该比例。最小下一步只强化 Investigator 提交合同：Evidence refs 必须逐字来自 Catalog id；SQL 只引用成功结果的实际序号；派生百分比/比例必须由 SQL 明确返回。保持 Runtime validator 不变，Prompt 升版后只允许一次新 identity Provider 验收；仍为空则停止 AI 实现扩张并保留可用的确定性 Overview。 |
| 2026-08-10 05:05 SGT | 2 Day30 正式链 | BLOCKED | Day30 materialize 请求精确运行 `900,016 ms` 后命中验收 transport 的 15 分钟停止条件，未产生 Day30 Snapshot，8788 已释放。May/Day1/Day7 分别约 8–10 分钟，说明核心热点在每次 Manifest 变化后全量重解析、事实重写和 canonical integrity，而不是 Overview resolve。禁止继续加 timeout 或第三次全链重跑；先加 phase timing，并仅做 formatter cache、数组 append 两个语义不变优化，以 May Golden/现有 materializer tests 证明后才单独重跑 Day30。 |
| 2026-08-10 05:18 SGT | 1B Investigator v6 | DONE-ENGINEERING | Investigator 提交合同已升级为 `preschool-investigator-v6`：Evidence 只能逐字引用 Catalog `item.id`；成功 SQL 采用 Runtime 实际的 1-based index；排名、比例、差值必须由 SQL 明确返回。Editor 质量规则同时纠正“绝对 kWh 接近即可否定 EUI/per-pax”的错误推断：先核实 provisional 面积/人数，若元数据成立则继续调查固定负荷、基载或时段。Runtime validator、workflow 与 Editor identity 保持不变；109 项相关测试与 typecheck 已通过，尚未运行 Provider。 |
| 2026-08-10 05:22 SGT | 2 动态 Operational | DONE-ENGINEERING | `latest-complete-day` 已复用事实 cutoff；Operational v3 已把 Day1/Day7 当前 28 天派生为 20,160 个完整 Centre-hour cells，并保留 Calendar、Circuit reconciliation、Snapshot/Release/Hierarchy/Mapping fail-closed。缺 1 cell、Calendar 不覆盖及任意 July 28d 均拒绝；full-May v2 Saved Analysis 仍可读。Section 5 A-plan/B-actual 未混入本切片。 |
| 2026-08-10 05:27 SGT | 合并回归 | DONE-ENGINEERING | 主 Agent 复核 AI、动态窗口和 materialization 计时边界后，13 个测试文件 174/174 通过，覆盖 Resolver、Operational、AI Workflow/Artifact、Saved Analysis、Fact Writer 与 Web Renderer。另校准 phase timing：`integrity/checkpoint` 现在包含 materialization stats、Project audit、commit 与 checkpoint，避免低报后误判热点。 |
| 2026-08-10 05:31 SGT | 2 Day30 定点恢复 | DONE-ENGINEERING | 原 failed run 的 exact inspected batch 只 POST 一次并在 `559,601 ms` 成功，产生 `energy-snapshot-b22d0eabc6be53e809a168d2`。1d/7d/28d coverage 均 100%；9 条 Evidence 全 pin Current B；Saved A response bytes/Snapshot、Release、Mapping 全部不变。Day30 的 28d Benchmark/Appliances/Operational 已可用；只剩 Section 5 A-plan/B-actual。分段证据显示 source write `519,071 ms`（约 92.8%）才是主要瓶颈；不在本夜扩建增量平台。 |
| 2026-08-10 05:59 SGT | 1A/2 Section 5 A-plan/B-actual | DONE-ENGINEERING | 真实 isolated 8788 首次回读揭示 formal Saved A 是 May 4–31 四个完整周，而 full-May builder 要求 31 天；新增共享的 complete-weeks recovery seam 后复测通过。Saved A plan `26,240.3992 kWh` 与 Current B June actual `26,912.08 kWh` 分别引用 Snapshot A/B，30/30 后服务端给出 `+671.68 kWh / +2.56%`；Day1/7 自动测试仍 withholding variance。真实 resolve 约 9.2 秒；8788 已关闭。 |
| 2026-08-10 06:07 SGT | 1B Investigator v6 真实 Provider | BLOCKED | 新 Artifact `overview-ai-artifact-f15c1de65f7ad067e5db9138` attempt 1 使用 `deepseek-v4-flash`，Investigator `overview-ai-investigator-528af959-8d8e-490c-a4d8-ab2519df0fad` 在约 118 秒完成，未触发 300 秒 timeout。它自主执行 19 次工具调用并发现两个有增量价值的角度（G/J/M 小分母效应；N 单小时 Kitchen Plug Load 异常），但最后 Candidate envelope 是无效 JSON：未转义 `\"lower-intensity\"`，且 `possibleExplanation` 键值之间误用逗号。Runtime 正确 fail closed，Chrome 回读显示 `AI analysis unavailable`，未展示未验证内容。下一步只复用现有结构化提交/同 Run 单次语法修正 seam，并减少无效工具轮次；不加 timeout、不放宽 Evidence、不盲跑第二次 Provider。 |
| 2026-08-10 06:15 SGT | 1B 结构化提交与上下文减负预检 | READY | 独立反证否决三种扩张：不重新启用面向预定义 Requirement 的 `analysis_requirements_commit`，不建设任意 JSON 自动修复器，不用 SQL 次数硬上限代替 Agent 判断。最小方案是在现有 Agent 装配 seam 注入仅 Investigator 可见的严格 Candidate submit tool；模型仍自由调查，提交后仍走原 Evidence/typed Runtime validator。SQL 侧只增加“先复用已有 Evidence/成功结果、禁止等价重跑、结论足够即提交”的停止提示。Trace step0 的 64,633 prompt tokens 还证明 authoritative context 重复注入了完整 `project-analysis-snapshot`/Catalog；Overview Stage 将只移除这两份重复大对象，保留 EnergyQueryContext、Release、Workspace semantics、scoped datasource、Snapshot pins 与 Prompt 内 compact facts，普通 AI Analyst 保持原上下文。停止条件：不得用 submit tool 绕过 Runtime，不允许语法失败后无限 repair，不因减负丢失 Snapshot/Release/Scope pin。 |
| 2026-08-10 06:10 SGT | 1B Context 重复证据 | READY | v6 Trace 的首轮 62,327 context tokens 中，完整 `project-analysis-snapshot` 独占 55,580，Stage 自己的 compact Coverage/Evidence prompt 另占约 4,382；20 个 token events 累计 input 1,168,707。Overview Investigator 已在同一服务端从权威 Snapshot 构建 compact context，再把完整 Snapshot 重复注入每轮没有增加授权或 Snapshot 可信度，反而放大延迟与成本。最小修复只在 Overview Stage 排除这份重复 full snapshot/catalog，保留 Energy Query Context、Release、Analysis Pack、scoped SQL workspace、Prompt pins 和普通 AI Analyst 原路径。 |
| 2026-08-10 06:43 SGT | 1B v7 结构化提交 | DONE-ENGINEERING | 新 Investigator 专用 `overview_ai_candidates_submit` 已形成严格 schema、单次成功提交和一次 schema 修正边界；Overview Stage 不再每轮重复注入 55,580-token 完整 Snapshot。相关 8 files / 130 tests 与 root typecheck 通过。真实 attempt 1 的首轮上下文从 62,327 降到 6,713 tokens（约 -89%），提交 3 条候选后暴露 Editor prompt `10,075 > 6,000`；最小压缩保留候选身份、Evidence/SQL indexes 与视觉类型，并用 3 个长候选红测证明 Editor 可达。 |
| 2026-08-10 06:59 SGT | 1B v7 真实 DeepSeek | BLOCKED | 同一 Artifact `overview-ai-artifact-d809bab71007f76936e0f492` attempt 2 完成；Investigator `overview-ai-investigator-3fc77729-728b-47cc-936c-fc65b351ca52` 约 98 秒，Editor `overview-ai-editor-36d6f496-355c-421b-8f0c-5b316d7e0dba` 约 9 秒，均为 `deepseek-v4-flash`、`reasoning_model=false`，未触发 300 秒 timeout。Editor 接受 2 条候选，但 Runtime 正确产出 `findings=[]`：候选 1 把 3 类 Centre 数量相加为 30 却没有引用 `portfolio:window`；候选 2 写入未被所选 SQL 直接支持的相邻小时值和约 15 倍派生值。页面不得把该结果冒充 useful。另确认 validator 将 `15:00` 当普通数字、把 `single-centre demand` 当 Centre code 的两个窄误判；只修确定性误判并补测试，不继续盲跑 Provider，不放宽真正未证明数字。 |
| 2026-08-10 07:18 SGT | 1B Runtime 窄校准 | DONE-ENGINEERING | 已仅修复 deterministic validator 的误判：ISO 日期与 clock-time range 不再被当作 kWh 等业务数值，`single-centre` 等普通名词不再被当成 Centre code；真实负值、命名 Centre、倍数/比例仍须由相应 Evidence 字段支持。直接回归 6/6、相关回归 143/143、root typecheck 与 build 通过；没有重新调用 Provider。 |
| 2026-08-10 07:24 SGT | 1B 双轴代码审查 | READY | Standards/Spec 独立审查确认提交前需收口四类现有合同缺口：Editor 无工具却仍收到强制 inspect/SQL 的系统指令；合法 Candidate 总预算与 6,000 字符 Editor budget 不一致；Runtime 丢弃 selection 后 Trace 不能继续记 accepted；canonical Finding 要恢复 Action、acted/ignored consequence、verification 和 limitation/uncertainty，同时 `verified + possibleExplanation` 不能伪装成已证实原因。执行边界：只补 v7 现有 schema/prompt/materialization/tests，不建设通用治理平台、不放宽 Evidence。日期/时刻 typed dimension 属于后续治理风险，本夜不得因修误判而把任意时间 Claim 视为已证明。 |
| 2026-08-10 07:31 SGT | 2 Day30 B 真实 AI | BLOCKED | 隔离 8788 复用 B Snapshot 与加密的统一系统 Profile，只执行一次 `/ensure`，没有重新 materialize、没有 retry、没有改共享 8787/3102。DeepSeek 两阶段约 134.5 秒完成，未触发 300 秒 timeout；Artifact `overview-ai-artifact-6f0618bece5311e1fa4db20b`、Investigator `overview-ai-investigator-939fc3fd-1c03-4322-9c3c-302c5ed34856`、Editor `overview-ai-editor-a005ae21-33b0-4d91-bc18-049fa8252d10` 均绑定 Snapshot B / Release v1 / Profile revision 7。Editor 选中 2 条有潜在价值的 off-hours/plug-load 角度，但 Runtime 全部拒绝；精确根因之一是 Model 自行计数 SQL Evidence 发生 off-by-one：提交 `[5,7,8]` / `[9]`，事实结果位于 `[6,8,9]` / `[10]`，另含未显式返回的组合或过宽 Claim。Saved A 的 response SHA-256 前后仍为 `b532a597...f412e2f69`。脱敏证据写入 `outputs/energyiq/preschool-ab-ai-replay-v7/acceptance-report.json`；本轮证明真实 B 链可跑通且不超时，但不算 useful AI 验收。最小修复是每个成功 Overview SQL 直接返回 run-local `evidence_index`，Agent 复制而不心算；不得放宽 validator。 |
| 2026-08-10 07:36 SGT | 3 Ngee Ann 原型审计 | DONE-ENGINEERING | 只读审计确认用户给定 `pf-vg-hq` 是 VG HQ 通用 mock，不是真正 Ngee Ann；真实入口为 `proj-nap-energy-analysis` / `-v2`。已保存 v1/v2 整页、Section 和交互态截图，并完成模块矩阵。建议以 v1 的 Answer-first 章节顺序为主、选择性吸收 v2 的 Day Type/Scope/设备下钻；原型固定日期、29.72¢ Tariff、15% 阈值、Forecast、AI 文案和无行为按钮均不得复制。首切片固定为 `NAP-A1：Executive Summary + Change over time`，复用现有正式 KPI/Comparison/Trend/Anomaly/Level/Category/Evidence，不先扩 Kernel。 |
| 2026-08-10 06:52 SGT | 1B v7 合同收口 | DONE-ENGINEERING | Investigator submit 已限制 0–3 条并保留 Action、acted/ignored consequence、verification 与 limitation；Runtime 为每条成功 Overview SQL 返回 `evidence_index`，Workflow 冻结成功提交前 Evidence，且 all-rejected 返回明确失败。Editor 现为无工具 selection-only，不再改写 Candidate。主 Agent 合并回归 10 files / 138 tests、root typecheck/build 通过。尚未用新 identity 重跑 Provider，因此 AI useful 与 Chrome 仍待验收；日期/时刻 typed Evidence 记为后续治理风险。 |
| 2026-08-10 07:25 SGT | 1B v8 唯一真实验收 | BLOCKED | 真实 Chrome 只触发一次新 Artifact `overview-ai-artifact-6168ca3a4cb41b5042ce451d`。Investigator `overview-ai-investigator-fd3bd1e0-4270-4d2c-86e2-cf00072f35e2` 约 100 秒、Editor `overview-ai-editor-250f4070-cffd-406b-ac72-3a3539c345d5` 约 7 秒，均为 `deepseek-v4-flash`、`reasoning_model=false`，总计约 121 秒，未触发 300 秒 timeout。Investigator 自主找到 Centre L 两个 01:00 异常并成功结构化提交，但长 SQL 结果把 `evidence_index` 放在 JSON 末尾，模型视图未保留该字段，因此候选未绑定 SQL；Editor 又输出空 `relationship` 和非枚举 Trace，Artifact 以 `OVERVIEW_AI_EDITOR_RESULT_INVALID` fail closed，Chrome 未展示未验证文本。最小代码修复把 index 移到工具结果首字段、空 relationship 归一为 `independent`、非权威坏 Trace 由 Runtime 丢弃并重建；Editor identity 升为 v3。31/31 聚焦回归通过；遵守一次验收边界，本夜不再调用 Provider。 |
| 2026-08-10 07:40 SGT | 3 Ngee Ann NAP-A1 | DONE-ENGINEERING | 正式 Renderer 已完成第一项 Answer-first 切片：Context/Data Status → Executive Summary → 5 个 KPI → 当前期变化、Level/Category 独立同向变化、最高影响异常日期 → 服务端 Decisions/AI → Change over time。双轴复核后修正了“无同向事实却回退反向项”和“Level · Category 看似交集 driver”两个误导风险，并抽取共用 anomaly 选择逻辑。54/54 Renderer tests、root typecheck/build、diff check 通过；Section-local AI Artifact 薄适配、真实 Chrome 1440/1920 与 Charles 人工验收仍待后续，不冒充产品验收完成。 |
| 2026-08-10 07:54 SGT | 3 Ngee Ann NAP-A2 | DONE-ENGINEERING | `When energy occurs` 已从现有完整 Day Profile 的 24 个服务端值展示 observed peak hour、mean 与样本天数，并随模块局部 Day Type/Scope 同步；同 Scope Weekday/Weekend 均完整才对照。复核后删除了 Heatmap grid partial 对独立 Day Profile 的错误连坐，2 天样本不再称 typical，并明确深色 cell 不能证明异常、浪费或原因。该 peak 仅是当前图的展示级排序，不进入 Structured Signal、AI Artifact 或 Decision Priority。57/57 Renderer tests、root typecheck/build、diff check 通过；Chrome/Charles 仍待验收。 |
| 2026-08-10 08:18 SGT | 3 Ngee Ann NAP-A3 | DONE-ENGINEERING | `Where measured energy changed` 已把 Level/Category 的当前集中度与最大实测变化分开表达，不制造 Level × Category 因果交集；comparison 缺失或前期基线为零时保留当前 contributor、只将 movement 标记 Unavailable。Circuit 继续按当前用量 Top 5 排名，并明确不是异常、优先级或节省排名。ViewModel 150/150、Renderer 59/59 通过；默认 5 秒时限在当前机器负载下随机落到旧参数化用例，使用一次性 15 秒测试时限全绿，未修改项目全局测试配置。Chrome 1440/1920 与 Charles 人工验收仍待完成。 |
| 2026-08-10 08:25 SGT | 1B v9 Evidence submit 边界 | READY | 重启最新 API/Web 后只触发一次 Artifact `overview-ai-artifact-040af4673b35837d91bca96c`。Investigator `overview-ai-investigator-1a47186c-3997-4776-ac3f-b5e5cdb6de65` 使用 DeepSeek v4 Flash 约 93 秒完成、没有超时；3 条 SQL 成功结果明确返回 `evidence_index` 1/3/6。直接失败原因是模型连续启动了 3 次 Candidate submit，而 Runtime 只允许首次提交加一次定向修正；前两次仅因 120 字符边界被拒，第三次才通过 schema，因此整个 Artifact 以 `OVERVIEW_AI_INVESTIGATOR_RESULT_INVALID` fail closed。第三次 Candidate 又把 `evidenceRefs` 与 `evidenceSqlIndexes` 全部留空，这是独立的可信边界缺口。最小修复保持最多两次 submit，不增加重试：支持字段放宽到仍属精炼范围的 140 字符；`verified` Candidate 必须绑定 Catalog 或 SQL Evidence，`hypothesis` / `exploration-idea` 仍可在明确不确定性和验证步骤下保留探索空间；最终引用存在性和事实语义继续由 Workflow Runtime 验证。不得规定分析主题、自动补引用、放宽最终 Validator 或继续盲跑 Provider。 |
| 2026-08-10 08:39 SGT | 1B v9 最小提交修复 | DONE-ENGINEERING | `9f27407` 保持最多两次 Candidate submit 和既有调查自由；支持字段从 120 调整到 140 字符，Editor 合法极限 envelope 预算由 6,000 同步到 6,500；`verified` 必须至少绑定一条 Catalog 或 SQL Evidence，未绑定的 hypothesis/exploration 仍可在不冒充事实且带限制/验证步骤时保留。Prompt 删除了会暗示两个 Evidence 数组都为空的示例，Workflow 另加防御性解析守卫。聚焦 37/37、相关 AI/Artifact/Web 136/136、root typecheck/build 与 diff check 均通过。没有再触发 Provider，因此真实 useful Artifact 和 Chrome AI 表达仍未验收，#35 保持 Open。 |
| 2026-08-10 08:55 SGT | 3 Ngee Ann Saved Chrome | READY-FOR-HUMAN | 在真实管理员 Chrome 中切换到 Ngee Ann Workspace，并只打开不会启动 Provider 的 Saved Analysis `saved-analysis-690fdd54-cff8-4834-abc3-bd313007d6ed`。1280px 回读确认 Executive Summary、1d/7d/28d Takeaways、Change over time、Main contributors、Weekday/Weekend Day Profile 均来自 Frozen Snapshot `energy-snapshot-03499dcda183ae28c47f7d66`，页面无 document-level 横向溢出。该证据不是精确 1440/1920，也不是 Charles 人工验收；Saved 外壳把技术性 Area/Headcount 卡放在正式 Overview 前，登记为 #20 外壳问题，不混入 Ngee Renderer 切片。 |
| 2026-08-10 09:03 SGT | 3 Ngee Ann NAP-A4 预检 | DONE-ENGINEERING | 独立复核确认服务端和 ViewModel 已有 1 条同 Snapshot 的 Action、Next Check、Verify，Renderer 只漏显已有 `action`；当前真实 Evidence 仅支持一条合并主题，不能为凑 2–4 张卡复制结论。现有卡已补成 `Takeaway → Evidence → Why → Action → Where/Next check → Verify`，1d/7d/28d 详细比较移入折叠 Evidence。saving、ROI、owner、Action Log、量化 expected/if-ignored 继续隐藏。 |
| 2026-08-10 09:16 SGT | 3 Ngee Ann 首屏可读性 | DONE-ENGINEERING | 真实 Chrome 暴露的首屏无千位分隔和内部术语已做窄修复：customer-facing KPI/summary/comparison/Cost 使用 `en-SG` 分组，Evidence exact 与下游模块不变；两条 KPI 小字改为普通英语。ViewModel + Renderer `210/210`、root typecheck/build 与 diff check 通过。Saved Analysis 外壳先展示 Area/Headcount 的问题登记为 #20，未混入本 Renderer 提交。 |
| 2026-08-10 09:24 SGT | Web production build | DONE-ENGINEERING | `next build` 先暴露 Day Profile unavailable 分支的 TypeScript 收窄缺口，已用现有 summary/profile reason 显式降级；继续构建发现 Web 端残留的测试专用两阶段 materializer 与服务端 v13 canonical 合同漂移。旧 Web materializer/parser 已删除，服务端继续作为唯一 Provider/Runtime authority；Web 单航班与恢复测试改用显式 v13 Artifact fixture。Web focused `137/137`、API workflow `28/28`、root typecheck 和 production `next build` 通过。尚未重启 3102/8787，因此这不是浏览器或 Provider 验收。 |
| 2026-08-10 12:32 SGT | 1A Section 5 集成收口 | READY-FOR-HUMAN | Task A A5 已集成；补齐 fixed May Snapshot 对现有 June Estimate series 的 waiting 映射。真实 3102 显示 26,240 kWh / S$7,156、四 KPI、Estimate 曲线、Daily/Weekly/Monthly、Portfolio/30 Centres；Actual/Pace 保持 0/30 waiting，局部切换不改 URL，1422px 无横向溢出。56/56 聚焦测试、typecheck、API/Web production build 和 UI detector 通过。独立剩余：精确 1920/tablet、Charles 人工验收，以及 Task B 的英文粘连/Section interpretation 缺口。 |

## 9. 明早交付格式

1. 完成了什么：按 1A/1B/2/3 分栏；
2. 可在哪里看到：URL、Project、Snapshot/Release、操作步骤；
3. 自动化 / Provider / Browser / 人工验收分别是什么状态；
4. 新发现的问题、是否在 scope 内解决、未解决原因；
5. 提交 SHA、测试数量、截图/Run id；
6. 下一项最小可验证交付物。
