---
title: "pi-ai Model Gateway 版本钉扎与兼容矩阵"
summary: "为 GitHub #103 固定 pi-ai 包身份、能力边界、EnergyIQ Profile 映射、风险与 adopt/adapt/reject 门，不启动生产 Runtime 迁移。"
doc_type: research
tags: [Pi, pi-ai, Model Gateway, Model Profile, Provider]
updated_at: "2026-08-24"
related:
  - "../决策-Harness逻辑控制面、Run-Event与可替换Runtime边界.md"
  - "../开发计划-Admin与模板运行闭环.md"
  - "2026-08-24-Pi三层与DeepSeek-Harness选择性吸收评估.md"
status: in_review
---

# pi-ai Model Gateway 版本钉扎与兼容矩阵

## 1. 结论先行

本研究对 [GitHub #103](https://github.com/Zion74/energyiq-datafoundry/issues/103) 的最终评估结论是 **`adapt behind an EnergyIQ-owned adapter`**，不是直接采用外部公共类型，也不是迁移 Agent Runtime：

- 候选实现固定为 **`@earendil-works/pi-ai@0.84.2`**；`@mariozechner/pi-ai` 是停在 `0.73.1` 的旧 npm scope，不能与当前发布线混用。
- `pi-ai` 的 provider/model、stream、reasoning、Tool transport、usage、abort 和 Faux Provider 足以支撑一个隔离 probe；但它没有 EnergyIQ 的 Workspace、Project、Model Profile revision、secret reference、Run snapshot、Tool/MCP authorization 或 stable request identity。
- 外部 model catalog 是运行时可变数据。它只能辅助验证或形成候选发现，不能自动修改已发布 Model Profile，更不能回填历史 Run。
- `pi-ai` 的 `Models`、`MutableModels`、`createProvider()`、真实 OpenAI-compatible payload builder 和 `fauxProvider()` 已在隔离 probe 中验证；Pi Coding Agent 的 `ModelRuntime`/旧 `ModelRegistry`、Session、Agent loop、Skills 与本 Ticket 无关。
- Mastra 保持唯一生产 Runtime；本分支把 `pi-ai` 与 synthetic probe 完整隔离到非 root-workspace 的 `evaluations/pi-ai-gateway`，使用独立 `package.json + package-lock.json`。root lock 与 `packages/providers/package.json` 保持和 `main` 一致，候选依赖不进入 production install graph、Providers public index、Runtime 默认或 #105。

当前 #103 兼容矩阵已经完成：53 个隔离 evaluation/dependency cases 与 27 个既有 Provider compatibility cases 通过；DeepSeek/Alibaba/Kimi fake-fetch cold path 另以三个独立 Vitest 进程重复通过。第 10 节逐项列出证据和仍属于生产采用阶段的风险。这里的“完成”只表示可提交主 Agent 复审的隔离评估完成，不表示生产采用、Runtime 切换或 #105 获得授权。

## 2. 固定研究对象与证据账本

### 2.1 EnergyIQ 快照

| 项目 | 本次固定值 |
| --- | --- |
| 仓库 / 分支 | `Zion74/energyiq-datafoundry` / `codex/103-pi-ai-gateway-eval` |
| 最终复审基线 | `origin/main@fe42aeb1c01c41c768456c613b8ac43f3de15790`；#103 分支已 clean rebase，未吸收其他 worktree WIP |
| 本轮修订证据 | 独立 package `2 files / 53 tests`、cold fake-fetch `3 processes × 3 cases`、既有 Providers `2 files / 27 tests`、evaluation typecheck、Contracts/Providers build、docs strict、docs link smoke 与 diff-check；exact commit 以 PR #120 当前 head 为准。这是本地自动化证据，不是生产、真实 Provider 或 Runtime 验收 |
| 仓库 Node 合同 | 根 [`package.json`](../../../package.json) 为 `>=22`；GitHub CI 使用浮动 `node-version: "22"` |
| 本地只读研究环境 | Node `v24.14.0`、npm `11.9.0` |
| 当前生产 Model 实现 | [`@datafoundry/providers`](../../../packages/providers/src/index.ts) 仍输出 AI SDK/Mastra-shaped `model: unknown`，支持 Alibaba、DeepSeek、OpenAI 与 OpenAI-compatible |
| 当前 Profile 真相 | [`workspace-model-profile-resolver.ts`](../../../apps/api/src/workspace-model-profile-resolver.ts) 与 [`run-config-resolver.ts`](../../../apps/api/src/run-config-resolver.ts) 服务端解析 exact profile/binding revision、Workspace owner、secret ref、fallback chain 与 planning context |
| `pi-ai` 依赖状态 | `evaluations/pi-ai-gateway` 以独立 lock 精确 pin `@earendil-works/pi-ai@0.84.2`，且不在 root workspaces；root lock 与 Providers package manifest 均不含候选包，`packages/providers/src/index.ts` 也不导出 evaluation seam |

### 2.2 候选包身份

2026-08-24 的 npm 与上游 tag 快照如下：

| 对象 | 精确身份 | 判断 |
| --- | --- | --- |
| 旧 scope | [`@mariozechner/pi-ai@0.73.1`](https://registry.npmjs.org/@mariozechner%2fpi-ai/0.73.1)，Node `>=20.0.0` | 历史包；npm 最新仍为 `0.73.1`，不用于 #103 |
| 当前 scope | [`@earendil-works/pi-ai@0.84.2`](https://registry.npmjs.org/@earendil-works%2fpi-ai/0.84.2)，Node `>=22.19.0` | #103 唯一候选 |
| 上游 tag | [`v0.84.2`](https://github.com/earendil-works/pi/tree/v0.84.2/packages/ai)，commit `914cf1472e715297caa30db4b9535d534a9eb718` | 源码、README、CHANGELOG 与 types 的固定基准 |
| npm artifact | tarball SHA-1 `708f13d19c0f5cfd9432fee704b0cde46e4d906f`；integrity `sha512-6MzsrYIYNVlE7SfpbL2yYb67Qo58p/7Q+xWG1RZvoX1P80aRCHSod2/13aFpxkow1lPO2LEh3c495J0Gwmyjig==` | 后续 lockfile 必须精确解析到此 artifact |

原 `https://github.com/badlogic/pi-mono` 现重定向到 [`earendil-works/pi`](https://github.com/earendil-works/pi)。npm 发布时间显示新 scope 从 `0.74.0` 延续，而旧 scope 停在 `0.73.1`；包名迁移不能靠 semver 自动推断。当前 package name、版本、repository、11 个直接依赖与 Node 下限见固定 tag 的 [`packages/ai/package.json`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/package.json#L1-L94)。

前置研究先把 tarball 下载到系统临时目录做只读审计；随后 atomic probe 将同一 artifact 写入 lockfile。`npm pack` 报告该 artifact 为 **755,725 bytes compressed、4,034,579 bytes unpacked、742 entries**。上游 package 对 telemetry 使用 `^0.84.2`，仅 pin 顶层包不足以证明整个依赖图不漂移。

本分支 lock 快照中顶层 resolved URL 与 integrity 与上表一致；其 transitive `@earendil-works/pi-telemetry` 解析到 `0.84.2`，integrity 为 `sha512-wg5caea7uIv1BHRBm2Y116RvFG4oSAiP5qk9tA2463PDGIr4K8M1Ceyyg5DOpF/shUUl0gk826yQJAeAcHYB9g==`。这仍只是 branch-level probe 证据，不是合并、发布或生产验收证据。

### 2.3 版本变化门

[`0.84.0` CHANGELOG](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/CHANGELOG.md#0840---2026-08-06) 包含 breaking changes：`ModelsStreamTransforms` 改名为 `ModelsRequestTransforms`，动态 catalog refresh 改用 concrete abort signal 与 generation-checked `publish()`，auth/login/OAuth refresh 也要求 signal。`0.84.2` 又修改了 strict Tool schema 转换、DeepSeek `max_tokens`、Tool namespace 与 terminal stop 行为。由此得到两个硬门：

1. 不允许使用 `latest`、旧 scope 或社区指南的 `0.83.0` API 直接实现。
2. 只要候选版本、tarball integrity 或 transitive lock 改变，compatibility matrix 必须重跑。

## 3. EnergyIQ 必须继续拥有的边界

当前 [`@datafoundry/providers`](../../../packages/providers/src/index.ts) 已把 Provider alias、base URL、API key、Alibaba/DashScope empty-message compatibility、reasoning 参数和 Tool compatibility 隔离在一个包内，但返回值仍是 Mastra/AI SDK 所需的模型对象。因此“Model Gateway”目前是 #103 要用第二实现证明的**目标 seam**，不是已成立的公共合同。

无论 probe 是否通过，下列身份不能交给 Pi：

- `workspaceId / projectId / actorId / sessionId / runId` 与授权；
- Model Profile `id + revision`、Workspace visibility、server-owned binding revision 与 fallback policy；
- `secret_ref`、解密、rotation、Admin redaction 与 retention；
- Context budget、requested/effective capability、Run snapshot 和 request fingerprint；
- Tool/MCP allowlist、canonical validator、execution、Evidence 与 audit；
- retry identity、terminal-state uniqueness 和历史 Artifact immutability。

`pi-ai` 自身的 `Context` 只有 `systemPrompt/messages/tools`，`Model` 只有 provider/model/API/base URL/capability/cost 等字段；其公开类型没有上述 EnergyIQ identity，见 [`types.ts`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/types.ts#L370-L530) 与 [`Model`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/types.ts#L794-L815)。

## 4. Profile → Pi request 的建议映射

| EnergyIQ server-owned 输入 | `pi-ai@0.84.2` 内部映射 | 必须保留的限制 |
| --- | --- | --- |
| Profile `id + revision`、binding revision | 不映射为 Pi catalog identity；作为 EnergyIQ adapter request/snapshot 字段 | Pi `Model` 没有 revision；Run 必须另存 exact profile snapshot/hash |
| `provider` | 独立 `Provider.id` | 只允许服务端白名单映射；不能接受浏览器任意字符串 |
| `modelName` | `Model.id` | exact lookup 失败即 Unavailable；禁止取 catalog 第一项兜底 |
| `baseUrl` | `Provider.baseUrl` / `Model.baseUrl` | URL scheme/host 由服务端 policy 验证；不得形成 SSRF 编辑器 |
| `secret_ref` | 服务端解密后提供给受控 auth resolver 或 per-request `apiKey` | 不把 secret 交给 Pi 持久化 Credential Store、日志、Run payload 或 Admin DTO |
| `contextLength / maxOutputTokens` | `Model.contextWindow / maxTokens` | 以 EnergyIQ verified/explicit Profile 为准；外部 catalog 只能用于一致性诊断 |
| `reasoningModel` 与 run reasoning policy | `Model.reasoning`、`thinkingLevelMap`、`streamSimple({reasoning})` 或 API-specific option | 同时记录 requested/effective；unsupported/silently ignored 不能显示为“已启用” |
| temperature/topP/penalty | `StreamOptions` 或 API-specific options | 只映射已验证字段；任意 `samplingParams` 不开放给 Admin |
| fallback chain | EnergyIQ 逐个解析的 immutable Profile chain | 不使用 Pi `getAvailable()` 顺序或 catalog refresh 自动改变 fallback |
| EnergyIQ request identity | adapter 以 exact `workspaceId/projectId/actorId/sessionId/runId/requestId/stepId/retryIndex`、Profile revision 与 request fingerprint 生成 attempt id；event id 再绑定 normalized event fingerprint，可按 policy 注入 header | Pi `responseId` 只是可选 Provider response id；Pi 的 `sessionId` 是 cache/affinity hint，不能代替 EnergyIQ Session/Run identity；同 event id 与不同 content hash 必须 fail closed |

Provider/Model/request headers 的合并顺序是 auth/model headers → explicit request headers → `transformHeaders()`；request header 可用 `null` 抑制默认值，见 [`ProviderRequestOptions`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/types.ts#L120-L222) 与 [`Models.applyAuth()`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/models.ts#L636-L665)。这提供了受控 gateway header 与 request-id 注入点，但不授权任意 Header UI：EnergyIQ 仍应只接受 server-resolved header policy，snapshot 仅存 hash/redacted names。

### 当前三类生产 Profile 的适配假设

- **DeepSeek**：上游有内置 `deepseek` provider；`0.84.2` 修复了 custom/built-in DeepSeek `max_tokens` 与大小写 hostname 识别。但仍需 synthetic request-body probe，不能用 catalog 名称证明兼容。
- **OpenAI-compatible / Kimi**：用独立 custom provider + exact model record，而不是覆盖内置 `openai`。Kimi non-strict Tool 只能复用既有 exact model、read-only、eligible bundle 与 local validation 合同；不能按名称前缀泛化，也不继承 Alibaba/DashScope 的 empty-message compatibility。
- **Alibaba / Qwen**：`0.84.2` provider 清单有 Qwen Token Plan，不等于当前 `@ai-sdk/alibaba` 的 DashScope/Bailian 合同。应按 exact base URL 作为 custom OpenAI-compatible provider 验证，禁止把订阅型 Qwen Token Plan 当作一比一替代。固定 provider 清单见 [`README`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/README.md#L55-L90)。

## 5. Capability matrix

### 5.1 Streaming 与 terminal model

`AssistantMessageEvent` 的规范序列为 `start`，若干 text/thinking/toolcall start/delta/end，最终恰好一个 `done` 或 `error`；不同 content block 的事件可能交错，消费者必须以 `contentIndex` 关联，不能假设块内事件连续。官方事件合同见 [`types.ts`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/types.ts#L523-L584) 和 [`README`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/README.md#L652-L671)。

适配要求：

- 由 EnergyIQ exact Workspace/Project/actor/Session/Run boundary、request/step/retry 与 request content fingerprint 生成 deterministic attempt id；event id 再绑定 normalized event content fingerprint。不要把 array index、Provider `responseId` 或 Tool call id 当 Run request identity。
- `thinking_delta`、`text_delta` 和 `toolcall_delta` 分开规范化；reasoning-only response 必须能合法 terminal，不能伪造空 text。
- `done(reason=toolUse)` 只证明模型提出 Tool call；只有 EnergyIQ Tool executor 通过 authorization、validator、执行并记录 result 后，才能写 `called/succeeded/failed`。
- error event 带的是部分 `AssistantMessage`，可能已有 text/thinking/usage；projection 必须显示 partial/unavailable，不能把缺失字段补成零。

### 5.2 Tool schema、call 与 result

`pi-ai` 使用 TypeBox Tool schema，支持 JSON Schema constrained sampling 的 `prefer/require`，也能流出 partial JSON；但 `toolcall_delta` 只是 best-effort partial parse，`toolcall_end` 后仍应显式调用 `validateToolCall()` 再执行。官方说明见 [`README Tool`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/README.md#L458-L650)。

EnergyIQ 的适配原则：

- 继续以现有 Zod/业务 validator 为 canonical；Pi TypeBox/JSON Schema 只是 Provider transport schema。
- valid/invalid argument、unknown Tool、strict unsupported、Kimi non-strict 和 result Evidence rejection 分别归类；不能把 schema accepted 等同 Tool executed。
- Tool result 通过 `toolCallId/toolName/content/isError` 回送模型，但 actual success 仍由 EnergyIQ audit 决定；`ToolResultMessage.usage` 也不属于主 LLM usage。
- Pi Tool calling 不构成 MCP server identity、manifest revision、连接授权或 Workspace scope。

### 5.3 Reasoning

统一层提供 `off/minimal/low/medium/high/xhigh/max`，并以 `thinkingLevelMap` 映射 Provider 特有值；具体 API 还暴露各自 options。非 reasoning model 对 reasoning option 可能静默忽略，见 [`README Reasoning`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/README.md#L786-L880) 与 [`getSupportedThinkingLevels()`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/models.ts#L900-L930)。

因此 Admin/Run 不能只显示 `reasoning requested`：probe 与未来 snapshot 必须分别记录 capability source、requested level、effective mapped level、thinking event observed，以及 Provider 是否报告 reasoning tokens。未证实时显示 `Unavailable/Not reported`。

### 5.4 Usage、cache 与 cost

`Usage` 规范化为 input/output/cacheRead/cacheWrite、可选 `cacheWrite1h`、可选 reasoning、totalTokens 与 cost breakdown；reasoning 已包含在 output 内。cost 是按 `Model.cost` catalog rate 本地计算，包含 tier 与 Anthropic 1h cache write 特例，见 [`Usage`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/types.ts#L370-L391) 与 [`calculateCost()`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/models.ts#L878-L897)。

适配要求：

- token/cache 使用量可规范化，但 Provider 不报告时保持 nullable/unavailable，不得填 `0`。
- catalog cost 是估算，不是账单；Run 必须记录 rate snapshot/source/hash，catalog refresh 后不能重算历史成本。
- cache `sessionId`/retention 属于请求行为；不能把 cache hit 推断为同一 EnergyIQ Session/Run identity。

### 5.5 Abort、timeout、retry、error 与 context overflow

请求 options 支持 `AbortSignal`、timeout、max retries 与 retry delay cap，但不同 Provider/SDK 的支持程度不同。stream request failure 不从 iterator 直接抛出，而以 `error` terminal + `AssistantMessage.stopReason=error|aborted` 返回；auth/catalog 操作另外使用 `ModelsError` code。见 [`Error Handling`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/README.md#L882-L950) 和 [`ModelsError`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/auth/resolve.ts#L20-L31)。

`isContextOverflow()` 是基于错误文案、usage 超 window、或少数 length/zero-output 信号的启发式分类；官方源码明确承认 custom provider 与 silent truncation 可能无法识别，见 [`overflow.ts`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/utils/overflow.ts#L37-L187)。`pi-ai` 本身只提供分类 helper，**不拥有 Agent compaction/retry loop**。

适配要求：

- EnergyIQ deadline 始终包住 Provider-native timeout，pre-abort/during-stream abort 都只产生一个 terminal。
- Provider 内部 retry 必须固定为可观测策略，不能与 EnergyIQ retry 叠加成不可解释次数；每次 retry 有独立 request identity。
- overflow、rate limit、auth、provider schema、transport timeout、aborted 分开映射；无法分类时保留 redacted diagnostic 并标 `provider_error`，不能猜。
- 一次失败 request 的 partial content、usage 与 upstream `responseId` 可保存为受控 trace，但不得当成功 Artifact。

### 5.6 Request identity 与可观测性缺口

`AssistantMessage.responseId` 是 optional Provider-specific response/message id；`onResponse` 只保证 HTTP status/headers；公开请求类型没有必填 stable request id。`sessionId` 文档定义为 cache/routing hint。因此 `pi-ai` **不能单独满足** #102/#103 的 deterministic request identity。

建议 adapter 输入至少包含：

```text
workspaceId + projectId + runId + stepId + retryIndex
modelProfileId + modelProfileRevision + requestFingerprint
```

adapter 在调用前生成 EnergyIQ request id；允许时把其 redacted form 注入受控 header，并把可选 upstream response id 作为相关字段。`onPayload()` 能看到完整 Provider payload，风险高于价值：默认不持久化、不日志输出；synthetic probe 可以用它断言 request shape，但生产 raw capture 必须继续受 #102 的 protected-payload/retention 合同约束。

## 6. Catalog 与 credential 的隔离风险

### 6.1 Mutable catalog 不是 Profile Store

`MutableModels` 可 `setProvider/deleteProvider/clearProviders`；dynamic `refresh()` 可读写 `ModelsStore` 并通过 generation-checked publication 更新内存 catalog，见 [`models.ts`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/models.ts#L225-L445)。而且 `refresh()` 未传 options 时的 `allowNetwork` 默认为 `true`；它不是可用在普通 GET 的“只读刷新”。这些机制改善同一 runtime 内的并发 refresh，但没有 EnergyIQ revision/publish governance。

硬边界：

- probe 使用每 case 独立的 in-memory `Models`；不把 Pi ModelsStore 接到 Governance/Metadata Store。
- production adapter 若未来采用，只从 exact EnergyIQ Profile 构造单次/受控 Provider；不自动注册 `providers/all`，不执行 network catalog refresh。
- external catalog difference 只能产生候选或告警；必须经 EnergyIQ Profile validation、capability test、revision publish 才可使用。
- `setProvider()` 同 id 会替换 runtime Provider，dynamic model 同 id 会覆盖 baseline model；因此 provider id 必须由服务端 namespace，且不能共享可变 singleton 跨 Workspace。

### 6.2 Credential ownership

`Models` 默认使用 in-memory credential/models stores，但 built-in Provider 仍可从 env/OAuth/ambient source 解析认证，显式 per-request value 优先。EnergyIQ 不采用 Pi login/logout、OAuth UI、credential file 或 ambient discovery；只使用 server-resolved secret，并保证 request/audit/Admin 中只出现 secret ref 或 redacted source。

header `transformHeaders()` 在 auth merge 后执行，意味着回调可看到 Authorization 等敏感值。生产实现若需要该 hook，必须是封闭代码路径，禁止插件/Prompt/User 配置函数，并以测试证明 secret 不进入 exception、event、snapshot 或 DTO。

## 7. 依赖与 Runtime 成本

固定 package 是 ESM，直接依赖 11 个包，包括 OpenAI、Anthropic、Google、AWS Bedrock、TypeBox、telemetry 与 proxy 组件；即使 API 实现可 lazy load，安装依赖图仍显著大于一个窄 OpenAI-compatible client。上游说明 core entrypoint 不导入 catalogs/Provider SDK，单 Provider subpath 使用 lazy wrapper，而 `providers/all` 是 heavy entrypoint，见 [`Bundling and Tree Shaking`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/README.md#L1399-L1420)。

采用门：

- probe 只导入 core、Faux 和待测 API lazy module，禁止 `providers/all`。
- 构建报告至少记录 clean install lock delta、API production bundle delta、cold import 和 first synthetic stream timing。
- Node contract 必须从模糊 `>=22`/CI `22` 收紧或自动门明确验证 `>=22.19.0`；本任务不修改 Runtime 配置。
- 若 tree shaking 后仍把全部 Provider SDK 拉入 API hot path，或迫使生产镜像承担不可接受 cold start/CVE 面，则拒绝或拆为隔离 adapter package。

## 8. 社区 `dg-piagent` 指南的吸收与纠偏

用户提供的 [`dg-piagent`](https://github.com/buchidonggua/dg-ai-notes/tree/main/skills/dg-piagent) 是高质量的**二开检索地图**，但它声明基线为 Pi Coding Agent `v0.83.0`，不是 #103 的 `pi-ai@0.84.2` 合同。以下内容经固定上游源码复核：

| 社区指南线索 | 复核结果 | #103 处理 |
| --- | --- | --- |
| pin exact version、读 CHANGELOG/types | 正确；`0.84.0` 存在 breaking changes | 采纳为版本门 |
| custom provider、Faux provider、stream/tool/error 场景 | `pi-ai@0.84.2` 官方 `createProvider()`/`fauxProvider()` 可直接验证 | 采纳为 synthetic probe 路由 |
| `ModelRuntime` / `ModelRegistry` 与默认模型选择 | 属于 Pi Coding Agent 组合层；`pi-ai@0.84.2` 直接 API 是 `Models/MutableModels` | #103 不采用，也不把它建成第二套 Model Store |
| `models.json`、本地 auth、环境/命令插值 | Coding Agent 产品能力；可引入任意文件、env 或 command 执行 | 明确拒绝进入 EnergyIQ Admin/Profile 配置 |
| overflow 后自动 compact/retry | 是 Agent loop 行为；`pi-ai` 仅暴露 overflow classifier | #103 只验证分类，不启动 #105 |
| register 同名 Provider 会覆盖 catalog | 与官方 `setProvider()` replace-by-id 语义一致 | 以 per-request isolated registry 与 server namespace 防护 |

社区指南可继续作为查找上游路径和测试清单的辅助资料，但任何 API 名、默认值与生命周期结论都必须回到固定 tag 的 README、source、CHANGELOG 与 published `.d.ts` 验证。

## 9. Adopt / adapt / reject 判定

### 9.1 `adopt` 的条件

仅当下列条件全部成立，才能把 `pi-ai` 作为 `@datafoundry/providers` 内部第二实现采用：

1. exact version/integrity/Node/lock 自动门稳定；
2. DeepSeek、Alibaba/Qwen custom endpoint、OpenAI-compatible/Kimi 三条 fixed profile fixture 全通过；
3. stream、Tool、reasoning、usage、abort/error/overflow 能无损映射为 EnergyIQ-owned DTO/Event；
4. secret/header/raw payload 不泄漏，catalog refresh 不改变 persisted Profile 或 historical snapshot；
5. 外部类型不穿透 `@datafoundry/providers`、Admin 或 Run public contract；
6. dependency/bundle/runtime 成本在 API budget 内。

这里的 adopt 仍然是“采用为 adapter 内部库”，不是让 Pi 拥有 Profile、Run、Tool、MCP 或 governance。

### 9.2 `adapt` 的条件

如果核心 stream/Provider 能力成立，但至少存在下列一种差异，则选择 adapter-only：

- 需要 EnergyIQ 自己生成 request identity、event sequence、retry/terminal state；
- 需要 Zod canonical validation、Kimi non-strict local validation 或自定义 Qwen mapping；
- 需要把 Pi usage/error/reasoning nullable 字段转换成 EnergyIQ projection；
- 需要禁用 Pi catalog/credential persistence、ambient discovery 或 raw payload hook；
- 需要固定 Profile capability 与 cost snapshot，阻止 catalog 漂移。

按目前源码证据，**预期结论就是此项**。

### 9.3 `reject` 的条件

任一条件成立即拒绝当前版本：

- exact Node/lock 无法进入现有 build/deploy baseline；
- valid/invalid Tool、reasoning-only、abort/overflow 或 Kimi/Qwen fixture 不能稳定规范化；
- secret/header/raw Prompt 进入日志、event、snapshot 或 Admin；
- adapter 必须让 Pi catalog/credential store 成为第二真相源；
- Provider-native类型必须暴露给 Admin/Run 才能工作；
- bundle/cold-start/CVE 面超过可接受预算且无法通过窄 import 隔离。

## 10. Compatibility probe 结果与生产采用剩余门

当前 `pi-ai-gateway-evaluation.ts` 只接受 EnergyIQ-owned Profile/Request/Tool DTO，内部使用 `createModels()`、`fauxProvider()`、`MutableModels` 和固定版本的 OpenAI-compatible payload builder，输出中性 event/fingerprint/audit；所有 evaluation seam 都由自动测试证明未从 `@datafoundry/providers` 的 `index.ts` 导出。

### 10.1 九项矩阵结果

| 矩阵 | 隔离证据 | 结论 |
| --- | --- | --- |
| identity | exact Workspace/Project/actor/Session/Run boundary、Profile revision、request/step/retry、validated canonical base URL、secret-free header-policy fingerprint 与 request content fingerprint 共同生成 attempt id；event id 绑定 normalized event fingerprint；跨任一 boundary/destination/policy 均不同，同 event id/不同 hash fail closed，Provider response id 只做关联 | PASS；identity 必须继续由 EnergyIQ 生成 |
| profile mapping | DeepSeek、Kimi/OpenAI-compatible、Alibaba/Qwen 均由 exact Profile 选 model/base URL；base URL 先规范化为无 credential/query/hash 的 HTTPS destination，unknown Provider/model fail closed；Faux factory 观察到实际 reasoning/maxTokens/timeout/retry；fake fetch 又观察真实 `max_tokens`、DeepSeek `thinking`、Qwen `enable_thinking` | PASS；Pi catalog 不能代替 Profile revision |
| headers/secrets | server-owned request header 与大小写无关 suppression 进入实际 Pi header merge；audit 仅有 header names；API key、Authorization 值、客户 header、Prompt 和错误明文不进入 result | PASS；`onPayload` 只在测试闭包中断言，禁止持久化/日志化 |
| stream | synthetic Provider 产生交错 thinking/text/Tool events；projection 保留 `contentIndex`、确定 event id 和恰好一个 terminal；reasoning-only 合法 | PASS |
| Tool | valid/invalid sibling 局部隔离；unknown Tool 独立分类；`require/prefer/disabled` 进入实际 Pi Context；只有 exact `kimi-k3` + read-only + eligible bundle 才复用既有 canonical non-strict/local-validator seam，真实 fake Tool call 的 valid arguments 通过、invalid arguments 在本地拒绝，mutating/ineligible 也 fail closed；成功/失败 Tool result 都在第二次请求作为 `ToolResultMessage` 回送 | PASS；模型提议始终标 `not-executed-by-gateway`，执行权仍在 EnergyIQ |
| usage/cost | missing evidence 输出 `null + unavailable`；true zero 输出 `available=0`；reasoning/cache 分列；成本只有 Profile 含固定 rate snapshot 时才标 `estimated` 并带 rate hash | PASS；估算不是账单，历史结果不按新 catalog 回算 |
| abort/error | pre-abort、mid-stream abort、EnergyIQ outer deadline、Provider timeout、auth、rate limit、Provider error、recognized overflow 分开；无法识别的 length/silent overflow 保持 `unavailable` | PASS；Pi overflow helper 仍是启发式，不拥有 compaction/retry loop |
| catalog | 对 actual `MutableModels` 执行同 id replace；对 dynamic Provider 执行 `refresh({allowNetwork:false})`；runtime catalog 可变但 compiled Profile/request identity hash 不变，network fetch count 为 0，且 probe 没有 EnergyIQ Store 参数 | PASS；不接 Pi ModelsStore/Governance/Metadata |
| dependency | 非 root-workspace evaluation package 与独立 lock 自动检查 dev-only `pi-ai@0.84.2`、tarball integrity、telemetry `0.84.2`、Node `>=22.19.0`；同时断言 root lock、Providers manifest/public index 不含候选 seam。GitHub CI 在独立目录 clean install/typecheck/test，不修改 production lock graph | PASS for evaluation；生产采用前仍要收紧根 Node/CI 下限并做镜像/CVE 审核 |

### 10.2 本地自动化与成本快照

在 Windows、Node `v24.14.0`、npm `11.9.0` 的独立 worktree 中：

- 独立 evaluation package：2 files / 53 tests；既有 Provider compatibility：2 files / 27 tests；合计 4 files / 80 tests；
- 独立 package typecheck、`@datafoundry/contracts` 与 `@datafoundry/providers` build 通过；GitHub workflow 已加入 evaluation 目录内的 `npm ci --ignore-scripts`、typecheck、focused suite 与 cold-repeat step；本节只记录本地自动化，不能把尚未运行的新 head CI 写成通过；
- evaluation source/type 只存在于 `evaluations/pi-ai-gateway`，不参与 root TypeScript build、不进入 production package index；候选 SDK 图只存在于独立 lock；
- `npm ci --ignore-scripts` 在独立目录安装 143 个 evaluation packages；这是 probe 成本，不是 production image delta，root lock 仍与 `main` 相同；
- 三次独立 Node 进程的 core cold import 为 **401–610 ms**，evaluation module + first Faux stream 为 **397–627 ms**，OpenAI-completions lazy wrapper import 为 **10.8–15.7 ms**；
- fake-fetch payload probe 曾在主 Agent 独立 worktree 的高负载首次运行触发 5 秒 test timeout；本轮给这一个 case family 设置局部 15 秒上限，并以三个新 Vitest 进程重复，三轮均为 `3/3 PASS`（单轮约 0.9–1.0 秒 wall time）。历史 timeout 仍如实保留，不能把降载后的重复通过包装为生产延迟或 SLA。

### 10.3 `adapt` 后仍不能越过的门

1. 本分支不把 adapter 导出到生产 `@datafoundry/providers`，不改变 Mastra Runtime assembly 或默认；
2. 根仓库仍只声明 Node `>=22`，CI 使用浮动 Node 22；若未来采用，必须显式保证 `>=22.19.0`；
3. 生产镜像总依赖、许可证/CVE、cold start 和真实 Provider 行为仍需独立采用 Ticket；不得用这次 synthetic/fake-fetch 结果替代；
4. 任何真实 Provider、生产流量、浏览器验收、部署、Mastra/Pi Runtime parity 都不属于本 probe；#105 仍需主 Agent 重新授权，并继续受 #102 未关闭门约束。

## 11. 主要一手来源

- [`@earendil-works/pi-ai@0.84.2` npm registry record](https://registry.npmjs.org/@earendil-works%2fpi-ai/0.84.2)
- [`@mariozechner/pi-ai@0.73.1` npm registry record](https://registry.npmjs.org/@mariozechner%2fpi-ai/0.73.1)
- [Pi `v0.84.2` release](https://github.com/earendil-works/pi/releases/tag/v0.84.2) and [tagged package source](https://github.com/earendil-works/pi/tree/v0.84.2/packages/ai)
- [`pi-ai` README](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/README.md)
- [`pi-ai` CHANGELOG](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/CHANGELOG.md)
- [`types.ts`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/types.ts), [`models.ts`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/models.ts), [`models-store.ts`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/models-store.ts), [`faux.ts`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/providers/faux.ts), [`overflow.ts`](https://github.com/earendil-works/pi/blob/v0.84.2/packages/ai/src/utils/overflow.ts)

## 12. 验收边界

- 已把 `pi-ai@0.84.2`、evaluation-only module、focused synthetic tests 与独立 lock 放入 `evaluations/pi-ai-gateway`；root `package-lock.json` 与 `packages/providers/package.json` 恢复为 `main`，CI 只在隔离目录安装/运行候选；
- 已完成第 10 节隔离矩阵并形成 `adapt` 评估结论；未把 adapter 从 package index 导出，也未把评估结论晋升为 production adoption；
- 未调用真实 Provider、MCP 或 Tool；
- 未改变 Mastra Runtime 默认；
- 未执行 browser、deployment、production traffic 或人工产品验收；
- 未触碰 Preschool Stage 3、Additional Insight Artifact identity/evaluation/mutation、变化回顾、Ngee Ann AI Slot、部署脚本或服务器。
