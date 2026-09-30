---
title: "受保护模型请求 Payload、保留与重建权限边界"
summary: "目标设计（尚未实现）：在既有 Metadata Store 内为 Provider 边界请求增加默认关闭、密文保存、exact 重建、限期保留和审计访问，不开放普通 Admin raw Prompt 查看。"
doc_type: decision
tags: [Run Event, Model Request, Encryption, Retention, AI Operations]
updated_at: "2026-08-26"
related:
  - "决策-Harness逻辑控制面、Run-Event与可替换Runtime边界.md"
  - "../plans/开发计划-Admin与模板运行闭环.md"
  - "../handoff/agent/2026-08-24-Harness-Evolution主Agent审核与协作交接.md"
status: proposed
---

# 受保护模型请求 Payload、保留与重建权限边界

> 状态：**proposed / target / not implemented。** 本文内容已被独立审核接受为 proposed design，但不会因此晋升为已实现产品合同或生产证据；在 #122/#123 分阶段获得新的显式授权并交付前，生产 writer 继续保持 PR #110 的 hash-only 行为，#102 继续打开。

## 1. 背景

[PR #110](https://github.com/Zion74/energyiq-datafoundry/pull/110) 已把 typed `Run Event v1`、确定性的 `model.request.prepared` identity、hash-only `model_request_snapshots`、exact actor + Run Operations 读取和 bounded Runs list 合入主线。它故意没有保存可重建的模型请求，因此 [#102](https://github.com/Zion74/energyiq-datafoundry/issues/102) 的“Provider 边界模型可见输入可重建”仍未完成。

当前生产 `ModelRequestSnapshotRepository.create()` 会对规范化请求计算 SHA256，但在 `payload_json` 中只保存 `{ "retention": "hash-only" }`。测试通过直接 SQL 构造的 `retained` 行只证明 read projection 的兼容分支，不证明生产 writer 已经安全保留 Payload。

问题不能靠“Admin DTO 不返回 raw Prompt”解决：若 plaintext 已写入 Metadata SQLite，数据库、WAL、备份和文件访问面仍然持有客户 Context、Prompt、Tool schema 和 Provider options。另一方面，永远只保留 hash 又无法进行 exact replay、请求重建和未来 Runtime parity。

## 2. 真实选项

| 选项 | 做法 | 优点 | 主要问题 |
| --- | --- | --- | --- |
| A. 永久 hash-only | 只保留 identity、hash 和摘要 | 风险最低，已在主线运行 | 无法完成 #102 request reconstruction；Replay/Eval 只能验证 identity，不能验证内容 |
| B. SQLite 明文保留 | 直接把 canonical JSON 写回 `payload_json` | 实现最小 | 客户内容落盘无 at-rest protection；字段名过滤不能识别字符串内敏感内容；拒绝 |
| C. 同一 Metadata Store 内 protected-retained | 默认 hash-only；显式 server policy 下保存认证加密 envelope，限期保留，exact 服务端重建 | 满足可重建与单一 Store；可局部 unavailable；不改变普通 GET | 需要密钥、权限、保留/删除、审计和运维合同 |
| D. 外部 KMS + 独立 Payload service | 每条 Payload 由外部密钥/对象服务管理 | Key rotation、隔离和 crypto-shred 能力最强 | 当前部署和运维复杂度过高；会形成新的基础设施与故障面 |

## 3. 提议决定

**选择 C，但保持默认关闭。** 在既有 `MetadataStore.modelRequestSnapshots` 深模块内增加可选的 protected envelope，不建立第二套 Session、Trace、Artifact、Config 或客户数据真相源。

### 3.1 两种 capture mode

```text
hash-only             # 默认；任何缺 key / 缺 policy / 校验失败均回到这一状态
protected-retained    # 只有显式 server-owned retention policy 才允许
```

- 普通 Project Admin 不能通过浏览器参数打开 `protected-retained`；
- 未配置保护密钥时必须 fail closed 为 hash-only，绝不能为了“可重建”回退到明文；
- capture mode、policy id/revision、createdAt 和 expiresAt 在写入时固定；普通 GET 不延长保留期；
- 历史 SQL fixture 或旧中间版本留下的 `retained` 行，没有合法 envelope 时仍为 `Unavailable`。

### 3.2 protected envelope

建议实现为 Metadata Store 内部的 `ProtectedModelRequestPayloadCodec`：

- canonical JSON 在内存中计算 `content_sha256` 后立即做 AES-256-GCM 认证加密；
- 每条记录使用随机 96-bit IV；
- 使用独立的 `model-request payload key ring`，包含一个 `active-write` key 和零到多个 `retired-read` key；不得复用 credential row、credential encryption key 或 `encrypted_secrets` 的生命周期。key material 只从受保护的 server secret/KMS 注入，绝不写入 SQLite；SQLite 只存不敏感的 `keyId`；
- writer 只使用 `active-write` key；reconstruct 可按 envelope `keyId` 使用仍在有效期内的 `retired-read` key。旧 key 的读取窗口必须覆盖其最后一个 envelope 的 hard retention ceiling，并覆盖仍可能包含该 envelope 的 WAL/backup retention ceiling；在这些副本超过上限或被证明不可恢复前，不得把 key 删除宣称为 payload deletion completed；
- AAD 使用 canonical protected manifest，至少固定 `Workspace + Project + actor + Session + Run + step + retry + snapshot id + payload schema + content hash + key id + captureMode + policy id/revision + createdAt + expiresAt`；这些字段中任何一个被修改都必须使该条 Payload unavailable，不能让攻击者延长保留期、替换 policy 或把 hash-only 冒充 protected-retained；
- SQLite 只保存 algorithm/key id、IV、auth tag、ciphertext、policy identity、expiresAt 和状态，不保存 plaintext；
- captured schema 只允许应用级 Provider 边界的 Prompt messages、active Tool schema/name、model settings 和 allowlisted Provider options。Credential header、secret ref、内部路径和 Provider 隐藏推理不进入 capture。
- 删除后保留 append-only tombstone；同一 snapshot identity 一旦进入 deleted，后续重新插入 envelope 或恢复旧 ciphertext 都必须 fail closed，不能形成 resurrection。tombstone identity 与 ciphertext 清除必须在同一事务中提交。

当前 `EncryptedSecretStore` 证明 Metadata Store 已有 server master-key 注入和 AES-GCM 能力，但它是 user-owned、可覆盖的 credential store，没有模型请求的 immutable identity、retention 或 access audit 语义。可以抽取共享 crypto primitive；不能把模型请求伪装成 credential row。

#### Canonical payload schema v1 与硬上限

首版只接受 `energyiq.model-request-payload/v1`，并在加密前对以下限制 fail closed：

| 维度 | v1 上限 |
| --- | --- |
| canonical UTF-8 JSON 总量 | 512 KiB |
| messages | 最多 128 条；单条 canonical JSON 最多 64 KiB；合计最多 384 KiB |
| active tools / tool schemas | 最多 64 个；每个 canonical schema 最多 32 KiB；全部 Tool 定义合计最多 128 KiB |
| model/options | options 最多 32 个 allowlisted key；canonical options 合计最多 32 KiB |

上限按 UTF-8 bytes 而不是 JavaScript 字符数计算。任何 count、字段类型或 byte limit 超限，都不截断、不保存“部分 exact payload”，而是保留完整请求的 canonical identity/hash，把 capture 诚实降为 `hash-only`，记录 secret-free `payload-over-limit` reason，并投影 `reconstruction=unavailable`。未来增加多模态 part、Provider option 或上限时必须发布新的 payload schema revision，历史 v1 不随 current schema 重解释。

### 3.3 重建与 Admin 权限

内部深接口建议为：

```ts
reconstructExactModelRequest({
  requesterPrincipalId, // server-authenticated caller, not the target actor
  requesterKind,        // internal-service | maintenance-job
  internalCapabilityId, // exact server-owned capability grant
  accessAttemptId,      // server-issued opaque command identity
  purpose,
  target: {
    workspaceId,
    projectId,
    actorId,            // actor that owns the historical Run
    sessionId,
    runId,
    snapshotId,
  },
})
```

`requester*` 描述“谁在请求重建”，`target.actorId` 描述“历史 Run 属于谁”，两者不得复用或互相推导。该 command 只能由服务端在认证完成后签发；浏览器传入的 requester、capability、Workspace、actor 或 payload ref 均不权威。服务端验证 requester capability 后，再验证 Session 的 exact Workspace/Project、Run 的 exact target actor/Session、Snapshot 的 exact Run/step/retry/Context Package、AAD 和 hash。当前 Project Admin 永远不能调用 raw reconstruct；其 admin Membership 只授权 redacted manifest/status 和另行治理的客户可见 transcript。

普通 `GET Harness Configuration / AI Operations`：

- 仍然 `private, no-store`；
- 不 decrypt、不写访问 audit、不调用 Provider/MCP/Tool、不 ensure/materialize、不 queue；
- 只返回 hash、schema、retention 状态、expiresAt 和人类可读 `Available / Hash only / Expired / Deleted / Corrupt / Key unavailable / Unavailable`；
- 不返回 raw Prompt、动态客户 Context、Tool arguments/results、secret 或内部路径。

由于当前 `admin` 不等于 platform operator，本文**不提议给现有 Project Admin 增加 raw reveal**。对 Protected Request Payload，普通 Project Admin 只读取 redacted manifest/status；第一阶段的 plaintext consumer 仅限 server-internal reconstruct/verify，不进入浏览器响应。本路线也不建立 platform-operator raw reveal；未来若提出该需求，必须作为新的安全决策处理。

这里的 raw model request 与客户可见会话正文不是同一资源。目标能力（当前未实现）的 `View conversation` action 将允许 Project Admin 通过独立、显式且受审计的操作查看 exact Project 下的 user/assistant transcript；该 action 不属于普通 Runs GET，也不解密 Protected Request Payload，只返回客户本来可见的消息，不包含 System Prompt、动态 Context、Knowledge 原文、Tool arguments/results、Provider options、secret、内部路径或隐藏推理。会话 transcript 的 retention/redaction/audit 复用 Session 可见性合同，不由 #122/#123 偷扩实现。

### 3.4 Internal reconstruct/verify 与 Runtime replay/eval 是两项授权

- **Internal reconstruct/verify**：在服务端受控内存中解密，只做 AAD、schema、content hash 与 exact identity 校验；它不调用 Runtime、Provider、MCP 或 Tool，也不把 plaintext 返回给 Project Admin。
- **Runtime replay/eval**：把重建内容交给 Runtime 或 Provider 重新执行，是另一项数据外发与执行授权。protected payload 可以解密，只证明内容可验证，不自动授予 replay/eval 权限。
- [#105](https://github.com/Zion74/energyiq-datafoundry/issues/105) 即使未来获准，也继续只用 synthetic/de-identified fixtures；本路线不需要任何管理员查看完整模型请求。若未来要把客户 Payload 交给 Runtime/Provider，必须另行决定 purpose、数据驻留、Provider retention、日志、预算和删除边界。

### 3.5 保留、删除与审计

本文把候选产品参数固定为默认 7 天、硬上限 30 天，供后续实现授权时整体复核；这不是已部署 retention policy。任何 server policy 超过 30 天必须 fail closed，不得由 Project/Admin 配置绕过。到期后：

- 清除 active ciphertext/envelope material；
- 保留 hash-only request identity、Run Event 和 append-only tombstone；
- 不改写 Run、Artifact、Finding 或 current Harness configuration；
- 清理只能由显式维护任务执行，不能隐藏在普通 GET 中；
- 每次显式 reconstruction/decrypt 使用 server-issued `accessAttemptId`，并记录 requester principal/kind、internal capability、exact target、purpose、request fingerprint、outcome 和时间，但不记录 Payload 内容。它不是浏览器提供的权威 requester 或 target identity；
- 顺序固定为：authenticated command 与 exact target 解析 → durable audit intent 成功插入/认领 → exact authorization/identity validation → decrypt/verify → terminal outcome 以 compare-and-set 从 `pending` 写为 `succeeded/denied/failed` → 只有 outcome 已持久化为 `succeeded` 后才把 plaintext 交给 server-internal verifier。intent 或 outcome 写入失败时必须丢弃 plaintext，不得返回或交给 consumer；
- `accessAttemptId` 对同一次受控命令幂等。相同 id + 相同 request fingerprint 只能有一个 audit row 和一个 terminal outcome；相同 id + 不同 fingerprint fail closed。只有第一次成功 claim 的命令执行可以在 terminal `succeeded` 持久化后把 plaintext 交给一次 server-internal verifier；同 attempt 的任何 retry 只返回 terminal status，绝不再次解密或释放 plaintext。若调用方确需再次取得 plaintext，必须由服务端重新授权并签发新的 `accessAttemptId`；
- 该合同保证 durable audit 的唯一性和“同 attempt 不二次释放”，**不宣称跨进程 exactly-once plaintext delivery**。若进程在 `succeeded` audit 持久化后、内存交付前崩溃，该 attempt 仍只返回 terminal status；恢复交付必须新建 attempt，而不是重放旧 attempt；
- 必须诚实写明 SQLite row delete 不是对 DB pages、WAL、backup 或存储介质的 forensic erase。备份保留与 key rotation 是独立生产门。

## 4. 状态语言

`retained` 不能继续作为“可以安全重建”的充分条件。建议区分：

```text
request identity:       present | missing | malformed
capture mode:           hash-only | protected-retained
protected lifecycle:    active | expired | deleted | corrupt | key-unavailable
reconstruction:         available | unavailable
access:                 not-requested | pending | succeeded | denied | failed   # 只来自 durable audit
```

只有 `protected-retained + active + exact identity + valid AAD/tag + matching SHA/schema` 才能投影 `reconstruction=available`。一个坏 snapshot 不得吞掉同 Run 的有效 siblings。

## 5. 数据流与 Trace 影响

```text
Mastra/未来 Runtime
  -> EnergyIQ Provider-boundary canonical request
  -> hash + server retention decision
     -> hash-only identity
     -> protected envelope (optional)
  -> append model.request.prepared event with immutable ref/hash

ordinary Admin GET
  -> read event + envelope metadata only
  -> never decrypt, never write

explicit internal reconstruction
  -> server-issued requester/capability + exact target resolution
  -> durable audit intent + unique accessAttemptId
  -> exact authorization/identity validation
  -> decrypt + AAD/hash/schema verification in server memory
  -> durable terminal audit outcome (CAS)
  -> internal verifier only, or redacted status

separately authorized Runtime replay/eval
  -> synthetic/de-identified fixture only under current #105 boundary
  -> protected customer payload is not implicitly authorized
```

该设计会优化 Trace：Trace 不再复制大块 Prompt，而是记录稳定的事件 identity、内容 hash、受保护 Payload ref、capture/lifecycle/reconstruction 状态和访问 audit。Live SSE/AG-UI 仍是 derived transport；durable Run Event + protected payload identity 才是历史真相。

## 6. Ticket 拆分

### #102 安全闭环

1. [#122 AIOPS-2A](https://github.com/Zion74/energyiq-datafoundry/issues/122)：protected envelope、默认 hash-only、exact server reconstruction、corruption/local-unavailable；
2. [#123 AIOPS-2B](https://github.com/Zion74/energyiq-datafoundry/issues/123)：bounded retention、expiry/deletion、append-only access audit、Admin 状态语言。

本文仅作为 proposed design 完成了内容审核；两票仍未获得实现授权。若后续授权，顺序仍固定为 **先 #122 RED→GREEN 并独立验收，再单独裁决是否授权 #123**；#123 不能与 #122 并行写 lifecycle。[#105](https://github.com/Zion74/energyiq-datafoundry/issues/105) 仍同时等待完整 #102、完成 disposition 的 [#103](https://github.com/Zion74/energyiq-datafoundry/issues/103) 与主 Agent 再次显式授权；任何 PR/CI 状态都不能自行解锁。

### Harness Configuration 四条产品路线

这些路线复用 [#66](https://github.com/Zion74/energyiq-datafoundry/issues/66) 的单一 Draft -> Validate -> Diff/Preview -> human Publish 合同，不建立四套 Store：

1. [#124 HCFG-4 Models & Routing](https://github.com/Zion74/energyiq-datafoundry/issues/124)：Model Profile、routing、visibility、revision 和 secret-free connection test；
2. [#125 HCFG-5 Skill Library](https://github.com/Zion74/energyiq-datafoundry/issues/125)：formal Skill revisions 与 Prompt-to-Skill Proposal；actual load 继续由 [#114](https://github.com/Zion74/energyiq-datafoundry/issues/114) 负责；
3. [#126 HCFG-6 Tools & MCP](https://github.com/Zion74/energyiq-datafoundry/issues/126)：registered/declared/local availability 与 resolved/called/succeeded 历史事实分离；
4. [#127 HCFG-7 Context & Instructions](https://github.com/Zion74/energyiq-datafoundry/issues/127)：context capacity、组成来源、Prompt layers、revision/fingerprint 和 redacted manifest。

## 7. 实施硬门

即使 proposed design 内容已通过审核，进入代码前仍必须由主 Agent 重新显式授权，并确认：

1. 生产继续默认 hash-only，只有显式 server policy 才允许 protected-retained；
2. 使用独立 `model-request payload key ring`（active-write + retired-read）、key material 不进 SQLite、不复用 credential key，旧 key 覆盖 envelope/WAL/backup retention ceiling；
3. retention 默认 7 天、hard max 30 天，超过 hard max 必须 fail closed；
4. 第一阶段 protected payload consumer 仅为 server-internal reconstruct/verify；Project Admin 的独立 audited transcript action 只读取 user/assistant 客户可见消息，不读取完整模型请求；
5. 生产 SQLite/WAL/backup 的实际访问控制与保留期满足 at-rest 承诺。

任何授权后的实现都必须严格 RED -> GREEN，并把下列门写入 #122/#123：canonical payload schema/count/byte limits 与 over-limit hash-only、envelope 与 `model.request.prepared` event ref 原子提交、legacy hash-only migration、双连接 migration once-only、at-rest/no-plaintext、独立 key ring/rotation/missing-key fail-closed、exact requester capability + target tenant/actor/Run/AAD/hash、`captureMode/policyRevision/createdAt/expiresAt` 篡改拒绝、corrupt sibling isolation、GET zero-decrypt/zero-write、cleanup/reconstruct race、expiry/delete tombstone 与 ciphertext 清除同事务、resurrection 拒绝、`accessAttemptId` 幂等/CAS、exactly-one durable audit、同 attempt retry status-only/no second plaintext release、true unavailable UI 和 relevant package builds。真实 Provider、浏览器、多账户、部署、备份恢复、key rotation 和人工验收分别报告。实现顺序固定为 #122 先完成和验收，#123 后授权。

## 8. 后果与失效条件

- 好处：可以完成 #102 的 server-internal 内容重建，同时保持普通 Admin GET 安全、快速和可解释；它只为未来 parity/replay 提供可验证的历史基材，不构成 Runtime/Provider 数据外发授权。
- 成本：新增密钥与 retention 运维；Payload 数据面扩大，需要明确数据驻留、备份和事件响应。
- 若主 Agent 或合规判断任何模型可见客户内容都不得持久化，即使认证加密，本文失效，#102 应降级为永久 hash-only 并明确放弃 exact content replay。
- 若未来引入外部 KMS/object store，应以第二实现和迁移/灾备证据复审，不得把本地 SQLite 设计直接宣称为企业级 crypto-shred。
