---
title: "2026-08-01 开发记录：Admin Excel Import Batch"
summary: "记录真实 Excel 上传、检查、SHA 幂等、Mapping Draft、Raw/Normalized/Interval Fact 物化、重叠裁决与验收。"
doc_type: runlog
tags: [Admin, Excel, Import Batch, Meter Mapping, Data Quality]
updated_at: "2026-08-02"
related:
  - "../plans/开发计划-Admin与模板运行闭环.md"
  - "2026-08-01-Admin-Meter-Mapping与虚拟电表实施记录.md"
status: implemented
---

# 2026-08-01 开发记录：Admin Excel Import Batch

## 1. 目标与范围

正式 Admin 路径保持为 `Basics → Structure → Data & Meters → Analysis → Review & Publish`。管理员在 `Data Sources` 上传 Excel，系统保存原文件、检查数据契约、展示批次证据，把精确源标签带到 `Meter Mapping`；Mapping 确认后，再由管理员显式执行 `Build interval facts`。Mapping 只能选择 Structure 已存在的 Scope，不会反向创建层级。

本次已完成上传批次的 `Raw Reading → Normalized Reading → Interval Fact → Quality Event` 物化；不包含 Tuya API、Metric/Rule/Template 和正式发布。

## 2. 代码改动

- 新增 Project 级 Excel Import Batch API 与 metadata 持久化；
- 使用现有文件资产服务保存原始 `.xlsx`，记录 SHA-256；
- 同一 Project 重复上传相同 SHA 时复用已有 Import Batch；
- 检查固定字段 `Device Name`、`Time`、`Active Energy`；
- 记录总行数、有效行数、精确 source labels、覆盖区间、典型采样间隔、重复键、无效行与负累计读数；
- Admin `Data Sources` 显示最新批次及 `ready / needs_review` 状态；
- `Use detected labels` 生成可编辑 Mapping Draft，原始 label 不被改写；
- Ngee Ann 的位置前缀与冒号后回路说明仅用于可解释的匹配建议，最终仍由管理员确认；
- Mapping Draft 保存后可刷新复用，不再在没有 Import Batch 时伪造 fixture labels。
- Mapping 确认后可显式构建事实；未确认时按钮禁用并说明原因；
- 累计读数按实际经过时间差分，首条读数保留为 boundary 质量事件；
- Excel 浮点时间在距离整分钟 1 秒内时归一到整分钟，避免 `14:59.999` 破坏重叠判断；
- Raw 层保留重叠来源证据，Normalized/Interval Fact 对同一 Meter Point/时点选择覆盖结束时间更晚的来源；
- Meter Point ID 与 Scope ID 分开保存，实体表可挂任意 Tier；
- 分析 Scope 优先使用本 Scope 直接计量；没有直接计量时，每个子分支选择最近一层事实，避免总表与分表重复相加；
- Admin 显示 Raw、Normalized、Interval Fact 和 All-meter deltas，后者明确不是正式 Scope 总量。

| 文件 | 改动类型 | 说明 |
| --- | --- | --- |
| `apps/api/src/energy/energy-excel-import.ts` | 新增 | 解析并检查固定 Excel 契约 |
| `apps/api/src/energy/energy-api.ts` | 修改 | 增加 Import Batch 上传与列表 API |
| `packages/metadata/src/energyiq-store.ts` | 修改 | 持久化 Project 级 Import Batch 元数据 |
| `apps/web/src/app/energyiq/admin/project-setup-workbench.tsx` | 修改 | 连接 Data Sources、批次检查和 Mapping Draft |
| `apps/web/src/app/energyiq/admin/project-setup-model.ts` | 修改 | 以可解释规则建议既有 Scope，不创建层级 |
| `apps/api/src/energy/energy-import-materializer.ts` | 新增 | 由已确认 Mapping 生成规范读数、区间事实和质量事件 |
| `packages/data-gateway/src/energy-fact-writer.ts` | 新增 | DuckDB 事务写入、幂等重跑和跨文件重叠裁决 |
| `apps/api/src/energy/energy-analysis.ts` | 修改 | 按 Scope 距离选择正式聚合路径 |

主要提交：

- `861783b feat(energyiq): persist inspected Excel import batches`
- `5bd7908 feat(energyiq): connect Admin Excel import to mapping`
- `ad8ed80 fix(energyiq): match detailed meter labels to scopes`
- `edbceec feat(energyiq): materialize Excel batches into facts`
- `efc9002 fix(energyiq): preserve canonical facts across overlapping imports`
- `fb28e11 feat(energyiq): expose interval fact build in Admin`

## 3. 验证证据

### 3.1 真实浏览器验收

文件：`Ngee Ann Poly Level 6 (21 April - 20 May).xlsx`

| 检查项 | 结果 |
| --- | --- |
| 有效行 | 25,919 / 25,919 |
| Source labels | 9 |
| 典型间隔 | 15 min |
| 覆盖区间 | 2026-04-21 至 2026-05-21 |
| SHA 展示 | `e4d788af0135281c…` |
| 重复上传 | 复用已有 Import Batch |
| Mapping 建议 | 9 Mapped / 0 Needs Scope |
| Draft 持久化 | 保存、刷新后仍为 9 / 0 |
| Raw evidence | 25,919 |
| Canonical normalized readings | 24,192 |
| Canonical interval facts | 24,183 |
| Source all-meter deltas | 4,597.72855 kWh，仅作批次证据 |
| Ngee Ann Project golden | 5,328.2073 kWh |
| Level 6 / Level 7 | 2,013.9707 / 3,314.2365 kWh |
| Preschool golden | 24,921.8123 kWh |

### 3.2 自动化证据

~~~text
npx vitest run apps/api/src/energy/energy-excel-import.test.ts \
  packages/metadata/src/energyiq-store.test.ts \
  apps/web/src/app/energyiq/admin/project-setup-model.test.ts
~~~

最终相关回归：7 个测试文件、22 项测试通过，包括 Excel 时间归一、重叠来源优先级、幂等写入、Scope 聚合、Ngee Ann 与 Preschool golden。

~~~text
npm run build
~~~

结果：根 TypeScript project build 通过。

## 4. 问题与取舍

- 现象：带说明后缀的标签（如 `Lvl 6 Office Load 1: L1P1-L3P6`）最初无法匹配 `Office Load 1`。
- 根因：建议逻辑只允许完整名称相等，没有区分稳定业务名和冒号后的回路说明。
- 处理：精确名称优先；没有精确项时，使用冒号前业务名做同位置内的唯一前缀匹配。原始 label 保持不变，管理员仍需最终确认，没有引入自动建树或 LLM 猜测。
- 现象：首次将真实批次写入已有 Golden Store 后，Level 6 比基线少 `0.1831 kWh`。
- 根因：5 月 20 日重叠边界存在两份导出；较早文件被错误允许覆盖覆盖期更长的后续文件，而且 Excel 浮点时间出现 `14:59.999`，使等时点去重失效。
- 处理：Raw 保留双方；Normalized/Fact 按来源覆盖结束时间裁决；整分钟附近时间先归一。修复后 golden 精确恢复。

## 5. 复现与排查

前置条件：本地 API/Web 服务已启动，访问 `http://127.0.0.1:3001/energyiq/admin?section=data-sources`，Project 选择 Ngee Ann Polytechnic。

1. 上传 `data/raw_excel/Ngee Ann Poly Level 6 (21 April - 20 May).xlsx`；
2. 核对批次行数、标签数、15 分钟间隔和 SHA；
3. 重复上传并确认复用已有 Import Batch；
4. 点击 `Use detected labels` 与 `Open Meter Mapping`；
5. 确认 9 Mapped / 0 Needs Scope，保存 Draft 后刷新复查。

## 6. 后续与关联

Excel 事实闭环已通过。下一步进入批次 3：Metric Definition、确定性 Rule、Component Catalog 与 Project/Tier Template。Tuya API 后续只新增 Source Adapter，并复用相同事实管线。

当前保留两个明确优化项：

1. 25,919 行完整物化本机约 56 秒，一天一次试点可用，但批量写入与 Mapping 更新仍需优化；
2. Admin 需要继续补充更直观的 Quality Summary 与失败重试信息，避免只显示数量。

## 7. 2026-08-02 Ngee Ann 管理员闭环复验

使用真实 Admin 账号和正式页面，从 `Data Sources` 重新走通一份 Level 6 Excel 的检查、Mapping、虚拟表、事实构建、校验与 FM 视角查询。

### 复验结果

| 检查项 | 结果 |
| --- | --- |
| Workbook | `Ngee Ann Poly Level 6 (19 May - 17 June).xlsx` |
| 有效行 | 25,919 / 25,919 |
| Source labels | 9 |
| 典型间隔 | 15 min |
| 覆盖区间 | 2026-05-19 至 2026-06-18 |
| Mapping | 9 个标签、0 个缺失 Scope，已确认并保存到共享 Project Draft |
| Virtual Meter | `Load 12 = Office Load 1 + Office Load 2`，挂在 Level 6，独立展示且不参与官方汇总 |
| Raw readings | 25,919 |
| Interval facts | 25,910 |
| All-meter deltas | 4,002.133 kWh，仅作为本批次证据 |
| Draft validation | 通过 |
| FM Level 6 | 2,013.97 kWh，5,758 valid / 0 flagged |
| AI Context | 正确携带 Project、Level 6、Custom period 和日期边界 |

### 本次发现并修复

1. **跨 Admin 页面会清空未保存 Mapping**：Project setup loader 错把 `section` 当作加载依赖，每次从 Data Sources 跳到 Meter Mapping 都会用后端旧 Draft 覆盖本地编辑。现已改为只在 `projectId` 变化时加载，并增加回归测试。
2. **Project Overview 阶段状态写死**：即使 Mapping 已确认、Facts 已生成，仍显示 `Data & Meters: Not configured`。现已按 Import Batch、Mapping 和 materialization 的真实状态派生，复验显示 `Facts ready` 和 `Analysis: Ready to configure`。

对应提交：`2cd2530 fix(energyiq): keep admin delivery state in sync`。

### 当前边界

- 本轮遵循“一次只验证一个 Excel”的约定，因此新 Import Batch 只覆盖 Level 6；不是完整 Ngee Ann 双楼层重新发布。
- Draft Mapping 和 `Load 12` 尚未进入不可变 Published Snapshot；客户页面当前消费已物化 facts 和既有 published hierarchy。
- Stage 5 `Review & Publish` 尚未实现，不能把 Draft 已通过校验表述为已正式发布。

## 8. 2026-08-02 Metric Registry 第一阶段

在现有 `Templates` Admin 子页中加入 Analysis configuration，不新增侧栏入口。当前仅允许管理员选择项目可用指标，不提供自由 SQL 或公式编辑器。

### 已实现

- 新增 9 个稳定的内置 Metric Revision：总耗电、日均耗电、峰值、非营业时段耗电/占比、每平方米、人均、有效区间数与质量事件数；
- Metric Revision 固定 `metric_id`、版本、单位、依赖条件与现有分析结果的 `calculation_key`；
- Project Metric Config 只保存启用的 revision IDs，并用 `expected_revision` 防止并发覆盖；
- 面积和人数缺失时明确标记依赖，不用 mock 值伪装可计算；
- 新增 `averageDailyUsageKwh`，按所选日期范围实际包含的日历日计算；
- Ngee Ann 与 Preschool 的指标选择按 Project 隔离。

### 验证证据

| 检查项 | 结果 |
| --- | --- |
| Metadata 测试 | 6/6 通过，覆盖目录种子、默认选择、保存、revision 冲突与非法指标 |
| Energy golden tests | 2/2 通过，Preschool 与 Ngee Ann 总量不变并新增日均断言 |
| Metadata typecheck | 通过 |
| API build | 通过 |
| Web 变更文件类型检查 | 无新增错误；全库仍有既有 DataTasks 测试类型错误 |
| 浏览器目录加载 | Ngee Ann 9/9 指标加载成功 |
| 保存与复载 | 关闭一项保存为 revision 1，刷新后保持 8/9 |
| 恢复默认 | 恢复为 9/9，保存为 revision 2 |
| Project 隔离 | 切换 Preschool 显示独立 revision 0，返回 Ngee Ann 保持 revision 2 |

### 当前边界

- Rules、Component Catalog、Project/Tier Template 布局和 Preview 尚未实现；
- 历史基线、同级排名、热力图、Bell curve 与四象限属于后续比较/组件能力，不在本次 9 个标量指标中；
- 新配置仍是 Draft 能力，尚未进入不可变 Published Snapshot 或 Analysis Run；

### 同步修复的连接问题

Ngee Ann golden 测试曾稳定报 `Connection was never established or has been closed already`。根因是 DuckDB Database 构造为异步建立连接，但缓存立即返回未 ready 的 handle。缓存现改为保存并等待 opening Promise；失败时删除缓存项，允许后续重试。原始双 Project golden 测试随后 2/2 通过。
