---
status: verified-excel-onboarding-local
updated_at: 2026-09-12
---

# Agent 导入、映射、发布与报告同源验证

## 结论与范围

在独立本地项目中，用真实 Ngee Ann Level 6 Excel 跑通了：上传资料 → Pi + DeepSeek Flash 导入 → 建立配置和计量映射 → 数据物化 → 发布配置 → Explorer 查询 → 新对话生成英文 HTML → Knowledge 预览。原有项目和生产数据未被这次验收覆盖。

这证明的是现有支持格式的 Excel 初始化链路。任意 CSV 的字段适配、任意新 API 的连接器配置与定时取数验收仍需补充。不能把本次结果写成所有数据源已自动接入，也不代表 Charles 已认可分析价值。

## 实现

- Agent 新增 source list/import/materialize、setup publish 工具；文件入口绑定当前运行的授权附件，不允许指定任意服务器路径或其他项目。
- 导入复用现有格式适配器、文件哈希去重和校验；发布复用 Admin 服务、版本检查及物化锁，不绕过原权限。
- 新项目允许独立发布读数与配置，不再强制依赖旧版 Overview 分析预热。旧项目的发布路径保持原行为。
- 已有数据但配置尚未发布时，初始化对话仍可继续修复。发布后新运行从项目自动准备数据包，基础数据无需手动上传。
- 快照保留初始化时的配置恢复凭据；同一不可变快照再次物化不改写凭据。项目节点 ID 冲突在保存前拒绝。

## 真实验收

源文件：`docs/template/Net-Zero Product/Ngee Ann Poly Level 6 (19 May - 17 June).xlsx`。

| 项目 | 证据 |
| --- | --- |
| 本地验收项目 | `energy-project-45d5bf21` |
| 初始化运行 | `a77e4044-4de6-4acd-9c3d-e849149159a4` |
| 报告运行 | `1ab7b7ac-9c46-4ef8-bc06-066bce29103e` |
| 数据快照 | `energy-snapshot-b30781266a9f7b9710e5413e` |
| 层级版本 | `energy-project-45d5bf21-hierarchy-v1` |
| 报告窗口 | 新加坡时间 `[2026-06-10, 2026-06-17)` |
| 报告手动附件 | 0；读取系统生成的项目数据包 |
| 源导入 | 25,919 原始行，25,910 区间读数；校验未发现无效、重复、负值或未映射冲突 |
| 独立 CSV 汇总 | 476.983827 kWh |
| Explorer | 476.9838 kWh |
| Agent 计算结果 | 476.984 kWh（3 位小数） |
| HTML | 21,455 bytes，全英文；总计表格显示 476.98 kWh |

七个逐日总量也已独立核对，差异均为声明精度下的舍入。Explorer 与报告数据包使用同一快照、层级版本。浏览器已确认 Knowledge 报告卡片和右侧 HTML 预览可打开。

诊断与验收脚本、manifest、计算结果保存在本地忽略目录 `outputs/report-integration-20260911/` 及其 storage 下；不提交账号、密钥和客户原始数据。早期失败试跑暴露了旧 Overview 依赖、零号版本、发布前聊天和快照恢复问题，已据此修复，不能把这些失败试跑计为成功。

## UI 与 Explorer 合并

- 原先两个项目/工作区选择入口合并为一个按工作区分组的项目选择器，保留 Admin 的 Create project。
- Explorer 从已发布计量映射生成电表叶节点；空间树与电表目录分开处理。上层可查看下级空间和电表读数，缺数据显示 No data，不能用 DB 总量代替单表。
- Circuit 选择写入 URL，刷新后恢复叶节点及父级展开状态。
- UI 合入 GFM 表格、项目切换上下文修复、未发送文字草稿恢复。附件目前仍沿用项目级设置契约，界面明确范围；尚未改成逐条消息附件协议。
- 详见 [Explorer 验收](2026-09-12-explorer-child-meters.md) 和 [UI 验收](../reviews/2026-09-12-shell-analysis-ux.md)。

## 验证与剩余边界

- 核心三类 Seam：7 文件、157 项测试通过。
- 配置工具 13 项、报告输入 15 项、快照物化 5 项及读数发布完成检查通过。
- TypeScript 构建通过；Next 构建与 Explorer 浏览器验收通过。最新草稿 UI 另有专项测试记录。
- 已知旧测试边界：`energy-api.error.test.ts` 中 1 项断言期待 `SNAPSHOT_FACT_STATE_STALE`，实际为 `ENERGYIQ_SNAPSHOT_STALE`；在改动前基线也复现，不属于本轮新增故障。
- HTML 数字一致不等于所有解释已经验证。对残差、待机负载和人员活动的推断仍需证据与 Charles 反馈，不能当成已确认原因。
- Tuya PPT 的个别 DB2 归属描述存在冲突。设备/回路身份应由 Device ID 和确认资料绑定，不按 Meter 序号猜测；冲突核实后再改业务映射。
- 本批在 Integration 分支验证，尚未合入 main 或部署生产。个人/公共 Skill、成员权限及自动化范围的后续实现仍按产品基线推进。
