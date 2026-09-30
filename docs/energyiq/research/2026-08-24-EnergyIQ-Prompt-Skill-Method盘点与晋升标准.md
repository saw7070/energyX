---
title: "2026-08-24 EnergyIQ Prompt / Skill / Method 盘点与晋升标准"
summary: "以 main@40269bf 的仓库代码为证据，区分正式 Skill、Method/SOP、Stage Prompt、Context、Protocol/Validator 与 Tool/MCP，并提出第一条可治理 Skill 纵切。"
doc_type: research
tags:
  - EnergyIQ
  - Harness
  - Prompt
  - Skill
  - Method
  - Tools
  - MCP
updated_at: "2026-08-24"
related:
  - "GitHub #104"
  - "GitHub #114"
  - "../CONTEXT.md"
  - "../handoff/agent/2026-08-23-Admin-Harness-Truth与Skill演进复核交接.md"
  - "../plans/开发计划-Admin与模板运行闭环.md"
status: accepted
---

# 2026-08-24 EnergyIQ Prompt / Skill / Method 盘点与晋升标准

## 0. 目的、基线与证据边界

本文是 GitHub #104 的只读代码盘点，回答五个问题：

1. 当前正式 Skill、Prompt、Method/SOP、Protocol/Validator、Context、Tool/MCP 分别是什么；
2. 哪些内容在当前 Run 中只是“可用”，哪些有“selected / materialized / loaded / attributed / succeeded”证据；
3. 哪些 Prompt 内容适合沉淀为 Skill，哪些必须留在动态 Prompt、Context 或确定性代码；
4. 用户看到的“两套 Skill”究竟是重复 Store，还是命名和资源层次混淆；
5. 第一条可治理 Skill 纵切应该如何 RED → GREEN，并如何证明没有把历史事实和当前配置混为一谈。

盘点基线：

```text
repository: Zion74/energyiq-datafoundry
branch: codex/104-prompt-skill-inventory
HEAD: 40269bf25dac5c78a9475f6f29b173cd4af5be8b
date: 2026-08-24
```

证据边界：

- **事实**只来自本基线的仓库代码和仓库一方文档；没有调用 Provider、MCP、Tool，没有启动服务，没有做浏览器或生产验收。
- **建议**是从事实推导出的后续设计，不代表已经实现，也不代表 GitHub Ticket 已获批准。
- 文中行号用于快速定位，后续提交会使行号漂移；文件路径、symbol、revision 字符串比行号更稳定。
- 本文不会把自动化、静态阅读、浏览器、真实 Provider/MCP 或人工产品验收互相替代。

## 1. 结论先行

### 1.1 已确认事实

1. **正式 Skill 只有一套运行机制，但目前只有两个 builtin package：** `data-analysis@1.0.0` 与 `energy-insight-investigation@1.0.0`。package 文件是 builtin 的源内容，Config Resource 是带 owner/revision/status 的运行时登记，materialization 是把被选 package 准备到 Run workspace；这三段是一条管线，不是三套 Skill Store。
2. **Method/SOP 是第二种资源类型，但不是第二套 formal Skill。** Additional Insights 的 `energyiq-open-discovery@1.0.0` 与 Workspace `expert-direction` 走 Method Governance Store，带 exact resource revision/content hash，并在 Artifact 中记录 `loadedMethods` 与 Finding `origin`。`skillId`、`methodSkillId` 等字段名会造成误解。
3. **生产 Harness 仍然 prompt-heavy、skill-light。** Preschool/Ngee Ann 的 Section、Executive、Additional Insights 都有 code-owned Prompt revision、Output Contract 与 Validator，但 isolated value stages 明确使用 `skillMode: "none"`，并禁用通用 Skill tools。
4. **当前 Skill 运行证据止于 selected/materialized。** Run events 有 `skill.selection` 与 `skill.materialized`；AI Operations 将 loaded/read 保持为 `unavailable`。因此不能说 formal Skill 已被模型实际读取或对 Finding 作出贡献。
5. **Method 与 Tool 的历史证据更深。** Additional Insight Artifact 保存 exact `loadedMethods`、Finding origin、`allowedTools`/`usedTools` 及 succeeded/rejected Tool audits；Finding 引用的 Method 和 audit 必须通过 deterministic validation。
6. **Context 不是 Skill。** Project/Workspace identity、release/snapshot、analysis period、Evidence Catalog、Report Time、conversation、memory 和 tool observations 是每次 Run 的动态 package；它们应由服务器 exact 组装和预算校验，不能沉淀进跨项目 Skill。
7. **Protocol 也不是 Skill。** `data-analysis@1` Protocol 是确定性的阶段/动作状态机；同名 `data-analysis@1.0.0` Skill 是给模型的 SOP 内容。二者同名但职责不同。
8. **Overview 当前不声明外部 MCP。** AI Analyst 可从 Run config 获得 MCP；固定 Overview stages 的 `enabledMcpServerIds` 为空，Admin Harness 也明确说明其 server-owned tools 与 external MCP 分离。
9. **Tool “声明可用”不等于“实现可用”或“调用成功”。** Additional Insights 声明五个 server-scoped tools，但 `energy.snapshot-history.read` 与 `energy.project-knowledge.read` 在当前 runtime 明确返回 source unavailable；只有 Artifact 中 succeeded audit 才能证明实际成功。
10. **code-owned Prompt revision 存在漂移风险。** 当前 revision 是手工字符串，并没有与 Prompt 正文自动 content hash 绑定；修改文字而忘记 bump revision 在技术上可能发生。
11. **Harness control plane 应是现有真相源的逻辑投影，不是新 Kernel 或新 Store。** 当前配置读取应复用 Config Resource、Method Governance、code-owned Stage contract registry；历史读取应复用 Run events 和 immutable Artifact provenance。
12. **#104 是 inventory/decision 工作，可以与其他实现并行，但本 Ticket 不修改 Runtime。** 下文 P0 只是 follow-up 实现合同；实际 Runtime event、selection 或 prompt dedupe 必须另票、另分支、先 RED。

### 1.2 建议裁决

第一条 governed Skill 纵切不应再新建一个 “Open Discovery Skill”。建议先**深化现有 `data-analysis` Skill**：让服务器在适用 AI Analyst Run 中 exact selected，并在真正读取/注入 Skill 内容的 seam 写入 `skill.loaded`（或语义等价事件）；只从 `buildAgentInstructions(...)` 迁移重复、稳定、跨项目的软工作流，不迁移 tenant 数据、Stage identity、Evidence、schema、工具权限或输出 Validator。

理由：

- 它已经是正式 builtin Skill，不增加第三套表达机制；
- 它与 `data-analysis@1` Protocol 天然相邻，适合验证 “Protocol 管硬门、Skill 管软 SOP”；
- AI Analyst 是 run-dependent Harness，可先验证 selection/materialization/load 的完整证据，不必改写 Preschool/Ngee 当前 Artifact identity；
- Open Discovery 已经是强治理 Method，强行再复制为 formal Skill 会制造内容双写和错误 attribution。

这个排序是**可被证据推翻的建议**。第 8.5 节列出需要推翻或暂停它的证据。

## 2. 统一术语：不要再把所有 instructions 都叫 Skill

| 层次 | 当前职责 | 可信 revision / identity | 历史证据应该是什么 | 不应承载 |
| --- | --- | --- | --- | --- |
| Formal Skill | 可复用模型 SOP、检查清单、示例和可声明的工具边界 | package semantic version + Config Resource revision + content hash/ref | selected → materialized → **loaded/read**；若声称贡献，还需 attribution | 当次 Project 数据、secret、tenant identity、动态时间窗口 |
| Method / SOP | 业务认可的分析角度、core method、expert direction、适用 scope 和治理状态 | resource revision + content SHA + Method Set fingerprint | approved/loaded Method；Finding exact origin/novel contribution | Runtime 文件路径、通用 Tool 实现、未经审批的自动发布 |
| Stage Prompt | 一次 stage 的任务装配、当次输入、目标、动态约束与对输出合同的说明 | 当前是手工 code revision；建议增加 assembly/content fingerprint | Run-captured prompt identity；不能用 current code 回填历史 | 跨项目唯一知识真相、权限、确定性校验的唯一实现 |
| Context Package | 每次 Run 的 conversation、memory、Project/snapshot/release/Evidence、attachments、tool observations | package/revision/ref + server pins | append-only context events / exact package ref | 稳定 SOP、客户无关的通用教学内容 |
| Protocol | phase/action/transition/completion 状态机、允许动作与终态 | protocol id/version | Run protocol state、action records、terminal decision | 教学型 SOP、动态 tenant facts、输出文案 |
| Validator / Output Contract | schema、单位、时间、比较方向、Evidence binding、权限与 fail-closed publication | validator/output contract revision | Artifact captured identity + deterministic pass/fail | 依赖模型自觉遵守的软建议 |
| Tool / MCP | 受控能力；Tool 是本地/server-owned/MCP adapter，MCP 是外部工具协议与 server config | Tool catalog/capability revision；MCP Config Resource revision/manifest/status | registered/configured → declared → called → succeeded/rejected/failed | “配置存在”等价于“本次成功调用” |
| Harness | 某个 Run/Stage 对上述资源的 exact 组合与治理 | Run-captured assembly identity | append-only Run events + immutable Artifact provenance | 一个可随意编辑的巨大 system prompt |

### 2.1 为什么用户会感觉有“两套 Skill”

事实上的混淆来自四处同名或近义表达：

1. `packages/skills/**` + Config Resource + runtime selection/materialization：正式 Skill；
2. Additional Insights 的 `InsightMethodRevisionRef.skillId`、Artifact identity 的 `methodSkillId`：实际是 Method identity；
3. TypeScript 内 code-owned Stage Prompt：会影响模型，但不是可登记 Skill；
4. `data-analysis` 同时是 Protocol id 和 formal Skill id：一个是状态机，一个是 SOP。

因此结论不是“合并两个 Store”，而是：

- 保持 `Skills`、`Methods & SOP`、`Stage Instructions`、`Protocol & Output Contracts` 四类资源；
- 用引用关系解释一次 Harness 如何组合它们；
- 逐步消除 `methodSkillId` 这类容易误导的新接口命名；历史 Artifact 字段只能兼容读取，不能就地改写；
- Skill Library 只展示正式 Skill；Method Library 展示 Method/SOP；Admin Harness 才展示两者在当前配置和历史 Run 中的组合。

兼容迁移建议：未来新增 DTO/事件/Artifact schema 使用 `methodId` 或 `methodRevisionRef`；读取层继续接受历史 `skillId` / `methodSkillId`，并在 server-owned normalization 后投影为 Method；新写入先通过显式 schema revision 双读单写，待所有受支持历史 revision 都有只读 adapter 后才停止旧字段写入。不得批量改写历史 Artifact，也不得让一个兼容 alias 同时指向 formal Skill Store 和 Method Store。

## 3. Required inventory：Prompt / Skill / Method 全量盘点

下表中的 “Owner / scope” 指代码和运行时所有权，不是产品营销分类；“Runtime evidence” 只写当前能从持久证据证明的状态。

### 3.1 正式 builtin Skills

| 项目 | Exact source | Owner / scope / revision source | Dynamic inputs | Deterministic constraints | Reusable SOP | Runtime evidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `data-analysis@1.0.0` | `packages/skills/builtin/data-analysis/SKILL.md:1-125`；解析/选择/物化在 `packages/skills/src/index.ts:157-218,221-315,350-430`；bootstrap 在 `apps/api/src/server.ts:2435-2544` | 源文件 code-owned builtin；启动时按 `workspace_id + user_id` 建 Config Resource。semantic version 来自 frontmatter；Config revision 来自 upsert；builtin content SHA 在 payload | Run task、选中 datasource/KB、Evidence、可用 tools、Project Context | readonly SQL、schema-first、Evidence/validation；真正权限由 Protocol、Tool policy、gateway 实现 | 任务分类、先取 Knowledge、schema → query → validate → present 的跨项目流程 | `skill.selection` 与 `skill.materialized`；当前没有 loaded/read 或 Finding attribution | **P0 深化现有 Skill**。迁入重复软流程并建立 actual-load 事件；不新建同义 Skill |
| `energy-insight-investigation@1.0.0` | `packages/skills/builtin/energy-insight-investigation/SKILL.md:1-77`；同一 parser/selection/materialization；Preschool base workflow 在 `apps/api/src/energy/preschool-overview-ai-workflow.ts:320-349,596-624` | code-owned builtin；同样按当前 user/workspace bootstrap。revision 与 SHA 来源同上 | Bounded Snapshot、页面已覆盖内容、Project overlay、Evidence、调查问题 | Evidence binding、只读 SQL、零发现允许、不得改写数据；Artifact validator 兜底 | 增量价值、开放调查、事实/假设分离、停止原则 | base workflow 的 Artifact 保存 `workflow.methodSkill` 与 prompt revisions；通用 Run 仍只有 selection/materialization，没有真实 load 事件 | **保留并校正使用证据**。后续只吸收不重复的 investigation SOP，不复制 Section/Additional Prompt |

重要事实：

- `BUILTIN_SKILL_SOURCES` 在 `apps/api/src/server.ts:2435-2441` 只有上述两个条目。
- builtin 文件不是独立于 Config Store 的第二套 catalog。`ensureBuiltinConfigResources(...)` 读取文件、计算 SHA、创建 FileRef 并 upsert `kind: "skill"`，见 `apps/api/src/server.ts:2501-2544`。
- Config Resource 的 physical identity 包含 `workspace_id + user_id`；`scope: workspace` 只是 Skill payload 声明。Admin 当前只把 builtin/builtin 和 user/user 组合标为 verified，见 `apps/api/src/energy/project-harness-configuration.ts:500-522`。因此仅把 payload 改成 `workspace` 不能证明 Workspace 共享已经成立。

### 3.2 AI Analyst instructions 与 data-analysis Protocol

| 项目 | Exact source | Owner / scope / revision source | Dynamic inputs | Deterministic constraints | Reusable SOP | Runtime evidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AI Analyst platform instructions | `packages/agent-runtime/src/index.ts:1038-1549`，组装入口 `:835-860` | platform code-owned；Admin 明确标为 `not-separately-versioned`，见 `apps/api/src/energy/project-harness-configuration.ts:661-667` | task、mentioned/pinned resources、Evidence focus、Energy mode、Protocol、selected Skill 摘要、MCP/tool names、trusted stage capability | 工具是否可用最终由注入与 policy 决定；Prompt guard 拒绝引用不可用 Tool | inspect-before-query、readonly、如何结束回答、Evidence/uncertainty 等软流程 | 只有 Run 使用当前构建函数这一事实；没有 exact platform-instruction revision/hash | **拆分而非整体晋升**：重复且稳定的 data-analysis 软流程迁入现有 Skill；身份、动态摘要和安全边界留在 platform assembly |
| `data-analysis@1` Protocol | `packages/agent-runtime/src/protocol/protocols/data-analysis.ts:54-160,227-744` | platform code-owned protocol id/version | available action names、analysis requirements、context Evidence Catalog | `scope → semantic_grounding → query_planning → execution → validation → synthesis` phase/allowed-action/transition；Evidence/claim reduce | 无；它是状态机，不是教学内容 | protocol events/state 与 Run config identity；不是 Skill load evidence | **保留在 Protocol**。不要把 allowed action/state transition 下放给 Skill 文本 |

`data-analysis` 同名不是重复实现：Protocol 决定“什么动作在什么阶段被接受”，Skill 解释“怎样做好分析”。第一条纵切要用测试证明这两个职责没有互相替代。

Protocol 也不是一段建议性 Prompt：其 phase/action/transition 与 terminal/completion policy 是独立资源。通用合同在 `packages/agent-runtime/src/protocol/types.ts:5-73` 定义 `AgentProtocolDefinition` 的 id/version/initialPhase/phases、每 phase 的 allowed actions/action guards/transitions、Action 的 requested/rejected/succeeded/failed 状态、Run 的 active/waiting/terminal/handed_off 状态，以及 completed/degraded/partial/continue/failed 决策。`data-analysis@1` 在 `scope`、`semantic_grounding`、`query_planning`、`execution`、`validation`、`synthesis` 各 phase 计算 allowed actions 和转移条件，并在 `completionPolicy` 中返回有 Evidence 约束的 terminal/recovery 决策，见 `packages/agent-runtime/src/protocol/protocols/data-analysis.ts:54-223`。这些终态条件必须留在确定性 Runtime，不能降级为 Skill 中的自然语言要求。

### 3.3 Preschool prompts

| 项目 | Exact source | Owner / scope / revision source | Dynamic inputs | Deterministic constraints | Reusable SOP | Runtime evidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Base Overview Investigator | Prompt builder `apps/api/src/energy/preschool-overview-ai-workflow.ts:596-624`；identity `apps/api/src/energy/overview-ai-artifact.ts:80-89` | Preschool code-owned；prompt `preschool-investigator-v15`、workflow `preschool-two-stage-v2`、validator `...v7`；revision 为手工常量 | bounded snapshot、signals、page coverage、question、Project scope | Candidate submit tool、Evidence/SQL index、artifact materialization validation | 开放调查、零发现、增量价值；与 `energy-insight-investigation` 高度相关 | Artifact `methodSkill` + investigator runId/promptRevision；formal Skill actual-load 仍未证明 | **保留 stage shell；去重 SOP**。复用现有 investigation Skill，不另建 Preschool Skill |
| Base Overview Editor | `apps/api/src/energy/preschool-overview-ai-workflow.ts:627-689`；identity 同上 | Preschool code-owned；`preschool-insight-editor-v7`、output `v13` | Investigator candidates、Evidence、placement | 不准 SQL；服务端验证 Evidence、来源、placement、publication | 面向客户的清晰表达、保留不确定性 | Artifact editor runId/promptRevision + accepted/rejected trace | **保留 Prompt/Validator**。编辑是 stage-specific publication，不优先晋升 |
| Section Discovery | current prompt `apps/api/src/energy/preschool-section-interpreter.ts:272-320`；pack `apps/api/src/energy/preschool-section-pack-v2.ts:31-100`；identity `apps/api/src/energy/overview-ai-artifact.ts:533-564` | Preschool per-Section code-owned；identity `v4`、pack `v2`、prompt `discovery-prompt-v11`、workflow `discover-tools-accept-publish-v4`、validator `acceptance-validator-v16` | Section binding、Evidence、already presented facts、cross-section index、data quality、missing Evidence、section-specific trusted tools | exact evidence IDs、numeric/unit/date/relationship checks、local acceptance、dedupe、最多 3 个 publication | 增量发现、epistemic status、zero candidate、价值排序可跨项目复用 | Artifact exact identity、Section Tool audits；`skillMode:none`，不能声称用了 formal Skill | **暂留 Prompt + Pack + Validator**。只把可证明重复的 discovery SOP 并入既有 investigation Skill；section semantics 不迁移 |
| Key Findings / Executive Synthesis | prompt `apps/api/src/energy/preschool-executive-synthesis.ts:344-433`；acceptance `:453-687`；identity `apps/api/src/energy/overview-ai-artifact.ts:470-500` | Preschool code-owned；identity `v4`、prompt `...v12`、workflow `...v12`、validator `...v22`、output `...v4` | accepted Section artifacts、overview evidence、summary | 每个 Finding 至少两个 accepted Sections；exact refs、numeric support、uncertainty、safe publication | 跨 Section 综合、避免单 Section 复述、决策价值排序 | Artifact exact revisions；无 Skill/Method/Tool attribution | **P1 候选**：先与 Ngee Executive 提取共同 SOP；确定性跨 Section binding 留在 validator |

### 3.4 Ngee Ann prompts

| 项目 | Exact source | Owner / scope / revision source | Dynamic inputs | Deterministic constraints | Reusable SOP | Runtime evidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Section Interpretation | prompt `apps/api/src/energy/ngee-ann-section-interpreter.ts:184-209`；acceptance `:212-327,329-1020`；output schema `apps/api/src/energy/ngee-ann-overview-ai-structured-output.ts:7-39`；identity `apps/api/src/energy/overview-ai-artifact.ts:93-119` | Ngee project adapter；identity `ngee-ann-section-v16`、prompt `...discovery-v8`、workflow `...discover-publish-v1`、validator `...acceptance-v14`、output `...interpretation-v1` | exact Section pack、Report Time、Evidence IDs、field semantics、day type、units | pack-only/no SQL/no tool；日期、entity、数字、单位、比较方向、ranking 和 evidence binding 由本地 acceptance 修复/拒绝 | observed/inferred/speculative、Section 内增量解释 | Artifact exact revisions；`skillMode:none`，无 Tool/Skill load | **保留 Prompt/Pack/Validator**。不可把 Ngee 时间/字段语义整体做成通用 Skill |
| Executive Synthesis | prompt `apps/api/src/energy/ngee-ann-executive-synthesis.ts:212-224`；validation `:242-376`；schema `apps/api/src/energy/ngee-ann-overview-ai-structured-output.ts:41-69`；identity `apps/api/src/energy/overview-ai-artifact.ts:122-148` | Ngee project adapter；identity `ngee-ann-executive-v7`、prompt `...prompt-v2`、workflow `...synthesis-v2`、validator `...acceptance-v6`、output `...synthesis-v1` | accepted Section insights | 1–3 Findings、每项至少两 Sections、exact Evidence/Insight IDs、uncertainty | 与 Preschool 相同的跨 Section synthesis 核心 | Artifact exact revisions；无 Skill/Method/Tool attribution | **P1 cross-project Skill 候选**。先证明两项目共同 SOP 和 eval parity；binding/schema 留在 contract |

### 3.5 Additional Insights / Open Discovery prompts 与 Methods

| 项目 | Exact source | Owner / scope / revision source | Dynamic inputs | Deterministic constraints | Reusable SOP | Runtime evidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Preschool Additional Discovery Prompt | `apps/api/src/energy/preschool-additional-ai-insights-workflow.ts:1512-1569`；identity `apps/api/src/energy/overview-ai-artifact.ts:315-347` | Preschool adapter；identity `additional-insights-v24`、prompt `...discovery-v12`、workflow `...v21`、validator `...v17`、output `...v2` | current Evidence Catalog、presented claims、Method resources、server tools、Artifact binding | candidate isolation、exact Evidence/audit IDs、Method origin、dedupe、安全发布最多 3 | open discovery、novel contribution、zero candidate | Artifact exact `loadedMethods`、Finding origin、tool audits、allowed/used tools | **保留 stage Prompt；Open Discovery 留作 Method**。不要再复制成 formal Skill |
| Ngee Additional Discovery Prompt | 同一 workflow `apps/api/src/energy/preschool-additional-ai-insights-workflow.ts:1512-1569`；identity `apps/api/src/energy/overview-ai-artifact.ts:351-384` | shared workflow + Ngee identity；identity `ngee-ann-additional-insights-v4`、prompt `...discovery-v11`、validator `...v18`，其余同上 | Ngee current catalog/presented claims/Methods/tools | Ngee JSON submission、同一 exact Method/Evidence/Tool audit boundary | 同一 open discovery SOP | 同一 immutable Artifact provenance | **继续共享 Method/workflow**；应重命名 Preschool-only symbol，但不能为重命名改写历史 identity |
| Builtin core Method `energyiq-open-discovery@1.0.0` | `packages/contracts/src/energyiq-additional-ai-insights.ts:13-97` | platform builtin Method；resource `builtin:energyiq-open-discovery` rev 1，固定 SHA；Method Set 当前仍名为 `preschool-additional-insights-current@v1` | workspaceId + published workspace Methods | resolver 校验 exact scope/role/content；Artifact 校验 method set fingerprint | 增量价值、开放角度、Evidence/epistemic status、server-scoped readonly tools、zero candidate | `methodExecution.loadedMethods`；Finding `origin.coreMethod`；reuse 要求 exact revision set | **保持 Method，不晋升 formal Skill**。内容属于“本次如何归因的分析方法”，已有更强 artifact evidence |
| Workspace `expert-direction` Methods | Governance lifecycle/store `packages/contracts/src/energyiq-insight-method-promotion.ts:240-313`；`packages/metadata/src/energyiq-insight-method-governance-store.ts:403-536` | Workspace governed resource；provisional → in-review → approved → published；published 时生成 revision/hash | exact source Artifact/Finding、proposal guidance、review/approval actors | comment/feedback 不自动晋升；platform publication 不支持；发布 Method 必须 exact target/scope/role | 人工认可的分析角度或 SOP direction | 只有 published workspace Methods 被加载；Artifact Finding exact attributed | **保持 Method Governance**。不得复制到 Skill Store，不得因评论自动 publish |

关键事实：`InsightMethodRevisionRef` 的 `semanticVersion` 只是描述；真正防止错误复用的是 `resourceRevision + contentSha256`，见 `packages/contracts/src/energyiq-autonomous-insights.ts:5-19,84-102`。Finding origin 必须同时存在于 approved 和 loaded Methods，见同文件 `:114-150`。

## 4. Context 与 Output Contract assembly 盘点

### 4.1 Context assembly

| 层次 | Exact source | Owner / scope / revision source | Dynamic inputs | Deterministic constraints | Reusable SOP | Runtime evidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Canonical Run context | `apps/api/src/run-agent-assembly.ts:107-155` | server-owned、exact user/workspace/session/run | selected datasource、model、Skill/KB/MCP IDs、mentioned/pinned refs、Evidence、Energy query | 参数由认证与 resolver 生成；不接受模型自报 tenant | 无 | Run config/context events | **保留 server assembly** |
| Agent/runtime assembly | `apps/api/src/run-agent-assembly.ts:157-226` | server-owned Mastra adapter | MCP tools、selected Skills、context evidence、structured output、trusted stage tools、model settings | 注入清单、禁用 tools、Protocol、Output schema 均来自 server | 无 | append-only events + Artifact refs | **保留 Runtime seam**；未来 Runtime adapter 也只能消费同一 contract |
| Energy Context Item | `apps/api/src/energy/energy-context-item.ts:18-98,154-233,294-381` | server-owned Project/Release projection | exact Energy query/snapshot/evidence catalog | Workspace/Project/scope/snapshot/release/metric/calendar pins | 无 | Context package refs/events | **绝不能沉淀为 Skill** |
| Analysis Evidence Catalog | `apps/api/src/energy/project-analysis-context-evidence.ts:14-40` | Project snapshot projection；contract `analysis-context-evidence@1` | deterministic snapshot facts | exact identity pins、只投影当前 release/snapshot facts | 无 | Additional tool runtime 和 Artifact evidence refs | **保留为 Evidence contract** |
| Prompt projection / budget guard | `packages/agent-runtime/src/context/projection/context-prompt-materializer.ts:40-140`；`packages/agent-runtime/src/context/protocol/mastra/mastra-provider-prompt-guard-processor.ts:14-63` | runtime-owned | selected source/system/turn groups、model input budget、available tools | 只投影 model-visible items；引用 unavailable tool 或超预算即 abort | 无 | `context.prompt-verified` | **保留 Context Kernel** |

### 4.2 Output contracts 与 deterministic acceptance

| Surface | Exact source | Owner / scope / revision source | Dynamic inputs | Deterministic constraints | Reusable SOP | Runtime evidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Preschool Section/Executive/Additional structured outputs | `apps/api/src/energy/preschool-overview-ai-structured-output.ts:67-126,144-194,222-245,440-573` | Preschool Stage code-owned；revision 来自对应 identity creator 的 output/validator revision | 当次 Section/Executive/Additional candidate payload、Evidence refs | JSON shape、required keys、Evidence refs、candidate/output limits | 无；这是输出合同，不是分析方法 | Artifact 保存 exact output/validator revision 及 deterministic accept/reject 结果 | **保留为 Stage contract**；不得迁入 Skill |
| Ngee Section/Executive structured outputs | `apps/api/src/energy/ngee-ann-overview-ai-structured-output.ts:7-69` | Ngee Stage code-owned；revision 来自 Ngee identity creator | 当次 Ngee Section/Executive candidate payload、Evidence refs | Section/Executive schema、字段与数量边界 | 无 | Ngee Artifact 保存 identity 与 deterministic validation 结果 | **保留为 Stage contract**；可复用 schema seam，但不复制到 Skill |
| Artifact identity registry | `apps/api/src/energy/overview-ai-artifact.ts:27-148,315-384,470-564` | platform code-owned registry；code revision + exact Project/Run pins | renderer、Project、Snapshot、Release、Model、Report Time、Stage identities | 所有 pin 必须 exact matching；历史 Artifact 只读且禁止用 current config 回填 | 无 | immutable Artifact identity 与 Run envelope | **保留为平台 identity contract** |
| Additional Artifact validator | `packages/contracts/src/energyiq-additional-ai-insights.ts:304-344,421-580` | shared contract package；output contract、Method Set、capability revisions | candidates、loaded Methods、Finding origin、Tool audits、Evidence refs | exact loaded Method set、origin、allowed/used Tools、succeeded audits、Evidence lineage | 无；Method SOP 由 Method Store 管理 | Artifact validation trace、accepted/rejected candidate 与 succeeded Tool audit | **保留为共享 Validator**；Skill 只能提供软流程 |

原则：Skill 可以解释“如何做”，但不能成为 schema、tenant、Evidence、时间、单位或发布权限的唯一执行者。模型忽略 Skill 时，确定性 acceptance 仍必须 fail closed。

## 5. Tool / MCP policy 盘点

### 5.1 Tool catalog 与实际证据

| Tool surface | Exact source | Owner / scope / revision source | Dynamic inputs | Deterministic constraints | Reusable SOP | Runtime evidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AI Analyst static tools | catalog/selection 在 `packages/agent-runtime/src/index.ts:1038-1075,1558-1590`；Skill allow/deny merge 在 `packages/skills/src/index.ts:414-430` | platform runtime；Tool implementation revision 随代码，effective policy 随 Run | Run config、selected Skill policy、datasource/KB/Evidence、Tool inputs | 只有实际注入且通过 effective allow/deny policy 的 Tool 可用；数据/写权限由实现/gateway 执行 | 无；Tool 是能力，不是 SOP | generic Run `TOOL_CALL`/result events；Admin projection `apps/api/src/energy/project-ai-operations.ts:375-405` | 保留；Admin 分开显示 registered/declared/called/succeeded |
| Preschool Section trusted tools | declarations `apps/api/src/energy/preschool-section-pack-v2.ts:46-58,95-99`；runtime injection `apps/api/src/server.ts:269-280` | server-owned、Section-specific capability `scoped-read-only-v1` | exact Section、Project binding、bounded fact/signal IDs、Tool call input | 每个 Section allowlist 不同；server validates binding/input/Evidence；无任意 SQL/network/write | 无 | Section Artifact Tool audits；未调用不能标 used | 保留 server-owned；不开放任意 Tool editor |
| Additional server-scoped tools | catalog `packages/contracts/src/energyiq-additional-ai-insights.ts:13-19`；runtime `apps/api/src/energy/preschool-additional-ai-insight-runtime.ts:39-145` | server-owned capability；五个固定名，catalog revision 随 output/capability contract | exact workspace/project/scope/snapshot/release、Evidence Catalog、factIds/knowledgeIds | exact catalog pins、exact input keys、unique IDs、metric/timeseries checks；history/knowledge 当前 source unavailable | 无 | Artifact `toolAudits` 只有 succeeded/rejected；`usedTools` 必须由 succeeded audit 导出 | 保留；Admin 明确 declared ≠ locally available ≠ succeeded |
| AI Analyst MCP servers/tools | resolver `apps/api/src/run-config-resolver.ts:588-739`；execution `apps/api/src/policy-mcp-middleware.ts:65-180,235-429` | Config Resource physical owner `workspace_id + user_id`、resource revision、persisted manifest/status；remote server 自有实现版本不由 EnergyIQ 保证 | selected server IDs、transport/URL/command、secret ref、remote listTools/call input | exact owner lookup、transport/manifest/name/allowlist、Skill policy、timeout、name conflict、client close | 无 | resolved/offered mapping + generic Tool call/result events；persisted last-test 不是当次 success | 保留受控 adapter；普通 GET 不 connect/probe |
| Fixed Overview external MCP | `apps/api/src/server.ts:1279-1308`；Admin declaration `apps/api/src/energy/project-harness-configuration.ts:573-658` | Stage contract；current code revision | none；`enabledMcpServerIds: []` | isolated stage 禁通用 Skill/MCP tools，只能使用显式 trusted server-owned tools | 无 | 无 MCP call 即无 actual-use evidence | 保持隔离，除非另开安全合同/Ticket |

### 5.2 MCP config 与 fail-closed 边界

MCP 只属于 run-dependent AI Analyst 路径，当前链路为：

```text
Config Resource(kind=mcp-server)
→ Run config exact workspace/user resolution
→ persisted manifest + allowlist + secret_ref
→ Skill/MCP tool policy check
→ PolicyMcp client listTools
→ name conflict/allowlist filtering
→ call with timeout
→ Run Tool events
```

证据：

- `apps/api/src/run-config-resolver.ts:588-739`：按 exact workspace/user 读取 MCP Config Resource，验证 transport、URL/command、manifest、tool name/conflict、allowlist、secret headers；若 selected Skill policy 不允许 MCP tools，则抛 `SKILL_MCP_TOOL_POLICY_UNSUPPORTED`。
- `apps/api/src/policy-mcp-middleware.ts:65-180,235-339,362-429`：仅在 Run 有 MCP servers 时连接；list/call 均有 timeout、allowlist 和 client close。
- `apps/api/src/run-agent-assembly.ts:161-196`：只有解析出的 MCP tools 才注入 Runtime；`buildAgentInstructions(...)` 只描述实际注入的 MCP tool names。
- `apps/api/src/energy/project-harness-configuration.ts:525-546`：Admin 的 MCP manifest/status 是 persisted status，不是普通 GET 现场 probe。

因此 Admin 必须使用以下状态语言：

```text
registered/configured
≠ enabled for this Run
≠ listed by MCP server
≠ offered to model
≠ called
≠ succeeded
```

普通 Harness/Operations GET 不应连接 MCP、probe Tool、调用 Provider，也不应把 persisted last-test 冒充当前在线状态。

## 6. Prompt 内容归宿：逐类 disposition

### 6.1 应进入或深化 formal Skill 的内容

只考虑同时满足以下条件的文本：跨 Project 稳定、可复用、不含 tenant facts、改变时需要版本治理、是“如何分析”的软 SOP、可以被 eval 直接比较。

候选内容：

- `buildAgentInstructions(...)` 中重复的 data-analysis 软流程：inspect schema before query、readonly query planning、结果 validation、Evidence/uncertainty、完整 closing synthesis；
- Preschool base Investigator 中与 `energy-insight-investigation` 重复的增量价值、开放问题、事实/假设分离、zero finding、stop criteria；处理方式优先是**引用/深化已有 Skill**，不是新建一个 Preschool Skill；
- Preschool/Ngee Executive 的共同 synthesis SOP：至少跨两个 accepted Sections、避免单 Section 复述、保持不确定性、按决策价值排序。它需要先完成 cross-project common-core 证明，排在 P1。

### 6.2 必须留在 Stage Prompt / dynamic assembly 的内容

- 本次 task、Section pack、accepted artifact projection、current Evidence Catalog、already presented claims；
- Project/Workspace/scope/snapshot/release/analysis period/Report Time；
- 本次 selected Method resources、Tool names、MCP names；
- Stage-specific candidate shape 和用户可见 copy 目标；
- Ngee 的字段语义、day type、单位和时间说明中依赖当前 report pack 的部分。

### 6.3 必须留在 Contract / Validator / server policy 的内容

- tenant/project identity、权限、private/no-store、历史 Artifact read-only；
- schema、required fields、数值/单位/日期/比较方向、Evidence binding；
- Tool allowlist、readonly、超时、网络/写权限、MCP secret；
- max publication、dedupe、accepted/rejected trace；
- Method lifecycle、审批角色、发布和 revision；
- “comment/Useful/Not useful 不自动 approve/publish”。

### 6.4 必须保持 Method/SOP 的内容

- `energyiq-open-discovery` core Method；
- Workspace expert directions；
- Finding 的 origin、novel contribution 和 Method attribution；
- 从 exact Finding 发起的 proposal/review/approve/publish lifecycle。

## 7. Skill 晋升标准与评分 Rubric

### 7.1 硬门：任一失败则不能晋升

1. **边界纯净：** 不含客户事实、tenant identity、secret、当次时间窗口、Evidence payload 或动态 tool result。
2. **确定性职责已外置：** 权限、schema、Evidence binding、数值/单位/时间校验、Tool policy 和 publication gate 不依赖 Skill 文本。
3. **单一真相源：** 晋升后删除或引用重复软文本；不允许 Prompt 和 Skill 长期双写同一 SOP。
4. **exact identity：** semantic version、Config Resource revision、content SHA/ref 可以被 Run capture；stale/missing revision fail closed。
5. **实际读取可证明：** materialized 不等于 loaded；必须从真正读取/注入 Skill content 的 seam 产生 append-only evidence。
6. **范围可说明：** builtin/user/workspace 的 physical owner 与 declared scope 一致；不能以 payload 声明伪造 Workspace 可见性。
7. **Eval 可比较：** 有至少两个 Project/fixture，且可以比较 correctness、evidence、novelty、actionability、decision utility、redundancy 和 token/cost。
8. **治理可逆：** 新 revision 不改写历史 Run/Artifact；回滚只影响未来 selection。

### 7.2 评分项

每项 0–3 分；硬门通过后，建议总分至少 18/24 才进入实现 Ticket。

| 维度 | 0 | 1 | 2 | 3 |
| --- | --- | --- | --- | --- |
| 跨项目复用 | 单 stage 特例 | 同项目多处 | 两项目相似 | 平台/多项目稳定共用 |
| 稳定性 | 每次 Run 变化 | 高频随产品变 | 可独立 version | 已长期重复且边界稳定 |
| SOP 密度 | 主要是事实/格式 | 混杂严重 | 多数是 how-to | 纯工作流/检查单/示例 |
| 确定性可分离 | 只能靠模型 | 部分外置 | 关键 gate 已外置 | 全部安全/正确性 gate 外置 |
| 可观测性 | 无 identity | selected | selected+materialized | exact loaded + attribution/outputs |
| Eval 就绪度 | 无 fixture | 单元快照 | 跨项目回归 | 质量+成本+失败模式完整 |
| 治理价值 | 改动无风险 | revision 较少 | 需要 review/diff | 发布/回滚/历史解释价值高 |
| 去重收益 | 会新增重复 | 基本不变 | 删除部分 prompt 重复 | 建立唯一 reusable truth |

## 8. 候选排序与第一条 governed Skill 纵切

### 8.1 排名

| 排名 | 候选 | 当前判断 | 主要原因 |
| --- | --- | --- | --- |
| P0 | 深化现有 `data-analysis` Skill | **推荐第一条纵切** | 已是 formal Skill；与 AI Analyst + Protocol 相邻；可最小验证 selected/materialized/loaded；能去掉 platform prompt 重复 |
| P1 | Cross-project Executive Synthesis common core | 条件成立后推进 | Preschool/Ngee 有明显共同 SOP，但 exact refs、schema、项目语义仍不同 |
| P2 | 深化 `energy-insight-investigation` | 先去重再评估 | 已被 base Preschool 引用；Section discovery 有重合，但不能搬走 Section-specific semantics |
| 保持 Method | `energyiq-open-discovery` + expert directions | **不晋升** | 已有 exact Method set/hash/loaded/origin 证据；复制成 Skill 会双写和混淆归因 |
| 不晋升 | Ngee/Preschool 完整 Section Prompt | 保留动态 Prompt | 混合当前 pack、时间、字段语义、Evidence 与输出合同，不是纯 SOP |

### 8.2 P0 目标合同

建议 Ticket outcome：

> 对适用的 AI Analyst data-analysis Run，服务器 exact 选择 `data-analysis` 的某个 revision；Runtime 在实际读取/注入该 revision 内容后写 append-only load evidence；Admin Operations 能分开显示 available、selected、materialized、loaded。Platform prompt 不再复制同一软流程，Protocol/Validator/Tool policy 仍保持确定性执行。

最小深模块 seam：

```text
resolve exact Skill resource
→ select (policy decision)
→ materialize (file prepared)
→ load/read (content actually read for this Run)
→ assemble prompt (content ref/fingerprint included)
→ append Run event
→ optional output attribution (only when contract supports it)
```

`skill.loaded` 至少应包含：

- `id`、semantic version、Config Resource revision；
- content SHA256 或 immutable package ref；
- scope + exact physical owner identity（服务端保存；Admin 可折叠技术字段）；
- Run/session/workspace/project 由 event envelope 绑定；
- load source 与发生阶段；
- 不记录 secret、完整客户 Context 或任意可执行内容。

### 8.3 RED tests（先失败）

1. `data-analysis@exact revision` 在服务器判定适用时 selected；跨 Workspace、错误 user owner、disabled/stale/missing revision fail closed。
2. 仅创建 `skill.materialized` 不会让 Admin 显示 loaded；只有实际 reader/assembler 调用后才出现 `skill.loaded`。
3. loaded event 的 revision/hash 与 selection/materialization 不一致时 trace 局部 `unavailable`，不得使用 current Config 回填。
4. 同一 Run 未读取 Skill 内容时不会产生 loaded event；失败读取记录 unavailable/failed，不伪造成功。
5. Tool policy 仍是 Run policy 与 Skill allowlist 的 strict intersection；Skill 文本不能增加未声明 Tool/MCP。
6. 普通 Admin GET 只读现有 Store/Event，`private, no-store`，0 Provider、0 MCP connect/probe、0 Tool、0 ensure/materialize、0 queue。
7. AI Analyst platform prompt 删除重复软流程后，仍包含动态 identity、available tool names、Protocol handoff、安全约束与当次 Context 摘要。
8. 历史 Run 和 Artifact 只读；新 event 不回写旧 Run；缺少旧证据显示 `unavailable`。

### 8.4 GREEN 与 Eval gate

最小 GREEN：

- 复用 `packages/skills` 和现有 Config Store；不建新 Store；
- 在真正读取 Skill package 内容的单一 runtime seam 发 event；
- AI Operations read model 读取该 event，保留 list-first/detail-on-demand；
- 只迁移已被测试证明重复的 platform soft workflow；
- 不改 Overview Stage identity、Additional Method Store 或历史 Artifact。

Eval 分层：

1. **纯单元/合同：** exact revision/hash、owner、stale/missing、available-vs-used、event projection。
2. **synthetic fixture：** 通用 tabular task + Energy evidence-bound task；不调用真实 Provider/MCP。
3. **fixed provider parity（独立报告）：** 同一输入对比旧 platform prompt 与 Skill-backed prompt；评估 correctness、Evidence、novelty、actionability、decision utility、redundancy、token/cost。
4. **浏览器/人工（独立报告）：** Admin 能看懂 available/selected/materialized/loaded；技术 IDs 折叠；历史 unavailable 诚实。
5. **生产验收：** 只有部署后另做，不能由本地测试或 commit 代替。

本纵切的第一版 parity gate 固定如下，避免用“感觉差不多”批准：

- fixture 至少覆盖 1 个通用表格任务与 1 个 Energy Evidence-bound 任务；同一模型、参数和输入，baseline 与 Skill-backed 各运行 3 次；
- schema、tenant/snapshot/release pin、单位/时间方向与 Evidence binding 的确定性检查必须 100% 通过，且 Skill-backed 不得新增 unsupported factual claim；
- correctness 与 Evidence 任一单项人工盲评分不得低于 baseline；novelty、actionability、decision utility 三项的中位综合分不得低于 baseline（5 分制，差值 < 0.25 视为测量噪声）；
- 重复 claim 数不得高于 baseline；中位 input token 与估算 Provider cost 各不得高于 baseline 10%；
- 主 Agent 审核独立 parity 报告后批准。任一门失败即暂停 prompt dedupe，只保留 actual-load evidence 的 GREEN，不得以 CI green 替代质量批准。

### 8.5 可以推翻或暂停 P0 的证据

出现以下任一证据，应回到 Ticket 重新裁决，而不是继续实现：

- `buildAgentInstructions(...)` 中拟迁内容实际上没有重复，迁移只会增加一次 I/O/Prompt 长度而无去重收益；
- current Mastra Skill loader 无法在不 fork/侵入 Runtime 的情况下证明实际 read；
- Skill-backed fixture 触发第 8.4 节任一 parity gate，或 token/cost 超过 10% 上限；
- exact physical Workspace scope 在现有 Config Store 无法表达，需要先解决 owner model；
- `data-analysis` Protocol 与 Skill 的同名在 UI/API 中造成无法消除的 identity 冲突；
- 主 Agent 发现更小的 vertical 可以同时产生 actual-load evidence 与用户价值。

### 8.6 2026-09-02 current-main 实现候选

当前 `main` 的正式事实仍是：没有 `skill.loaded` event 就显示 `unavailable`。独立分支 `codex/114-actual-loaded-skill-main-f13c` 已基于 `main@f13c20ca0b568b991d435d6744975cb25a337918` 形成 initial checkpoint `15567444ba6b70a4f35defb314617c667035373b` 与 review-fix code checkpoint `722105707f8896d0472989087e0a04048ce89bfd`，验证本节最小纵切在不修改 Overview Stage identity、Additional Insight Artifact/Method Store 或历史 Artifact 的前提下可以实现。它不是生产事实，只有完成 fresh 双轴审核、CI、主 Agent disposition、合并和部署后，才能更新 production truth。

候选实现把 `available → selected → materialized → loaded` 固定为不可跳步的独立证据：Runtime 真实读取 materialized package entry 并核对 owner/scope/revision/ref/hash 后，才把正文装入 model-visible instructions；持久事件只保存 secret-free identity。MCP 与普通 Tool 先形成 capability candidates，再接受 server policy ∩ Skill allowlist；Skill prose 不授予能力。Operations detail 从同一 exact Run 的 selection/materialization/load siblings 交叉验证，坏 sibling 局部 unavailable，且不以 current Config 回填。

review-fix 将 actual-load v1 收窄为 exact builtin `data-analysis` 单项候选，并以 256 KiB entry safety ceiling 约束 model context；非 `valid` revision、owner/scope/ref/hash/session 不一致、identity 首尾空白、缺失或不安全 ZIP entry 均 fail closed。selected/materialized 但无 loaded event 的 Skill 仍在 Admin 中局部显示 unavailable。离线生产纵切使用真实 builtin package、真实 Runtime reader、server 使用的统一 audit seam 与 canonical Run Event Store，证明确定性 materialized/loaded event 重放只追加一次；普通 Run 仍为 0 actual-load。它没有授权其他 Skill 自动加载，也没有把本地自动化提升为真实 Provider、浏览器或生产验收。

## 9. 风险、缺口与 follow-up Ticket 建议

### 9.1 当前风险

1. **Prompt revision 无自动 hash：** code-owned revision 依赖开发者手工 bump；建议建立 Prompt assembly fingerprint 或 CI guard，但不要把完整 Prompt 默认暴露给 Admin。
2. **formal Skill actual-use 证据仍待合入：** selected/materialized 不能说明模型读取；当前 `main` 的正确 UI 状态仍是 loaded `unavailable`。第 8.6 节的独立候选只有在审核、合并和部署后才能改变该事实。
3. **scope 声明可能伪共享：** physical owner 为 `workspace_id + user_id`；workspace payload scope 仍未被 Admin 验证。
4. **Method 命名带 Skill：** `skillId`/`methodSkillId` 容易让 API/UI 把 Method 当 formal Skill。
5. **Method Set 名称偏 Preschool：** `preschool-additional-insights-current` 实际被 Ngee 共享；应只对未来 identity 做兼容重命名，不能改写历史。
6. **Tool catalog 比实现更宽：** history/knowledge 已 declared 但局部 unavailable；需要在 Configuration 中区分 declared 与 locally available。
7. **Platform instructions 未版本化：** 历史 AI Analyst Run 无法仅靠 current code 重建 exact system instructions。
8. **Stage Prompt 职责过重：** 特别是 Ngee Section 同时承担 pack explanation、字段语义、输出指令与补救规则；应逐步把 projection/normalization/acceptance 收敛为深模块，但不能在 Skill 晋升中顺手大改。
9. **Admin Section Tool 声明不完整：** Preschool Section pack 在 `apps/api/src/energy/preschool-section-pack-v2.ts:53-58` 按 Section 声明四类 server-owned tools，但 `apps/api/src/energy/project-harness-configuration.ts:611-625` 当前把 Section Analysis `toolIds` 投影为空。这是 control-plane projection 缺口，不代表 Runtime 没有这些 tools。
10. **selection audit 状态词不完全对齐：** `packages/skills/src/index.ts:85-99` 的 selection audit item 只表达 selected/rejected，而 Operations read model 还保留 unavailable 计数。后续应让 DTO 与持久事件合同一致，不能凭空推导 unavailable。

### 9.2 唯一 follow-up Ticket：[#114 `data-analysis` governed load vertical](https://github.com/Zion74/energyiq-datafoundry/issues/114)

本轮只建立一张后续实现票，不把其余风险拆成平行 backlog。该票合并 actual-load event contract、`data-analysis` exact server selection、AI Operations projection 与最小 prompt dedupe，避免先做一个没有用户可见闭环的底层事件票。

| Scope | Depends on | Done when |
| --- | --- | --- |
| 复用现有 Skill/Config/Run Event Store，在单一 reader/assembler seam 记录 exact `data-analysis` revision/hash 的实际 loaded 证据；Admin 分开 available/selected/materialized/loaded；只在 fixture parity 通过后删除重复 soft workflow | #104 结论经 PR #115 审核；canonical Run Event v1 已随 PR #110 合入 `main`。#102 的浏览器/人工证据继续单独跟踪，不阻塞 #114 的 RED 与本地实现 | tenant/user/revision fail closed；历史缺失诚实 unavailable；普通 GET 零 Provider/MCP/Tool/ensure/queue；Protocol/Validator/Tool policy 不被 Skill 文本替代；synthetic fixture 质量不退化 |

Prompt fingerprint、owner/scope、Executive common core、Method terminology 与 declared Tool availability 仍是第 9.1 节中的已知风险/兼容迁移项；只有在这条纵切给出新证据后，主 Agent 才决定是否另行建票。

## 10. 对 Admin Harness Configuration / AI Operations 的直接含义

### Harness Configuration（当前声明）

- 展示正式 Skills：registered/configured、owner/scope、semantic version、Config revision、content hash（若有）；
- 展示 Methods & SOP：builtin core + published Workspace directions、role/scope/revision/hash/lifecycle；
- 展示 Stage Instructions：code-owned prompt revision、output/validator/workflow revision；正文 summary-only；
- 展示 Tools/MCP：registered/declared/local availability/persisted last-test，不能普通 GET 现场 probe；
- 展示 Context composition 与预算策略，不下发 Project facts、secret 或完整 system prompt。

### AI Operations（历史事实）

- Skill：selected、materialized、loaded 分栏；没有 event 就显示 unavailable；
- Method：approved/loaded 与 Finding-attributed 分栏；读取 exact Artifact provenance；
- Tool：called、succeeded/rejected/failed 分栏；只有 succeeded audit 进入 `usedTools`；
- MCP：configured server、resolved/offered tool、call/result 分栏；
- Prompt/Context：只显示 captured identity/fingerprint 和人类可读摘要；不能用 current revision 回填旧 Run；
- 所有历史 Artifact read-only；Comment/Useful/Not useful append-only，修改只形成 Proposal，不能自动 approve/publish。

## 11. 本轮未覆盖证据

- 文档自动门：`pnpm docs:build` 与 `git diff --check` 已在本分支通过；本轮是 docs-only，未运行 API/Web/Runtime code tests，因此不证明当前产品代码或所有引用 revision 一致；
- 未做浏览器验收，所以不证明 Skill Library 当前不可见的具体 UI 原因；本文只指出 user-scoped physical owner/scope verification 这一代码风险；
- 未调用 Provider，未比较 Prompt 与 Skill 的真实输出质量；
- 未连接 MCP，未证明任何 MCP server 当前在线或 Tool 成功；
- 未检查生产部署/数据库中的实际 Config Resource、Method Proposal、Run event 或 Artifact 数量；
- 本文已进入 `docs/energyiq/README.md` 与 `docs/energyiq/research/README.md`；唯一 follow-up 为 [#114](https://github.com/Zion74/energyiq-datafoundry/issues/114)。PR #110 已把 canonical Run Event v1 合入 `main`，主 Agent 已授权 #114 进入 RED/本地实现；#102 尚未关闭的浏览器/人工验收仍保持独立，不得冒充 #114 的实现证据。

## 12. Primary evidence index

- Formal Skill package/runtime：`packages/skills/builtin/*/SKILL.md`、`packages/skills/src/index.ts`、`apps/api/src/server.ts`
- AI Analyst instructions/Protocol：`packages/agent-runtime/src/index.ts`、`packages/agent-runtime/src/protocol/protocols/data-analysis.ts`
- Run assembly/Context：`apps/api/src/run-agent-assembly.ts`、`apps/api/src/energy/energy-context-item.ts`、`apps/api/src/energy/project-analysis-context-evidence.ts`、`packages/agent-runtime/src/context/**`
- Stage Prompts/Validators：`apps/api/src/energy/preschool-overview-ai-workflow.ts`、`preschool-section-interpreter.ts`、`preschool-executive-synthesis.ts`、`ngee-ann-section-interpreter.ts`、`ngee-ann-executive-synthesis.ts`、`preschool-additional-ai-insights-workflow.ts`
- Artifact identity/output contracts：`apps/api/src/energy/overview-ai-artifact.ts`、`apps/api/src/energy/*structured-output.ts`、`packages/contracts/src/energyiq-additional-ai-insights.ts`
- Method Governance：`packages/contracts/src/energyiq-autonomous-insights.ts`、`packages/contracts/src/energyiq-insight-method-promotion.ts`、`packages/metadata/src/energyiq-insight-method-governance-store.ts`
- Tool/MCP：`apps/api/src/energy/preschool-additional-ai-insight-runtime.ts`、`apps/api/src/run-config-resolver.ts`、`apps/api/src/policy-mcp-middleware.ts`
- Admin truth projection：`apps/api/src/energy/project-harness-configuration.ts`、`apps/api/src/energy/project-ai-operations.ts`、`apps/api/src/energy/run-config-audit.ts`
