---
title: "Tuya Office Source Connector 运行手册"
summary: "说明 Tuya Source Connector 的安全配置、自然月同步、验收边界和故障恢复。"
doc_type: runbook
tags: [Tuya, Source Adapter, Connector, 自然月, 数据更新]
updated_at: "2026-08-23"
status: proposed
related:
  - "CONTEXT.md"
  - "../decisions/2026-08-19-Project通用Report-Time-Context与Overview复用决策.md"
---

# Tuya Office Source Connector 运行手册

## 1. 当前交付边界

Tuya Office 使用既有 `Import Batch → Raw Reading → Interval Fact → Data Snapshot → Overview` 主链路，不建立第二套计算栈。默认 Managed Overview 口径是 `calendar_month_to_date`：从项目时区当月 1 日开始，到最新完整数据日为止。

代码测试、构建和脱敏 fixture 只构成工程证据。只有受保护配置齐全并成功执行真实 Singapore OpenAPI 同步后，才能声称真实 Source Adapter 可用；生产部署和客户验收仍是独立门。

## 2. 受保护配置

以下配置只能放在部署环境或本地未跟踪 `.env` 中，不能提交到 Git、返回浏览器、写入日志或保存到 Artifact：

- `ENERGYIQ_TUYA_ACCESS_ID`
- `ENERGYIQ_TUYA_ACCESS_SECRET`
- `ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID`
- `ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID`
- `ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON`

`ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON` 的键是已发布 Mapping 中的 `meterPointId`，值是 Provider Device ID。服务端必须验证它与该 Project 当前已发布 Mapping 的 Meter Point 集合完全一致。浏览器不得提交或覆盖 Device ID。

可选运行配置：

- `ENERGYIQ_TUYA_SYNC_ENABLED=true` 启用每日调度；默认关闭。
- `ENERGYIQ_TUYA_SYNC_LOCAL_HOUR` 指定项目时区内的整点小时。
- `ENERGYIQ_TUYA_ENDPOINT` 只能是 Singapore endpoint。

## 3. 同步与恢复语义

1. 服务端先解析 exact Workspace/Project Connector，再允许状态查询或同步；其他 Project 在调用 Provider 前 fail closed。
2. 同步窗口使用新加坡完整日边界并保留一天 overlap，用于跨批次累计读数重建。
3. 同一 Project、相同时间窗口且 Published Connector revision/fingerprint 相同的成功同步，复用既有 Run/Batch/Snapshot，不重复写入；Mapping 或设备绑定发布变更后必须生成新 Run。
4. OpenAPI 请求有有限重试和有界超时；token 失效时只刷新一次。
5. 分页 cursor 重复立即失败，防止无限循环。
6. 服务关闭时先取消并等待进行中的同步，再关闭 Metadata，避免遗留永久 `running`。
7. 同步失败保留上一个成功 watermark 和 Snapshot；不能用失败批次污染 Current Overview。

## 4. 发布前自动门

- 签名、token refresh、429/5xx retry、timeout、abort、pagination stalled 全部通过。
- 非 Connector Project 和浏览器自带 Device ID 均在 Provider 调用前拒绝。
- Import Batch、Fact Writer、Snapshot、Project Resolver 与 Renderer 回归通过。
- `npm run build`、`npm run build:web`、EnergyIQ seams 通过。
- 仓库扫描不包含真实 Device ID、Access Secret、token 或客户用量原型。

## 5. 真实数据更新验收

在独立测试 Storage 中记录 Previous Snapshot，然后执行一次新完整日同步并发布 Current Snapshot：

- `Data through` 前进，Report Edition 仍为同一自然月模板；
- 确定性数字、图表和对应 AI 数据域只引用 Current Snapshot；
- Previous Artifact 仍可历史读取，但不能冒充 Current；
- `What changed?` 能展示已保留、已更新、新增和移除的结论；
- 普通打开和刷新不新增 Provider Run；只有明确的生成动作补齐缺失 Current Artifact。

## 6. 人工验收

真实同步通过后再分别执行：管理员账户、Tuya Office 项目账户、跨项目拒绝、Overview 浏览器、AI Analysis、刷新恢复、服务重启恢复。任何 fixture、单元测试或 HTTP 200 都不能替代真实 Provider、浏览器和人工内容价值验收。
