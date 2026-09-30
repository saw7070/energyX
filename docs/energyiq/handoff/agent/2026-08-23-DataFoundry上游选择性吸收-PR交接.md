---
title: "DataFoundry 上游选择性吸收 PR 交接"
summary: "交接 Issue #96 的 CI Package 测试门禁、Run 终态真值、same-protocol handoff 与 Web 会话恢复修复。"
doc_type: implementation
tags: [DataFoundry, upstream, protocol, conversation, CI, handoff]
updated_at: "2026-08-23"
status: delivered
---

# DataFoundry 上游选择性吸收 PR 交接

## 1. 主 Agent 先做什么

1. 在 GitHub 审查 [Issue #96](https://github.com/Zion74/energyiq-datafoundry/issues/96) 对应 PR 的四个实现提交和本交接提交。
2. 确认 PR base 仍包含 `origin/main@d22f2affcadf1195a9afe1673b8ee2d40104289f`。若 `main` 再前进，先比较本交接第 7 节的 owned paths；存在路径交集时重新跑聚焦测试，不按“无文本冲突”直接放行。
3. 复核 GitHub Actions run `32639220680`：`Run package unit tests` 已在 Ubuntu 实际执行并通过，满足 U0；整体 CI 仍被第 4 节记录的当前 `main` blocker 阻断。
4. 在 reviewed Integration Worktree 按第 5 节顺序验证。该 Worktree 有未提交工作时，先归还其 owner；不把本 PR 混入共享 WIP。
5. 只有自动化与人工边界均如实记录后才合并。当前交接不包含真实 Provider、浏览器、部署、多账户或人工产品验收。

完成条件：PR checks 给出 package gate 的真实结果，聚焦测试和 EnergyIQ Seams 通过，浏览器人工复现两条 Web 场景，且没有修改本交接第 8 节的冻结范围。

## 2. 身份与结论

| 项目 | 精确身份 |
| --- | --- |
| Ticket | `#96` |
| Branch | `codex/issue-96-upstream-correctness` |
| Worktree | 隔离 Worker Worktree（本地个人路径不进入仓库文档） |
| Reviewed base | `origin/main@d22f2affcadf1195a9afe1673b8ee2d40104289f` |
| 上游候选快照 | `datagallery-lab/datafoundry@5cf7d364e2eddf69f84a1ac2eb0a606e069c67a4` |
| 吸收方式 | 机制适配；没有 merge、rebase 或 cherry-pick 上游历史 |

本 PR 只吸收四个“执行真值”机制：

- Package 单测进入 Zion74 PR CI；
- general-task 的数据动作被协议拒绝后，Run 与 protocol durable state 同时失败；
- same-protocol handoff 被拒绝，并持久化 proposed/rejected 治理事件；
- 同线程后台 refresh 保留本地 transcript，且 Run failure 在 composer 可见。

提交顺序：

1. `f1c16e5 chore(ci): run package unit tests`
2. `828b3c7 fix(protocol): preserve failed run truth`
3. `8bc2d01 fix(protocol): reject same-protocol handoffs`
4. `c57a7d4 fix(web): preserve conversation truth on refresh`

## 3. 已交付行为

### U0 — CI execution truth

- 根 `test:packages` 明确执行 `vitest run packages`；Vitest 是根直接 devDependency，不依赖偶然 hoist。
- Zion74 `.github/workflows/ci.yml` 在 TypeScript build 后执行 Package 单测。
- 没有复制上游的 repository-name guard，因此 fork 的 PR 不会因仓库名不同而跳过。

### U1 — Protocol terminal truth

- `completeProtocolRun` 在 `general-task` action ledger 中发现 `ACTION_NOT_ALLOWED_IN_PHASE` 的数据动作拒绝后，不再自动提交 `general.answer.commit`。
- 新的 `ProtocolRuntime.terminateFailure` 原子持久化 `terminalDecision.status = failed`，并生成 `protocol.completion.proposed`、`protocol.run.failed`。
- 现有 Run finalizer 再写 metadata failure 与 `RUN_ERROR`。Protocol 不会是 `partial` 而 metadata 是 `failed`。
- 非数据动作拒绝、`data-analysis` 路径和既有 time-budget partial 语义保持原状。

### U3 — Handoff governance

- `evaluateProtocolHandoff` 拒绝目标 `protocolId` 与当前相同的提案；仅改变 version 也不是合法 handoff。
- Coordinator 用一次 CAS 保存 rejected state revision、`protocol.handoff.proposed` 与 `protocol.handoff.rejected`。
- 被拒绝的 handoff 不创建新 segment；Boundary 保留当前 phase、ContextPackage、domain 与已成功记录的 handoff tool action。
- 本切片没有引入 Session Intent、route-correction 或新的 Store。

### U2 — Web conversation integrity

- `shouldRestoreConversationMessages` 新增显式 `replaceExistingMessages` 决策。
- 切线程时先清空 transcript 并允许一次替换；消息为空也允许恢复。
- 同线程后台 refresh 在已有本地 transcript 时只恢复其他持久状态，不覆盖消息。
- composer 显示 `client submit error ?? liveRun.errorMessage`；更局部的上传/提交错误优先。

## 4. RED 与 GREEN 证据

### RED

| Slice | 变更前证据 |
| --- | --- |
| U0 | `npm run test:packages` 退出 1：`Missing script: "test:packages"` |
| U1 | `protocol-run-completion.test.ts` 7 个测试中 1 个失败：拒绝数据动作后仍调用 `general.answer.commit`；加入 durable failure seam 后另见 `terminateFailure is not a function` |
| U3 | 3 files / 28 tests 中 4 个失败：纯决策接受 same protocol、Coordinator 创建 segment、Boundary promise 未拒绝 |
| U2 | 2 files / 69 tests 中 3 个失败：后台 refresh 返回 `true`，composer error resolver 尚不存在 |

### GREEN（重放到最新 base 后）

```text
7 focused files / 121 tests passed
@datafoundry/agent-runtime build passed
@datafoundry/contracts build passed
@datafoundry/data-gateway build passed
@datafoundry/metadata build passed
@datafoundry/api build passed
git diff --check passed
```

Web `tsc --noEmit` 在最新 main 上整体仍退出 1；过滤输出确认本 PR 修改文件没有类型错误。不能把这称为 Web typecheck passed。

`npm run test:packages` 已真实执行 79 files / 544 tests，在 Windows 为 75 files、534 tests 通过，10 tests 失败：

- `packages/artifacts/src/session-output-service.test.ts`：2 个临时目录清理 `EPERM`；
- `packages/knowledge/src/knowledge-document-lifecycle.test.ts`：5 个临时目录清理 `EPERM`；
- `packages/agent-runtime/src/tools/session-output-ingest.test.ts`：2 个测试写死 POSIX 路径，实际返回 Windows 绝对路径；
- `packages/data-gateway/src/energy-scoped-datasource.test.ts`：最新 main 的一个 5 秒 timeout 测试在 Windows 用时超限。

这些文件不在 #96 diff 中。不得通过 exclude、放宽 assertion 或跳过 CI 隐藏失败；Ubuntu package job 已通过。

GitHub Actions run `32639220680` 的其余结论：

- `Build TypeScript workspaces` 与 `Run package unit tests` 通过；U0 已有远端证据。
- Web tests 为 125 files passed / 3 files failed，失败文件是本 PR 未修改的 `identity-menu.test.ts`、`mastra-stream-hooks.test.ts` 与 `energyiq-ui-regressions.test.ts`；Web build 因此未执行。
- Core Smoke 在 authentication regression 失败：Public registration closed 返回 403，而旧 smoke assertion 期待 400。
- Docs smoke 仍扫描到既有生成 HTML、旧 EnergyIQ 文档和已有个人路径；本交接文档移除本地路径后已不再出现在本地 smoke 输出。

这些是合并 blocker，但不是扩大 #96 的理由。主 Agent 应通过独立 baseline Ticket 修复或明确处置，再重跑 #97。

## 5. Integration 验证顺序

在 reviewed Integration Worktree 串行执行，避免 API 读取旧 `dist`：

```powershell
npm --workspace @datafoundry/contracts run build
npm --workspace @datafoundry/data-gateway run build
npm --workspace @datafoundry/metadata run build
npm --workspace @datafoundry/agent-runtime run build
npm --workspace @datafoundry/api run build

npx vitest run `
  packages/agent-runtime/src/protocol/protocol-runtime.test.ts `
  packages/agent-runtime/src/protocol/protocol-handoff.test.ts `
  packages/agent-runtime/src/protocol/protocol-handoff-coordinator.test.ts `
  packages/agent-runtime/src/protocol/run-protocol-boundary.test.ts `
  apps/api/src/protocol-run-completion.test.ts `
  apps/web/src/app/data-tasks/__tests__/conversation-restore.test.ts `
  apps/web/src/app/data-tasks/__tests__/run-error-message.test.ts

npm run test:energyiq:seams
git diff --check
```

然后做两条已登录浏览器人工检查：

1. 同一 Session 发送新消息，在后台 conversation refresh 返回旧快照后，已显示的消息仍完整且顺序不变。
2. 制造一个可恢复的 Run failure，composer 上方出现格式化错误；开始下一次 Run 后，旧错误按 live-run reducer 现有语义清除。

浏览器通过只证明 transcript/error UI；不证明 Provider 回答正确、Energy Fact 正确、部署完成或客户接受。

## 6. PR 审查重点

- U1：`ProtocolRunState.terminalDecision`、metadata Run status、durable protocol events 与 Web error 必须同为失败事实。
- U3：rejected handoff 会把当前 segment revision 加一；调用方继续使用旧 revision 应由 CAS 拒绝。
- U2：`messageReplacementThreadRef` 只授予切线程后的首次 message replacement，旧异步请求不能清除新线程授权。
- U0：Package step 应在 fork PR 中实际运行，且保留现有 Web、smoke 与 EnergyIQ 验证。

## 7. Owned paths

```text
.github/workflows/ci.yml
package.json
package-lock.json
apps/api/src/protocol-run-completion.ts
apps/api/src/protocol-run-completion.test.ts
packages/agent-runtime/src/protocol/protocol-runtime.ts
packages/agent-runtime/src/protocol/protocol-runtime.test.ts
packages/agent-runtime/src/protocol/protocol-handoff.ts
packages/agent-runtime/src/protocol/protocol-handoff.test.ts
packages/agent-runtime/src/protocol/protocol-handoff-coordinator.ts
packages/agent-runtime/src/protocol/protocol-handoff-coordinator.test.ts
packages/agent-runtime/src/protocol/run-protocol-boundary.test.ts
apps/web/src/app/data-tasks/conversation-restore.ts
apps/web/src/app/data-tasks/components/chat/SessionConversationRestore.tsx
apps/web/src/app/data-tasks/components/chat/DataTaskChatInput.tsx
apps/web/src/app/data-tasks/components/chat/DataTaskChatInputBindingsContext.tsx
apps/web/src/app/data-tasks/data-tasks-app.tsx
apps/web/src/app/data-tasks/run-error-message.ts
apps/web/src/app/data-tasks/__tests__/conversation-restore.test.ts
apps/web/src/app/data-tasks/__tests__/run-error-message.test.ts
```

## 8. 冻结范围与后续 frontier

本 PR 保持以下范围不变：Energy Fact、Project Analysis Resolver、Renderer、Stage 3 Artifact/Evaluation、Snapshot Diff、Admin Harness Configuration、Provider routing、Auth 与 deployment。

后续只在触发条件成立时立项：

- Tool Plan：先完成 #61、#63、#64、#65 Integration 与人工复核；仍有真实原因链缺口才做窄 follow-up。
- Session Intent / Helper Context：固定多轮 same-session Eval 重复证明 intent 继承失败后再做。
- MySQL/MariaDB 顺序修复：真实 Connector 进入交付/回归环境后，连同真连接 read-only smoke 一起做。
- DataLink：只有命名的跨源 schema/join discovery 场景才允许只读 sidecar spike；它不进入 EnergyIQ 正式真相链。

## 9. 当前验收边界

| Evidence | 状态 |
| --- | --- |
| 聚焦自动测试 | 通过：7 files / 121 tests |
| 受影响 package build | 通过：Contracts、Data Gateway、Metadata、Agent Runtime、API |
| Package 全门禁 | Ubuntu PR job 已实际执行并通过；Windows 10 个范围外失败不再阻断 U0 |
| PR CI 总体 | 红：Web tests、auth smoke、Docs smoke 的当前 `main` blocker；Web build 未执行 |
| EnergyIQ Seams | Worker 未执行；由 Integration 执行 |
| 真实 Provider / MCP | 未执行 |
| 浏览器 / device | 未执行 |
| 部署 / 多账户 | 未执行 |
| 人工产品验收 | 未执行 |

合并后在 #96 发布 Integration、PR checks 与浏览器证据；全部满足后关闭 Ticket。若任一硬门失败，保持 #96 open，并把 exact failure、owner 与下一步写入 Issue。

## 10. 主 Agent 独立复核与修正（2026-08-23）

主 Agent 没有直接按原交接放行，而是在共享 CI 基线 #98 合入后重新做了 RED → GREEN 复核。结论如下：

- 同意 U0 的 fork-safe Package 门和 U3 的 same-protocol handoff 拒绝机制；
- 部分反对原 U1“Run 与 Protocol 已完整保持同一失败事实”的表述：原实现只识别 `ACTION_NOT_ALLOWED_IN_PHASE`，漏掉 action budget 与 guard 两类 admission rejection；Protocol failure CAS 冲突也会被上层 catch 转写成 metadata Run failed，留下 active Protocol；
- 部分反对原 U2“切线程首次替换授权不会被旧异步请求污染”的表述：live Run 接管或 restore cancellation 时，replacement grant 仍可能残留，并在 Run 结束后的下一次 restore 覆盖新 transcript。

已补修：

1. admission failure 精确覆盖 `ACTION_NOT_ALLOWED_IN_PHASE`、`PROTOCOL_ACTION_BUDGET_EXHAUSTED` 与 `PROTOCOL_GUARD_REJECTED`；
2. `terminateFailure` 使用 bounded CAS retry；只有 Protocol 已持久化为 terminal failed 后才发布 Run failed；持久化失败时显式拒绝，避免制造矛盾终态；
3. live Run 接管和 restore cancellation 都撤销 thread-switch transcript replacement grant。

更新后的自动化证据：

```text
focused correctness: 7 files / 128 tests passed
EnergyIQ seams: 7 files / 109 tests passed
Contracts, Data Gateway, Metadata, Agent Runtime, API builds passed
Web production build passed
git diff --check passed
```

共享 CI blocker 已由 #98 / PR #101 独立修复并合入 `main`。浏览器两条 Data Tasks 人工场景、真实 Provider/MCP、部署、多账户和人工产品验收仍未由本节声称完成。
