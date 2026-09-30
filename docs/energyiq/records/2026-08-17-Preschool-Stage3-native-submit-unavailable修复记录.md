---
title: "2026-08-17 开发记录：Preschool Stage 3 native submit unavailable"
summary: "定位真实 Provider 已完成调查但运行装配层漏传 native submit 能力，并修复、部署和完成 v23 真实生成与页面验收。"
doc_type: runlog
tags: [Preschool, Stage3, AdditionalInsights, Provider, Artifact]
updated_at: "2026-08-17"
related:
  - "../decisions/2026-08-16-AI输出审核边界二次验证结论与实施计划.md"
  - "../decisions/2026-08-05-Overview用户价值与AI-Slot最小交付决策.md"
---

# 2026-08-17 开发记录：Preschool Stage 3 native submit unavailable

## 1. 目标与范围

- 解决 Current B 的 Additional AI Insights 显示 `unavailable`：真实 Provider Run 已完成调查，但 Artifact 以 `PRESCHOOL_ADDITIONAL_AI_DISCOVERY_RESULT_INVALID` 失败。
- 保留候选级 Evidence、价值审核、最多三条发布、历史 Artifact 只读和普通 Overview GET 零 Provider 的既有边界。
- 本次不调整 Ngee Ann 页面组织，不放宽事实校验，不用普通 Assistant 文本代替正式 Candidate 提交。

## 2. 代码改动

真实 Run 事件证明模型只看见五个只读调查工具，并明确表示 `energyiq_additional_insights_submit` 不在可用函数列表，因此查数完成后把候选写成普通 Assistant 文本。Runtime 正确拒绝了这段非正式提交。

进一步穿透生产装配链后确认：server-owned stage options 已正确计算 `additionalAiInsightSubmission: true`，Agent Runtime 也具备第六个 submit tool；真正的断点位于 `createRunAgentAssembly`。该中间层的输入类型没有声明该字段，也没有把它传给 `createDataFoundry`。`server.ts` 使用条件展开传参，绕过了 TypeScript 的 excess-property 检查，因此旧测试和 build 都没有暴露这个丢参。

本次修复：

1. Agent instructions 显式列出 native submit tool，说明它在五个只读工具之外可用；
2. 成功提交后立即结束，不再要求生成与 native submit 冲突的结尾 Assistant 文本；
3. Preschool current Artifact 旋转为 `additional-insights-v23` / `additional-insights-discovery-v12`；
4. v22 保持历史可读、所有 mutation fail closed；Evaluation 和 Method Governance 只允许 v23 继续写入。
5. `createRunAgentAssembly` 显式接收并转发 `additionalAiInsightSubmission`；新增公共装配 seam 红测，防止 server 正确、最终 Agent 工具集仍缺 submit 的假绿。

| 文件组 | 改动类型 | 说明 |
|---|---|---|
| `packages/agent-runtime/src/index.ts` | 修改 | 正式声明 submit tool 与提交后终止语义 |
| `apps/api/src/energy/overview-ai-artifact.ts` | 修改 | 旋转 Preschool current identity/prompt |
| `apps/api/src/energy/preschool-additional-ai-insights-workflow.ts` | 修改 | 仅 current v23 采用 native submit 合同 |
| Metadata Artifact/Evaluation/Governance Stores | 修改 | v23 current-mutable，v22 historical-read-only |
| 对应测试 | 修改 | current fixture 迁移、提交工具提示、v22 历史回归 |
| `apps/api/src/run-agent-assembly.ts` | 修改 | 把 server-owned submit capability 贯穿到最终 Agent Runtime |
| `apps/api/src/run-agent-assembly.test.ts` | 新增 | 直接锁定中间装配层不得丢参 |

## 3. 验证证据

已完成自动门：

```powershell
vitest run <9 个 Stage 3 / Store / API / Runtime 聚焦文件> --maxWorkers=2
```

原 Stage 3 结果：`9 files / 169 tests passed`。本次装配修复额外完成 `5 files / 110 tests passed`，并通过 root TypeScript build 与 Web production build。

已完成真实运行和部署门：

- 精准提交 `3b81ac7`，合入 integration main 为 `2ffce8d`；服务器 current 已原子切换到 `/opt/energyiq-datafoundry/releases/2ffce8d830adcb616fe1d8ad768666f049d25a8f`。
- API/Web systemd 均为 `active`，本机 `/healthz`、外网 `/login` 和未登录 `/api/v1/me=401` 边界通过。
- Current B exact identity：Snapshot `energy-snapshot-315fd785045481c29b7182cf`、Release `preschool-demo-template-v2`、本地日期 2026-06-10 至 2026-07-07。
- Run 总数 `419 → 420`，仅明确 regenerate 增加一次；新 Run 事件包含一次 `energyiq_additional_insights_submit`。Artifact `overview-ai-artifact-258a11fb73b4c5b186da7762` 从第 1 次 failed 恢复为第 2 次 available。
- 模型发现 3 个候选，本地逐候选审核接受并发布 1 个、拒绝 2 个；普通 Overview 连续 GET 后 Run 总数仍为 `420`。
- 生产浏览器已实际显示 Additional AI Insights 卡片，未再出现 unavailable，console error 为 0。

仍需后续独立验收：完整 Saved A→B 语义分类与 Charles/Ngee Ann 多账户回归不由本次 submit 修复自动证明。

## 4. 问题与取舍

- **现象：** Provider Run completed，但 Stage 3 unavailable。
  **根因：** Run 完成只代表 Agent 协议结束；业务 Artifact 还要求一次 native Candidate submission。v23 已要求 submit，但中间装配层丢失了 server-owned 开关，最终 Agent 实际只注册五个读取工具。
  **处理：** 修复 capability 的端到端传递，不降低业务校验；红测直接覆盖发生故障的装配 seam。

- **取舍：** 不直接接受模型最后的 JSON 文本。否则会绕过一次提交、工具审计和候选级治理，A→B 无法证明结果来自当前合同。

- **身份旋转：** Prompt 与终止行为改变后必须生成 v23，防止旧 v22 失败或旧 Proposal 被当作修复后的 current。

## 5. 复现与排查

排查顺序：

1. 读取 exact Artifact 的 error code、Run id 和 Snapshot/Release pins；
2. 核对 Run 是否 completed，不把 Run completed 等同于 Artifact available；
3. 按事件顺序统计只读工具与 `energyiq_additional_insights_submit`；
4. 若 submit 次数为 0，检查最终 Assistant 文本是否明确报告工具不可见；
5. 修复后只用新 Artifact identity 重跑，禁止 retry 旧 v22 冒充 current。

## 6. 后续与关联

1. 对已发布 Insight 做人类价值复核：当前角度把 60.77% load、22.19% aircon 与 11.37% off-hours 连接为一个可验证的 plugload-vs-HVAC 假设；有新角度，但“more plausibly”仍应在后续数据分析中验证，当前正确标为 speculative。
2. 继续验收 `What changed?` 与 Saved A 的 retained/updated/new/removed 分类，不把本次 Current B 成功等同于完整 A→B 通过。
3. 回归 Charles 管理员与 Ngee Ann-only 账户的项目隔离、Overview 和 AI Analysis。
4. Ngee Ann 页面组织属于后续独立切片。
