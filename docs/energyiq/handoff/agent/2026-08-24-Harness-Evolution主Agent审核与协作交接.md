---
title: "2026-08-24 Harness Evolution 主 Agent 复审交接"
summary: "记录 PR #106/#110 的固定审核结论、#102–#105/#114/#117 依赖、#110 hash-only 范围、所有权边界与重新提交门。"
doc_type: handoff
tags: [EnergyIQ, Harness, Run Event, Skill, Model Gateway, Protocol, AI Operations, Handoff]
updated_at: "2026-08-24"
related:
  - "../../CONTEXT.md"
  - "../../plans/开发计划-Admin与模板运行闭环.md"
  - "../../decisions/决策-Harness逻辑控制面、Run-Event与可替换Runtime边界.md"
  - "../../research/2026-08-24-Pi三层与DeepSeek-Harness选择性吸收评估.md"
status: in_review
---

# 2026-08-24 Harness Evolution 主 Agent 复审交接

## 0. 使用方式

本文保存不会随一次 Session 或 CI run 消失的审核决定、依赖和验收门。Issue label、assignee、PR head、CI 与执行 Session 都是易失状态，接手 Agent 必须从 GitHub 和自己的 clean worktree 重新读取，本文不缓存它们。

领域身份采用 canonical [EnergyIQ glossary](../../CONTEXT.md) 的 Workspace、Project、Analysis Run、Template Revision、Report Artifact、Finding Feedback 与 Insight Method Proposal。所谓 Harness control plane 只是复用既有 Store/contract 的服务端逻辑组合，不新增同义领域实体或第二套 Store。

## 1. 主 Agent 固定审核结论

审核对象：

- PR #106：reviewed head `1e9bb4d2151aa38bedca2410767f4eee84b833a3`；结论为 **要求修改，暂不合并**；
- PR #110：reviewed head `27e89309d2c85a3096783e433433cf1559df82da`；结论为 **要求修改，暂不合并**。

后续 push 产生的新 head 不是上述审核对象；只有逐项关闭下列门并由主 Agent 复审，才能合并。

后续复审记录：PR #106 修订 head `512190d024f33f9b2ad506a88e2979903322b6e7` 已逐项关闭第 1.1 节六个文档门；本地六门与 GitHub CI 重跑全绿后，主 Agent 于 2026-08-24 正式接受其架构决策，并合入 `main@9abb73b687888baaad5cbd1a2c7a1057f9afa519`。上述首次 reviewed head 与“要求修改”结论保留为历史；PR #110 不因 PR #106 被接受而自动通过。

### 1.1 PR #106 历史文档复审门（已关闭）

已认可方向：

- EnergyIQ 保留 tenant/Project/Context/Evidence/Artifact/governance 的业务控制权；
- Mastra 仍是唯一生产 Runtime，Pi/DeepSeek 只做隔离 challenger；
- #103 可验证 `pi-ai`；#105 同时等待 #102 与 #103；
- Prompt、Skill、Method、Protocol/Validator 是不同资源。

必须满足：

1. decision status 保持 `in_review`；主 Agent 接受前不进入 README“当前有效决策”；
2. Harness control plane 明确为 Config Resource、Method Governance、Context/Protocol state、Session/Run/Event 与 immutable Artifact provenance 的逻辑组合，不是第二套 Kernel/Store；
3. `@datafoundry/providers` 当前仍是 Mastra/AI SDK shaped；#103 用第二实现证明目标 Model Gateway seam，不能预先宣称公共边界成立；
4. Protocol 独立定义 phase、allowed action、guard、transition 与 terminal decision；Validator/Output Contract 独立负责 schema、单位、时间、Evidence、权限和 publication fail-closed；
5. #104 可以并行；#105 明确同时 blocked by #102 和 #103；
6. Session、assignment、CI 等易失状态不晋升为产品决策或实现证据，重复派工内容只留 GitHub。

### 1.2 PR #110 首轮代码复审门

已认可方向：exact Project/Run 授权、Admin 不返回 raw prompt、historical missing 不回填 current config、`private, no-store`，以及在最终 Mastra Provider 前捕获 prompt/tool request。

必须按 TDD 满足：

1. `model.request.prepared` 使用由 snapshot/run/step/retry identity 派生的 deterministic `eventId`；同一事件 replay 只追加一次；
2. 真实 authenticated HTTP GET 链路零写，包括 session touch、owner upsert、ensure/materialize、queue；登录或显式 mutation 才可写；
3. malformed request payload 与 valid sibling 并存时只让坏项 `Unavailable`，有效兄弟证据继续展示；
4. raw prompt 默认关闭，只存 hash/ref 并显示 unavailable；或进入具备 at-rest protection、exact permission、retention/deletion policy 和测试的受保护 payload store。Admin DTO 字段过滤不等于落盘安全；
5. snapshot create 由服务端验证 actor/session/run 属于同一 exact Run；读取继续按 Workspace/Project/Run fail closed；
6. 所有门关闭前 PR 不写 `Closes #102`。

### 1.3 PR #110 二轮复审与本次修订范围

主 Agent 固定复审 `3eaa191c84f99ee60795f4819fb14ceb30d1646a` 后，确认 deterministic eventId/replay dedupe、snapshot create identity、authenticated GET 零写、默认 20 条列表、列表零 per-Run events/artifacts N+1 和本地 496 Run 性能已经成立；同时明确 CI green 不能替代以下合同门：

1. **交付降级为真实范围**：生产 `ModelRequestSnapshotRepository.create()` 只保存 deterministic hash/ref 与 `hash-only` marker。本 PR 是 **hash-only request identity/event tracer + bounded Runs slice**，不交付 reconstructable raw request payload；#102 invariant 3 与相应 deliverable 继续 open。不得用 Metadata SQLite 明文 raw Prompt 快速补洞。
2. **一次性逻辑迁移**：`0040_model_request_payload_retention` 的 ledger check、row-level logical rewrite 与登记必须位于同一个 `BEGIN IMMEDIATE` 事务；两个进程并发打开同一 WAL DB 时，后到连接必须等锁并在锁内重新检查 ledger，不得重复 rewrite。顺序 reopen 也不得重写后续合法 `retained` sentinel。该迁移不承诺物理擦除 SQLite pages、WAL、备份或 forensic remnants。
3. **局部损坏隔离**：非法 `payload_availability` 或字段类型只让对应 request item `Unavailable`，不得让 valid sibling 消失或把整个 Run detail 变成 500。
4. **exact actor + Run**：Operations detail、cursor、Web key/selected/loading/dedupe 使用 `actorId + runId`。Repository 新增 Operations 专用 `findByProjectActorRun`；Operations 的 EnergyIQ Artifact lineage 还必须同时匹配 `triggered_by + session_id + run_id`，任一 identity 缺失或歧义即省略。Saved Analysis 继续使用既有 legacy `findByProject`，避免在 #110 偷改历史 Artifact 合同。
5. **Web 乱序保护**：Project 切换、连续打开不同 Run、分页请求均使用 generation 与 exact Project/actor/Run guard；旧 response 不得覆盖或合入当前 state。
6. **诚实证据状态**：轻量列表缺 stage 时显示 `Open trace to load`；detail 缺 token event 时返回 `Unavailable + null`，只有持久 token event 明确给出零时才显示 0。
7. **HTTP 与 CI 门**：invalid limit/cursor 返回 400，mismatched actor/Run 返回明确 403/404；authenticated GET 通过生产 server 共用的 auth/CSRF/mutation preflight 与真实 `handleConfigApiRequest` router，保持 exact auth、零写和零 Provider；unsafe method 必须走 mutating auth。Operations 与 authenticated zero-write focused tests 纳入重复执行的 CI workflow check；截至本轮审核 GitHub main 没有 branch protection/ruleset，因此不得把这些 checks 称为平台 required gate。

Saved Analysis 当前序列化合同只带 `runId`，不能在两 actor 同 Project 共用 Run ID 时证明 exact actor。此缺口已单独记录为 [#117](https://github.com/Zion74/energyiq-datafoundry/issues/117)；#110 只保兼容 regression，不修改 Saved Analysis Artifact identity 或历史 payload。

## 2. 授权任务与依赖

```text
#102 canonical Run Event in review
├─ #66 editable Harness policy prerequisite
├─ #114 data-analysis governed actual-load prerequisite
└─ #105 Runtime parity prerequisite A

#103 pinned pi-ai second implementation
└─ #105 Runtime parity prerequisite B

#104 Prompt/Skill/Method/Protocol inventory
└─ #114 candidate and boundary source
```

- #104 已形成 PR #115 的 code-backed inventory；主 Agent 接受前仍为 `in_review`。唯一后续实现票是 #114，且当前因 #102 未接受而 blocked。
- #103 获授权在另一独立 clean worktree 执行：固定依赖版本，synthetic fixtures，零生产凭据，验证 profile/streaming/usage/tool schema/abort/error/request identity；外部类型不得穿透 Admin/Run 公共合同，也不得成为生产默认。
- #105 未获启动授权；两个独立前置都满足后仍需重新确认。
- #117 是 Saved Analysis actor + Run provenance 的独立历史合同缺口；不属于 #110，也不得借此修改受保护 Artifact identity。

## 3. 稳定所有权与冲突边界

该路线只拥有 Harness Configuration、AI Operations、Run Event、Model Gateway evaluation、Prompt/Skill inventory 及直接相关 Admin UI/API/tests/docs。受保护范围保持只读：

- Preschool Stage 3 discovery/workflow；
- Additional Insight Artifact identity、evaluation、mutation；
- Snapshot Diff / Change Review；
- Ngee Ann AI Slot；
- 部署脚本、服务器、生产配置；
- 其他 Agent 的 WIP 或 dirty worktree。

若实现必须触碰受保护范围，先在 Issue/PR 停线记录 exact file/symbol 和原因，等待 owner 协调。

## 4. 每张实现票的执行门

1. 从 GitHub 读取 Issue/PR 最新状态；核对独立 worktree、branch、HEAD、status、owner 和冲突面并写入 Issue comment；
2. 先写能证明目标 contract 的 RED；记录失败原因，不能用 compile error 代替行为 RED；
3. 最小 GREEN；复用既有 Store/contract，避免平行真相源；
4. 运行 touched package focused tests/build、必要 docs build 和 `git diff --check`；
5. 分开报告本地自动化、浏览器、真实 Provider/MCP、部署、生产与人工产品验收；未执行的层级明确写未执行；
6. 只提交 owned files，push 精确 commit，并用新 head 请求主 Agent 复审。

## 5. 权威入口

- Program plan：[开发计划：Admin 与模板运行闭环](../../plans/开发计划-Admin与模板运行闭环.md)第 1.5 节；
- Accepted decision：[Harness 逻辑控制面、Run Event 与可替换 Runtime 边界](../../decisions/决策-Harness逻辑控制面、Run-Event与可替换Runtime边界.md)；
- External mechanism research：[Pi 三层与 DeepSeek Harness 选择性吸收评估](../../research/2026-08-24-Pi三层与DeepSeek-Harness选择性吸收评估.md)；
- Prompt/Skill inventory：PR [#115](https://github.com/Zion74/energyiq-datafoundry/pull/115)；合并后才成为本分支可用的 repository path；
- GitHub：[Program #62](https://github.com/Zion74/energyiq-datafoundry/issues/62)、[#102](https://github.com/Zion74/energyiq-datafoundry/issues/102)、[#103](https://github.com/Zion74/energyiq-datafoundry/issues/103)、[#104](https://github.com/Zion74/energyiq-datafoundry/issues/104)、[#105](https://github.com/Zion74/energyiq-datafoundry/issues/105)、[#114](https://github.com/Zion74/energyiq-datafoundry/issues/114)、[#117](https://github.com/Zion74/energyiq-datafoundry/issues/117)。

## 6. PR #110 二轮修订的本地实现记录

### 6.1 RED → GREEN

- RED 证明 migration reopen 会把 post-migration retained sentinel 再次改回 hash-only；后续双进程 barrier + 双连接 RED 进一步证明 autocommit check/runner/record 会对同一 legacy row 执行两次 rewrite（audit `count=2`）。GREEN 后仅 0040 使用 `BEGIN IMMEDIATE` 包住 ledger check、rewrite 与登记，两个连接都成功打开且该 row 只被 rewrite 一次（audit `count=1`）。
- RED 证明同 Project、同 `startedAt`、同 `runId` 的第二个 actor 会在下一页丢失；GREEN 后排序和 cursor 都使用 `startedAt + runId + actorId`，Operations detail 走 `findByProjectActorRun`。终审新增 RED 证明只按 runId 会把 actor A 的 EnergyIQ Artifact 投影给 actor B；GREEN 后 lineage fail-closed 地同时匹配 actor、Session 与 Run。
- RED 证明非法 snapshot enum 会让整个 detail throw；GREEN 后只捕获 snapshot row validation error，使坏项 unavailable、valid sibling 保留。
- RED 证明旧分页 response 会合入已切换 Project，缺 stage/token evidence 会分别显示 `Stage unavailable` 和 `0/0/0`；GREEN 后 Web 使用 generation + exact identity guard，并区分 `Open trace to load`、`Unavailable` 和有事件证明的真实零。API/UI characterization regression 进一步锁定持久 `input=0/output=0/total=0` 必须显示 Available 0，而不是 Unavailable。
- authenticated HTTP regression 不再直调 Energy handler：测试和生产 server 共用 `resolveConfigApiRequestPreflight`，再进入真实 `handleConfigApiRequest`；GET 证明 read-only auth、零 session/owner/ensure/queue/Provider 写，POST 证明 mutating auth、CSRF 与 mutation preparation 分支被执行。
- 独立 clean detached `6747a2b`、Node `v22.23.2` 在同机并行 Web/docs/CI 负载下，0040 child-process test 曾连续两次达到 Vitest 30 秒 timeout；降载后原提交连续 3 次通过（2.84s / 2.69s / 2.70s），因此不能宣称该提交无 flake。修订后 child 直接依赖 Node 22 原生 type stripping，不再启动两个 `tsx` loader；ready/start/opened 改为 IPC，helper 只有在两个 child 均 `opened` 且 `exit=0` 后 resolve，clean exit without opened、非零 exit、error 和 15 秒 deadline 都携带 phase/stderr fail-fast。对应协议 regression 已覆盖 `exit=0` 但未报告 opened。

### 6.2 可复制自动门

```powershell
npx vitest run packages/agent-runtime/src/model-request-audit-processor.test.ts packages/metadata/src/model-request-snapshot.test.ts packages/metadata/src/run-event-dedupe.test.ts apps/api/src/energy/project-ai-operations.test.ts apps/api/src/authenticated-energy-get-zero-write.test.ts apps/api/src/energy/energy-api.saved-analysis.test.ts apps/web/src/app/energyiq/admin/project-ai-operations.test.tsx apps/web/src/app/energyiq/admin/project-ai-operations-skill-evidence.test.tsx apps/web/src/lib/config-api/__tests__/project-ai-operations-client.test.ts
npm run build -w @datafoundry/contracts
npm run build -w @datafoundry/metadata
npm run build -w @datafoundry/agent-runtime
npm run build -w @datafoundry/api
npm run build -w @datafoundry/web
npm run smoke:docs
npm run docs:build -- --strict
git diff --check
```

本地结果：终审修订在 Node `v22.23.2`、single worker 下的 focused suite 为 9 files / 27 tests 通过，其中 Saved Analysis 兼容 regression 为 4 tests；修订后的 0040 并发用例另行连续 3 次通过，测试本体为 `632–732 ms`。Contracts、Metadata、Agent Runtime、API build 通过；Web production build 通过并生成 17 routes/pages；docs link smoke 检查 154 files、strict build 通过。authenticated synthetic SQLite fixture 含 496 Runs，首屏返回 20 rows，本轮 Node 22 本地 HTTP 为 `15.8 ms / 8,266 bytes`。该 timing 是本地合成证据，不是 production-equivalent timing，也不关闭 #108 的部署后 `<=3s` 门。

补充运行的 Windows 全量 `npm run test:packages` 不是绿色门：81 files / 550 tests 中 78 files / 541 tests 通过，9 个失败来自未修改的 `session-output-ingest` Windows 盘符期望，以及 `knowledge`/`artifacts` 临时目录清理 `EPERM`。不得把该结果写成通过，也不得在 #110 越界修改这些模块；易变的 GitHub CI 状态只从 PR 读取，不固化在本文。

### 6.3 未完成/未执行边界

- 主 Agent 必须对提交时的 exact PR head 独立复审；易变的 head/CI 状态只从 GitHub 读取；
- #102 的 reconstructable payload invariant 仍 open；
- 未执行浏览器/产品、多账户、真实 Provider、真实 MCP/Tool、部署、服务重启、生产 timing 或人工验收；
- 未修改 Saved Analysis Artifact identity；其 actor provenance 缺口由 #117 跟踪；
- 未启动 #105，#103 保持在独立 atomic GREEN 提交处暂停。
