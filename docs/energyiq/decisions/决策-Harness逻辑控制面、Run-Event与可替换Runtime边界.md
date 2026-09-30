---
title: "Harness 逻辑控制面、Run Event 与可替换 Runtime 边界"
summary: "EnergyIQ 以既有 Store 的逻辑控制面保有运行真相，Mastra 继续作为生产 Runtime，Pi/其他 Harness 只能通过待验证的 Model Gateway 或 Runtime Adapter seam 参与隔离评估。"
doc_type: decision
tags: [Harness, Run Event, Runtime, Trace, Governance]
updated_at: "2026-08-24"
related:
  - "../CONTEXT.md"
  - "../plans/开发计划-Admin与模板运行闭环.md"
  - "说明-DataFoundry-Agent-Harness与EnergyIQ复用边界.md"
  - "../handoff/agent/2026-08-23-Admin-Harness-Truth与Skill演进复核交接.md"
  - "../research/2026-08-24-Pi三层与DeepSeek-Harness选择性吸收评估.md"
status: accepted
---

# Harness 逻辑控制面、Run Event 与可替换 Runtime 边界

## 1. 背景

PR #99 已让 Admin 能诚实展示 current Harness 与 historical Run evidence，但它也暴露了下一层问题：当前运行证据能证明 Skill selected/materialized，却没有统一的 actual load/read 与完整 request reconstruction；Mastra 类型仍进入 API assembly；外部 Pi 和 DeepSeek Harness 同时提供值得吸收的 Model、Agent loop、Session 和 Tool pipeline 机制。

如果直接把 EnergyIQ 替换成一个热门 Harness，会同时冲击 tenant identity、Project/Stage 装配、Context、Tool policy、Evidence、Artifact、Method Governance、Trace、AG-UI、恢复和发布。反过来，如果完全拒绝外部机制，又会把 Provider、Agent loop 和事件基础设施永久绑死在当前实现。

## 2. 选项

| 选项 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. 整体迁移到 Pi 或 DeepSeek Harness | 用外部 Session、Agent、Tools、Skills 和配置替代现有 Harness | 表面统一，快速获得外部功能 | 丢失 EnergyIQ 治理语义；迁移范围巨大；形成新的产品真相源 |
| B. 永久绑定 Mastra/AI SDK | 继续让 Runtime 类型渗透 Provider、API、Trace 和 UI | 短期改动最少 | Provider/Runtime 无法独立验证或替换；Trace 合同随框架漂移 |
| C. 既有 Store 的逻辑控制面 + 小而深的 Adapter | EnergyIQ 固定业务合同，Model Gateway 与 Agent Runtime 分层；以第二个真实实现验证 seam | 保留治理真相，同时允许窄范围吸收和对比 | 需要先定义事件合同并承担有限 Adapter 成本 |
| D. 同时维护多个生产 Harness | 按项目或 Stage 动态选择 Mastra/Pi/DSH | 灵活 | 双重故障面、Trace 语义分裂、运维与验收成本不可接受 |

## 3. 决定

**选择 C：EnergyIQ governed Harness 逻辑控制面 + 小而深的 Model Gateway / Runtime Adapter。** 本文已于 2026-08-24 由主 Agent 正式接受，现为当前有效决策。

这里的“逻辑控制面”不是新增 `HarnessKernel` 模块、第二套 Kernel 或第二套 Store。它是对现有 Config Resource、Method Governance、Context/Protocol state、Session/Run/Event 与 immutable Artifact provenance 的服务端 exact 解析和组合。领域身份继续使用 canonical [EnergyIQ glossary](../CONTEXT.md) 中的 Workspace、Project、Analysis Run、Template Revision、Report Artifact、Finding Feedback 与 Insight Method Proposal，不另造同义实体。

默认规则：

1. EnergyIQ governed Harness 逻辑控制面组合 tenant/Project identity、Purpose/Stage、Prompt/Skill/Method revision、Context、Protocol/Validator、Tool/MCP policy、Evidence/Artifact lineage、Run Event、Eval 和 Proposal/Publish governance；每类真相仍由其既有 Store/contract 拥有。
2. Mastra 继续作为唯一生产 Agent Runtime；在 #105 完成前不建设生产 Pi 路由或双 Runtime。
3. `@datafoundry/providers` 当前仍是 Mastra/AI SDK shaped 的 Provider module，尚不是已被第二实现证明的公共 Model Gateway。#103 的任务是用 pinned `pi-ai` 建立第二个隔离实现，验证目标 seam 是否能表达真实差异；验证前不能宣称该边界已经成立，外部 catalog/provider 类型也不得成为 Admin 或 Run 公共合同。
4. Runtime 只消费已经服务端解析并冻结的 `GovernedRunRequest`，执行模型/Tool loop，发出规范 Run events，并返回 terminal state；它无权选择 tenant、扩大 Tool 权限或发布 Artifact。
5. append-only Run Event 是 historical execution truth；Admin AI Operations、Trace、实时 AG-UI/SSE、恢复和 Eval 均为其消费者或投影。
6. 任何送入 EnergyIQ Provider adapter 的模型可见应用级内容，都必须由 durable event 证明其 identity/hash；只有受保护 payload store 的 at-rest protection、exact permission 与 retention/deletion policy 通过审核时，才承诺由 immutable payload reference 重建正文。否则正文 capture 默认关闭并诚实显示 unavailable。Provider 内部变换与隐藏思维链不在该承诺内。
7. Prompt、Skill、Method、Protocol 和 Validator/Output Contract 保持不同资源类型，也不建立第二套 Skill、Method、Trace 或 Harness Store。

## 4. 理由

- EnergyIQ 的竞争价值来自 exact Snapshot、Evidence、Artifact、Project Renderer、Method Governance 与受控发布，不来自某个通用 Agent loop。
- PR #99 已证明 current configuration 与 actual execution 必须分开；可替换 Runtime 必须先服从同一事件语言。
- `pi-ai`、Pi Agent Core 与 Pi Coding Agent位于不同层，选择性吸收比整体迁移更可验证。
- DeepSeek Harness 的 append-only Session、model-visible reconstruction 和 Tool pre/execute/post pipeline 可作为机制参考，无需让 developer-preview 框架成为生产依赖。
- 只有两个真实 Adapter 才能证明 seam 深度；不为单一 Mastra 实现提前制造空泛接口。

## 5. 固定边界

```text
Admin Draft / Published Revisions
                 │
                 ▼
EnergyIQ governed Harness logical control plane
  exact resolution over existing Stores/contracts
  identity + stage + context + protocol/validator + policy + evidence + governance
                 │ GovernedRunRequest
                 ▼
HarnessRuntime Adapter ───────► Model Gateway Adapter
  Mastra production             AI SDK current / pi-ai candidate
  Pi challenger                 exact model profile snapshot
                 │
                 ▼
Append-only Run Event + immutable payload refs
  ├─ Admin AI Operations / Trace
  ├─ live AG-UI/SSE projection
  ├─ resume/replay
  └─ Harness Eval
```

### 5.1 `GovernedRunRequest` 必须由逻辑控制面解析

- exact Workspace/Project/actor/Session/Run；
- Project Release、Snapshot、Report Time 与 Stage identity；
- Model Profile snapshot 和 Context limit source；
- Prompt/Skill/Method/Tool/MCP revision set；
- immutable Context/Evidence references；
- output contract、timeout、token/tool limits；
- Artifact target 与 Proposal-only capability。

### 5.2 Runtime 不得拥有

- Membership/tenant 解析；
- current revision 选择或隐式 catalog refresh；
- 任意 filesystem/shell/SQL 权限；
- Method approval、Skill publish 或 Artifact publish；
- 用 current config 回填 historical Run；
- 自己的第二套客户可见 Trace/Session truth。

### 5.3 Protocol / Validator 是独立硬合同

- Protocol 以 id/version 定义 initial phase、每个 phase 的 allowed actions、action guards 与 transitions；Action 状态为 requested/rejected/succeeded/failed，Run 状态为 active/waiting/terminal/handed-off；
- terminal decision 至少区分 completed/degraded/partial/continue/failed，并由规范事件保存，不能由 UI 或模型自由文本猜测；
- Validator/Output Contract 负责 schema、单位、时间、比较方向、Evidence binding、权限和 publication fail-closed；
- Skill/Method 可以给模型 SOP 或分析角度，但不能取代 Protocol 的 action/terminal 状态机或 Validator 的确定性拒绝。

## 6. 后果

- #102 是 #66 的前置；#105 同时 blocked by #102 与 #103，必须在 canonical events 被接受且 Model Gateway 目标 seam 被第二实现验证后才做 Runtime 对比。
- #103 可以独立验证 Model Gateway，不要求引入 Pi Agent Core。
- #104 可与 #102/#103 并行盘点 Prompt/Skill/Method/Protocol/Validator，再创建第一条 Skill 实现票；Skill 迁移必须保留 deterministic Protocol/Validator。
- Pi Coding Agent 只可能成为隔离 Template/Renderer Build/Review Worker，必须有外部 Sandbox、脱敏 fixture、无生产凭证和无 `publish()`。
- 历史缺事件是诚实的 `Unavailable`，不会通过迁移脚本猜测补齐。
- 事件存储会增加容量、隐私与保留期成本；应使用不可变 payload ref、hash、redacted projection 和明确 retention，而不是在 Admin DTO 复制完整 Prompt/Context。

### 失效条件

出现以下事实时复审：

1. #105 证明 Pi 或另一 Runtime 在全部硬门上通过，并在恢复、质量或维护成本上有显著净收益；
2. 当前 Provider/Runtime API 无法在不泄漏框架类型的情况下表达真实第二实现；
3. 合规要求禁止持久化某类模型可见输入，即使使用加密 payload ref；
4. 产品决定不再提供 historical Trace/replay，只保留最小 Artifact provenance；
5. 真实多租户并发或攻击面要求独立 Worker/credential broker 成为运行前置。

## 7. 关联

- Program Map：[GitHub #62](https://github.com/Zion74/energyiq-datafoundry/issues/62)
- Run Event v1：[GitHub #102](https://github.com/Zion74/energyiq-datafoundry/issues/102)
- Pi AI evaluation：[GitHub #103](https://github.com/Zion74/energyiq-datafoundry/issues/103)
- Prompt/Skill inventory：[GitHub #104](https://github.com/Zion74/energyiq-datafoundry/issues/104)
- Runtime parity：[GitHub #105](https://github.com/Zion74/energyiq-datafoundry/issues/105)
- Editable policy：[GitHub #66](https://github.com/Zion74/energyiq-datafoundry/issues/66)
