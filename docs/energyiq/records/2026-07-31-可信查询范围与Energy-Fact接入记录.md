---
title: "2026-07-31 开发记录：可信查询范围与 Energy Fact 接入"
summary: "将两套样板数据统一为可审计 Energy Fact，并以受保护的确定性接口驱动 Project Explorer 的 Project、Centre、Circuit 下钻。"
doc_type: runlog
tags: [Energy Fact, EnergyQueryContext, DuckDB, Excel, SQL审计]
updated_at: "2026-07-31"
related:
  - "../decisions/当前共识与新会话入口.md"
  - "../plans/开发计划-Admin与模板运行闭环.md"
  - "../decisions/阶段技术选型-基于DataFoundry二次开发.md"
status: completed
---

# 2026-07-31 开发记录：可信查询范围与 Energy Fact 接入

## 1. 目标与范围

本轮解决四件事：

1. 将 Ngee Ann 的累计电表 Excel 转换为统一的原始读数、规范读数和 15 分钟用量事实；
2. 让 AI 查询范围不只存在于提示词，而是落实到 DuckDB 视图与 Data Gateway 表 allowlist；
3. 将 Preschool May 2026 的小时用量、营业日历和 270 个 Circuit 实例接入同一事实库；
4. 统一两个 Project 的 Explorer，实现 `Project → Centre → Circuit` 下钻和范围化 AI 入口。
5. 让 Explorer 的指标、小时曲线、子级比较、电表明细和规则提醒由同一确定性分析接口生成。

本轮没有接通 Overview 的 Charles 六模块，也没有持久化 Template Revision / Analysis Run。Explorer 已不再复用 Ngee Ann 的演示数值或跨 Project mock 热力图。

## 2. 数据链路

```text
Ngee Ann Excel cumulative readings
→ raw_meter_readings
→ normalized_meter_readings
→ adjacent reading difference per meter
→ energy_interval_facts
→ energy_daily_facts

Preschool Excel hourly interval usage
→ raw_interval_usage
→ operation schedule join
→ energy_interval_facts
→ energy_daily_facts
```

事实库存放于：

```text
storage/energy/default/energy.duckdb
```

核心表：

| 表或视图 | 作用 |
| --- | --- |
| `raw_meter_readings` | 保留原文件、原行号、原读数、校验结果与重叠冲突证据 |
| `normalized_meter_readings` | 映射 Project、Level、Meter Node、业务分类和总/分表角色 |
| `raw_interval_usage` | 保留 Preschool Centre、Circuit、小时列、营业状态、源行号和质量状态 |
| `energy_interval_facts` | 统一承载累计读数差分或源端区间用量，并记录 `source_reading_kind` |
| `energy_daily_facts` | 按新加坡本地日期、表和角色聚合的日事实 |
| `energy_import_batches` | Snapshot、源文件哈希、行数与质量统计 |

使用规则：

- `Active Energy` 是累计读数，不能直接求和；
- `usage_kwh = current_active_energy - previous_active_energy`；
- 首条边界读数只用于建立差分边界，不算消费；
- 负差值、缺口和不规则间隔保留为质量事件，不进入消费量；
- 总量只聚合 `meter_role='total'`；
- 分项分析只使用 `meter_role='submeter'`，总表和分表不得同时相加。
- 没有指定总表的 Preschool Centre 使用 `meter_role='component'`，9 个 Circuit 各求和一次；
- 指定总表与 component 不能混加；查询必须先判断当前 Scope 的计量角色；
- 时间范围按 `interval_start ∈ [from, to)` 归属，不能按 `interval_end` 过滤，否则会漏掉每天最后一个区间。

### Preschool 导入结果

| 指标 | 结果 |
| --- | ---: |
| Centre | 30 |
| 每个 Centre 的 Circuit | 9 |
| Circuit 实例 | 270 |
| 小时事实 | 200,880 |
| 缺失/负数/重复键 | 0 / 0 / 0 |
| May 2026 总用量 | 24,921.8123 kWh |
| 营业时段用量 | 21,818.0283 kWh |
| 非营业时段用量 | 3,103.7840 kWh（12.45%） |
| Snapshot | `preschool-26b85b9c0b95e090` |

层级版本为 `preschool-hierarchy-v3`，共 301 个节点：1 个 Project、30 个 Centre、270 个 Circuit。Circuit 业务分类简化为 `aircon / light / load`，同时保留 `Aircon / Heater / Lighting / Plugload` 的 appliance 维度。

## 3. 重叠文件冲突处理

四个 Excel 存在重叠日期。大部分重叠读数一致，但旧导出在 `2026-05-20 23:45` 的 16 个设备点重复了前一个时点的值，新导出包含继续增长的读数。

处理规则：

1. 原始层同时保留两条记录；
2. `is_overlap_conflict=true` 标记冲突证据；
3. 规范层选择覆盖结束时间更晚的导出；
4. Snapshot 由所有源文件内容哈希和规范行数生成。

本次导入结果：

| 指标 | 结果 |
| --- | ---: |
| 原始行 | 103,678 |
| 去重规范读数 | 100,223 |
| 有效区间事实 | 100,205 |
| 无效原始行 | 0 |
| 冲突原始行 | 32 |
| 质量为 `ok` 的区间 | 100,205 |
| 边界读数 | 18 |
| Snapshot | `ngee-ann-4bac1177eca62cdb` |

## 4. 可信查询边界

前端仍只提交：

```text
projectId / scopeId / resource / period / from / to
```

服务端执行：

```text
登录身份
→ Workspace / Project / Scope 权限校验
→ 新加坡时区范围解析
→ 找出 Scope 下的全部 Meter Node
→ 创建不可变签名的 energy_scope_<hash> 视图
→ 为本次用户注册只读 DuckDB Data Source
→ allowlist 只开放该视图
→ 强制 Agent Run 仅启用该 Data Source
→ Data Gateway 记录 SQL、行数、耗时和 run_id
```

受限视图同时过滤：

- `workspace_id`
- `project_id`
- `resource`
- `interval_start ∈ [from, to)` 时间范围
- 当前 Scope 的后代电表

模型生成的 SQL 即使尝试访问 `energy_interval_facts`，也会被 `TABLE_NOT_ALLOWED` 拒绝。Schema 检查同样只返回一个受限视图。

### 4.1 确定性分析执行接口

`POST /api/v1/energy/analysis/execute` 只接收现有 Energy Query Context 字段，不接收 SQL。服务端先完成权限和时间范围解析，再并行执行三条版本固定的查询：

| Query ID | 输出 |
| --- | --- |
| `scope_summary_v1` | 总耗、峰值、营业外用量、有效区间和质量事件 |
| `hourly_profile_v1` | 0–23 时的平均功率和观察峰值 |
| `meter_breakdown_v1` | 电表/Circuit 用量、营业外用量、峰值和质量 |

聚合规则按 Scope 内可用角色确定：优先 `total`，其次 `component`，最后 `submeter`，避免总分表重复计算。接口同时生成子层级横向比较、`kWh/m²`、`kWh/person` 和确定性提醒，并返回 Snapshot、Hierarchy、Meter Formula、Metric 与 Query 版本。

当前确定性提醒只包含：无有效数据、营业外用量占比、最高耗能子层级和同级面积归一化异常。它们是可复跑规则，不宣称设备故障原因。

## 5. 代码改动

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `scripts/energyiq/build_energy_fact_store.py` | 新增并扩展 | 两种 Excel Adapter、去重、差分、营业日历、质量规则与 Snapshot |
| `packages/data-gateway/src/energy-scoped-datasource.ts` | 新增 | 创建受限视图并注册 allowlist Data Source |
| `packages/data-gateway/src/duckdb-database-cache.ts` | 新增 | 复用 DuckDB Database，支持同进程连续查询 |
| `packages/data-gateway/src/adapters/local-sql-adapters.ts` | 修改 | 每次只关闭 Connection，不关闭路径级 Database |
| `apps/api/src/energy/energy-query-context.ts` | 修改 | 解析 Scope 后代 Meter Node |
| `apps/api/src/energy/energy-analysis.ts` | 新增 | 封装权限后 Scope 的固定查询、聚合、标准化指标、规则提醒和溯源 DTO |
| `apps/api/src/energy/energy-analysis.test.ts` | 新增 | 验证 30 Centre、270 Circuit、总量守恒和 Centre A 下钻 |
| `apps/api/src/energy/energy-api.ts` | 修改 | 增加受保护的确定性分析执行接口 |
| `apps/api/src/server.ts` | 修改 | Energy Agent Run 强制使用受限 Data Source |
| `apps/api/src/energy/energy-bootstrap.ts` | 修改 | Preschool 301 节点、完整 Ngee Ann Meter Node 与两个 Snapshot |
| `apps/web/src/app/energyiq/_components/project-explorer.tsx` | 修改 | 两个 Project 共用真实指标、小时曲线、规则、比较、Circuit 明细和溯源面板 |
| `apps/web/src/lib/config-api/client.ts`、`types.ts`、`index.ts` | 修改 | 增加分析执行客户端与稳定 DTO |
| `apps/web/src/app/energyiq/_components/energy-analysis-workbench.tsx` | 修改 | Preschool 默认使用 May 2026 已知数据窗口 |
| `packages/agent-runtime/src/tools/python-runtime.ts` | 修改 | Windows 与 Unix 均能解析项目 `.venv`、site-packages 和 PATH |
| `scripts/ensure-dev-environment.mjs` | 修改 | Windows 不再误报 `.venv` 缺失 |
| `requirements.txt` | 修改 | 增加 `openpyxl` 与 Python `duckdb` |

## 6. 验证证据

环境：

```powershell
uv venv .venv --seed
uv pip install -r requirements.txt --python .venv\Scripts\python.exe
```

构建事实库：

```powershell
.\.venv\Scripts\python.exe scripts\energyiq\build_energy_fact_store.py `
  --input-dir data\raw_excel `
  --preschool-input "D:\Projects\EnergyIQ\data\Preschool Analysis\ideal-brief\source-data\Preschool_Database_30centres_May2026.xlsx" `
  --output storage\energy\default\energy.duckdb
```

可信范围专项验证：

```powershell
node scripts\smoke-energy-trusted-scope.mjs
```

结果：

```text
Energy trusted scope smoke OK
allowed_rows=2
schema_tables=1
preschool_circuits=9
preschool_kwh=843.0985
```

该验证同时确认：

- Level 7 查询只返回两个总表汇总；
- 直接访问底表被拒绝；
- Schema 只暴露受限视图；
- 同一进程连续执行查询和 Schema 检查可用。
- Centre A 范围只包含自己的 9 个 Circuit、6,696 个小时区间和 843.0985 kWh；
- Project、Centre、Circuit 三层的 AI 跳转都携带服务端可校验的 Scope；
- Preschool 默认窗口解析为新加坡时间 `2026-05-01 00:00` 至 `2026-06-01 00:00`。

相关单元测试：

```powershell
npx vitest run `
  apps/api/src/energy/energy-analysis.test.ts `
  apps/api/src/energy/energy-query-context.test.ts
```

本次复验结果为 2 个测试文件、4 个测试全部通过；`@datafoundry/api` 与 `@datafoundry/web` 构建通过。

浏览器验收：

- Preschool Project：`24,921.81 kWh`、30 个 Centre、200,880 个有效区间、0 个质量事件；
- 30 个 Centre 均有非零事实，子级合计等于 Project 总量；
- Centre A：`843.1 kWh`、9 个 Circuit、6,696 个有效区间；
- Centre A / Aircon 1：`91.95 kWh`、744 个有效区间，AI 链接携带精确 Circuit Scope；
- Ngee Ann / Block Test：`5,328.21 kWh`，Level 6/7 使用相同查询与页面；
- 页面控制台无 error。

### 6.1 本轮发现并修复的边界

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 合法的 CTE 查询被 `TABLE_NOT_ALLOWED` 拒绝 | Data Gateway 的表名提取器会把 CTE 名当作表 | 固定查询改为等价的内联子查询，不放宽 allowlist |
| Project 总量正确，但 Centre I 以后错误显示 0 | `meter_breakdown_v1` 被默认 100 行上限截断 | 受控查询显式请求 1000 行；回归测试固定验证 270 Circuit 和 30 Centre 总量守恒 |
| API 从 `apps/api` 启动时找不到根目录事实库 | 相对路径随进程 cwd 漂移 | 默认路径相对模块定位仓库根目录，同时保留 `ENERGYIQ_DUCKDB_PATH` 覆盖 |

### 6.2 Overview 项目切换修复

现象：顶部 Project 已切到 Preschool，但 Overview 正文仍显示 Ngee Ann 的 Level 7、Block Test、4,020 kWh 和静态异常。

根因：Overview 只有页头读取 `activeProject`；指标、图表、排名、Benchmark、Standby、Operating Hours、Forecast 和 AI 链接均来自组件内的 Ngee Ann 常量。

处理：

- Project 或 period 改变时重新执行 `/api/v1/energy/analysis/execute`；
- 用 `decision-dashboard-model.ts` 将统一分析 DTO 转成 Charles 页面需要的模块 View Model；
- Preschool 使用 Project Scope 比较 30 个 Centre；Ngee Ann 使用 Block Test Scope 比较 Level 6/7；
- 请求返回前不再短暂展示上一 Project 的旧结果；
- AI Analyst 链接同步携带当前 Project、Scope 和时间范围；
- 移除 Ngee Ann 的静态电力洞察，未发布的自身历史基线和 Forecast 明确不伪造结论。

回归验证：

```powershell
npm --workspace @datafoundry/web test -- --run `
  src/app/energyiq/_components/decision-dashboard-model.test.ts
npm --workspace @datafoundry/web run build
```

浏览器双向切换结果：

- Preschool：`24,921.81 kWh`、Centre E 排名、Preschool Snapshot，无 Level 7 残留；
- Ngee Ann：`5,328.21 kWh`、Level 6/7 排名、Ngee Ann Snapshot，无 Centre E 残留；
- 新页面控制台 error 为 0。

Windows Python 运行时复验：

```text
D:\Projects\energyiq-datafoundry\.venv\Scripts\python.exe
python-data-runtime-ok 3.0.5 1.5.5 3.1.5
```

API 重启后不再出现 “Python venv missing” 警告。

## 7. 后续

1. 让 Overview 的 Charles 六模块调用同一确定性分析内核；
2. 增加“相对自身历史”的同比基线，当前同级面积异常只作为辅助证据；
3. 增加真实的 `层级 × 层级 × 时间` 查询后再恢复热力图，不混入 mock；
4. 将 Template Revision、Analysis Run 和业务日历/电价版本形成正式复跑记录；
5. Tuya Connector 输出与 Excel Adapter 相同的规范区间事实合同。
