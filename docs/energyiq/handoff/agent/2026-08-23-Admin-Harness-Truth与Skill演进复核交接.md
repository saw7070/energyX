---
title: "2026-08-23 Admin Harness Truth 与 Skill 演进复核交接"
summary: "从 main@0fce1a5 完成 Skill/Harness 复核，并在 main@b0a2e42 上交付 Admin Harness Truth Alignment PR #99。"
doc_type: handoff
tags:
  - EnergyIQ
  - Admin
  - Harness
  - Skills
  - Methods
  - AI-Operations
updated_at: "2026-08-23"
related:
  - "../../plans/开发计划-Admin与模板运行闭环.md"
  - "../../decisions/2026-08-19-Project通用Report-Time-Context与Overview复用决策.md"
  - "../../plans/2026-08-08-AI-Analyst-Harness与AI-Slot执行路径.md"
---

# 2026-08-23 Admin Harness Truth 与 Skill 演进复核交接

## 0. 给主 Agent 的裁决请求

这不是一份要求照做的实施命令，而是一份经当前代码复核后的工程输入。请主 Agent：

1. 先独立复核本文标为“事实”的代码证据；
2. 判断下一阶段 P0 应是 **Harness Truth Alignment**，还是直接推进 Prompt → Skill；
3. 判断现有 #62–#66 的 scope 是否仍能承载这次演进，或需要新的 child Ticket；
4. 在作出决定后更新现有 `开发计划-Admin与模板运行闭环.md`，避免建立平行路线图；
5. 只有在 Ticket、边界和验收合同落盘后才进入 TDD 实现。

我的建议是先做 Harness Truth Alignment，再抽取 Skill。这个建议可以被推翻；第 8 节列出了可推翻它的证据。

## 1. 初始复核基线与证据边界

### 1.1 Git 基线

```text
worktree: <independent-worktree>/energyiq-datafoundry
branch: codex/skill-system-audit
HEAD: 0fce1a5157a053b5b353e4c49236f4d9086f36ce
comparison baseline: ccff860b6d8d328254f0617085959d0ee19b3ec0
origin/main at review time: 0fce1a5157a053b5b353e4c49236f4d9086f36ce
```

复核前 worktree clean。本文是本轮唯一预期文件改动。

后续实现已在独立分支 `codex/admin-harness-truth-alignment` 上 rebase 到 `origin/main@b0a2e4261c26a56408a7bdfdb721d28fc5b172fa`。代码交付提交为 `99bab41b637b521563cfbab0e254bc1d6e43d813`，PR 为 [#99](https://github.com/Zion74/energyiq-datafoundry/pull/99)。第 1.2–1.3 节仅记录初始只读复核阶段；实现后证据见第 14 节。

### 1.2 已执行

- 将自己的审计分支以 `--ff-only` 快进到当时最新 `origin/main`；
- 静态读取 Skill package、Config Store、Method Governance、Harness Configuration、AI Operations、Artifact identity、Ngee Ann Section/Executive、Managed Overview Definition 与 Report Time Context；
- 比较 `ccff860..0fce1a5` 的相关代码变化；
- 分别进行 Standards 与 Spec 只读审查；
- 核对未修改其他 worktree 和受保护 Stage 3 路径。

### 1.3 未执行

- 没有查询 GitHub Issues 的当前 open/closed/label 状态；
- 没有运行测试、build、浏览器或人工产品验收；
- 没有调用 Provider、MCP 或 Tool；
- 没有部署、重启服务或修改生产；
- 没有证明当前 `origin/main` 等于当前生产版本。

因此，本文的结论是 **当前代码结构审查**，不是运行环境或产品验收结论。

## 2. 先给结论

### 2.1 仍然成立的判断

1. **正式 Skill 只有一套机制。** 它由 `packages/skills`、Config Resource、materialize 与 Runtime selection 组成；内置仍只有 `data-analysis` 和 `energy-insight-investigation`。
2. **系统是 prompt-heavy、skill-light。** 多个生产 Stage 仍用 TypeScript 内的 Prompt revision 和确定性 Validator 驱动，没有成为正式 Skill package。
3. **Method 是独立治理资源。** 它描述分析角度、适用范围、状态和 revision，可关联 Skill，但不能与 Skill 混成一个概念或 Store。
4. **Configuration 与 historical execution 必须分开。** 当前可用资源不能反推历史 Run 实际使用的资源。
5. **不能开放任意 Prompt/HTML/SQL/Tool 编辑器。** published revision 的修改仍应走 Draft/Proposal/Validate/Diff/Publish 治理。

### 2.2 需要修正的旧判断

旧计划写“Ngee Ann 不出现 Preschool-only stages”，当时是正确的防伪目标，但已经不足以描述当前缺口：

- 当前 `overviewHarnesses(...)` 对任何非 `preschool-overview` renderer 直接返回空数组；
- 因此 Ngee Ann 不仅没有 Preschool stages，也没有展示它自己真实运行的 Section Interpretation、Executive Synthesis 和 Additional Insights stages；
- 与此同时，Ngee Ann 这些 Stage 的 Prompt、Validator、Artifact identity 和 Report Time 约束已经发生较大演进。

这意味着 Admin Harness Configuration 已落后于真实 Runtime。它不只是“功能还不丰富”，而是存在 **解释性真相缺口**。

### 2.3 当前最重要的两个合同错误

1. AI Operations 把 `skill.materialized` 投影为 `loadedSkills`。materialized 只能证明 Skill 被准备到运行环境，不能证明模型或 Runtime 实际读取了 Skill 内容。
2. 普通认证请求在路由前仍执行 `ensureBuiltinConfigResourcesOnce(...)`。它不调用 Provider/MCP，但普通 GET 仍可能触发 ensure/materialize 副作用，不符合既定的“普通 GET 0 ensure/queue/write”目标。

## 3. 当前机制的准确解释

### 3.1 Skill 是怎样产生的

当前正式路径是：

```text
作者创建 Skill package
→ SKILL.md/manifest 形成可识别资源
→ Config Resource 登记 revision、scope、enabled/status
→ Run 根据输入或固定合同 selection
→ materialize 到 Runtime 可访问位置
→ Runtime 读取后参与推理
→ Run event / Artifact provenance 记录可证明的阶段
```

当前缺口不是“完全没有 Skill 基础设施”，而是：

- 正式 package 数量很少；
- 很多生产知识仍嵌在 Stage Prompt；
- physical owner 仍是 `workspace_id + user_id`，payload 声明 `scope=workspace` 不足以证明真实 Workspace 共享；
- selection/materialization 有审计，但 actual load/attribution 仍不完整。

### 3.2 Prompt 与 Skill 的关系

建议主 Agent以以下定义审查，而不是把二者当成同义词：

| 概念 | 应承载什么 | 不应承载什么 |
| --- | --- | --- |
| Prompt | 一次 Stage 的动态调用装配：任务、Project facts、Report Time Context、Evidence、输出合同与当次约束 | 跨项目唯一知识真相、权限、tenant identity |
| Skill | 可复用、版本化、可治理的稳定推理说明、领域 SOP、检查清单和示例 | 当次客户数据、动态时间窗口、secret |
| Method | 业务认可的分析角度/方法、适用范围、origin、novel contribution、治理状态与 revision | Runtime 文件物化细节 |
| Protocol/Validator | Schema、单位、字段语义、时间、比较方向、Evidence binding、权限和 fail-closed 规则 | 依赖模型“自觉遵守”的软提示 |
| Harness | 某 Stage 实际可采用的 Model、Prompt、Skill、Method、Tool、Context、Output Contract 与治理组合 | 一个可随意编辑的巨型 system prompt |

运行时 Prompt 可以引用 Skill 和 Method，但仍需动态注入事实与确定性合同。把整个 Prompt 文件复制成 Skill 会把稳定 SOP、客户事实和 Validator 混成一团，反而削弱治理。

### 3.3 为什么看起来像“两套 Skill”

不是两套正式 Store，而是三个层次使用了相似词汇：

1. Config/Runtime 的正式 Skill package；
2. Method Governance 中带 `skillId` 或 method instruction 的受治理分析资源；
3. TypeScript Stage 中的 code-owned Prompt/SOP。

其中第 2、3 类会影响模型行为，但不一定出现在 Skill Library。UI 若把它们全部标成“Skill”，会制造错误心智模型；UI 若只展示正式 Skill package，又会漏掉真实 Harness 的关键组成。

建议 UI 使用 `Skills`、`Methods & SOP`、`Stage Instructions` 三个明确分组，并通过引用关系解释组合，而不是强行合并资源类型。

## 4. 从旧基线到当前代码，真正发生了什么

### 4.1 基本未变

相对 `ccff860`，下列核心文件或目录没有实质变化：

- `packages/skills/**`；
- `packages/metadata/src/config-store.ts`；
- `packages/metadata/src/energyiq-insight-method-governance-store.ts`；
- `apps/api/src/energy/project-ai-operations.ts`；
- `apps/web/src/app/energyiq/admin/project-harness-configuration.tsx`；
- `apps/web/src/app/energyiq/admin/project-ai-operations.tsx`。

`apps/api/src/energy/project-harness-configuration.ts` 只有一处适配性变化：Overview profile resolver 现在接收 `metadataStore`，以便从受管理的 Overview Definition 解析 renderer/profile。

### 4.2 变化显著

Ngee Ann Section、Executive、Additional Insights 与 Artifact identity 发生了连续升级，包括：

- Section identity/validator/prompt 已演进到当前 revision；
- Executive identity/validator/workflow/prompt 已演进；
- Additional Insights 的 Ngee identity 和 acceptance revision 已演进；
- Section Prompt 加入 Project-local Report Time、字段语义、比较方向、day-type、单位等规则；
- Section acceptance 增加语义数字绑定、单位/entity 校验、day-type direction/ranking、时间归一化、局部恢复与安全 salvage；
- Executive acceptance 强化跨 Section 合成、Finding 产出和来源 ID 验证；
- Artifact identity 可以携带 `reportTimePolicyId`、`reportTimePolicyRevision` 和 `reportTimeContextFingerprint`。

这说明业务 Stage 已经远比初版 Harness 页面表达得复杂。

### 4.3 新的 Managed Overview 真相源

当前 `resolveProjectOverviewProfile(metadataStore, projectId)` 会优先读取最新 Template Revision 关联的 Overview Definition，再解析：

- renderer/profile；
- Overview Definition revision/fingerprint；
- Report Time Policy Revision；
- primary named window；
- Section time bindings。

无法取得 managed definition 时才回退 legacy profile。

这些资源已经成为生产 Harness 的真实输入，但当前 Harness Configuration DTO 仍只聚焦 Models、Skills、Methods、Tools 和 MCP，没有把 Definition/Time Policy/Window binding 纳入解释模型。

## 5. 逐项代码证据

| 结论 | 当前代码位置 |
| --- | --- |
| Harness profile 已接入 Metadata/Managed Overview resolver | `apps/api/src/energy/project-harness-configuration.ts:184` |
| Harness 仍只组装 Analyst + Overview summaries | `apps/api/src/energy/project-harness-configuration.ts:208-210` |
| 非 Preschool renderer 的 Overview Harness 被全部省略 | `apps/api/src/energy/project-harness-configuration.ts:370-375` |
| `loadedSkills` 实际来自 `skill.materialized` | `apps/api/src/energy/project-ai-operations.ts:51-54,296-317` |
| Overview Definition 优先于 legacy profile | `apps/api/src/energy/project-analysis-resolver.ts:332-394` |
| Overview Definition 存储 fingerprint 与 time policy revision | `packages/metadata/src/energyiq-overview-definition-store.ts` |
| Ngee Section/Executive 当前 Prompt 与 Validator identity | `apps/api/src/energy/overview-ai-artifact.ts:97-147` |
| Report Time identity 已进入 Artifact identity | `apps/api/src/energy/overview-ai-artifact.ts:175-222` |
| 普通认证请求在路由前执行 builtin ensure | `apps/api/src/server.ts:914-924` |
| isolated Overview value stages 仍以 code Prompt 运行而非正式 Skill package | `apps/api/src/server.ts` 的 `buildOverviewAiStageRunInput(...)` |
| Ngee Section Prompt/Validator 已混合多类职责 | `apps/api/src/energy/ngee-ann-section-interpreter.ts` |
| Ngee Executive Prompt/Validator 已强化跨 Section 约束 | `apps/api/src/energy/ngee-ann-executive-synthesis.ts` |

主 Agent 应以当前 HEAD 重新打开这些位置；行号会随新提交漂移。

## 6. 我的建议：先做 Harness Truth Alignment

### 6.1 推荐路线

先交付一条只读 tracer bullet，使 Configuration 和 Operations 能解释当前真实运行，再迁移 Prompt → Skill。

#### A. Harness Configuration truth

扩展现有 `readProjectHarnessConfiguration(projectId)` 深模块，而不是新建 Store：

- 列出 Preschool 与 Ngee Ann 当前真实 stages；
- 读取当前 published Overview Definition revision/fingerprint；
- 读取 Report Time Policy revision 和 named window/Section binding 摘要；
- 展示 code-owned Stage Prompt revision、Output Contract revision 和 Validator revision；
- 继续展示 Model、formal Skill、Method、Tool、MCP；
- 技术 IDs 默认折叠，动态 Prompt/Context/secret 不下发；
- 任一局部证据缺失时局部 `unavailable`，不让整个页面假成功。

#### B. 分资源状态语言

不要把所有资源强塞入一条通用 lifecycle。建议按资源类型记录：

| 资源 | 可证明状态 |
| --- | --- |
| Skill | registered/configured → declared → selected → materialized → loaded/read |
| Method | provisional/review/published → declared → injected → Finding-attributed |
| Tool | registered → declared → called → succeeded/rejected/failed |
| Model | configured → resolved → request-started → provider-completed/failed |
| Prompt | code-owned revision → assembled identity；正文默认不进入 Admin read model |
| Definition/Policy | published revision → resolved for Run → Artifact identity bound |

只有存在对应持久证据时才能进入后一状态。

#### C. 普通 GET purity

将 builtin ensure/materialization 从普通 GET request path 移到显式 bootstrap、migration 或受审计写操作。完成标准不仅是“0 Provider”，还包括：

```text
0 Provider
0 MCP connect/probe
0 Tool call
0 ensure/materialize write
0 queue/rebuild
```

#### D. AI Operations truth

- 将当前 `loadedSkills` 修正为 truthful `materializedSkills`；或先增加真实 load/read event，再展示 loaded；
- 补 Definition/Policy/Prompt/Validator/Method Set 的 Run-captured identity；
- 保留 list-first、detail-on-demand；
- 历史 Run 只读取当时事件和 Artifact provenance；
- 缺失证据显示 `unavailable`，不根据 current config 回填；
- 历史 Artifact 保持只读，Comment/Useful/Proposal 使用既有 append-only/governance seam。

### 6.2 之后再做 Prompt → Skill

优先候选：

1. `energyiq-section-interpretation`：只抽取稳定的证据阅读、分析组织、谨慎表达和来源引用 SOP；
2. `energyiq-executive-synthesis`：只抽取跨 Section 综合、去重、矛盾处理、优先级和决策表达 SOP；
3. `energyiq-open-discovery`：统一当前 Additional Insights 的开放发现 SOP 与正式 Skill/Method identity；
4. Template Proposal：等 Overview Definition/Capability/Policy contract 稳定后，再判断是否抽取“管理员意图 → governed definition”的稳定 SOP。

每个迁移应保留：

- code-owned Prompt revision；
- formal Skill revision；
- deterministic Validator/Protocol revision；
- Artifact identity；
- Run-captured selected/materialized/loaded/attributed evidence；
- 历史 revision 只读兼容。

不要把字段语义、单位、Report Time、Schema、tenant exactness 或发布审批迁入 Skill。

## 7. 备选路线与取舍

| 选项 | 优点 | 风险/代价 | 何时选择 |
| --- | --- | --- | --- |
| A. Harness Truth Alignment 优先 | 先修复 Admin 与 Runtime 的事实偏差；为后续 Skill 提供可信展示和审计 | 短期用户看到的是解释能力增强，不是大量新可编辑资源 | 当前推荐 |
| B. Prompt → Skill 优先 | Skill Library 很快出现更多内容；可开始复用 SOP | 当前页面仍漏真实 stages，actual-use 证据也不可信；可能把 Validator 误迁为 Skill | 只有已另有可信 Harness/trace 证据时 |
| C. 直接建设完整 Configuration CRUD | 管理员表面上获得最大控制力 | owner/scope、immutable revision、secret、权限、publish 治理尚不充分，风险最高 | 仅在 #66 合同和 operator 权限模型完成后 |
| D. 只修 UI copy | 成本最低 | 无法修复 read model 缺阶段、GET 副作用和缺失审计 | 只适合作为临时止血，不算完成 |

## 8. 什么证据会推翻我的建议

如果主 Agent 发现以下任一事实，应重新排序：

1. 当前最新 main 已有另一条 server-owned read model 完整枚举 Ngee Ann stages、Overview Definition 和 Report Time Policy，而本文没有找到；
2. `skill.materialized` 在 Runtime 合同中被严格定义为“内容已被实际读取”，并有测试证明，不只是文件准备；
3. 普通 GET 的 `ensureBuiltinConfigResourcesOnce` 已被证明为纯读、幂等且绝不写入或物化任何状态；
4. 当前 GitHub Ticket 已明确将这些缺口纳入正在执行且不冲突的实现；
5. 产品决定 Harness Configuration 只解释正式 Config Resources，而另一个已交付页面负责完整 Stage/Prompt/Definition truth。

若这些证据不存在，直接做更多 Skill 会扩大解释性债务。

## 9. 建议的最小 Ticket / TDD 骨架

主 Agent 应先查询 #62–#66 和相关 #47/#48/#49/#51/#52/#57/#61 的当前状态，避免重复票。若没有已有 Ticket 覆盖，可建立一个 child Ticket，目标只包含：

```text
Admin Harness Truth Alignment:
- Preschool/Ngee exact stage catalog
- Overview Definition + Report Time Policy bindings
- resource-specific evidence states
- materialized != loaded
- ordinary GET 0 ensure/write/provider/MCP/tool/queue
```

RED tests 至少覆盖：

1. Ngee Ann 返回自己的 Section/Executive/Additional stages；
2. Ngee Ann 不返回 Preschool-only stage identity；
3. Preschool 当前 stages 与实际 Artifact contracts 一致；
4. Definition/Policy revision 和 fingerprint 来自 exact Project published context；
5. 跨 Workspace/Project、普通用户、伪造 Run/Artifact identity fail closed；
6. 普通 GET `private, no-store` 且 0 Provider/MCP/Tool/ensure/queue；
7. `skill.materialized` 只显示 materialized，不显示 loaded；
8. Method published/declared/injected/attributed 不互相推导；
9. Tool registered/declared/called/succeeded 不互相推导；
10. 历史 Artifact/Run 缺新证据时局部 unavailable，且不被 current config 改写；
11. Runs & Traces 首屏 list-only，点击后才请求 exact Run detail；
12. raw Prompt、客户 Context、Tool args/results、secret 和内部路径不通过 Admin GET 泄露。

GREEN 实现应优先复用：

- `project-harness-configuration.ts`；
- `project-ai-operations.ts`；
- Overview Definition/Template/Report Time stores；
- Artifact provenance 与 existing Run events；
- existing feedback / Method Proposal / Governance Store。

## 10. 结构性风险，不能顺手混入 tracer

Standards 审查未发现硬性违规，但发现以下设计债务：

1. Artifact/Prompt/Validator revision 分散在 identity creator、interpreter 和 server，升级容易产生 shotgun surgery；长期应收敛为只读 contract registry。
2. `ngee-ann-section-interpreter.ts` 同时负责 Prompt、JSON 修复、时间投影、单位修复和多类语义 acceptance，职责过多；后续可拆 projection/normalization/acceptance 深模块。
3. Section 与 Executive 存在重复单位修复逻辑。
4. Report Time identity 三字段靠运行时维持 all-or-none，适合抽成领域类型。
5. Energy scope resolution 在 server 中存在重复，适合集中 exact resolver。

这些问题值得单独 Ticket 或重构批次，但不应扩大第一条只读 truth tracer 的 diff。

## 11. 冲突与所有权边界

第一批实现应集中在 Harness Configuration、AI Operations、Admin UI/API/tests/docs。优先只读消费当前 provenance 和 managed definition。

以下路径如确实需要修改，应先停线协调 owner，而不是把它们顺带纳入：

- Preschool/Ngee Stage 3 discovery workflow；
- Artifact identity 与 evaluation/mutation Store；
- A→B compare；
- Ngee Ann AI Slot 正在进行的质量逻辑；
- 部署脚本和服务器。

尤其不要为了让 Admin 显示 revision 而回写或重建历史 Artifact。正确方向是读取当前已持久化 identity；缺失时显示 unavailable，未来再增加前向 audit。

## 12. 主 Agent 建议执行顺序

1. 核对自己的 worktree、branch、HEAD、status 和目标 main；
2. 重新读取本文第 5 节的当前代码位置，确认事实仍然成立；
3. 查询 #62–#66 和相关 Issues 的当前状态及重叠 scope；
4. 对 A/B/C/D 路线作独立裁决，并记录选择、否决理由和失效条件；
5. 更新现有开发计划，建立或补充唯一 child Ticket；
6. 独立 worktree 严格 RED → GREEN；
7. focused API/Web tests、相关 package builds、`git diff --check` 和受保护路径检查；
8. 自动化、浏览器、真实 Provider/MCP、部署和人工产品验收分开报告。

## 13. 一段式短交接

```text
请基于最新 main 独立复核 Admin Harness/Skill 路线，不要直接采纳旧计划。当前正式 Skill 管线和两个 builtin Skills 基本未变，但 Managed Overview Definition、Report Time Policy 以及 Ngee Ann Section/Executive/Additional stages 已显著演进；现有 Harness read model 对非 Preschool renderer 直接返回空 Overview stages，因此 Admin 看不到 Ngee 的真实 Harness。AI Operations 还把 skill.materialized 误投影为 loadedSkills；普通认证 GET 路由前仍调用 builtin ensure。建议先裁决并实施 Harness Truth Alignment：补 exact stage/Definition/Policy/Prompt/Validator read model，按资源区分 available/selected/materialized/loaded、registered/called/succeeded、published/injected/attributed，并实现普通 GET 0 ensure/write/provider/MCP/tool/queue；随后才将 Section Interpretation、Executive Synthesis 等稳定 SOP 抽成正式 Skill，确定性事实约束继续留在 Contract/Validator。请先核对 #62–#66 与相关票，更新现有开发计划，再按 TDD 实现；不要新建平行 Store，也不要回写历史 Artifact。
```

## 14. 独立实现进展（2026-08-23）

用户已批准在独立分支 `codex/admin-harness-truth-alignment` 实现并通过 PR 交付。该分支从已发布的 `origin/main` 拉出，不是从主 Agent 当前未合并的 Stage 3 worktree/WIP 拉出，也没有吸收该 WIP。已交付代码提交 `99bab41b637b521563cfbab0e254bc1d6e43d813`，待审 PR [#99](https://github.com/Zion74/energyiq-datafoundry/pull/99)。

已完成的 tracer bullet：

1. 扩展既有 Harness read model，使 Ngee Ann 显示自身的 Executive Synthesis、Section Interpretation 和 Additional Insights stages，并显示 code-owned 当前 Artifact/Workflow/Prompt/Validator/Output Contract revisions；
2. 只读投影 exact Project 的 published Overview Definition、fingerprint、pinned Report Time Policy、named windows 和 Section bindings；单一依赖缺失时局部 `Unavailable`；
3. 将 Run 中的 `skill.materialized` 与 `loaded/read` 分离；当前没有真实 load/read 事件时，后者诚实显示 `Unavailable`；
4. 普通 GET/HEAD/OPTIONS 不再执行 builtin config ensure 和 legacy migration write；unsafe write methods 仍保留原有准备流程；
5. Admin UI 增加人类可读的 Managed Overview 和资源证据状态，技术 identity 继续折叠，不返回 raw Prompt、客户 Context、Tool args/results 或 secrets。
6. 在 `origin/main` 前进并新增 Tuya `energy-template-overview` 后，将分支 rebase 到 `b0a2e4261c26a56408a7bdfdb721d28fc5b172fa`；Tuya 显示自身 published Definition/Policy，但不虚构尚不存在的 Executive/Section/Additional AI Stage contracts。

rebase 后的自动化证据：API focused 4 files / 16 tests，Web focused 8 files / 14 tests；contracts、metadata、data-gateway、API 和 Web builds 通过；`git diff --check` 通过；受保护的 Stage 3 discovery、Artifact identity/evaluation/mutation、A→B 路径无 diff。

未执行：浏览器/多账户产品验收、真实 Provider/MCP/Tool 调用、部署、服务重启和人工验收。这些不能由 focused tests 或 build 替代。

## 15. 主 Agent 独立复核与修正（2026-08-23）

主 Agent同意优先采用路线 A：先让 Admin 诚实解释当前 Runtime，再推进 Prompt → Skill；不同意仅凭 focused tests 直接放行原实现。复核发现并修正了三处边界：

1. 原 Overview Harness 的 `available` 只取决于系统模型是否存在，未绑定 exact Project Runtime Profile 是否能从 Definition、Policy 和其他 pinned dependencies 成功解析；现在 Runtime Profile 不可解析时，Stage 合同仍可查看，但执行状态为 `unavailable`；
2. 损坏的 `policy_json` 原本会让整个 Admin GET 抛错；现在 Definition 继续可见，Report Time Policy 局部 `unavailable`，并记录安全的本地诊断，不回传原始 JSON；
3. 原 Admin Stage revision 是第二份手写常量表，存在与真实 Artifact identity 漂移的风险；现在展示合同直接从当前 Ngee Ann / Preschool canonical identity factories 生成。

新增 RED → GREEN 覆盖包括：有可用模型但 pinned Policy 缺失时三个 Overview AI stages 均不可执行；Policy JSON 损坏时 Admin read model 保持可读且 fail closed。更新后的聚焦回归为 9 files / 25 tests passed，API build passed；完整相关 builds、GitHub CI 和浏览器验收继续按本交接的分层边界执行。
