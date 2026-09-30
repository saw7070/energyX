---
title: "DeepSeek V4 Flash 与 DataFoundry 可信问数实测记录"
summary: "记录 DeepSeek V4 Flash 的真实 provider、可信问数和受控图表测试，并据此界定 DataFoundry 在 EnergyIQ 中的适用边界。"
doc_type: runlog
tags: [DeepSeek, DataFoundry, AI Analyst, 可信问数, Chart Artifact]
updated_at: "2026-08-03"
related:
  - "2026-08-03-AI-Analyst可信问数与受控图表实施记录.md"
  - "../decisions/决策-Overview改造与AI-Analysis打通最终方案.md"
status: verified-with-open-gaps
---

# DeepSeek V4 Flash 与 DataFoundry 可信问数实测记录

## 1. 本次测试回答什么

本次不是只验证 API Key 是否可用，而是验证三层能力：

1. DeepSeek 官方服务是否确实提供 `deepseek-v4-flash`；
2. DataFoundry 是否能用该模型完成带 `Project + Scope + Period` 的可信问数；
3. 模型是否能稳定产生由后端校验的图表，而不是自己编数据或写任意前端代码。

测试模型配置为：

- Profile：`energyiq-deepseek-v4-flash`；
- Provider：DataFoundry 已有的官方 DeepSeek AI SDK adapter；
- Model：`deepseek-v4-flash`；
- Reasoning：关闭；
- 测试期间不配置 fallback，避免把其他模型的成功误认为 Flash 成功；
- 密钥继续保存在 DataFoundry 加密 Secret Store，未写入文档或前端。

该 Profile 已成为 `dev-user/default workspace` 当前 `run-defaults` 的首选模型；同时已用正常密码登录链路为 `admin@energyiq.demo/default workspace` 建立同名加密 Profile 并再次通过约 1.0 秒连接测试，便于管理员直接体验。原 Qwen 与 DeepSeek Pro 配置仍保留，未删除。

## 2. 测试结果

| 层级 | 结果 | 耗时/证据 | 判断 |
| --- | --- | --- | --- |
| 官方模型发现 | 通过 | DeepSeek `/models` 返回 `deepseek-v4-flash` 与 `deepseek-v4-pro` | 模型 ID 和 Key 有效 |
| DataFoundry 连接测试 | 通过 | Provider probe 约 1.0 秒，状态 `connected`，响应模型为 `deepseek-v4-flash` | 现有 provider 可直接复用 |
| Ngee Ann 文本问数，dev run | 流程通过、数值失败 | 完整 Run 约 53.5 秒；先查 Schema，再执行只读 SQL；得到 235.85078 kWh、640 条 interval 记录 | 模型用了错误 UTC 时间字面量，裁掉 8 个本地小时；不能算“可信问数通过” |
| Ngee Ann 文本问数，正常 Admin 登录 | 流程与数值通过 | 完整 Run 约 26.8 秒；同一 Scope/Period 得到 247.981288 kWh、672 条 15 分钟记录；查询本地半开区间 `[2026-06-03 00:00, 2026-06-10 00:00)` | 正确基准成立，但同问题两次结果不一致证明当前模型 SQL 不稳定 |
| Ngee Ann 168 点小时图，首次 | 失败 | 约 50.7 秒；只生成 160 点 | 模型使用 `TIMESTAMP` 过滤 `TIMESTAMPTZ`，造成新加坡时区边界错误；现有 guardrail 未拦截 |
| 小时图诊断重跑 | 部分通过 | SQL 改用 `TIMESTAMPTZ` 后正确返回 168 点，但模型把 `LIMIT 500` 写在 SQL 内，没有传工具的 `limit` 参数，后端未生成 Chart Artifact | 图表生成仍过度依赖模型遵守隐含调用格式 |
| 小时图再次验收 | 失败 | 60 秒超时 | 运行中出现 assertion registry/commit adapter 不一致，未在时限内稳定收口 |

## 3. 关键发现

### 3.1 Flash 能完成工具链，但当前不能称为可信问数

工具路径是受控的：模型使用了 Schema 检查和只读 SQL，没有调用文件浏览或任意代码生成来伪造结果。这证明 DataFoundry 已具备可用的 AI Analyst 骨架。

但同一个问题第一次得到 235.85078 kWh / 640 条，正常 Admin 登录重跑得到 247.981288 kWh / 672 条。后者使用本地 `TIMESTAMP` 半开区间并覆盖完整 7 天，是正确基准；前者使用错误 UTC 类型裁掉最后 8 个本地小时。**流程 completed、回答带 Evidence，都不能替代数值 Golden 验收。**

同一个模型在文本和图表任务中出现三类不稳定：

1. SQL 类型选择错误：`TIMESTAMP` 与 `TIMESTAMPTZ` 混用，导致同一文本问题得到不同总量，图表也把本地 7 天只取成 160 小时；
2. 调用契约不稳定：SQL 结果是 168 点，但没有按后端图表生成器需要的工具参数调用；
3. Runtime 收口超时：模型在 requirements/assertions commit 上反复尝试，最终超过 60 秒。

这些不是“换一个 Prompt 就肯定消失”的问题。可信问数的关键时间过滤、图表数据形状和证据提交，不应继续交给模型临场决定。

### 3.2 数据本身并没有缺 8 个小时

160 点不是 DuckDB 缺数据。诊断查询使用正确的 `TIMESTAMPTZ` 半开区间后，得到完整的 168 个小时桶，范围从本地 `2026-06-03 00:00` 到 `2026-06-09 23:00`。

因此需要修的是查询契约和验证器，而不是补造数据。

### 3.3 当前模型配置仍是用户级，不是 EnergyIQ 系统级

现有 Model Profile 按 `workspace_id + user_id` 存储。本次为测试用户 `dev-user` 和正常登录的 `admin@energyiq.demo` 分别保存了同一 Flash Profile；其他 FM/Boss 账户仍不会天然共享该 Profile。

正式产品应增加一个很薄的 EnergyIQ 系统模型绑定：管理员选择工作区默认模型，普通用户只使用，不看到密钥，也不需要每个账户复制一遍配置。MVP 演示前至少要让 EnergyIQ AI Analyst 能解析到这一默认 Profile。

## 4. 对 DataFoundry 的真实评价

### 已经值得复用的部分

- 官方模型 Provider 与加密 Secret；
- Model Profile、模型切换和 fallback 基础；
- Mastra/AG-UI 流式 Agent Runtime；
- 只读数据工具和 Energy Query Context；
- Session、Run、Trace、Artifact 与已有 Task Console；
- Knowledge、Skills、Tools、MCP、Assets 的管理骨架；
- 后端校验的 Chart Artifact 方向。

### 不能直接当成已完成的部分

- 新加坡本地时间到 UTC 查询边界的确定性编译；
- 图表请求到 Chart Spec/Chart Artifact 的确定性调用；
- requirement/assertion registry 与 commit adapter 的一致性；
- 60 秒同步 Run 对复杂图表分析的稳定性；
- Admin 配置的模型如何安全提供给普通 EnergyIQ 用户；
- Boss/FM 级别的简洁最终回答，目前 Trace 中仍可见较多模型自我纠错过程。

## 5. 结论

DataFoundry **可以继续作为 AI Analyst 的基础设施**，但本次实测不支持把它定义成整个 EnergyIQ 的“数据底座”或让 Overview 依赖 Agent 实时计算。

正确边界是：

```text
Energy Data Foundation / DuckDB = 数据与确定性指标底座
Project Recipe                  = 项目计算器
Project Renderer                = Boss/FM 的固定化 Overview
DataFoundry                     = 可替换的 AI Analyst Runtime
```

在修复时间查询、图表触发、协议提交和系统模型绑定以前，Flash 适合继续做基准测试模型，不应宣称 AI 图表链路已经稳定可交付。
