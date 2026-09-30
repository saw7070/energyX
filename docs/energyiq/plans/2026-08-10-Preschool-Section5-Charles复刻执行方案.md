---
title: "Preschool Section 5 Charles 复刻执行方案"
summary: "在不伪造 Forecast 或 Actual 的前提下，把现有 Planning Baseline 升级为 Charles 的状态、四 KPI、Estimate-vs-Actual 与局部切换结构。"
doc_type: playbook
tags: [Preschool, Overview, Charles, Forecast, Task-A]
updated_at: "2026-08-10"
related:
  - "2026-08-10-Overview夜间执行路线与Runlog.md"
  - "../records/2026-08-10-Preschool连续数据A-B实施记录.md"
  - "../records/2026-08-06-Preschool-Overview-Interaction-Matrix.md"
  - "../template/Preschool/Energy_Report_May2026.html"
---

# Preschool Section 5 Charles 复刻执行方案

## 1. 适用与不适用

**何时用**

- Task A 继续实现 Preschool Overview A5；
- 对照 Charles `June 2026 Forecast`，补齐客户可见的信息结构和局部交互；
- 验证 May Plan 与后续 June Actual 能在同一 Section 中诚实对照。

**何时不用**

- 不用于优化 AI Finding、Prompt 或 Provider；这些属于 Task B；
- 不建设通用 Forecast、Scheduler、Dashboard DSL 或机器学习平台；
- 不把 Charles HTML 内的 simulated actual、固定状态、硬编码日期或浏览器计算搬进正式 Renderer。

## 2. 当前事实与角色

- **Task A**：制定并实现 A5，维护独立提交和测试证据。
- **主 Agent**：审核数据边界、代码、回归和合并；不得把自动化验收冒充 Charles 人工验收。
- **当前真实实现**：仍是 `Planning baseline → May 四周横条 → June Energy/Cost → Method`，不是 Charles Forecast 复刻。
- **Charles 参考**：`docs/template/Preschool/reference-screenshots/charles/05-june-forecast.png`。
- **当前截图**：用户 2026-08-10 提供的 `codex-clipboard-0a56d1c1-f86a-4e3a-9b1d-49dc13d1c803.png`。
- **已存在的确定性能力**：May 完整周 Plan；A/B 链可提供 June Actual、coverage 和完整期 variance；Plan 与 Actual 分别 pin 自己的 Snapshot/Evidence。

## 3. 必须先做的反证检查

1. 核对 Task A 工作树与权威集成基线 `origin/codex/t35-presentation-clean@214c51b` 的分叉；不得 reset、clean 或覆盖其他 Agent WIP。
2. 核对 `preschoolPlanningLifecycle` 当前是否已经提供：Plan、Actual、coverage、variance、Project/Centre series、daily/weekly/monthly buckets。
3. 若缺少趋势或 Centre 数据，不得在 React 重算；先写出最小 DTO/Projection 缺口和测试，再做窄范围服务端补充。
4. 核对当前共享 3102 是 May-only 还是已含 June B；May-only 页面只能验收 waiting state，不能冒充 Actual 状态。
5. 不因 Charles 使用 simulated actual 而复制模拟曲线；正式页面只显示当前 Snapshot 可证明的 Actual。

## 4. A5 客户阅读结构

按以下顺序实现：

1. **Section 标题**：`June 2026 Forecast`；必要时用副标题说明这是 transparent planning estimate。
2. **状态条**：显示 `Awaiting actual / Partial / On plan / Above plan / Below plan` 等确定性状态；没有 Actual 时明确 `Actual not available yet`。
3. **四个 KPI**：
   - Estimated Energy；
   - Estimated Cost；
   - Consumed So Far；
   - Pace vs Estimate。
4. **主图**：Estimate 与 Actual 时间序列；Estimate 用虚线，Actual 用实线。无 Actual 时保留 Estimate，并给局部空态，不隐藏整个 Section。
5. **局部时间粒度**：Daily / Weekly / Monthly，只影响 Section 5，不改整页、不重跑 AI。
6. **局部范围**：Portfolio / 单个 Centre；使用同一 Project cutoff、Release 和授权 Snapshot。
7. **方法与 Evidence**：May 四周柱状基线、Tariff、区间和限制移入折叠区，不再作为主视觉。
8. **AI Slot**：沿用 Section 级插槽，不在本切片改生成逻辑。

## 5. 数据与降级合同

- Plan 和 Actual 必须分别携带 `dataSnapshotId / period / sourceRef`，不得合并成无法追溯的单一数字。
- 只有完整 June 才显示最终 variance；Day 1/7 显示 partial coverage 和 pace，不冒充 full-month outcome。
- 没有 Actual：Consumed So Far、Pace 和 Actual line 显示局部 Unavailable。
- 没有 Centre series：Portfolio 仍可用；Centre selector 局部禁用并解释原因。
- 没有可证明的 saving、weather、occupancy 或 customer tariff：不显示、不推断。
- `Estimated Cost` 必须继续标识公开参考费率、before GST、not customer bill。

## 6. 执行步骤

- [x] 产出 Charles/Current 差异矩阵，并把每项标成 `retain / adapt / unavailable / drop`。
- [x] 为 waiting、partial、complete 三种状态先补 ViewModel/Renderer 红测。
- [x] 若 DTO 缺趋势/范围数据，补最小服务端 Projection 测试和字段；不得在前端复制公式。
- [x] 实现状态条、四 KPI、Estimate-vs-Actual 和局部切换。
- [x] 把旧 May 四周横条降级到 Method/Evidence 折叠区。
- [x] 验证切换不会修改整页 URL 主 Period、不会触发 AI、不会混用 Snapshot。
- [x] 完成聚焦测试、typecheck、production build 和 `git diff --check`。
- [ ] 使用 Chrome 验收 1440×900、1920×1080、tablet；至少覆盖 waiting 与 available/partial 状态。
- [x] 独立提交并回报 SHA、变更文件、测试、浏览器证据和未完成边界。

## 7. 验收标准

- 用户在 10 秒内能回答：预计多少、目前用了多少、进度是否偏离、哪个范围、下一步看哪里。
- 主路径外观和信息顺序与 Charles 一致，但不复制假数据。
- Daily/Weekly/Monthly 和 Portfolio/Centre 是 Section-local。
- waiting/partial/complete 均有自动测试，且没有全页横向溢出或 console error。
- A/B 验收继续满足：Saved A fixed、Current B updated、A/B Snapshot/Evidence 不混。
- 最终状态只能是 `DONE-ENGINEERING` 或 `READY-FOR-HUMAN`；Charles 尚未检查时不得写“已验收完成”。

## 8. 失败模式

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 页面仍只有 May 四周横条 | 只调整了旧 fallback 样式 | 停止验收，按第 4 节重构阅读结构 |
| Actual 与 Plan 数字都存在但无曲线 | DTO 只有聚合值，没有时间序列 | 补最小 Projection 字段，不在 React 推导 |
| Centre 切换后日期或 Snapshot 改变 | 错把局部范围当整页 Context | 保持统一 cutoff/Snapshot，只切 series |
| May-only 页面显示 On Track | 把 Estimate 当 Actual | fail closed 为 `Actual not available yet` |
| 为对齐 Charles 写入 simulated actual | 复制了原型数据 | 删除假数据，只使用正式 A/B 链 |
| 复刻过程中修改 AI Runtime | Task A/B 越界 | 回退该部分并交由 Task B |

## 9. 明确停止项

- 通用 Forecast 平台、ML Forecast、Scheduler/DSL；
- 浏览器端重算权威 Forecast/Actual；
- 静态写死状态、Centre、日期或数值；
- 为了有图而伪造 June actual；
- 与 Section 5 无关的全页 redesign；
- Task B 的 Prompt、Harness、Provider 和 Evidence Validator。

## 10. 2026-08-10 集成验收状态

状态：`READY-FOR-HUMAN`，不是 Charles 已验收。

- Task A A5 已集成到权威开发线；固定 May 1–31 页面不再错误显示整个 Forecast unavailable。
- 当前 Snapshot 已有的 June Estimate 直接显示为 waiting：26,240 kWh、S$7,156、0/30 complete days；Actual 与 Pace 明确等待，不制造 Actual。
- Daily / Weekly / Monthly 与 Portfolio / 30 Centres 均为 Section-local；真实 Chrome 操作后整页 URL 保持不变。
- 当前 1422px Chrome 无 document-level 横向溢出；精确 1920 与 tablet 仍保留为人工/设备验收项。
- 自动证据：56/56 聚焦测试、root typecheck、API build、Web production build、Impeccable detector 均通过。
- 与模板无关但会影响整页观感的独立 Task B 问题：当前 AI Artifact 文案存在英文单词粘连，且部分 Section 无匹配 interpretation。不得把它误报成模板完成度问题，也不得在本切片跨改 AI Runtime。

## 11. 下一切片：自然月 Monthly Energy Outlook

执行 Ticket：[GitHub #42](https://github.com/Zion74/energyiq-datafoundry/issues/42)。

### 11.1 产品决定

客户可见标题使用 `Monthly Energy Outlook`，动态显示目标自然月；不固定写 `June Forecast` 或 `Next month forecast`。

目标月由 Project timezone 下的 latest complete local day 决定：取其下一自然日所在月份。由此形成统一行为：

- 月初、尚无本月完整日：显示整月 Original Estimate，Actual/Pace 显示 `Awaiting first complete day`；
- 月中：显示本月 Actual to date、剩余日期 Estimate、Expected full-month outcome，以及同日期 Actual-vs-original-estimate pace；
- 月末完成后：最终 Actual-vs-original-estimate 进入冻结 History，Current Overview 进入下一个自然月 Outlook；
- Saved Analysis/History 保留保存时的 target month、Plan、Actual cutoff 和 Artifact，不随 Current Snapshot 改写。

### 11.2 三条数据语义

1. **Original Estimate**：目标月开始时冻结的原始日序列；同一 target month 内不被后续 Actual 覆盖。
2. **Actual**：只包含同一 Project cutoff 前的完整本地日；缺失或未完成日期不能当作 0。
3. **Current Outlook**：Actual to date + Original Estimate 中尚未发生日期的剩余值。首版不因短期 pace 自动放大未来，不建设预测模型。

图表用三种可区分语义表达：Original Estimate 虚线、Actual 实线、Current Outlook 的未来段使用第二种虚线或浅色区域。Daily / Weekly / Monthly 和 Portfolio / Centre 继续保持 Section-local。

### 11.3 四 KPI 与 Cost

- `Expected Full-month Energy`：Actual to date + remaining Estimate；
- `Expected Full-month Cost`：Expected Energy × 当前适用或 latest configured Tariff；
- `Consumed So Far`：Actual energy，并显示 Actual cost to date；
- `Pace vs Original Estimate`：相同完整日期范围的 Actual ÷ Original Estimate，不拿 MTD Actual 与整月 Estimate 比。

Preschool 当前使用 27.27¢/kWh before GST。费率覆盖目标月时标为有效 reference；超出有效期但仍沿用最新配置时必须标 `Provisional · using latest available tariff`，不能冒充目标月正式费率，也不应仅因此把 Cost 整块隐藏。

### 11.4 必须先验证的风险

- 28/29/30/31 天、闰年二月、跨年和 Asia/Singapore 月界；
- cutoff 当天是否已完整，不能把正在发生的日期算入 Actual；
- 同月迟到数据或修订可以更新 Current Actual，但不能改写 Original Estimate 或 Saved History；
- Project/Portfolio/Centre 必须共用同一 cutoff、target month、Plan identity 和 Tariff assumption；
- 月中缺日、partial day、scope 缺失时局部显示 Partial，不将缺口当零；
- 当前实现若无法复用现有 Planning Lifecycle/Saved Plan 冻结 Original Estimate，应停止并提出最小复用方案，不建设第二套 Forecast/Version repository。

### 11.5 完成判据

- [x] July 1 / July 15 / month complete 三种状态有服务端、ViewModel 和 Renderer 测试；
- [x] 28/29/30/31 天、跨年和 timezone 边界有确定性测试；
- [x] Original Estimate、Actual、Current Outlook 分别携带可追溯 identity；
- [x] 四 KPI 与图表使用同一数据合同，Cost 使用明确 Tariff assumption；
- [x] 局部 grain/scope 切换不改变整页 URL、不重跑 AI；
- [x] Saved A fixed、Current B updated，A/B Plan/Actual/Evidence 不混；
- [ ] 1440/1920/tablet Chrome 无横向溢出，等待、月中和完成态分别留证；
- [ ] 主 Agent完成代码、数据语义和浏览器复核后，才交用户/Charles 人工验收。

### 11.6 T12A 工程交付边界

- 服务端、ViewModel 与 Renderer 的确定性测试覆盖 waiting / partial / complete、自然月天数、跨年、Asia/Singapore 月界、Scope 隔离，以及 Saved A 不随 Current B 更新而改写；
- 未找到兼容 Frozen Saved Plan 时，Section 5 保留 Planning Baseline、目标月 Energy 和可用的 provisional Cost，仅将 Original Estimate 对比局部标为 pending；不为此新增持久化写路径；
- Tariff 优先使用目标月有效配置；超出有效期时显示 latest available provisional reference，完全缺失时只隐藏 Cost；
- 真实 Chrome 只按当前运行时实际可达状态留证。waiting 状态可用于布局与交互验收，partial / complete 仍需主 Agent在相应 Snapshot 运行时补充正向证据；
- 本切片不建设 ML Forecast、通用 Scheduler/Forecast repository 或第二套版本系统，不修改 Task B AI Runtime；Charles 人工验收仍是独立终点。

### 11.7 P1/P2 收口合同

- Preschool 根 Scope 的 Resolver 在同一发布路线与 `dataSnapshotId` 上读取 latest complete local day，不再从固定 Overview `context.to` 推断数据截止日；`context.latestCompleteLocalDay` 与 `context.monthlyOutlookTargetPeriod` 将该服务端结论显式交给 Web。若当前 Snapshot 没有任何完整本地日，只让 Section 5 fail closed，不中断 Section 1–4。
- 固定 May 1–31 Overview 可以随 Snapshot 推进：例如 cutoff 为 2026-06-30 时，服务端目标月为 2026-07-01…2026-08-01，timezone 为 Asia/Singapore，目标天数为 31；ViewModel 会拒绝与该目标身份不一致的旧 Forecast。
- 图表三条线互斥：Original Estimate 覆盖整月并使用虚线；Actual 只覆盖 cutoff 及之前的完整本地日并使用实线；Current Outlook 图线只包含 cutoff 之后的未来 Estimate，使用第二种浅色虚线。完整月 KPI 仍使用服务端权威的 Actual + remaining Estimate，不在 React 重算。
- 状态条和 cutoff 标签属于当前选中 Scope。Portfolio Complete 切到 Centre Partial/Waiting 时，状态、说明与 `Actual through …` / `Actual not started` 同步切换，不沿用 Portfolio 状态。
- 工程自动证据已覆盖 waiting / partial / complete；真实运行时 partial / complete 的 1440、1920 与 tablet Chrome 仍需相应 Snapshot 环境，不得用 waiting 页面冒充最终 Charles 验收。
