---
title: "Preschool 连续数据 A-B 实施记录"
summary: "记录 June 模拟源数据的生成边界、确定性场景、不变量、产物与正式发布链路剩余项。"
doc_type: implementation
tags: [Preschool, A/B, Excel, Snapshot, Overview]
updated_at: "2026-08-10"
related:
  - "../plans/2026-08-10-Overview夜间执行路线与Runlog.md"
  - "../decisions/2026-08-06-Charles系统价值复核与连续数据演示决策.md"
status: done-engineering
---

# Preschool 连续数据 A-B 实施记录

## 1. 范围与完成定义

本切片只生成一份可版本化、可复现的 June 1–30 模拟 Source Excel，以及 Day 1、Day 7、Day 30 三个稳定切片和 manifest。它不修改共享 Metadata/DuckDB，不执行 Import、materialization、Publish，不触碰 Overview、AI Slot 或 UI。

生成结果必须能作为正式导入链路的输入，而不是前端或分析代码可读取的“答案”。场景说明只保存在离线 manifest，正式产品输入只有累计读数。

## 2. 旧 WIP 保护

现有 `.scratch/t39-spreadsheet/` 与 `outputs/t39-preschool-ab/` 是早期 7 天 WIP，均只读保留，不覆盖、不删除、不改名。

审计锚点：

- 旧 builder：`build-june-increment.mjs`，SHA-256 `A0A31A13E120788D2E5DAD22F10A902C9DBDBE5AC137B7161EB59AE5F08CB849`；
- 旧 7 天累计表：`Preschool_Incremental_Update_June_2026_v2.cumulative.xlsx`，SHA-256 `82B1CDD142ABE4BE899BB23EB8C5CBA8485606F2BD17C26B082B0CCBC6119611`；
- 旧另一份 7 天表：`Preschool_Database_30centres_2026-06-01_to_2026-06-07.incremental-cumulative.xlsx`，SHA-256 `81E9AC7DD5D283F17336D034B771500C4EB0027616E1F478D7DA415E62838CA9`。

新产物写入独立目录 `outputs/t39-preschool-continuous-ab-20260810/`，工作文件写入独立目录 `.scratch/t39-preschool-continuous-ab-20260810/`。

## 3. 输入与生成算法

### 3.1 输入

- May 原始宽表：`.scratch/Preschool_Database_30centres_May2026.xlsx`，从 `Energy Consumption` 读取 270 条 Meter series 的小时用量；
- May 正式累计表：`.scratch/Preschool_Database_30centres_May2026.normalized-cumulative.xlsx`，用于取得每条 series 在 `2026-06-01 00:00` 的累计终值，确保 June 与 May 连续衔接；
- manifest 同时记录两份输入的 SHA-256。

### 3.2 基线

不使用 `Math.random`，不对累计行直接扰动。先取得 interval delta：

1. June 1–28 分别映射到 May 4–31，保持星期结构；
2. June 29–30 重复该 28 天基线周期的第 1–2 天；
3. 对 interval delta 应用下面三个确定性场景；
4. 每条 Meter 从 May terminal cumulative 开始逐小时重新累加。

### 3.3 确定性场景

1. **长窗改善**：Jun 3–23 的工作日 08:00–18:00，所有 Centre 的 `Aircon 1` 使用量乘以 `0.90`；
2. **最近 7 天内的持续 standby**：Jun 24–29，Centre L 的 `Other Lighting3` 在 00:00–06:00 使用 `base + 1.2 kWh`。这里是 6 个自然日，位于 latest-complete-7d 窗口内；不把它误称为 7 个完整自然日；
3. **最新 1 天 spike**：Jun 30，Centre G 的 `Kitchen Plug Load` 在 09:00–17:00 使用 `max(base × 2.5, 0.35 kWh)`。

这些场景不规定 Overview 或 AI 必须得出哪句话；它们只提供可通过正常 SQL 重新发现的可解释变化。

## 4. 时间窗口校正

完整 Source 覆盖 June 1–30，覆盖终点为 `2026-07-01 00:00`。发布检查点为 Day 1、Day 7、Day 30，但产品验收窗口不改成全局 30 天：

- latest-complete-day；
- latest-complete-7d；
- current-overview-28d。

Day 30 只代表数据发布检查点；Overview 长窗仍是 28 天。

## 5. 预期规模与不变量

- 270 Meter series；
- 194,400 hourly intervals（270 × 30 × 24）；
- 194,670 cumulative readings（每条 series 含 1 个 June 起始边界）；
- coverage `2026-06-01 00:00` 至 `2026-07-01 00:00`；
- Day 1：6,750 readings；Day 7：45,630 readings；Day 30：194,670 readings；
- 累计单调、interval delta 非负；
- `(Device Name, Time)` 唯一；
- 边界重复 270 可接受，但与 May terminal value 必须相同，冲突为 0；
- gap / orphan / unmapped 为 0；
- 同 generator revision、输入 SHA 与 seed/config 必须生成相同 canonical content hash；Excel 文件 SHA 也应稳定，否则停止并记录包装层非确定性，不能用不稳定文件冒充可复现输入。

## 6. Manifest

Manifest 至少包含：

- generator revision；
- seed（本版虽无随机噪声，仍固定记录为协议字段）；
- 输入文件名和 SHA；
- 每个 staged 输出的文件 SHA、canonical content SHA、coverage、行数、series/interval/readings 数；
- 28 天映射规则；
- 三个场景的日期、Centre、Meter、时段和变换参数；
- 不变量检查结果。

## 7. 潜在问题与反证

1. **Jun 24–29 只有 6 天**：它仍覆盖 latest 7d 窗口的大部分日期，但不能在 manifest 中写成 7 个自然日。若产品验收必须要求连续 7 个自然日，应另行明确将规则扩到 Jun 30，不能暗改场景。
2. **28 天循环不是天气/节假日预测**：它只用于证明连续数据刷新，不得作为真实 Forecast 或客户基线。
3. **场景可被分析发现，不保证固定文案**：A/B 验收应检查指标、Evidence 与 Snapshot 是否更新，而不是要求 LLM 逐字复述场景标签。
4. **Excel 文件哈希可能受包装元数据影响**：必须实际双跑验证；若文件 SHA 不稳定，先定位导出器，而不是只宣称行内容相同。
5. **时间语义**：输出采用 UTC 文本，与当前正式累计导入格式一致。发布阶段仍必须复核 Project timezone 为 Asia/Singapore，不能在生成器里替代正式转换逻辑。

## 8. 验收与停止条件

### 本切片验收

- generator 自动测试覆盖三种场景和所有数据不变量；
- 双跑 canonical hash 与 Excel SHA 一致；
- 用 `@oai/artifact-tool` 导入最终 Excel，inspect 头/尾关键范围、扫描公式错误，并渲染至少一轮视觉预览；
- manifest 与实际文件哈希、行数和 coverage 一致。

### 停止条件

- 必须修改 SQLite/DuckDB 才能让 generator 成功；
- 负 delta、重复键、累计回退、缺失 series 或 May/June 边界冲突；
- 需要把场景标签暴露给 Overview/AI 才能“发现”变化；
- 需要覆盖旧 WIP 或共享输出；
- 需要把 28 天基线包装成正式预测。

## 9. Runlog

| 时间 | 状态 | 证据 / 决定 / 下一步 |
| --- | --- | --- |
| 2026-08-10 03:05 SGT | READY | 已冻结旧 WIP 哈希；取消普遍随机噪声，采用 28 天同星期基线和三个确定性场景；下一步实现 generator 与 invariant tests。 |
| 2026-08-10 03:25 SGT | FIXED | 首次 270-series 运行发现审查输入使用 `Aircon1`，真实 Source label 是 `Aircon 1`，导致改善场景命中 0。已改为真实 label，并增加场景精确命中数守卫；没有静默接受空场景。 |
| 2026-08-10 04:05 SGT | DONE-ENGINEERING | Day 1/7/30 三份累计 Excel、manifest、核心测试、artifact-tool inspect/render 与二次 canonical hash 验证完成。未执行 Import/materialization/Publish。 |
| 2026-08-10 04:50 SGT | RECALIBRATED | 独立复核发现业务场景原按 UTC hour 判断。已改为按 `Asia/Singapore` local day/hour/weekday 判断，新增跨 UTC 日界单测，重新生成三个文件和 manifest；5/5 tests、artifact-tool final import/inspect/render 和二次 canonical hash 全部通过。 |

## 10. 实际生成结果

### 10.1 产物

目录：`outputs/t39-preschool-continuous-ab-20260810/`

| Stage | File SHA-256（本次冻结文件） | Canonical content SHA-256 | Readings | Intervals | Coverage to |
| --- | --- | --- | ---: | ---: | --- |
| Day 1 | `e015a06ebd047abb37fd792f0854db59451ea070736ea29adbd379b076a4da42` | `432cd2bde71fead430146e8d117c257be850ad34c624ded51d09af9d21da364c` | 6,750 | 6,480 | `2026-06-02T00:00:00.000Z` |
| Day 7 | `9b9d7578b21c6e9826cbebd1d5725af428df69e3a6e840c0d236a719b4bf3be7` | `4263238f49987178b0236deecf182d41c49fe334f405136d94b821ec65ee1c8c` | 45,630 | 45,360 | `2026-06-08T00:00:00.000Z` |
| Day 30 | `c50183898a00ea7dc76660960e496af58ef8434ab8e1d0ad1e9b1dfe4a50c199` | `94756f4d7271c9edd1fd9b1f5f7587a9992c0888bf96f749c8e9c2b2c78cf26f` | 194,670 | 194,400 | `2026-07-01T00:00:00.000Z` |

Manifest SHA-256：`c705409857436d2c7480f3877cd656d2bd1357506ad4585db0ac2260e834f2f7`。Manifest 明确记录 `projectTimezone: Asia/Singapore`。

三阶段均为 270 series，June 文件内部重复键、累计回退、负 delta、gap、boundary conflict、orphan、unmapped 全为 0。与 May 连接时每阶段有 270 条预期边界重复，值冲突为 0。

### 10.2 场景证据

| Scenario | Matched intervals | Changed intervals | Net delta |
| --- | ---: | ---: | ---: |
| Portfolio `Aircon 1` weekday improvement | 4,500 | 4,500 | -54.462000 kWh |
| Centre L closed-hour lighting rise | 36 | 36 | +43.200000 kWh |
| Centre G latest-day kitchen spike | 8 | 8 | +3.796500 kWh |

Generator 源码不包含 `Math.random`、`randomBytes` 或 `randomInt`。场景只存在于生成器与离线 manifest，输出 Excel 只有 `Device Name / Time / Active Energy`。

### 10.3 验证证据

- `node --test scripts/energyiq/preschool-june-ab-generator.test.mjs`：5/5 pass，包含 UTC ↔ Asia/Singapore 跨日边界；
- artifact-tool 导入最终文件后的 used range：Day 1 `A1:C6751`、Day 7 `A1:C45631`、Day 30 `A1:C194671`；
- 三个工作簿的头/尾 inspect 均通过，公式错误扫描均为 0；
- 三个工作簿均完成 PNG render 并人工检查：列宽、时间和值均无裁切；
- 二次独立生成的三个 canonical content SHA 与首次完全相同。

### 10.4 XLSX 包装层非确定性

二次生成的 Excel 二进制 SHA 不同，但 canonical content SHA 完全一致。逐 ZIP entry 比较确认 `sheet1.xml`、`styles.xml`、`sharedStrings.xml` 内容一致；变化来自 artifact-tool 新生成的 workbook/relation IDs 和 ZIP 时间元数据。

因此本次 MVP 的可复现边界是：

1. 冻结并复用上述三份实际 Excel，其文件 SHA 由 manifest 记录；
2. 用 canonical content SHA 验证逻辑数据可复现；
3. 不把“重新导出后的 XLSX 文件 SHA”当作稳定幂等键；
4. 暂不为测试 fixture 建设确定性 XLSX 打包器。

## 11. 本切片未完成的正式链路

以下项目明确留给主 Agent 的隔离发布切片，不属于 generator 完成状态：

1. 在隔离 Metadata、file storage、DuckDB 与端口中，将 Day 1 / Day 7 / Day 30 依次走正式 Register → Mapping → materialization → Publish；
2. 核对 latest-complete-day / latest-complete-7d / current-overview-28d，而不是把 Overview 改成全局 30 天；
3. 证明 Current 指标和 Section 5 更新、Saved A 不变、Snapshot/Evidence 不混；
4. 每个 Published Snapshot 预生成并恢复同 identity 的 AI Artifact；
5. 记录 materialization、Overview resolve 和 AI time-to-available；
6. 场景已经按 `Asia/Singapore` local parts 生成，但发布后仍必须用真实页面复核 Calendar 与 closed-hour 归属，不能只用 generator 单测代替产品验收。

## 12. Timezone 校准（2026-08-10）

### 12.1 发现的问题

第一次生成器在 `applyScenarios` 中直接用 UTC 的 `juneDay / hour / weekday` 判断场景。Project 的正式 timezone 是 `Asia/Singapore`（UTC+8），因此：

- 原 `00:00–06:00 UTC` 会落到本地 `08:00–14:00`，不能形成 intended closed-hour signal；
- 原 `09:00–17:00 UTC` 会落到本地 `17:00–次日 01:00`，与 intended daytime spike 不一致；
- 工作日与日期边界附近也可能被分到错误的本地日。

这不是展示层问题，而是模拟 Source 的业务场景时间语义错误。上节列出的首次文件 SHA、canonical SHA 与场景 delta 作为历史证据保留，但标记为 **superseded，不得进入正式 A/B 发布验收**。

### 12.2 最小修复

1. 输出累计 reading 仍采用当前正式输入合同的 UTC 文本；
2. 每个 interval 先确定 UTC interval-start；
3. 仅在场景判断处将其转换为 `Asia/Singapore` 的 local year/month/day/hour/weekday；
4. 三个场景的日期、时段和 weekday 全部按 local parts 判断；
5. 28 天基线仍按 UTC interval 固定平移/循环，不改变 Day 1/7/30 coverage，也不改变 latest-complete-day / latest-complete-7d / current-overview-28d；
6. 单测必须覆盖跨日边界，例如 `2026-06-23 16:00 UTC = 2026-06-24 00:00 Asia/Singapore`。

### 12.3 修复验收

- local Jun 3 08:00 的 `Aircon 1` 命中，local 07:00 不命中；
- local Jun 24 00:00 的 Centre L `Other Lighting3` 命中，local Jun 23 23:00 不命中；
- local Jun 30 09:00 的 Centre G `Kitchen Plug Load` 命中，local 08:00 不命中；
- 场景命中数仍为 4,500 / 36 / 8；
- 重新生成三个文件和 manifest，旧 hash 标记 superseded，新 hash 才是可发布候选；
- 重跑 invariant tests、artifact-tool final import/inspect 和 canonical 双跑。

### 12.4 校准结果

以上项目均通过。Day 1 canonical hash 因前三天尚未触发场景而保持不变；Day 7 与 Day 30 canonical hash 已改变，证明 timezone 修复确实影响了业务区间，而不是只改 manifest。场景命中数保持 4,500 / 36 / 8，净变化更新为 -54.462 / +43.2 / +3.7965 kWh。

## 13. 隔离正式 API A/B 验收 Runner（执行前方案）

### 13.1 目标与边界

本切片在独立目录和 `127.0.0.1:8788` 启动一次性 API，不读取或写入共享 `8787/3102` 的 Metadata、DuckDB、File Assets 或 Mastra storage。它不直接写 SQLite/DuckDB；Project Setup、Operational Policy、Excel Register、Source Manifest、materialization、Overview、Saved Analysis 和 AI Artifact identity 全部经正式 HTTP Energy API 完成。

隔离 A 不采用对在线 SQLite/WAL 的裸文件复制。Runner 从 tracked Preschool bootstrap publication 出发，以冻结 May cumulative Excel 走一次正式 Register → Source Manifest → materialize，重建与当前 May Golden 一致的 A；随后保存 A，再依次追加 Day 1、Day 7、Day 30。这样避免 1.7 GB 在线 Metadata 非原子复制，也能证明业务路径本身可复现 A。

纯数据 B 只扩展 Source Manifest 并 materialize：Meter Mapping、Hierarchy、Template、Metric/Rule config 和已发布 Operational Policy 均保持原 revision；不得为 Day 1/7/30 再调用 Project Publish。

### 13.2 执行顺序

1. 创建明确位于 `.scratch/t39-preschool-continuous-ab-acceptance/` 下的全新 run 目录；若目标已存在则停止，不覆盖历史证据。
2. 以 dev auth、Preschool Workspace、隔离 Metadata/File/DuckDB/Mastra/Workspace roots 启动 `8788` API；等待 `/healthz` 与 `/ready`。
3. 经 API 发布 A 所需的 project-level Tariff 与 Calendar；这是隔离基线初始化，不在 B 阶段重复。Calendar 使用已确认的 Mon–Fri 07:00–19:00、weekend closed、May 1/27 closure；Tariff 使用当前 Preschool Demo 的 S$0.2727/kWh reference。
4. 上传 May cumulative Excel，GET Setup 后仅追加 confirmed Source Manifest，经 materialize 形成 A；读取 1d/7d/28d Overview，核对 May Golden、Project/Release/Snapshot/Evidence pins。
5. 经 Saved Analysis API 固化 A，并保存其响应正文 bytes、Snapshot id、Release identity 与 Evidence ids。
6. 对 Day 1/7/30：上传 Excel；GET 当前 Setup；保持 Mapping/Nodes/Tiers 不变，仅把新 SHA 追加到 Source Manifest；PUT Draft；materialize；分别读取 1d/7d/28d Overview；GET Saved A；GET AI Artifact identity。
7. 每阶段证明：Current Snapshot 前进；Release/Mapping 等配置 identity 不变；所有 Current Evidence 只 pin 当前 Snapshot；Saved A 响应 bytes 和内部 Snapshot/Evidence 仍为 A；AI Artifact 为当前 Snapshot/Release identity。Artifact 只要求 `missing/queued` 或同 identity 记录，不调用 ensure/retry，不把 mock Provider 当真实验收。
8. 输出 machine-readable `acceptance-report.json`，记录阶段耗时、窗口、KPI、Snapshot/Release/Evidence/Artifact identity 和不变量结果；无论成功失败都只终止自己启动的 API PID。

### 13.3 潜在问题与默认处理

1. **Bootstrap 与当前 A revision 不同**：允许隔离 A 的随机 revision/id 不同，但 May Golden、Renderer、Recipe、Mapping 语义和同一次 run 内的 Release identity 必须一致；不得声称复用了共享 A 的字节级 Metadata 快照。
2. **May boundary 与 June boundary 重复**：Manifest 包含 May + 当前 June stage，materializer 应按正式去重规则接受 270 条同值边界；若出现冲突、负 delta、unmapped/orphan 或缺口，立即停止。
3. **Day 7/30 包含早期 June stage 的子集**：Manifest 每次只保留 May + 最新累计 stage，不同时保留 Day 1/Day 7/Day 30，避免同一 June interval 被三份嵌套文件重复导入。
4. **Artifact 未排队**：clean DB 若没有真实系统 Model Profile binding，`GET overview-ai-artifact` 可能返回 Profile 配置错误而不是 `missing/queued`。Runner 记录为 AI identity blocker，但不得创建 mock Profile、调用 Provider 或把 deterministic A/B 判为失败；若授权的 env 能建立 binding，则验证 identity。
5. **运行耗时**：Day 30 materialization 可能耗时数分钟。每个 HTTP 请求设置独立 15 分钟上限并记录 duration；不提高产品 Runtime/Provider timeout。
6. **源码并行变化**：Runner 使用当前 Integration 源码启动一次性 API；执行报告必须记录当前 Git SHA 和 dirty 状态摘要，不能把它冒充 committed baseline。

### 13.4 停止条件

- `8788` 已被非本 Runner 进程占用，或任一解析后的 storage path 不在本次 `.scratch` run 目录内；
- 需要停止/重启/调用共享 `8787/3102`，或需要读取共享 SQLite/DuckDB 才能继续；
- 需要直接修改 SQLite/DuckDB、复制计算公式、跳过 Mapping/Manifest/authorization 守卫；
- A 不能通过正式 May import 重建到 `24,921.8123 kWh / 30 Centres / 270 Circuits / 100% coverage`；
- B 导致 Saved A bytes 改变、配置 Release identity 漂移、Current/Saved Evidence 混用；
- 只有 mock Provider 才能让 Artifact 看似成功。

### 13.5 状态

| 时间 | 状态 | 证据 / 决定 / 下一步 |
| --- | --- | --- |
| 2026-08-10 03:05 SGT | READY | 已完成正式 HTTP 路由、隔离环境和 A 重建方式预检；选择 clean bootstrap + 正式 May import，避免复制在线 SQLite/WAL。下一步实现 runner、纯函数测试和一次完整 isolated run。 |
| 2026-08-10 03:11 SGT | BLOCKED-TRANSPORT | 首次完整 run 在 isolated API ready 后约 307 秒于 May materialize 客户端侧 `fetch failed`。期间 API CPU 持续活跃且 log 无业务异常；时长精确吻合 Node/Undici 默认 300 秒 response-header timeout。Runner 的 15 分钟 AbortSignal 不会覆盖该默认 headers timeout，finally 随后才终止自有 API，因此没有 API OOM/崩溃证据。失败目录保留，不复用。 |
| 2026-08-10 03:15 SGT | READY-RETRY | Runner 为每个 HTTP 请求与当前 phase 持久化 method/path/start/end/status/duration/error cause；使用仓库已有 Undici dispatcher 将 acceptance transport 的 headers/body timeout 显式设为 15 分钟。这不修改 API 业务 timeout 或 AI Provider timeout。另增加 Section 2 Benchmark、Section 3 Appliances、Section 3/4 Operational、Section 5 Planning target/actual-vs-plan 状态与产品 blocker；5/5 runner tests passed。允许只重跑一次。 |
| 2026-08-10 04:00 SGT | BLOCKED-PERFORMANCE | 允许的重跑已结束。May A 用 9m04s 完成；Day 1 用 8m53s；Day 7 用 10m07s；Day 30 在 15m00s 达到单请求上限后由 runner 中止。不继续提高 timeout，不做第三次盲跑。隔离 API 已释放 `8788`。 |

### 13.6 真实运行结果（run `2026-08-09T19-15-36-500Z`）

| 阶段 | Snapshot | Current 28d | Saved A | Release / Mapping | 产品结果 |
| --- | --- | --- | --- | --- | --- |
| May A | `energy-snapshot-52ca9611e48b0d71c2efe7b7` | `24,921.8123 kWh`，30 Centres，270 Circuits，100% coverage | 创建并冻结 | 建立基线 | Section 2/3/4 available；Section 5 actual-vs-plan 未实现 |
| Day 1 | `energy-snapshot-40825be182eb788b4a2ae05c` | `24,491.0393 kWh`，5 May–2 Jun，100% coverage | response SHA-256 与 Snapshot 字节级不变 | `preschool-demo-template-v1` 与 Mapping 不变 | 28d 数字已更新；1d 误锦定 wall clock；Operational/Planning fail closed |
| Day 7 | `energy-snapshot-f8c44ac53cc83aac0a9f35e3` | `24,480.2501 kWh`，11 May–8 Jun，100% coverage | response SHA-256 与 Snapshot 字节级不变 | 同上 | 7d/28d 窗口已随数据前进；Operational/Planning fail closed |
| Day 30 | 未产生 | 未 resolve | A 没有被修改 | 无漂移证据（materialize 未返回） | full-history materialization 超过 15 分钟，阻塞 30d 产品验收 |

实验证明的边界是：

1. Day 1 / Day 7 的正式数据更新链、Current Snapshot/Evidence 切换、Saved A 不变已通过；
2. 不能宣称 Day 1/7/30 完整产品链通过：1d cutoff、动态 Operational/Planning、Section 5 actual-vs-plan 和 Day 30 性能仍是阻塞；
3. AI Artifact 每阶段都因隔离 Workspace 没有统一 Model Profile，以 `WORKSPACE_DEFAULT_MODEL_PROFILE_NOT_CONFIGURED` 被阻塞。验收未注入 mock Provider，因此没有伪造 AI 成功。

### 13.7 materialization 性能复核与最小下一步

从数量与耗时看，不是 Day 1 本身需要约 9 分钟，而是 manifest 一变就会重做完整 May + 当前 June 累计文件：

| 阶段 | 组合 canonical intervals | materialize 耗时 |
| --- | ---: | ---: |
| May A | 200,880 | 9m04s |
| May + Day 1 | 207,360 | 8m53s |
| May + Day 7 | 246,240 | 10m07s |
| May + Day 30 | 预期 395,280 | >15m，未完成 |

代码证据指向四个叠加热点：

1. `materializeEnergyProjectManifest` 在 manifest 变化时对所有 active batches 重新 `buildEnergyExcelMaterialization`，已 materialized 的 May 也被重新读取和解析；
2. `buildEnergyExcelMaterialization` 为大量行重复创建 `Intl.DateTimeFormat`，且 `readingsByMeter.set(id, [...old, reading])` 会在每条 reading 上拷贝已有数组；
3. Fact Writer 会删除并重插所有 manifest batches，对每个 Source Label 执行多次 historical mapping `UPDATE`；
4. canonical publish 再对整个 Project 做复制、dedup window sort、cumulative `LAG/median`、quality rebuild、逐行 JSON SHA-256 integrity 和 checkpoint。

最小下一步不是立即建设通用增量平台，而是：

1. 在隔离 benchmark 里分别记录 Excel parse/normalize、source write、canonical rebuild、integrity/checkpoint 时间，确认占比；
2. 先做两个不改业务语义的窄修复：按 timezone 复用 formatter，以 `push` 替代每行 array spread；用现有 Golden 证明输出完全不变；
3. 重跑一次 Day 30；若仍不能在 15 分钟内完成，再仅对“未变 Source 不重解析/重插”设计最小增量切片，保留完整 canonical integrity 校验。

### 13.8 最小性能切片执行记录

| 时间 | 状态 | 方案 / 证据边界 |
| --- | --- | --- |
| 2026-08-10 04:05 SGT | IN PROGRESS | 先给 materializer/fact writer 增加 `parse/normalize`、`source write`、`canonical rebuild`、`integrity/checkpoint` 分段计时；再只修改 formatter cache 和 `readingsByMeter.push`。验收用现有 materializer/fact-writer tests 与 May Golden，不跑完整 A/B，不改 timeout，不建增量架构。 |
| 2026-08-10 04:12 SGT | IMPLEMENTED | Materialize HTTP 成功响应现在返回当次 `materializationTimings`，不写入 Snapshot/summary；formatter 按 timezone 复用，Meter 分组改为 `push`。Data Gateway/API TypeScript build 通过；3 个定向文件 26/26 tests 通过；Preschool May Golden 1/1 通过；A/B runner 5/5 tests 通过；`git diff --check` 通过。按边界没有重跑完整 A/B/Day 30，因此尚未宣称 15 分钟阻塞已解决。 |
| 2026-08-10 05:27 SGT | REVIEWED | 主 Agent 发现初版 `integrity/checkpoint` 没有覆盖 materialization stats 和 Project audit，会低报验证阶段耗时。现已把计时边界校正为：source rows write；canonical rebuild + fact-state write；stats/audit + commit/checkpoint。13 个合并回归文件 174/174 通过，权威数据输出与 Golden 未改变。 |

潜在问题与处理：

1. 计时字段不能进入 Snapshot/Mapping fingerprint 并改变幂等性；因此它只存在当次 materialize 运行结果，不写入权威 summary。
2. `Promise.all` 会同时 build 多个 Source，不能用相加 wall time 冒充项目总时间；报告保留每个 batch 的 parse/normalize 耗时。
3. formatter cache 必须按 timezone 隔离，不能把 Singapore 偏移误用给其他 Project；它复用 `Intl.DateTimeFormat` 对象，不缓存具体日期结果。
4. `push` 只改变数组构造方式；后续仍执行原有排序，不依赖 input row order。

### 13.9 Day30 定点恢复方案

失败 run 中 Day30 batch `energy-import-1ea4da4c-2e03-4c21-99c3-8239132e72a4` 经只读 SQLite 复核仍为 `inspected`，`materialized_at` 与 `materialization_json` 都为空；因此上次被 15 分钟 transport 中断后，没有可冒充完成结果的 batch 状态。

只允许进行一次定点恢复，不重跑 May、Day1、Day7：

1. 严格解析并确认 Metadata、File、DuckDB、Mastra、Workspace roots 都位于原隔离 run 目录；8788 未被其他进程占用；
2. 以当前已通过回归的 API build/source 启动同一 isolated storage；
3. GET batch/setup 验证 Day30 仍为 `inspected`、Source SHA 与 manifest 精确匹配、Saved A id/response SHA 未变；
4. 只 POST 该 Day30 batch 的正式 materialize endpoint，transport 上限仍为 15 分钟；
5. 若成功，读取 1d/7d/28d、Saved A、Release/Mapping/Evidence 与 timing，把 Day30 stage 追加到原报告；若再次超过 15 分钟或状态异常，立即停止，不第三次重试；
6. 不直接写 SQLite/DuckDB，不复用共享 8787/3102，不修改产品 timeout，不把本次恢复当 AI Artifact 验收。

验收仍分两层：Snapshot/Saved-A provenance 与客户 Section 3–5 availability。即使 Day30 materialize 成功，也必须保留尚未完成的动态 Operational/Planning blocker，直到对应切片独立通过。

#### 13.9.1 唯一一次正式恢复结果

| 时间 | 状态 | 证据与结论 |
| --- | --- | --- |
| 2026-08-10 04:21–04:31 SGT | COMPLETED | 使用原 run root 和原 Day30 batch 执行了一次且仅一次正式恢复。正式 preflight 证明 8788 空闲、batch 仍为 `inspected`、文件/SHA/Source Manifest、Meter Mapping、Saved A hash 与当前 Day7 Snapshot 全部匹配。Day30 materialize 在 `559,601 ms` HTTP wall time 内成功，未提高 15 分钟上限。新 Snapshot 为 `energy-snapshot-b22d0eabc6be53e809a168d2`，前一 Snapshot 为 `energy-snapshot-f8c44ac53cc83aac0a9f35e3`。随后 1d/7d/28d 均由正式 resolve API 返回 100% coverage；9 条 Evidence 全部引用新 Snapshot；Release 与 Mapping 无漂移；Saved A bytes 与 Snapshot A 均保持不变。8788 已释放。 |
| 2026-08-10 04:31 SGT | PERFORMANCE EVIDENCE | API 返回的分段 timing 为：两个 Source 的 parse/normalize `7,989.522 ms` 与 `15,718.289 ms`；source write `519,070.570 ms`；canonical rebuild `16,267.332 ms`；integrity/checkpoint `5,439.633 ms`；总计 `559,536.016 ms`。因此 formatter cache/分组构造优化已让 Day30 从原来的 15 分钟 transport timeout 降到约 9 分 20 秒并完成，但剩余主要瓶颈非常明确地位于 source write（约占 92.8%），不是 DuckDB canonical rebuild 或 integrity。后续若做性能切片，只应先调查 source write，不扩大为增量平台。 |
| 2026-08-10 04:31 SGT | PRODUCT BOUNDARY | Day30 的 28d Benchmark、Appliances、Operational 已分别为 `provisional` / `available` / `available`；剩余 blocker 仅为 Section 5 Planning baseline unavailable 与 Actual-vs-plan 尚未实现。该恢复证明正式数据更新链成立，不代表 AI Artifact 或 Charles 最终页面验收完成。 |

机器可读证据：

- 原报告：`.scratch/t39-preschool-continuous-ab-acceptance/run-2026-08-09T19-15-36-500Z/acceptance-report.json`
- 单次恢复 sidecar：`.scratch/t39-preschool-continuous-ab-acceptance/run-2026-08-09T19-15-36-500Z/day30-resume-report.json`
- 恢复 runner：`scripts/energyiq/preschool-day30-resume.mjs`
- 防误跑测试：`scripts/energyiq/preschool-day30-resume.test.mjs`（6/6）

## 14. 正式链暴露的动态窗口缺口与修复切片

### 14.1 已证明与未证明

Day 1、Day 7 已经通过正式 Register → Source Manifest → materialization → resolve 链证明：Current Snapshot 会前进，Saved A 响应 bytes 不变，Project Release 与 Meter Mapping 不漂移，Current Evidence 只引用 Current Snapshot。这只能判定 **provenance 链成立**，不能判定客户可见 A/B 已完成。

当前客户可见缺口分成三个互不混淆的原因：

1. `latest-complete-day` 没有进入 `resolveCurrentOverviewContext`，因而按系统当前日期解析默认 Last 30 days，历史 June fixture 返回 0；
2. Preschool Operational Projection 固定要求 May 1–31 和 `30 × 31 × 24` cells，任何 28 天或 June 窗口都会正确 fail closed，但产品因此无法动态更新 Section 3/4；
3. Section 5 目前只有 May→June planning baseline，没有 Saved A plan 与 Current B actual 的双 provenance 对照，因此不能把 Operational available 误报成 Actual-vs-plan 已完成。

### 14.2 执行顺序

#### Slice A：1d 数据锚点

- 只修改 Project Analysis Resolver，让 `latest-complete-day` 与 7d/28d 一样进入现有数据锚定分支；
- 复用现有 `selectEnergyLatestCompleteDay`，不新建日期选择器；
- 补历史 Snapshot 回归：latest day 必须锚定事实 cutoff，而不是 wall clock；
- 不修改已经支持 Explorer 锚点的 `analysis/execute` 路径。

#### Slice B：28d Operational

- 只泛化 Preschool 的 `current-overview-28d`；不建设通用 Forecast、Calendar DSL 或 Scheduler；
- 日期和 cell 数由当前 28 天 period 派生，保留 30 Centres、完整 hourly coverage、published Calendar、Circuit alias、reconciliation，以及 Snapshot/Release/Hierarchy/Mapping fail-closed；
- May/June fixture 的允许范围仍是项目专属验收条件，不能把任意窗口都标记为 available；
- Renderer 把 May 专属说明改为“当前已接受窗口”，不改变权威数字。

#### Slice C：A plan / B actual

- 从冻结 Saved A 的 `snapshot_json` 只读取得已经验证的 May→June plan，并保留 `savedAnalysisId` 与 A Evidence；
- 从 Current B Snapshot 计算 June actual，保留 B Snapshot/Evidence；
- Day 1/7 只显示 partial actual 和 coverage days，不计算或展示误导性的完整月 variance；
- Day 30 完整后才展示 actual-vs-plan delta；
- 响应必须明确区分 `planProvenance(A)` 与 `actualProvenance(B)`，不能用单一顶层 Snapshot 冒充同一来源。

### 14.3 停止与反证条件

- 需要重写通用时间选择器、构建第二套 Forecast/Version 平台或修改 Saved A bytes；
- 需要跳过 Calendar、Snapshot/Evidence pin 或 completeness 守卫才能 available；
- Day 1/7 被包装成完整月预测准确率；
- Section 3/4 available，但 28 天 cell 数、closed-hour totals 或 Circuit reconciliation 对不上；
- Section 5 不能分别指出 A plan 和 B actual 的来源。

### 14.4 Slice C 执行方案：Saved A plan / Current B actual 薄适配

#### 只读预检结论

1. `resolveProjectAnalysis` 已在确定性 `projectAnalysisCache.resolve(...)` 返回后附加 Ngee Ann decision lifecycle；Slice C 复用同一 seam，只对 Preschool Project-root、electricity、`current-overview-28d` 响应附加，不进入基础 resolution cache，也不修改 cache key。
2. Saved Analysis store 的 `listProject(projectId)` 已按 `created_at DESC, sequence DESC` 返回；候选仍须逐条校验同 Workspace、Scope、Resource、Template Revision、Project Release，且 Saved Snapshot、Analysis provenance 与 record 的 Data Snapshot identity 一致。只读解析 `snapshot_json`，不更新 Saved A。
3. 现有 `buildPreschoolPlanningOutlook` 已是确定性纯计算，但当前为 Operational module 私有函数。Slice C 只把该 builder 提升为可复用 seam：Saved A 已有 provisional `planningOutlook` 时直接恢复；旧 v2/v3 A 缺该字段时，从冻结 Snapshot 的 May `dailyTotals` 重新调用同一 builder，仍要求 May 1–31 完整、`daily_totals_v1` 与四个 Monday–Sunday 完整周。
4. Current B 的 Actual 不能来自 rolling 28-day summary。薄适配用当前 Snapshot/Release pins 构造固定 Singapore `2026-06-01T00:00+08:00` 至 `2026-07-01T00:00+08:00` context，调用现有 `executeEnergyScopeAnalysis` 确定性 Kernel，并只读取 Project Scope 的 `dailyTotals_v1`。Actual kWh 只累加 `dataHealth.status=complete` 的 June 日；`completeDayCount < 30` 时状态为 partial 且 variance withheld，只有 `30/30` 才计算 plan-vs-actual delta。
5. 新响应契约分别保存 `planProvenance(A)` 与 `actualProvenance(B)`：前者至少含 `savedAnalysisId/dataSnapshotId/projectReleaseId/templateRevisionId/queryId/recipeId`，后者至少含当前 `dataSnapshotId/projectReleaseId/period/queryId`。禁止用顶层 Current Snapshot 代替 A 来源，也禁止把 A Snapshot 写进 B Evidence。
6. Web ViewModel/Renderer 只格式化服务端给出的 plan、actual、coverage 与可选 variance；浏览器不求和、不补齐缺日、不反推 Forecast。

#### 潜在问题与处理

1. **Saved A 兼容与污染风险**：旧 A 可能有 Operational v2/v3、可能缺 `planningOutlook`，也可能缺有效 `snapshot_json`。处理：只接受 identity 完整的冻结 Snapshot；优先恢复已有 plan，否则复用纯 builder；解析失败或 May dailyTotals 不完整时 fail closed，不回写 record。
2. **“最新”不等于“兼容”**：最新 Saved Analysis 可能属于另一个 Scope、Release 或普通 Custom 查询。处理：保持 store 顺序，逐条过滤后取第一个 compatible candidate，不允许降格到仅同 Project。
3. **rolling 28d 冒充 June Actual**：Day 1/7 的 Primary Period 跨 May/June。处理：另建固定 June context 走现有 Kernel，Actual Evidence 固定 `daily_totals_v1`；不得读取 rolling summary 作为 June total。
4. **partial 被误报完整 variance**：存在 1/7 个完整日时也会有非零 Actual。处理：响应显式给出 `completeDayCount/targetDayCount=30`；partial 保留 accepted Actual，但 `varianceKwh/variancePct` 均为 `null`，Renderer 显示 withheld。
5. **cache 与 Saved 列表耦合**：Saved A 的新增/删除不能改变确定性分析 cache identity。处理：Saved lookup、计划恢复与固定 June Actual 附加全部位于 cache 返回之后；不把 `savedAnalysisId` 或 Saved count 写入基础 cache key，也不修改 cache 内冻结对象。
6. **性能与查询边界**：不能为 Section 5 建任意 SQL/Forecast 平台。处理：只调用一次现有 scoped Kernel 的固定 June 查询；若必须新增通用查询语言、第二套 scheduler 或绕过 Snapshot session 才能继续，则停止。

#### 自动化验收

1. 先写红测证明：最新 incompatible Saved record 被跳过，旧 v2/v3 Saved A 缺 `planningOutlook` 时仍能从冻结 May dailyTotals 得到 May 4–31 四周计划，且原 `snapshot_json/analysis_json` bytes 不变。
2. Day 1 / Day 7 fixture：Actual period 固定 June 1–July 1，只返回已完成日的 kWh 与 `completeDayCount`；状态 `partial`，variance 明确 withheld。
3. Day 30 fixture：只有 30 个 June complete days 才返回 `complete`，并由服务端给出 `varianceKwh/variancePct`；Actual provenance 只 pin Current B，Plan provenance 只 pin Saved A。
4. 两次相同 Current B resolve 证明基础 deterministic resolution 仍复用原 cache；新增 Saved record 不改变基础 cache key/缓存对象，附加结果可以随最新 compatible Saved A 更新。
5. Web ViewModel/Renderer 测试证明 partial、complete、无 compatible A 三态；浏览器没有 Actual 求和或 variance 计算路径。
6. 运行 Slice C 聚焦 tests、Preschool Renderer/ViewModel tests、project-analysis cache tests、typecheck 与 scoped `git diff --check`。自动化通过不等于 isolated A/B、Chrome 或人工验收通过。

#### 停止项

- 需要修改 Saved A record、`snapshot_json`、`analysis_json` 或其 immutable response bytes；
- 不能同时证明 A/B 各自的 Snapshot、Release 与 Evidence identity，或只能用单一顶层 Snapshot 表达；
- fixed June Actual 只能通过 rolling 28d total、浏览器计算、mock/fake actual 或任意 SQL 才能得到；
- Day 1/7 需要展示完整月 variance，或 completeness 守卫必须被跳过；
- 需要修改确定性 cache key、把 Saved state 放进基础 cache，或建设通用 Forecast/version/scheduler 平台；
- 需要触碰并行 AI、materializer、agent-runtime、`next-env.d.ts` 或 `tsconfig` 文件。

### 14.5 Slice C 真实 Day30 回读

在原隔离 run 已完成 Day30 materialization 后，只以最新源码重启 `127.0.0.1:8788`，没有再次导入、materialize、Publish 或写 Saved A。第一次真实 resolve 揭示 formal Saved A 是本地 May 4–31 的 28 天 current-overview，而原 full-May builder 要求 May 1–31，因此 lifecycle 正确返回 unavailable。该差异通过共享核心增加了“完整四周恢复”入口后，第二次 resolve 通过：

| 项目 | 真实结果 |
| --- | --- |
| Current B Snapshot | `energy-snapshot-b22d0eabc6be53e809a168d2` |
| Current 28d | 3 Jun–30 Jun 2026；Operational `available` |
| Saved A plan | `26,240.3992 kWh`；Saved Analysis `saved-analysis-0ab0e542-01e5-4a3b-9f02-ece8f6276532`；Snapshot `energy-snapshot-52ca9611e48b0d71c2efe7b7` |
| Current B June actual | `26,912.08 kWh`；30/30 complete days；Snapshot `energy-snapshot-b22d0eabc6be53e809a168d2` |
| Plan variance | `+671.68 kWh / +2.56%`，由服务端 fixed-June deterministic analysis 计算 |
| Resolve wall time | 约 `9,166 ms`，包含 current Overview 与 after-cache fixed-June Actual |

验收边界：这是真实隔离 API 与正式存储的产品合同回读，并证明 A/B Snapshot provenance 分离；Web 格式化已有自动测试，但尚未把隔离 API 接到真实 Chrome 页面，因此不冒充 Chrome 或 Charles 人工验收。8788 已关闭。
