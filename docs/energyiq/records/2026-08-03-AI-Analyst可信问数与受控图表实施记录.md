---
title: "2026-08-03 开发记录：AI Analyst 可信问数与受控图表"
summary: "复用 DataFoundry 原生 Harness 打通 Ngee Ann 可信问数、Qwen/DeepSeek 模型链、权威 Energy 语义上下文和 168 点受控图表。"
doc_type: runlog
tags: [AI Analyst, 可信问数, 受控图表, DataFoundry]
updated_at: "2026-08-03"
related:
  - "../decisions/说明-DataFoundry-Agent-Harness与EnergyIQ复用边界.md"
  - "../plans/2026-08-03-三Agent-MVP执行手册.md"
  - "../decisions/决策-NgeeAnn首个试点路线与页面边界.md"
---

# 2026-08-03 开发记录：AI Analyst 可信问数与受控图表

## 1. 目标与范围

本批次只解决 AI Analyst 的首个完整 MVP 链路：用户从 EnergyIQ 带入 Project、Scope 和 Period，DataFoundry Agent 使用受限数据源和只读 SQL 得到可追溯答案；用户明确要求图表时，由后端根据真实 SQL 行创建前端可渲染的 Chart Artifact。

本批次不包括：新 Agent Runtime、Deep Agents、重写 Task Console、AI 修改结构化模板、多 Agent 编排、通用指标平台或任意前端代码图表生成。

`energyiq-rebuild` 已废弃，本批次全部代码和验证只发生在 `D:\Projects\energyiq-datafoundry`。

## 2. 代码改动

| 文件/模块 | 改动类型 | 说明 |
|---|---|---|
| `packages/providers/src/index.ts` | 修改 | 建立薄 Model Provider Registry；使用官方 AI SDK Provider 接入 Alibaba/Qwen、DeepSeek、OpenAI 和 OpenAI-compatible；集中处理模型别名、推理开关和消息兼容。 |
| `apps/api/src/run-config-resolver.ts` | 修改 | 继续使用原有 Model Profile 和 fallbackProfileId；解析为 Mastra 原生模型数组，不增加 Runtime。 |
| `packages/agent-runtime/src/types.ts`、`apps/api/src/run-agent-assembly.ts`、`apps/api/src/server.ts` | 修改 | 把 `reasoningModel` 和服务端权威 `EnergyQueryContext` 传入现有 Run Context。 |
| `packages/agent-runtime/src/semantic/energy-query-semantic-provider.ts` | 新增 | 把已校验的 Project、Scope、Period、Data Snapshot 和 canonical energy fact schema 投影为 `authoritative + live` 语义上下文；普通 DataFoundry 查询仍走 DataLink/Local 链。 |
| `packages/agent-runtime/src/index.ts` | 修改 | 增加 EnergyIQ 可信查询短路径；限制重复找表、无关文件、自由报告和模型自造图表；保留原 Protocol、Evidence、Task Console 和工具治理。 |
| `packages/agent-runtime/src/tools/data-tools.ts` | 修改 | 用户明确要求图表时，从成功 SQL 的完整两列结果确定性创建 Chart Artifact；校验点数、数值、时间粒度和时间间隔。 |
| `scripts/smoke-model-providers.mjs` | 新增 | 验证 Provider Registry、Provider options 和 AI SDK 6 兼容。 |
| `scripts/smoke-model-fallback.mjs` | 新增 | 用本地假模型验证主模型失败后 Mastra 原生 fallback 接管。 |
| `scripts/smoke-energyiq-qwen-agent.mjs` | 新增 | 真实 Ngee Ann 文字问数和受控图表端到端验收。 |

## 3. 当前运行链路

```text
EnergyIQ 页面上下文
  -> server resolve EnergyQueryContext
  -> server 创建仅含 Project + Scope + Period 的 scoped datasource
  -> 原 DataFoundry Agent / Protocol / Task Console
  -> inspect_schema
  -> read-only SQL + validation + evidence binding
  -> 文字答案
  -> 若用户明确要求图表：后端从完整 SQL 行创建 ChartPreview
```

模型只决定“问什么、如何写 SQL、如何解释”；数据范围、只读边界、证据、Chart 点值和终态由服务端控制。

## 4. 受控图表规则

DataFoundry 原来已经有 `ChartPreview`、`createChartArtifact` 和前端 bar/line/pie renderer，本批次补的是 SQL 结果到 Chart Artifact 的可信连接，不是新建图表平台。

当前规则：

- 仅 EnergyIQ 且用户明确要求 chart/graph/plot/趋势图时触发；
- SQL 结果必须恰好两列：label/time + numeric metric；
- 只接受 2–500 个完整结果点，查询必须显式提供足够的 `limit`；
- hourly trend 必须使用真实小时 timestamp，且相邻时间至少 60 分钟；不能把 15 分钟数据改名成 `hour_start` 蒙混；
- daily/weekly/monthly 使用相同的粒度检查思路；
- 图表每个点直接来自成功 SQL 结果，模型不得插值、重复模式、模拟波动或手写 HTML/CSV/JavaScript；
- 当前只生成单序列 bar/line/pie；多序列、热力图和四象限留到后续 Catalog/Template 协同阶段。

## 5. 验证证据

### 自动验证

```powershell
npx tsc -b tsconfig.build.json --force --pretty
npx vitest run packages/agent-runtime/src/semantic/energy-query-semantic-provider.test.ts packages/agent-runtime/src/semantic/semantic-provider-chain.test.ts packages/agent-runtime/src/semantic/default-semantic-provider.test.ts
npx vitest run packages/agent-runtime/src/tools/data-tools-cache.test.ts
npm run smoke:model-providers
npm run smoke:model-fallback
npm run smoke:energyiq-qwen-agent
npm run smoke:energyiq-qwen-chart
```

结果：TypeScript 构建通过；语义与图表单元测试通过；Provider Registry 通过；主模型失败一次后 fallback 成功一次。

### Ngee Ann 文字问数

- Project：Ngee Ann Polytechnic；
- Scope：Office Load 4 Fan ISOL 1/2；
- 本地范围：2026-06-03 00:00 至 2026-06-09 23:59，Asia/Singapore；
- 结果：总用电量 247.98 kWh；
- 工具：1 次 schema、2 次 SQL、1 次 requirement commit；
- 失败调用：0；
- 终态：`protocol.run.completed`；
- 时长：约 23 秒；改造前同一链路约 288 秒。

### Ngee Ann 图表问数

- 生成 1 个后端 Chart Artifact；
- 类型：line；单位：kWh；
- 点数：168 个真实小时点；
- 首点：2026-06-03 00:00；末点：2026-06-09 23:00；
- 峰值：2026-06-04 17:00，约 3.742 kWh；
- 失败调用：0；
- 终态：`protocol.run.completed`；
- 最终回归时长：38.8 秒；
- 模型未写 HTML、CSV、SVG 或模拟图表数据。

不合格的自由 HTML 图表及对应失败测试会话已删除，不能作为产品能力证据。

### 真实页面验收

- AI Analyst 正确接收 `Ngee Ann Polytechnic + Office Load 4 Fan ISOL 1/2 + Custom period`；
- Task Console 随运行自动展开，完成后显示 4 个步骤、5 次工具调用和 100% 成功率；
- 第一次页面测试中，模型错误选择 24 个 hour-of-day 聚合点。后端粒度校验拒绝生成图表，没有产生假图；随后收紧 recipe，要求多日 hourly trend 使用完整本地小时 timestamp；
- 修正后 Outputs 中同时保存 168 行 SQL Dataset、168 点 line Chart Artifact、峰值查询和边界时间查询；
- `Outputs -> Preview` 能实际渲染折线图，首尾点、峰值与 SQL 结果一致；
- 刷新页面后，答案、Task Console 的 `Outputs 4` 和 168 点图表卡片均可恢复；
- 最终回答不再暴露 `requirements committed`、`protocol completed` 等内部状态；当前图表不内嵌在聊天正文，Agent 必须引导用户到 `Task Console -> Outputs -> Preview`，不得写 `chart below`。

## 6. 问题与取舍

| 问题 | 处理 |
|---|---|
| Qwen 默认长思考导致约 288 秒和大量无关工具调用 | `reasoningModel=false` 真正下发到 Provider；模型 helper 固定关闭 thinking；Energy fast path 收紧查询。 |
| 物理表语义 fallback 导致 Task Console 显示 degraded | 增加窄范围 Energy semantic provider；只认证服务端已有事实，不建立通用语义平台。 |
| 模型根据截断预览手写 168 点 HTML，出现模拟数据 | 删除产物；改为后端 `ChartPreview` 从完整 SQL 行构建，模型不再组装点值。 |
| 页面问题被误解为 24 个 hour-of-day 汇总点 | 后端拒绝错误粒度；recipe 明确多日 hourly trend 必须按完整小时 timestamp 分组，7 天应为 168 点。 |
| 字段改名可能伪装数据粒度 | 同时校验 label 字段语义和真实相邻时间间隔。 |
| Chart 问数仍可能使用约 5 次 SQL、耗时约 1 分钟 | MVP 可用但仍可优化；下一步应通过更明确的 Energy analysis recipe 减少探索查询，不改 Runtime。 |
| Qwen 最终回答偶尔带“requirements committed”等内部措辞 | 数据正确性不受影响；后续在回答投影层做轻量清理，不把内部协议词暴露给普通用户。 |

## 7. 复现与排查

1. 只能启动一个 `apps/api/dist/index.js`；Windows 下 DuckDB 不允许第二个 API 进程同时持有同一文件。
2. 真实 smoke 前临时使用 dev auth；完成后恢复 password mode。
3. Qwen Profile：`energyiq-qwen3-8-max`，fallback：`energyiq-deepseek-v4-pro`；密钥只存现有 Secret Store，不写入文档或代码。
4. 若看到 `No validated consumption in this period`，先确认前端 Period 是否落在 Ngee Ann 数据覆盖范围；当前 golden period 为 2026-06-03 至 2026-06-09。
5. 当前本地服务应为：Web `3001` 一个进程，API `8787` 一个 password-mode 进程。

## 8. 后续

1. 优化 Chart 问数 recipe，把完整小时线 + 峰值尽量收敛到 2–3 次 SQL；
2. 评估把 ChartPreview 直接嵌入聊天答案；在此之前继续使用 `Task Console -> Outputs -> Preview`；
3. 定义 AI Analyst 到 Structured Template 的最小协同合同：`scope + period + metric + query artifact + chart preview`；
4. 下一阶段只允许 Agent 产出受控 Template Patch，不允许任意前端代码生成；
5. 继续补 Boss 常问问题集，但每个问题先以 Ngee Ann golden period 跑通，再扩展通用能力。
