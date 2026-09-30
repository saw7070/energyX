---
title: "AI Tool Schema 与 Provider 兼容性独立研究"
summary: "区分 Provider 线协议、JSON Schema 方言、工具执行循环和应用适配，并给出 Overview MVP 的最小兼容方案。"
doc_type: research
tags: [AI, Tool Calling, JSON Schema, Provider, Overview]
updated_at: "2026-08-06"
related:
  - "../records/2026-08-06-Overview夜间执行清单与Runlog.md"
  - "../decisions/2026-08-05-Overview用户价值与AI-Slot最小交付决策.md"
status: reviewed
---

# AI Tool Schema 与 Provider 兼容性独立研究

## 结论

1. **JSON Schema 是一套有版本、有方言、可裁剪的规范族，不是所有厂商都完整实现的同一个校验器。** `$schema` 用来声明方言；不同 Draft 的关键字语义也会变化。官方 JSON Schema 文档明确把 Draft/方言定义为不同词汇表的组合，[2020-12 还调整了 `items`、`prefixItems` 等数组关键字](https://json-schema.org/draft/2020-12/release-notes)。
2. **“OpenAI-compatible”主要表示 HTTP 请求/响应外形兼容，不表示完整 JSON Schema、`strict` 默认值、可选字段表达、流式 Tool Call、消息续接规则或模型行为完全兼容。** Kimi 的 K3 Quickstart 确实直接使用 OpenAI SDK 和 Moonshot Base URL，但 Kimi Tool Use 同时规定 `parameters` 只能使用 MFJS 子集且省略 `strict` 时默认按 `true` 处理。[Kimi K3 Quickstart](https://platform.kimi.com/docs/guide/kimi-k3-quickstart)、[Kimi Tool Use](https://platform.kimi.com/docs/api/tool-use)。
3. **不同 Provider 需要适配，但不应把业务代码按每个模型复制一份。** 正确切口是一个很薄的 Provider Profile/Adapter：把内部统一 ToolSpec 编译成目标 Provider 支持的 Schema 方言和消息格式，再把 Tool Call/Result 归一化回内部事件。共享同一真实协议的模型可以复用 Adapter；Provider、网关或模型版本变化后重新跑兼容预检即可。
4. **Kimi 与当前 DeepSeek 失败不是同一个问题。** Kimi 在 Tool Schema 声明阶段被 Moonshot flavored JSON Schema 拒绝，属于 Provider Schema 适配问题；DeepSeek 已完成 Schema 检查和一条只读 SQL，随后才被 Finding-specific numeric Evidence 守卫拒绝，属于最终分析结果与 Evidence 绑定问题。继续仅靠换模型，无法修复这两个不同层次的失败。
5. **这件事应当先做一个小而明确的兼容闭环，但不应建设通用 Tool 平台。** 在把 DeepSeek、StepFun、Kimi 配成自动 fallback 之前，先让三者针对 Overview/Preschool 实际启用的同一小组工具通过预检。它不会取代继续交付可见 Overview，只是防止 fallback 把协议错误伪装成模型质量问题。

## 为什么“都是 JSON Schema”仍会不兼容

JSON Schema 只解决“如何描述 JSON 实例”，而一次 AI Tool Call 至少包含四层合同：

| 层 | 解决的问题 | 当前差异示例 | 应由谁适配 |
|---|---|---|---|
| 1. Provider 线协议 | 请求和响应如何在网络上传输 | OpenAI 的 `tools[].function.parameters` 与 `tool_call_id`；Anthropic 的 `input_schema`、`tool_use`/`tool_result` content block | Provider Adapter |
| 2. Tool Schema 方言/子集 | 哪些 JSON Schema 关键字及组合可用 | OpenAI Strict 子集、DeepSeek Strict 子集、Kimi MFJS、Anthropic Strict 子集 | Schema Serializer/Normalizer |
| 3. Tool 执行协议 | Tool Call 如何解析、执行、回传和续接 | OpenAI 返回字符串化 `arguments`；Anthropic 返回 `input` 对象并要求下一条 user message 紧接对应 `tool_result` | Agent Runtime |
| 4. 应用合同 | 谁能查什么、结果怎样验真、Evidence 如何绑定 | EnergyIQ 的只读 SQL、Snapshot、Finding-specific numeric Evidence | EnergyIQ 应用层；不随 Provider 改写 |

因此，“Schema 在标准校验器里合法”只证明第 2 层在某个方言下成立，不能证明四层全部兼容。尤其当 Schema 没有声明 `$schema` 时，解释方式可能依实现而异；JSON Schema Core 把方言定义为一组词汇表，[官方 glossary 也说明 `$schema` 标识所用方言和关键字语义](https://json-schema.org/learn/glossary#dialect)。

## 各协议实际统一了什么

### OpenAI Function Calling

OpenAI 使用 JSON Schema 定义 function 参数，并通过 `call_id` 关联 Tool Call 与 Tool Output。[官方 Function Calling 指南](https://developers.openai.com/api/docs/guides/function-calling)同时说明 Strict Mode 只支持 JSON Schema 的一个子集；严格对象通常要求所有字段列入 `required`、设置 `additionalProperties: false`，可选值以与 `null` 的联合表达。也就是说，OpenAI 自身也不是“任意 JSON Schema 都能严格生成”。

### Anthropic Tool Use

Anthropic 的工具定义字段是 `input_schema`，模型返回 `tool_use` block（含 `id`、`name` 和 JSON `input`），应用随后在 user message 中回传对应 `tool_result` block。[工具定义](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)、[Tool Call 处理规则](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)。Anthropic 明确指出，这种 content-block 消息协议不同于带专门 `tool`/`function` role 的 API；它的 Strict Tool Use 也只支持标准 JSON Schema 的受限子集，[并采用 grammar-constrained sampling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use)。

### DeepSeek

DeepSeek 的普通 Tool Call 外形接近 OpenAI；但其 Strict Mode 是 Beta 功能，需要 `/beta`，服务端会拒绝不受支持的 Schema 类型，并只列出有限的受支持类型/关键字。[DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)。DeepSeek 曾把 Function Calling 描述为兼容 OpenAI API，[这仍不等于 Strict Schema 语义完全相同](https://api-docs.deepseek.com/news/news0725/)。

### Kimi / Moonshot

Kimi 的 Tool Call 外形也接近 OpenAI，但 `parameters` 使用 Moonshot Flavored JSON Schema（MFJS）。MFJS 官方规范明确说明它是为 LLM 交互裁剪的 JSON Schema 子集：限制 `$defs`/`$ref`，不支持外部资源、`format`、`prefixItems`、`unevaluatedItems` 及多种复杂校验；若与通用 JSON Schema 冲突，以 MFJS 为准，未列出的关键字没有稳定性保证。[MFJS 官方规范](https://github.com/MoonshotAI/walle/blob/main/docs/mfjs-spec.zh.md)。

更关键的是，Moonshot 官方的 [Kimi Vendor Verifier](https://github.com/MoonshotAI/Kimi-Vendor-Verifier)专门提供 `tests/tool_call_json_schema/`：把 walle-valid MFJS Schema 原样作为 `tools[].function.parameters`，强制 Tool Call，并分别在 stream/non-stream 下本地校验返回的 `function.arguments`。官方还解释这类原始 API 预检不能完全交给上层评测框架，因为框架可能在请求到达 Provider 前就归一化或拒绝 Payload。这直接证明：即使 Endpoint 使用 OpenAI 外形，Schema 兼容仍必须单独验证。

### StepFun

StepFun 官方示例采用 OpenAI SDK 和 `tools[].function.parameters`，要求根节点为 `object`，随后以 `role: "tool"` 和 `tool_call_id` 回传结果。[StepFun Tool Call](https://platform.stepfun.com/docs/zh/api-reference/tool-call)。但该页只描述基础结构，没有承诺完整支持某个 JSON Schema Draft 或与 OpenAI Strict 子集逐项等价，所以不能据此跳过真实工具集预检。

### MCP 与 AI SDK

- **MCP** 统一的是 Host/Client 与 Tool Server 之间的工具发现和调用：`tools/list`、`tools/call`、`inputSchema`、Tool Result。[MCP Tools 规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。它没有统一 Host 与 OpenAI/Anthropic/Kimi 等模型 Provider 之间的 sampling/tool-call 线协议；Host 仍需把 MCP Tool 翻译成目标 Provider 的 Schema 与消息格式。
- **Vercel AI SDK** 统一的是应用侧编程接口。其官方 Tool Calling 文档明确说明 Strict Mode 的 Schema 支持取决于具体 Provider；[OpenAI-compatible Provider](https://ai-sdk.dev/providers/openai-compatible-providers)也暴露 `transformRequestBody`、Provider Options 和自定义 Provider 等扩展点。它减少了上层重复代码，但不会自动让每个兼容 Endpoint 接受同一份 Schema。

所以目前不存在一个能同时消除 Provider 线协议、Schema 方言和模型行为差异的单一协议。MCP、AI SDK、OpenAI Tools 和 Anthropic Tool Use 各自统一了不同边界，不能互相替代。

## 当前 Mastra / AI SDK 转换链

本仓库当前链路不是“把手写 JSON Schema 原样发送给所有模型”，而是：

`Mastra createTool + Zod inputSchema → AI SDK asSchema → Zod 4 toJSONSchema(target: draft-7) → OpenAI-compatible parameters → Moonshot MFJS 校验`

可核对的本地事实是：能源工具通过 Mastra `createTool` 注册 Zod `inputSchema`；当前依赖为 `@mastra/core 1.46.x`、AI SDK `6.0.x`、Zod `4.4.x`。已安装的 AI SDK 在准备工具时通过 `asSchema` 获取 JSON Schema，其 Zod 4 转换路径显式使用 `target: 'draft-7'`；Kimi Profile 则通过通用 `createOpenAICompatible` 发送请求，没有 MFJS 归一化步骤。

这条链路解释了为什么“代码里的 Zod 类型正确”仍可能在 Kimi 入口失败：Draft-7 形状只是内部通用序列化结果，Moonshot 最终按 MFJS 处理。Mastra 负责工具声明/执行生命周期，AI SDK 提供统一模型接口，但二者都不能从一个 OpenAI-shaped Base URL 自动推断对方采用 MFJS。最小改动点因此应放在 `createOpenAICompatible` 之前或它提供的 request transform/provider adapter seam，而不是改 EnergyIQ 的 SQL Tool executor 或 Finding Evidence 逻辑。

## 本项目两类失败的独立诊断

### A. Kimi K3：Schema 声明阶段失败

当前 Integration 使用通用 `createOpenAICompatible` 接入 Moonshot，而没有 Kimi/MFJS Schema 归一化层：[`packages/providers/src/index.ts`](https://github.com/Zion74/energyiq-datafoundry/blob/main/packages/providers/src/index.ts)。实际 Run 依次在 `table_names`、`claims[].values` 和通用 `skillNames` 等 optional array 字段被 Moonshot flavored JSON Schema 拒绝；服务端错误指向 optional array 转换后的 parent `items` 与 `anyOf` branch `items` 冲突：[`2026-08-06-Overview夜间执行清单与Runlog.md`](../records/2026-08-06-Overview夜间执行清单与Runlog.md)。其中 `table_names` 的内部定义确实为 `z.array(z.string()).optional()`：[`packages/agent-runtime/src/tools/data-tools.ts`](https://github.com/Zion74/energyiq-datafoundry/blob/main/packages/agent-runtime/src/tools/data-tools.ts)。

独立判断：

- 这不是 Kimi K3 “不会调用工具”，而是 API 在模型有机会选择/调用工具前拒绝了工具声明。
- 这份 Schema 可能在常规 JSON Schema Draft 下合法，但不满足 Moonshot 当前 MFJS 校验/转换路径；“通用 JSON Schema 合法”与“MFJS 接受”是两个命题。
- 当前继续逐字段把 optional array 手工改掉，会把 Provider 差异污染共享工具合同，而且错误已经从能源工具扩散到通用协议工具，应该停止这种修补方式。
- `strict: false` 可以作为受控实验，不应作为默认修复：Kimi 文档说明此时只保证参数是合法 JSON object，不保证内部字段符合 Schema。即使采用，也必须继续用内部 Zod Schema 校验 Tool Call 参数，校验失败不得执行工具。

### B. DeepSeek：工具执行成功后被 Evidence 守卫拒绝

当前 Preschool 解析器先确认 Run 完成、Schema 检查有效且恰好有一条成功只读 SQL；之后才解析 Findings，并把每个 Finding 文本里的数值与该 Finding 实际引用的 deterministic bundle values 和 SQL rows 数值逐项比对：[`apps/web/src/app/energyiq/_components/preschool-ai-run.ts`](https://github.com/Zion74/energyiq-datafoundry/blob/main/apps/web/src/app/energyiq/_components/preschool-ai-run.ts)。

因此已观测到的 “Schema + 1 条只读 SQL 完成，但 Finding-specific numeric Evidence 被拒绝”说明：

- Provider 线协议、Tool Call 参数解析、Schema inspection 和 SQL 执行已经走通；
- 失败发生在最终自然语言/JSON Finding 的应用验真阶段；
- 它可能是模型写入了 Evidence 中没有直接出现的派生百分比、数量、排序、阈值或其他数字，也可能是引用了不含该数值的 Evidence。由于当前失败原因没有记录具体被拒绝的 token 和来源，这些只能算假设，不能把 0/3 直接归因于模型质量或协议设计。

最小修复不是放松 Evidence 守卫，而是先让诊断记录：Finding id、被拒绝的 numeric token、引用的 Evidence ids/SQL indexes，以及可用数字白名单。确认实际模式后，再决定是收紧输出合同、把派生计算交给 SQL，还是只允许一次针对该 Finding 的结构化修复。

## Overview MVP 的最小兼容方案

目标不是做“任意模型、任意工具、任意 Schema”的平台，而是让当前 Overview/Preschool AI Slot 能稳定使用三种已选 Provider。

### 1. 冻结当前实际工具面

每个 Run 只向模型暴露授权且实际需要的工具。Preschool 首版优先保持 `inspect_schema` 与 `run_sql_readonly`；确实由当前流程需要的提交工具才加入。不要因为 Runtime 有通用 skills/governance 工具，就把它们全部发给 Overview 模型。

### 2. 建立一个内部 Canonical ToolSpec

- Tool 名称、说明和输入合同只维护一份（现有 Zod Schema 可继续作为执行前的最终权威校验）。
- 保存当前小工具集的 canonical fixture，以及每个 Provider Adapter 实际发出的 JSON Payload fixture。
- Tool Call 参数在执行前一律用 canonical Schema 解析；解析失败则 fail closed，不执行 SQL 或其他工具。

### 3. 只实现三个薄 Profile/Adapter

| Profile | 线协议 | Schema 处理 |
|---|---|---|
| DeepSeek V4 Flash | 现有 DeepSeek Provider | 明确记录是否启用 Strict 及其受支持子集；不沿用 Kimi 规则 |
| StepFun 3.7 Flash | OpenAI-shaped Chat Completion | 针对当前 fixture 实测支持面；未被官方承诺的关键字不推定支持 |
| Kimi K3 | OpenAI-shaped Chat Completion | 在请求边界把 canonical Schema 转换/校验为 MFJS；显式决定 Strict 策略和 K3 参数 |

这里的 “Profile” 是 **Provider + Model + Schema 方言/能力版本** 的兼容配置，不是给 Preschool 用户额外开一个账号，也不是把租户权限交给模型。Project/Scope 授权、只读 SQL 和 Evidence 仍由服务器应用层控制。

### 4. 先过小型预检，再进入真实分析

每个 Profile 针对同一实际 Tool Bundle 验证：

1. Schema 请求被 Provider 接受；
2. 强制执行一次无副作用的 `inspect_schema`（stream/non-stream 至少覆盖实际生产所用模式）；
3. Tool Call arguments 可解析并通过 canonical Zod 校验；
4. Tool Result 能按该 Provider 要求回传并续接；
5. 再用固定 Snapshot/Pack 跑三次真实 Analysis acceptance。

预检通过只代表协议可用；最终 Finding 的 Evidence 守卫仍需单独通过，不能把二者合成一个“模型好不好”的结论。

### 5. Fallback 的边界

- 一次 Run 开始时选定 Provider/Profile revision 并记录，不在已执行 Tool 后中途切 Provider。
- 只有已经通过同一 Tool Bundle 预检的 Profile 才能进入 fallback 链。
- 认证、限流、连接超时等“工具执行前的可分类瞬时失败”可以新建一次 Run fallback；Schema 不兼容或 Evidence 守卫失败不应自动换 Provider 重跑，因为前者是配置错误，后者是语义合同问题。
- 当前工具为只读，风险较低；该边界仍应保留，避免未来加入副作用工具后重复执行。

## 验收标准与停止项

### 这次兼容切片完成的标准

- Kimi 的实际 Overview/Preschool Tool Bundle 在 MFJS 预检中通过，不再依赖逐字段临时修改共享 Schema；
- DeepSeek、StepFun、Kimi 三个 Profile 都有明确的 outbound schema fixture 与最小 Tool Call loop 结果；
- 运行日志能把 `provider_schema_rejected`、`tool_arguments_invalid`、`tool_execution_failed`、`result_evidence_rejected` 分开；
- DeepSeek numeric guard 能指出具体被拒绝数字和引用 Evidence，但守卫本身不被放宽；
- 真实 Run 记录 Provider/Profile revision、Snapshot/Pack revision，便于复现。

### 明确不做

- 不建设通用 Schema 编译器、Tool Marketplace、协议 DSL 或新的 Agent 平台；
- 不为每个模型复制一套 EnergyIQ 业务工具或 Evidence 逻辑；
- 不为了兼容 Kimi 改弱共享 canonical Schema；
- 不把 MCP 当作 Provider Tool Calling 的直接替代；
- 不让未通过当前 Tool Bundle 预检的模型进入自动 fallback；
- 不用换模型掩盖 Schema 请求错误，也不用放松 Evidence 守卫掩盖最终结果错误。

## 推荐执行顺序

1. 增加失败分类与 DeepSeek numeric Evidence 的精确诊断；先确认 0/3 的真实拒绝数字。
2. 固定 Overview/Preschool 当前最小 Tool Bundle 和 canonical/outbound schema fixtures。
3. 在 Provider seam 增加 Kimi MFJS 预检与最薄转换，不改业务 Tool 执行逻辑。
4. 让 DeepSeek V4 Flash、StepFun 3.7、Kimi K3 依次通过相同的小型 Tool Call loop。
5. 再按选定默认模型和 fallback 顺序跑固定 Snapshot 的真实 3-run acceptance。
6. 兼容切片完成后回到客户可见 Overview/Preschool 迭代；只有真实页面所需的新工具再次触发同一预检，不扩大平台。
