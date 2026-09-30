---
title: "Preschool Overview AI 服务端可信闭环合并交接"
summary: "记录路线 B 从浏览器编排迁移到既有服务端 Run Runtime、Validator 与共享 Artifact Store 的最小闭环、验证证据和后续验收边界。"
doc_type: implementation-handoff
tags: [Overview, Preschool, AI-Insight, Artifact, Runtime]
updated_at: "2026-08-09"
---

# Preschool Overview AI 服务端可信闭环合并交接

## 合并基线与范围

- 基线：`codex/t35-presentation-clean` / `2395bc5816d62d6cfbc6a0d1bdf867ccc2e83ed3`。
- 开发分支：`codex/overview-ai-server-workflow`。
- 仅完成 Preschool 路线 B；没有扩到 Ngee Ann，没有建设 Scheduler、Queue、Worker 或第二套 Agent Runtime。
- 未修改路线 A 的 `preschool-overview-renderer.tsx`、`preschool-overview-view-model.ts` 及其测试。

## 已完成的可信闭环

1. API 的 GET 只在重新解析用户 Membership、Project access 和当前 Project/Scope/Snapshot/Release/Period 后读取 exact-identity Artifact，不 queue、不 claim、不运行 Provider、不写 Store，并返回 `Cache-Control: private, no-store`。缺失或 queued 时，浏览器另行调用受 CSRF 保护的 POST ensure，由服务器取得 lease。
2. 服务器复用现有 `DataFoundryAgUiAgent` 和 Run Store，顺序执行 Investigator、Insight Editor，再执行确定性 Validator；只有 Validator 通过的内容才能写入 canonical shared Artifact。
3. 浏览器只 GET 当前状态/结果、调用 POST ensure 或一次显式 retry。浏览器不再持有 lease、提交 canonical content 或调用 complete/fail；旧 claim/complete/fail API 返回真正的 403 `FORBIDDEN`。旧 `executePreschoolAiRun`、`executePreschoolAiWorkflow` 和直接 `/agent/run` Run-body 入口已从生产 Web 模块删除。
4. exact identity 保留 Workspace、Project、Scope、Snapshot、Release、分析 Period、Renderer、模型 Profile 与 revision、Analysis Pack、Workflow、两个 Prompt、Method Skill、输出合同和 Validator revision。
5. Runtime 完成证据同时校验两个 Stage 的 Run ID、Session ID、completed 状态，以及 Run 输入中的 Snapshot、Release 和 Period；随后才进入 Validator 和 Store commit。
6. Validator 逐条过滤非法 Finding/Block，不用固定模板补写：verified 必须有 Evidence；hypothesis/exploration-idea 至少有 uncertainty 或 verification；一个数值 claim 的 entity、metric、value、unit 必须由同一个 typed Evidence item 或同一 SQL row 支持。Centre count 不能支持 kWh，Centre E 的值不能支持 Centre A1；客户展示的合理四舍五入（例如 51.96% → 52%）被接受。合法 no-visual 与零 Finding 保留。
7. Store 保持 exact-identity single-flight、`available` 不可变、错误 lease token 不可 complete/fail；同一 identity 仅首次执行加一次显式 retry，最多两次 attempt。旧 Snapshot 不会回退到当前页面。
8. 服务器在 Provider 前及 canonical commit 前重新核验当前 Workspace 模型绑定 revision、模型资源状态和 Method Skill semantic revision。任一配置与 identity 漂移即 fail closed，不会把 identity 中的 revision 当作未经验证的提交标签。
9. 显式 retry 成功后会替换浏览器 `currentRuns` 中已失败的 Promise；重新挂载和 Saved Analysis attach 均可读取同一 available Artifact，不会继续命中旧失败缓存。

## API 与恢复语义

- `GET /api/v1/energy/projects/:projectId/overview-ai-artifact?scopeId=...`：纯读取 exact-identity 状态；missing/queued/running/failed/available 诚实返回，禁止缓存。
- `POST .../overview-ai-artifact/ensure`：CSRF 保护的首次显式启动；服务器 queue/claim/执行/验证/提交，竞争请求共享同一 lease 所有者。
- `POST .../overview-ai-artifact/retry`：仅显式重试；Store 决定是否仍有 attempt，竞争请求只有一个 owner。
- `POST .../overview-ai-artifact/claim|complete|fail`：浏览器编排/提交被拒绝。
- Provider 或 Runtime 失败后返回 failed；当前 Snapshot 页面显示 unavailable。不会把旧 Snapshot Artifact 与当前结构化数字混合。

## 自动化验证

- 路线 B 聚焦：`13 files / 143 tests` 通过。
- EnergyIQ seams：`7 files / 89 tests` 通过。电脑休眠后的默认并行 runner 曾未收尾，另一次默认 30 秒门槛出现一个未改动的 Ngee Ann 用例 30,098ms 超时；该用例隔离后 24,016ms 通过，最终同一 7 文件清单以 `--maxWorkers=1 --testTimeout=60000` 单次 89/89 通过，未修改仓库测试配置。
- `npm run typecheck`：通过。
- `git diff --check`：通过（仅 Git 的 LF/CRLF 工作区提示）。

覆盖重点包括：GET 纯读取与 no-store、POST ensure CSRF client、两个授权用户并发仅产生一套两阶段 Run、服务器 canonical commit、Runtime Run/Session provenance 拒绝、模型/Skill revision drift、同 Evidence/同行数值绑定、合理 rounding、旧 Snapshot 在 Provider 前 fail closed、失败后仅一次重试、并发 retry 单 owner、available 不可重跑、错误 lease token 被 fence、retry 后 remount/Saved Analysis 恢复、零高价值 Finding 不补固定废话。

## 合并与复测提示

- 第一版服务端闭环为 `52b183a`；本交接随其 correction commit 一并更新。主 Agent应将两者窄合并到当前 Integration `cd97827`，不覆盖路线 A 并行改动。`apps/api/src/server.ts`、`apps/api/src/energy/energy-api.ts`、Web Config API 和 AI Slot 是最可能相交的文件。
- Integration 合并后至少复跑本交接中的两组测试和 typecheck；若独立 worktree 缺少 `duckdb.node`，先执行 `npm rebuild duckdb`，这只修复本地原生依赖，不是业务改动。
- 路线 A 的 Section composition 继续使用已有 Benchmark/Standby 薄适配；本切片不改 Renderer/ViewModel。

## 明确未完成

- 未执行真实 Provider 固定 Snapshot pass@3，因此尚无 `2/3 useful` 人工价值证据。
- 未完成 1440/1920 Chrome、页面恢复、retry 交互和新旧 Snapshot 视觉验收。
- 未完成 Charles 最终产品验收，也未开始 Ngee Ann。
- 本地自动化通过不等于 Provider、Chrome 或最终产品验收通过。
