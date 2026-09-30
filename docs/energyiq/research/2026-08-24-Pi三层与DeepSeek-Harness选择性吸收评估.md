---
title: "Pi 三层与 DeepSeek Harness 选择性吸收评估"
summary: "区分 pi-ai、Pi Agent Core、Pi Coding Agent 与 DeepSeek Harness 的层级，给出 EnergyIQ 的验证顺序、兼容风险和采用门。"
doc_type: concept
tags: [Pi, DeepSeek Harness, Model Gateway, Agent Runtime, Trace]
updated_at: "2026-08-24"
related:
  - "../decisions/决策-Harness逻辑控制面、Run-Event与可替换Runtime边界.md"
  - "../plans/开发计划-Admin与模板运行闭环.md"
  - "../decisions/说明-DataFoundry-Agent-Harness与EnergyIQ复用边界.md"
status: in_review
---

# Pi 三层与 DeepSeek Harness 选择性吸收评估

## 1. 背景

EnergyIQ 已使用 Mastra、AG-UI、AI SDK、受治理 Tools/MCP、Skills、Context 与 Artifact。Admin 在 PR #99 后能够解释 current Harness 和 historical evidence，但生产 Runtime 仍与 Mastra assembly 紧密耦合，Provider 实现也需要为不同模型维护兼容分支。

Pi 与 DeepSeek Harness 近期提供了相邻但不同层的机制。评估目标不是寻找一个“最火的 Harness”整体替换 EnergyIQ，而是确认哪些窄层机制可以被现有 Store/contract 组成的治理控制面安全吸收。

## 2. 2026-08-24 时点快照

| 对象 | 已验证事实 | EnergyIQ 当前关系 |
| --- | --- | --- |
| EnergyIQ | `main@6950206f14cff11fbbb2c7c47e67c3a5cc8c5374`；`@mastra/core` lock 为 `1.46.0`，顶层 `ai` 为 `6.0.240`；43 个 Apps/Packages TS/TSX 文件直接引用 Mastra/AG-UI Mastra | Mastra 是当前生产 Agent Runtime；`@datafoundry/providers` 仍是 Mastra/AI SDK shaped，#103 需用第二实现证明目标 Model Gateway seam |
| `pi-ai` | 官方最新 release `v0.84.2`（2026-08-14）；统一多 Provider、Tool calling、stream、reasoning、usage/cost、abort 与 serializable context | Model Gateway 候选，不等于 Model Profile Store 或 Admin Configuration |
| Pi Agent Core | Stateful Agent loop，构建在 `pi-ai` 上；提供 turn/message/tool execution events、context transform、before/after Tool hooks 与 stop/cancel 控制 | Runtime Adapter challenger |
| Pi Coding Agent | 终端 Coding Harness，包含 read/write/edit/bash、Session、compaction、Skills、Prompt Templates、Extensions 和 SDK/RPC 模式 | 只适合未来隔离 Build/Review Worker，不适合直接承载生产能源分析 |
| DeepSeek Harness | `master` 在 2026-08-21 仍有更新；README 标记 developer preview；以 Cordis plugin tree 组合 Session、Prompt、Tools、Agent loop 和产品出口 | 机制参考；当前不作为生产依赖 |

上述版本和代码耦合数字只描述本次快照；采用决策必须在执行 Ticket 时重新核对。

## 3. 核心思路

把三层 Pi 看成三个可单独使用的部件：

```text
Pi Coding Agent        完整 coding 产品 / terminal harness
        │ builds on
Pi Agent Core          Agent loop + Tool execution + events
        │ builds on
pi-ai                  Model/Provider streaming API
```

EnergyIQ 不需要按这条栈整体采用：#103 可以只验证 `pi-ai`；#105 再验证 Pi Agent Core；Pi Coding Agent 等存在真实 Coding Worker consumer 后才讨论。

DeepSeek Harness 也采用类似的分层思想。它当前使用 `pi-ai` 作为可替换 LLM adapter，却保留自己的 Session、Agent loop 和 Tool pipeline。这说明复用 Model adapter 不要求同时复用完整 Agent Harness。

## 4. 各层能吸收什么

### 4.1 `pi-ai`：最高优先级

可吸收能力：

- 多 Provider/Model catalog 与统一 stream/complete；
- Tool call、partial arguments、reasoning block 和 stop reason；
- abort、context overflow 和 Provider error 分类；
- usage、cache、cost；
- OpenAI-compatible/custom provider；
-可序列化 Context 与跨模型 handoff。

不能交给它：

- Workspace/Project visibility；
- Model Profile id/revision 与 Published default；
- secret reference、审批与 audit；
- context window 的产品规划合同；
- Run 的 exact immutable model snapshot；
- MCP server identity、连接策略和 Tool authorization。

外部 catalog refresh 只能产生 Admin 候选发现；进入生产前必须显式导入、验证并发布为 EnergyIQ Model Profile revision。

### 4.2 Pi Agent Core：第二优先级

它已经有相对清晰的 Agent/turn/message/tool execution 事件和 Tool 前后钩子，适合用于 #105 固定 parity spike。EnergyIQ Adapter 必须：

- 接收 EnergyIQ 逻辑控制面从既有 Store/contract 冻结的 `GovernedRunRequest`；
- 只暴露 approved Tools；
- 把 Pi events 规范化为 #102 Run Event；
- 在 cancel/failure 后产生唯一 terminal state；
- 不把 Pi Session、Message、Tool 或 Provider 类型泄漏到 Admin/API 公共合同。

是否采用由固定任务硬门决定，不由 Stars、通用 coding benchmark 或 API 简洁度决定。

### 4.3 Pi Coding Agent：后置假设

其 read/write/edit/bash、自动资源发现、Skills 和 Extensions 对代码任务有价值，但也扩大 filesystem、process、credential 和 prompt-injection 攻击面。只在以下条件同时存在时立票：

- 产品需要生成或修改 Template/Renderer draft；
- 输入是脱敏、固定的 Snapshot/Definition fixture；
- 独立短生命周期 Worker/Sandbox；
-依赖、网络、文件路径和输出范围受控；
- 只返回 Patch/Proposal/Preview/Test evidence；
- 没有生产数据库凭证和 `publish()`。

Pi 的本地 Skill 文件不能成为 EnergyIQ 第二套 Skill Store。若 Worker 需要 Skill，应由 exact EnergyIQ Skill snapshot 临时 materialize，并记录 revision/hash。

### 4.4 DeepSeek Harness：先吸收机制

值得吸收：

- append-only Session event log；
- `model-visible means logged` 与 request header reconstruction；
- live coordination event 与 durable session event 分离；
- Tool `pre-execute → execute → post-execute` pipeline；
- Service Definition / Provider / Consumer capability seam；
- plugin lifecycle/disposal 和 product projection 从 durable truth 重建。

暂不整体依赖的原因：

- 官方仍标为 developer preview，兼容性会破坏；
- Cordis plugin topology 和 lifecycle 会引入新的平台级心智与运维成本；
- EnergyIQ 当前需要的是 typed Run Event 与一条真实 Runtime seam，不是重新平台化所有组件。

### 4.5 社区二开指南：`dg-piagent`

用户补充的 [`dg-piagent` Skill](https://github.com/buchidonggua/dg-ai-notes/tree/main/skills/dg-piagent) 是一份有用的 Pi Coding Agent SDK 二开导航。它把 `createAgentSession`、ModelRegistry、Tool、Extension、Session、Skills、Prompt Templates、Context、Faux Provider 和源码兜底路径整理成按场景检索的说明，可以降低 #103/#105 阅读上游 SDK 的成本。

对 EnergyIQ 最有价值的检查项是：

- 覆盖 Pi Coding Agent 默认 coding system prompt，不能让产品 Agent 保留 coding assistant 人设；
- 默认 `read/bash/edit/write` 不得进入能源分析 Runtime，Tool 必须来自服务端 exact allowlist；
- Web/多租户执行使用内存 Session 并由 EnergyIQ Store 持久化规范事件，不能写入默认用户目录；
- 自定义 `resourceLoader` 后显式验证 `reload()` 行为，禁止默认扫描本地 Skills/Prompt/Context；
- 区分 `session.subscribe` 可见事件与 extension-only `pi.on` 事件，验证慢 I/O 是否阻塞 agent loop；
- 以真正 settled 的 terminal signal、abort 与 cleanup 测试替代仅观察 `agent_end`；
- #103 优先使用 Faux/scripted Provider 验证模型、stream、Tool 和 error normalization。

该资料是**社区实现指南，不是 EnergyIQ 合同或官方版本真相**。当前 Skill 声明基线为 `pi-coding-agent v0.83.0`，而 2026-08-24 npm/latest 与本研究快照为 `v0.84.2`。官方 `v0.84.0` 已包含 `ModelsStreamTransforms` 重命名、`message_update` 改为仅增量事件、nullable header marker、`ModelRegistry.refresh()` 签名变化等 breaking changes。因此执行 #103/#105 时应：

1. pin 精确依赖版本，不安装漂移的 `latest`；
2. 以对应版本的官方 CHANGELOG、`dist/**/*.d.ts` 和实现源码核对该 Skill；
3. 把 Skill 当作检索地图和测试清单，而不是直接复制 API；
4. 将验证出的差异回写 Ticket/研究文档，不静默修补。

## 5. 与 Prompt、Skill、Method、MCP 的关系

| 术语 | EnergyIQ 定义 | 外部机制的边界 |
| --- | --- | --- |
| Prompt | 一次 Stage 的动态任务、Context 和输出装配 | Pi Prompt Template/DSH Prompt section 可参考，但不成为租户/版本真相 |
| Skill | 可复用、版本化、可治理的稳定 SOP 与 Tool/Method policy | Pi Skill 文件只能是临时运行表示，不是第二个 Store |
| Method/SOP | 被业务治理的分析角度、适用范围、origin 和 novel contribution | 不等于 Agent loop hook 或 Skill file |
| Contract/Validator | Schema、单位、时间、Evidence、权限和 fail-closed | 必须由确定性服务端执行，不能迁入软 Prompt |
| MCP | server identity、manifest snapshot、connection policy 和 Tools | Pi Tool calling 只描述模型调用协议，不能替代 MCP 治理 |

## 6. 主要风险与验证方法

| 风险 | 为什么重要 | 验证 |
| --- | --- | --- |
| Provider 语义差异 | Tool schema、reasoning、空 message、usage 在不同 SDK 中不等价 | #103 fake/scripted matrix，保留现有兼容测试 |
| 自动 catalog 漂移 | 新模型或参数变化会破坏 historical exactness | catalog 只读发现；显式发布 Profile revision；Run snapshot pin |
| framework type leakage | 一旦 Admin/API 使用 Pi/Mastra 类型，替换 seam 失效 | public contract compile/test，两个 Adapter 不导出 native types |
| 事件体量和隐私 | 完整 Prompt/Context/Tool result 可能敏感且庞大 | immutable encrypted payload refs、hash、retention、redacted projections |
| 历史证据缺失 | 旧 Run 不具备新 event | `Unavailable`，不做 current-config backfill |
| Tool 与 MCP 混淆 | Tool call 成功不证明 MCP server 当前健康 | Run-captured server/tool mapping + called/result events；GET 不 probe |
| Coding Agent 权限过大 | filesystem/shell/extensions 可执行任意本机操作 | 仅隔离 Worker；deny production credentials/network/publish |

## 7. 结论与执行顺序

1. 先完成 #102 Run Event v1；没有统一执行真相，不做 Runtime 对比或可编辑 Studio。
2. #103 独立验证 `pi-ai`，结论可以是 adopt、adapter-only 或 reject。
3. #104 同期盘点 Prompt/Skill/Method，不让 Pi/DSH 的同名概念形成第二套 Store。
4. #105 在 #102/#103 后做固定 Mastra/Pi Agent Core parity；Mastra 在此期间保持唯一生产 Runtime。
5. #66 在事件和 immutable revision 合同充分后再做。
6. Pi Coding Agent 不进入当前任务树；真实 Build/Review consumer 出现后再评估。

## 8. 官方来源

- [Pi monorepo](https://github.com/earendil-works/pi)
- [`pi-ai` README](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)
- [Pi Agent Core README](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md)
- [Pi Coding Agent README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)
- [DeepSeek Harness README](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [DeepSeek Harness Session](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md)
- [DeepSeek Harness Tool pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-execution-pipeline.md)
- [DeepSeek Harness `pi-ai` adapter](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/llm/llm-pi-ai)

## 9. 社区实施参考

- [`dg-piagent` Skill](https://github.com/buchidonggua/dg-ai-notes/tree/main/skills/dg-piagent)：Pi Coding Agent SDK 二开场景索引；当前基线 `v0.83.0`，使用时必须对照本 Ticket pin 的 SDK 版本。
