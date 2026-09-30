---
title: "2026-08-04 开发记录：Ngee Ann 权威 Excel、Mapping 与 Facts Materialization"
summary: "四份权威 Excel 已通过正式 Admin 流程形成 18/18 confirmed Mapping、100,205 条项目级 canonical interval facts 和可发布的不可变 Data Snapshot。"
doc_type: runlog
tags: [开发记录, Ngee Ann, Excel, Meter Mapping, Materialization]
updated_at: "2026-08-04"
related:
  - "2026-08-01-Admin-Excel-Import-Batch实施记录.md"
  - "2026-08-01-Admin-Meter-Mapping与虚拟电表实施记录.md"
  - "../handoff/agent/2026-08-04-Overview-AI-New-Orchestrator-Handoff.md"
---

# 2026-08-04 开发记录：Ngee Ann 权威 Excel、Mapping 与 Facts Materialization

## 1. 目标与范围

本轮完成 GitHub Issue #23（T03A）的本地数据底座验收：不直接改写 DuckDB，而是通过正式 Admin Import Batch、Source Manifest、Meter Mapping 和 production materializer，把四份权威 Ngee Ann workbook 固化为可审计、可重放的 composite Data Snapshot。

本文第 2–3 节首先保留 #23 当时的 v2 验收证据。随后 #25 将运行时契约升级为“当前 Snapshot + 完整 manifest + 当前 fact state”的 v3 fail-closed 边界；v3 的代码证据与 live 重放证据在 3.7 节单独记录，不能用历史 v2 Snapshot 冒充本轮 live 结果。

本轮范围包括：

- 四份 workbook 的 SHA、sheet、row、source label 与 coverage lineage；
- 18 个 source labels 的 confirmed physical Meter Mapping；
- 4 个 designated total meters 与 14 个 component meters 的角色；
- `Load 12` 版本化 Virtual Meter 公式；
- Raw、Normalized、Interval Fact、Quality Event 和 immutable Snapshot；
- later-coverage precedence、跨文件 interval、Asia/Singapore 与半开区间；
- Project、Level、component Circuit、category、peak、coverage 的固定 Golden；
- Admin `Review & Publish` 的 Interval facts、Meter mapping 和 Setup validation readiness。

不在本轮范围：

- 发布 Ngee Ann 的有效 Tariff 与 Operating Calendar；该闭环属于 #4；
- 拆分 Meter attachment、navigation 与 Official Aggregation Route；四个 total Circuit 的导航缺口属于 #24；
- 客户 Release pin、灰度和 rollback；属于 #19。本轮没有点击 `Publish revision`；
- Ngee Ann 核心 Overview Renderer；属于 #6，并继续由 #4、#24 阻塞。

## 2. 代码改动

### 2.1 正式 provenance 和 readiness

| 文件 | 改动类型 | 说明 |
| --- | --- | --- |
| `packages/metadata/src/energyiq-project-setup-store.ts` | 修改 | 新增通用 `source_manifest`，保存并确认当前 Import Batch SHA 集合，不硬编码项目名或四个 SHA。 |
| `packages/metadata/src/energyiq-store.ts` | 修改 | 保存 batch-local materialization summary 与 project-canonical audit，生成 deterministic immutable composite Snapshot；A→B→A 可回到原 Snapshot ID。 |
| `packages/metadata/src/energyiq-import-readiness.ts` | 修改 | 对 manifest、Mapping、contract、snapshot、canonical duplicates、missing/orphan facts 和 legacy rows fail closed。 |
| `apps/api/src/energy/energy-api.ts` | 修改 | materialization 前验证 saved Source Manifest 与 18/18 saved confirmed Mapping；不满足时 409，且不读取 workbook、不修改 batch。 |
| `apps/web/src/app/energyiq/admin/project-setup-workbench.tsx` | 修改 | 增加 `Pin current batches`、`Use all detected labels`、`Build all interval facts` 和 Composite Snapshot/readiness 状态。 |
| `apps/api/src/energy/energy-project-materialization.ts` | #25 新增 | 串行执行 Project full-manifest prepare → DuckDB write → Metadata completion，并恢复 writer 已提交、Metadata 尚未推进的中断窗口。 |
| `packages/data-gateway/src/energy-snapshot-guard.ts` | #25 新增 | 在 coverage 与每次 scoped query 中复核 Snapshot identity、manifest、writer contract、canonical count 与内容 digest。 |

### 2.2 项目级 canonical interval 修复

真实四文件第一次 materialize 得到 `100,223 normalized / 100,196 facts`。18 个 Meter 均无 15 分钟时间断点，因此正确相邻点对数量应为：

```text
100,223 canonical normalized readings
- 18 meter series 的首读数
= 100,205 canonical adjacent intervals
```

根因是旧 materializer 只在单个 Import Batch 内对累计读数求差；writer 虽会合并并按 later coverage 去重 normalized readings，却只合并既有 batch-local facts，不会从最终项目级 canonical sequence 重建跨 source interval。

修复落在 `packages/data-gateway/src/energy-fact-writer.ts`：

1. 先按 later-coverage 规则得到项目级 canonical normalized readings；
2. 在同一事务内按 `project + resource + meter + event_time` 排序并全量重建 cumulative facts；
3. fact lineage 归属于 interval-end/current canonical reading 的 batch、file 和 SHA；
4. gap、irregular interval 和 negative delta 仍生成 non-ok fact，并重建对应项目级 quality event；
5. direct `interval_usage` 不进入 cumulative rebuild；
6. 显式传入已保存的 Project timezone，用 interval start 计算 `local_date/local_hour/day_type`；
7. #23 当时的 writer contract 升级为 `energy-fact-writer-project-canonical-v2`，强制旧 v1 四批全量重放并生成新的 immutable Snapshot ID；#25 后续再升级为 v3，见 3.7；
8. project audit 新增：
   - `canonicalMeterSeriesCount`
   - `adjacentReadingPairCount`
   - `missingAdjacentIntervalCount`
   - `orphanIntervalFactCount`

Integration 提交链：

- `4a4679e`：composite Snapshot 与正式 source/materialization 主链；
- `aea352f`：rematerialized sheet lineage；
- `6193a9f`：formal snapshot provenance fail closed；
- `9553cda`：order-independent batch manifest；
- `75afbaf`：semantic Mapping rollback；
- `a17b22b`：不完整 saved Mapping 的 UI/API materialization guard；
- `78c7d56`：项目级 canonical interval rebuild 与 readiness completeness gate；
- `d3e1ddd`：把 canonical facts 绑定到精确 Snapshot manifest；
- `05a814d`：在事实状态漂移、缺失或内容损坏时 fail closed，并删除旧单批写旁路。

## 3. 验证证据

### 3.1 权威 Source Manifest

| Workbook | SHA-256 | Data rows | Labels |
| --- | --- | ---: | ---: |
| `Ngee Ann Poly Level 6 (21 April - 20 May).xlsx` | `E4D788AF0135281C8BA519F04FA3C44751206CE0812E15E434DA6CB8FDA44F70` | 25,919 | 9 |
| `Ngee Ann Poly Level 6 (19 May - 17 June).xlsx` | `64502F6369DAD96F3DC6CBC650B28B3F108BB655E7A95CA078B9AA616966413F` | 25,919 | 9 |
| `Ngee Ann Poly Level 7 (21 April - 20 May).xlsx` | `0B1FB9613C596D3569F6BE93046A43737366649B5F8A4D45FC8CDEF073C30E5D` | 25,920 | 9 |
| `Ngee Ann Poly Level 7 (19 May - 17 June).xlsx` | `3F41F94E229933A97CE8D02A0382D3A8192E3C26065BF0F48A04168EC90DD674` | 25,920 | 9 |

四份 workbook 均为 `Sheet1`，固定列为 `Device Name / Time / Active Energy`，invalid rows 为 0，合并后为 18 个稳定 labels。较早创建的 Level 6 May–June Import Batch 的 immutable inspection JSON 没有 `sheetName`；当时的 v2 rematerialization summary 与 composite Snapshot manifest 已正式保存 `sourceSheetName/sheetName = Sheet1`。没有回写或伪造原历史 inspection。

正式 Setup 状态：

- Draft revision：`r5`；
- Source Manifest：confirmed，精确四 SHA；
- Mapping：18/18 confirmed；
- 4 direct totals：`meter_role=total`，进入 official route；
- 14 components：`meter_role=component`，可单独分析但不进入 Project/Level official total；
- Virtual Meter `Load 12`：Level 6 Load 1 + Load 2，不进入 official total。

### 3.2 新 Data Snapshot 与项目级审计

以下是 #23 当时通过 Admin `Build all interval facts` 得到的正式 v2 replay，结果为 `4 materialized / 0 reused`；它是升级前历史证据，不是 #25 v3 live 证据。

- Snapshot ID：`energy-snapshot-a7d17e899229aa8a482e139f`；
- Mapping fingerprint：`4ac07fedc2b2c618504611514e9d1f0e39332b7eff90c51b64aa837a72c76a00`；
- Materializer contract：`energy-excel-cumulative-v1`；
- Writer contract：`energy-fact-writer-project-canonical-v2`；
- Timezone：`Asia/Singapore`。

| Project audit | 结果 |
| --- | ---: |
| Raw rows | 103,678 |
| Invalid / unmapped raw rows | 0 / 0 |
| Raw overlap conflict rows | 32（16 keys，仅 warning，later coverage 已决定 winner） |
| Canonical normalized readings | 100,223 |
| Canonical Meter series | 18 |
| Adjacent reading pairs | 100,205 |
| Interval facts | 100,205 |
| Missing adjacent intervals | 0 |
| Orphan interval facts | 0 |
| Duplicate normalized / facts | 0 / 0 |
| Invalid duration / negative delta | 0 / 0 |
| Legacy raw / normalized / fact / canonical | 0 / 0 / 0 / 0 |

Mapping 完整性审计同时确认：unmapped source labels = 0、inactive source labels = 0、duplicate source labels = 0、direct-total conflicts = 0；每个 `Level × category` 恰有一个 designated official total。

API readiness 为 `ready=true`、`blockingReasons=[]`，唯一 warning 是 `RAW_OVERLAP_CONFLICTS_RESOLVED_BY_LATER_COVERAGE:32`。

### 3.3 跨 source interval 与数值更正

v2 最终包含 18 条跨 source canonical intervals，均为新加坡本地 `2026-05-18 23:45 → 2026-05-19 00:00`：

| Scope | 数量 | 精确用量 | 修复含义 |
| --- | ---: | ---: | --- |
| Level 7 | 9 | 0.360955 kWh | 旧实现完全漏失，v2 恢复。 |
| Level 6 | 9 | 0.243301 kWh | 旧实现已有 batch-local fact，但 v2 按 later-coverage canonical endpoint 重建 lineage 和 delta。 |
| 合计 | 18 | 0.604256 kWh | 全部归属于 interval-end/current winning source。 |

早期排查记录把 Level 7 九条合计写成 `0.360956 kWh`。这是 0.000001 kWh 的报告舍入错误；以 `DECIMAL(18,6)` 对九条六位小数 delta 求和后，正式值为 `0.360955 kWh`。Issue #23 已追加更正，不修改历史留言。

全表 100,205 条 facts 与 normalized endpoints 联表验证：

- previous/current endpoint mismatch：0 / 0；
- current source/batch/file lineage mismatch：0 / 0 / 0；
- Asia/Singapore local calendar mismatch：0；
- cumulative delta mismatch：0；
- usage mismatch：0；
- average-kW mismatch：0；
- nonpositive duration / negative delta：0 / 0；
- canonical quality events：18 个 `boundary`，无其它 non-ok event。

### 3.4 固定 Golden Period

Golden 使用本地半开区间 `[2026-06-10 00:00, 2026-06-17 00:00)`，即 UTC `[2026-06-09T16:00:00Z, 2026-06-16T16:00:00Z)`。

| 指标 | DuckDB 独立 oracle | 正式 Analysis API |
| --- | ---: | ---: |
| Official Project usage | 1,531.168324 kWh | 1,531.1683 kWh |
| Daily average | 218.738332 kWh/day | 218.7383 kWh/day |
| Peak interval-average power | 20.673108 kW | 20.6731 kW |
| Level 6 | 476.983827 kWh | 476.9838 kWh |
| Level 7 | 1,054.184497 kWh | 1,054.1845 kWh |
| Light | 291.744387 kWh | 291.7444 kWh |
| Load | 1,239.423937 kWh | 1,239.4239 kWh |
| Valid official intervals | 2,688 | 2,688 |
| Coverage | 100% | 100% |
| Virtual `Load 12` | 49.021767 kWh | 49.0218 kWh |

四个 designated-total Circuit 由覆盖 Golden period 的两份 May–Jun 权威 Excel（Level 6、Level 7 各一份）独立复算，不使用 legacy mixed evidence：

| Total Circuit Scope | DuckDB 独立 oracle | 正式 Analysis API |
| --- | ---: | ---: |
| `l6-total-light` | 111.688071 kWh | 111.6881 kWh |
| `l6-total-load` | 365.295756 kWh | 365.2958 kWh |
| `l7-total-light` | 180.056316 kWh | 180.0563 kWh |
| `l7-total-load` | 874.128181 kWh | 874.1282 kWh |

精确 reconciliation 为：Level 6 `111.688071 + 365.295756 = 476.983827`；Level 7 `180.056316 + 874.128181 = 1,054.184497`；Light `111.688071 + 180.056316 = 291.744387`；Load `365.295756 + 874.128181 = 1,239.423937`；四个 totals 合计 `1,531.168324`。14 个 components 合计 `1,518.996480`，18 个 Meter 全加为 `3,050.164804`，因此正式 Project 汇总必须只走四个 total routes，不能把 component 再加一次。

14 个 physical component Circuit 逐一通过正式 Analysis API 与 DuckDB oracle 对账；每个 Scope 均为 672 个有效区间、100% coverage、0 quality events，并 pin 到 `energy-snapshot-a7d17e899229aa8a482e139f`：

| Component Circuit Scope | DuckDB usage | API usage | DuckDB peak | API peak |
| --- | ---: | ---: | ---: | ---: |
| `l6-light-left` | 40.287062 kWh | 40.2871 kWh | 1.537228 kW | 1.5372 kW |
| `l6-light-right` | 70.687320 kWh | 70.6873 kWh | 2.052860 kW | 2.0529 kW |
| `l6-load-1` | 11.537893 kWh | 11.5379 kWh | 1.188288 kW | 1.1883 kW |
| `l6-load-2` | 37.483874 kWh | 37.4839 kWh | 0.787148 kW | 0.7871 kW |
| `l6-load-3` | 13.529150 kWh | 13.5292 kWh | 0.500864 kW | 0.5009 kW |
| `l6-load-4` | 255.153879 kWh | 255.1539 kWh | 4.915592 kW | 4.9156 kW |
| `l6-load-5` | 42.335467 kWh | 42.3355 kWh | 0.823852 kW | 0.8239 kW |
| `l7-back-light` | 48.904264 kWh | 48.9043 kWh | 1.707948 kW | 1.7079 kW |
| `l7-front-light` | 107.019997 kWh | 107.0200 kWh | 2.037452 kW | 2.0375 kW |
| `l7-middle-light` | 20.767825 kWh | 20.7678 kWh | 0.796700 kW | 0.7967 kW |
| `l7-load-1` | 28.122014 kWh | 28.1220 kWh | 0.803844 kW | 0.8038 kW |
| `l7-load-2` | 66.168234 kWh | 66.1682 kWh | 1.374620 kW | 1.3746 kW |
| `l7-load-3` | 337.902316 kWh | 337.9023 kWh | 3.242088 kW | 3.2421 kW |
| `l7-load-4` | 439.097185 kWh | 439.0972 kWh | 3.530652 kW | 3.5307 kW |

以 `l7-load-4` 为代表的独立 Circuit 对比也由正式 API 返回：当前 439.0972 kWh、前期 247.9813 kWh、变化 +191.1159 kWh（+77.0687%）、peak 3.5307 kW、672/672 intervals、coverage 100%。

Official Route 的 no-double-count 证据：

| 口径 | Meter 数 | 用量 |
| --- | ---: | ---: |
| All physical meters | 18 | 3,050.164804 kWh |
| Designated official totals | 4 | 1,531.168324 kWh |
| Excluded components | 14 | 1,518.996480 kWh |

`3,050.164804 = 1,531.168324 + 1,518.996480`。正式 Project Analysis 返回 1,531.1683 kWh，证明 Project/Level route 只取四个 designated totals，没有把 14 个 component meters 重复相加。四个 total Circuit 自身的导航查询仍归 #24。

正式 Analysis API provenance 指向新 Snapshot，`aggregationRule=designated_total`，Data Health 为 complete，`cumulativeDeltaMismatchCount=0`、`averageKwMismatchCount=0`、`invalidIntervalDurationCount=0`，且不含 `<legacy>` batch。Golden fixture 同步使用正式 May–Jun provenance：Level 7 `energy-import-2059d4af-9d67-4e65-8cf1-61d15352be3d` / SHA `3F41F94E229933A97CE8D02A0382D3A8192E3C26065BF0F48A04168EC90DD674`，Level 6 `energy-import-776b4be8-9ac4-4159-87d6-73837abe896e` / SHA `64502F6369DAD96F3DC6CBC650B28B3F108BB655E7A95CA078B9AA616966413F`，source filename 也保持与两份 workbook 一致。

Tariff 与 Operating Calendar 当前仍返回结构化 `Unavailable`：

- `TARIFF_VERSION_NOT_FOUND: sg-tariff-v1`；
- `OPERATING_CALENDAR_VERSION_NOT_FOUND: sg-calendar-v1`。

这证明现有代码没有使用静默默认费率或营业时间；为 Ngee Ann 发布有效版本并验证 v1→v2 冻结属于 #4。

### 3.5 自动化与浏览器验收

Integration 上独立执行：

```powershell
npm run build
npx vitest run apps/api/src/energy packages/data-gateway/src/energy-fact-writer.test.ts packages/metadata/src/energyiq-import-readiness.test.ts packages/metadata/src/energyiq-store.test.ts
npm run build --workspace @datafoundry/web
```

结果：

- TypeScript root build：通过；
- 16 test files / 63 tests：通过；
- Next production build：通过；
- 两路 fixed-SHA 独立审查：P0=0、P1=0、Integrate=YES；
- Chrome Data Sources：4/4 batches、18/18 labels、新 Snapshot、canonical checks current；
- Chrome Project Overview / Review & Publish：`READY`；
- Interval facts：4/4 + 新 Snapshot；
- Meter mapping：18 confirmed rows；
- Setup validation：No blocking issue。

这里的 `READY` 只证明 #23 的本地 Setup、Data Snapshot 与 Mapping 已满足发布前置条件；它不代表 Tariff/Operating Calendar 已发布，也不代表 #19 的 Customer Release 已创建或切换。`Publish revision` 因此前置条件满足而可用，但本次没有点击。

浏览器当时只启动了一次 v2 Build。重放过程中出现多个中间 Snapshot 且持续 `FACT_WRITER_CONTRACT_MISMATCH`，直到四批全部升级后才变为 ready，证明 mixed v1/v2 状态正确 fail closed。

### 3.6 备份与环境边界

正式 mutation 前完整备份 Integration `storage`：

`D:\Projects\energyiq-datafoundry-backups\t03a-pre-materialization-20260804-115331`

- 181 files；
- 113,624,093 bytes；
- SQLite SHA-256：`709A62E79B4C5B41341BCBFB88F22EF4E73E3E573963136FA9B00E5F5D737747`；
- DuckDB SHA-256：`6DE09840603AB034C72BC9C0EAC8F77B77F723596620E6BFC70AC551B2247247`。

Source root 与 Worker 不运行服务或共享 DuckDB；只有 Integration 的 8787/3000 服务被启动、核验和精确停止/重启。没有 reset、clean、stash 或直接数据库补写。

### 3.7 #25 v3 当前 Snapshot 事实边界

代码集成后 writer contract 为 `energy-fact-writer-snapshot-manifest-v3`。每次 Project materialization 必须一次提交完整 active manifest；DuckDB 在同一事务更新 canonical facts、当前 Snapshot/fingerprint、source SHA 集合、canonical interval count 和内容 SHA-256 digest。Metadata completion 用 expected previous/target Snapshot 做 CAS。Coverage、Overview 和 AI 查询先核对同一状态；旧 pointer 返回 stale，当前事实缺失、删行、等数量改值或状态损坏返回 facts unavailable。

旧 single-batch writer、Metadata per-batch prepare/complete 和 completion shim 已全仓删除。自动化已通过 79 个定向测试、56 个跨层测试、root build/typecheck 与 diff-check；删一行和保持数量但篡改 `usage_kwh` 的回归均 fail closed，Ngee Ann fixture Golden 保持不变。

2026-08-04 已完成 live v3 重放与验收，历史 v2 Snapshot 不再代表当前事实状态：

- mutation 前在 API 停止状态备份完整 Integration `storage` 到 `D:\Projects\energyiq-datafoundry-backups\t05a-pre-v3-materialization-20260804-205701`：185 files、119,242,725 bytes；SQLite SHA-256 `D9EF8EC0AB463C39196104F336B1AFCC909790BBCF029444F7EE87E091E64CA6`，DuckDB SHA-256 `D49C2354F80BD7DD2FB1BFA7FA0599554A00A5F2301149424BF3F2AD7C776C09`；
- 只在 Chrome Admin Data Sources 点击一次 `Build all interval facts`，正式 API 使用已保存的四份原始 workbook/File Asset 完成完整 active manifest 重物化；页面由 `FACT_WRITER_CONTRACT_MISMATCH / SNAPSHOT_FACT_STATE_UNAVAILABLE` 转为 4/4 batches、18/18 labels 和 `All registered batches, Mapping pins and canonical fact checks are current`；
- 当前 Snapshot 为 `energy-snapshot-03499dcda183ae28c47f7d66`，manifest fingerprint 为 `6e5a5f06aeea7dc51f04f2733cad3ee2f317528c3980f82ba6b1d4c2ff31f0e7`；四个 source SHA 精确为 `0b1fb9613c596d3569f6be93046a43737366649b5f8a4d45fc8cdef073c30e5d`、`3f41f94e229933a97ce8d02a0382d3a8192e3c26065bf0f48a04168ec90dd674`、`64502f6369dad96f3dc6cbc650b28b3f108bb655e7a95ca078b9aa616966413f`、`e4d788af0135281c8ba519f04fa3c44751206ce0812e15e434da6cb8fda44f70`，writer contract 全部为 `energy-fact-writer-snapshot-manifest-v3`；
- GET imports/readiness 返回 ready、blocking reasons 空；project audit 为 raw 103,678、normalized 100,223、interval facts 100,205、18 canonical meter series、missing adjacent 0、orphan 0、legacy 0，仅保留明确 warning `RAW_OVERLAP_CONFLICTS_RESOLVED_BY_LATER_COVERAGE:32`；
- API 停止后只读 DuckDB 独立复核 `energy_project_fact_state`：`canonical_interval_count=100205`，保存与即时重算 digest 均为 `caf19389d3693e6b586879e0c2dc26eb77ad6ce60be5c53a3e8023ada969678e`，count/digest 均一致；复核后 API 已立即重启并通过 coverage health；
- Custom Golden Period `2026-06-10`–`2026-06-16` 的正式 Overview 与 scoped Analysis/AI 查询均 pin 同一 Snapshot：Project 1,531.1683 kWh、Daily Average 218.7383 kWh/day、Peak 20.6731 kW、Level 7 1,054.1845 kWh、Level 6 476.9838 kWh、Top Circuit `l7-load-4` 439.0972 kWh、2,688/2,688 intervals、100% coverage；Tariff cost 为 available，489.973864 SGD；
- Chrome 客户 Overview 显示同一 Snapshot、`1,531.17 kWh`、Tariff、Evidence 与 Level 7/6；九条 Evidence ID、Analysis Context 与 AI provenance 都编码/引用同一 Snapshot。

本地完整 Analysis 当前约 9 秒。它不影响 #25 的 correctness 封顶，但在 #6 真实 Renderer/截图验收中作为体验风险监控；除非明确阻塞客户页面，不因此新增通用底座 Ticket。

## 4. 问题与取舍

### 4.1 旧 readiness 会把不完整 facts 判为 ready

- 现象：100,196 facts 仍通过旧 readiness；
- 根因：只检查“已有 facts 是否健康”，不检查 canonical 相邻读数是否都有 fact；
- 处理：新增 adjacent/missing/orphan project audit，missing 或 orphan 大于 0 直接阻断。

### 4.2 batch summary 与 project audit 不能混为一谈

每个 workbook 的 summary 继续记录本文件内部产生的 facts；project audit 记录合并、去重、跨 source 重建后的 canonical facts。四个 batch summary 不能简单相加作为正式发布口径，否则会重新引入 completion-order 依赖。

### 4.3 mixed reading kind 是非阻断 P2

当前 Ngee Ann 为 cumulative，Preschool 为 direct interval，且分属不同 Project。dedupe partition 尚未显式包含 `source_reading_kind`；未来若同一 Project/Meter/time 混用两种 reading kind，应先定义 one-kind-per-meter invariant，或扩展 partition 并增加 mixed-kind test。本问题不阻断 #23。

### 4.4 四个 designated-total Circuit 的导航仍为空

为避免 Level/Project double count，四个 total meter 当前必须走 designated-total route；但 `scope_id` 仍混合 measurement attachment、navigation 和 roll-up 语义。14 个 component Circuit 已可 Golden，四个 total Circuit 的导航修复归 #24，#6 在其完成前不能宣称全 Circuit North Star 闭环。

## 5. 复现与排查

前置条件：使用 Integration worktree，API 监听 8787，Web 监听 3000；不要在 Source/Worker worktree 运行共享服务或 DuckDB。

1. Admin 选择 Ngee Ann Polytechnic；
2. Data Sources 确认四个 SHA 已 pin，18 labels 已保存并 confirmed；
3. 点击一次 `Build all interval facts`；
4. 等待 `4 materialized / 0 reused`；
5. GET `/api/v1/energy/projects/ngee-ann-polytechnic/imports`，核对 Snapshot audit/readiness；
6. 停止唯一 API 进程后只读查询 DuckDB，核对 100,223 / 100,205 / missing 0 / orphan 0；
7. 重启 API，POST `/api/v1/energy/analysis/execute`，Custom period 使用 `from=2026-06-10`、`to=2026-06-16`；
8. Project Overview 检查 `Review & Publish = READY`，但 #23 不点击 `Publish revision`。

若再次出现 `FACT_WRITER_CONTRACT_MISMATCH`，先检查是否有部分 batch 仍保存 v1 writer contract；不要重复点击 Build，也不要直接修改 metadata/DuckDB。

## 6. 后续与关联

推荐执行顺序：

1. 关闭 #23，解除数据底座阻塞；
2. 执行 #24，分离 Meter attachment/navigation/official route，补四个 total Circuit Golden；
3. 执行 #4，为 Ngee Ann 发布有效 Tariff/Calendar，验证 cost/operating/standby v1→v2；
4. 执行 #6，用同一 Snapshot/Context/Release 完成 Overview Golden Slice；
5. #19 再负责客户 Release pin/rollback，不把本地 READY 偷换成客户已发布。

这条顺序仍以 Overview 北极星为目标：#23 证明底层数据可信，#24 证明下钻语义正确，#4 补齐 Overview 必需的 Cost/Operating，#6 才能判断 Renderer 与方法是否真正有效。

## 附录：Agent 与工具链

- Main Agent 只在 Integration 运行服务、API 和 DuckDB；
- Worker 1 在独立 worktree 实现并提交；
- 两个只读审查 Agent 分别检查架构链路和验收 oracle；
- Chrome 用于正式 Admin UI acceptance；
- PowerShell/Node/DuckDB 用于独立 API 与数据库对账；
- GitHub Issue #23 保存 claim、scope、缺陷、修复与 0.360955 更正记录。
