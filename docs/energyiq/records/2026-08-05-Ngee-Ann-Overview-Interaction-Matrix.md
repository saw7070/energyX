---
title: "Ngee Ann Overview Interaction Matrix"
summary: "冻结 Ngee Ann Overview 的保留、适配与放弃交互，以及 URL、局部状态、Evidence、恢复和浏览器验收边界。"
doc_type: implementation_record
tags: [Overview, Ngee Ann, Interaction, Evidence, Chrome]
updated_at: "2026-08-05"
related:
  - "../handoff/agent/2026-08-04-Overview-AI-New-Orchestrator-Handoff.md"
  - "../research/2026-08-03-NetZero-Prototype完整理解与复用审计.md"
status: accepted
---

# Ngee Ann Overview Interaction Matrix

## 1. 决策与边界

本矩阵落实 GitHub Issues `#6`、`#7`、`#8` 和 `#9` 已批准的 Ngee Ann 交互合同。它不是新的交互 DSL、事件总线或配置平台。

- 所有模块共享同一 Primary Period、Published Project Release、Data Snapshot 和 Evidence pins。
- 只把 `projectId`、`scopeId`、`resource`、`period`、`from`、`to`、`grain`、`comparison`、`category` 写入 Overview URL。
- Dialog open、hover、选中点/单元格、展开状态和焦点属于临时局部状态，刷新后不恢复。
- React 只选择、格式化和显示 Snapshot/ViewModel 已有结果，不计算权威指标、异常、排序或去重。
- AI Analyst 是可选下游，不改变确定性 Overview 的完整性与权威性。

## 2. Approved Interaction Matrix

| Interaction | Source state | Retain / Adapt / Drop | Trigger | Result | Snapshot / ViewModel payload | State owner | Evidence | Empty / partial behaviour | Close / recovery | Keyboard / motion | Owner / browser evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Project / Scope / Resource / Period / Custom date | Published access、Hierarchy、URL View State | Retain and adapt | Select Project/Scope/Resource/Period or edit native date | Re-resolve one authoritative Snapshot; URL updates without changing the requested Period silently | `context`、`primaryPeriod`、`projectRelease`、`dataSnapshot`、Hierarchy | URL context state | Release/Snapshot/Hierarchy/Mapping/Formula/Metric pins | Invalid selection fails closed; no-data Period remains selected and exposes latest available range | Browser back/refresh restores URL state; no module-local state is carried across Snapshot | Native controls and buttons; visible focus; reduced motion does not affect correctness | `#6`; `D:\Projects\energyiq-datafoundry-artifacts\t06-overview-20260804\ngee-ann-overview-e935e53-1440x1000.png`, `...1920x1080-v2.png` |
| View latest available data | Current no-data resolution | Adapt | Explicit CTA | Replaces the Period/date only after user action and reruns the Snapshot | `latestAvailablePeriod` | URL context state | Resolver-provided range and next Snapshot pins | CTA is absent when the server has no trustworthy range | Resulting URL is shareable; browser back returns to the honest empty Period | Button is keyboard operable; no animation dependency | `#6`; same #6 Chrome flow, repeated at #9 default Last 7 gate |
| Peak breakdown | Peak KPI and optional same-interval breakdown | Retain and adapt | `View peak breakdown`; select Project/Level; expand Circuit evidence | Shows server-owned same-interval Project/Level contributions and explanatory Circuits | `peakBreakdown` | Dialog-local Scope/disclosure | `peak_breakdown_v1` plus same Snapshot pins | Missing/invalid payload withholds only breakdown; partial Period is labelled | Close/Escape resets to Project and returns focus to trigger | Focus enters/traps in dialog; Enter/Space; reduced-motion safe | `#8`; `D:\Projects\energyiq-datafoundry-artifacts\t08-peak-breakdown-20260805\chrome-*.png` |
| Level / Category / Circuit composition | Server-projected Level/category/Circuit rows | Retain and adapt | Select Level/category; Top 5 ↔ All | Filters already-projected rows; official total and explanatory component boundary remain unchanged | `levelComparison`、`energyComposition` | Category is URL context state at #9; Level/Top 5 are local | Same Snapshot provenance; official aggregation and reconciliation payload | Empty combination is explicit; Category/Circuit/accounting/derived subsections fail closed independently | Filter change returns ranking to Top 5; collapse/reopen is coherent | Buttons/disclosures with `aria-pressed`/`aria-expanded`; visible focus | `#7`; `D:\Projects\energyiq-datafoundry-artifacts\t07-composition-20260805\ngee-ann-overview-composition-17a7c64-1440x2200.png`, `...1920x2200.png` |
| Accounting / Derived meter trace | Published official route and formula trace | Retain and adapt | Expand/collapse Accounting or Derived trace | Explains designated totals and `Load 12`; never adds explanatory values to official total | `energyComposition.accounting`、`virtualMeterTraces` | Disclosure-local | Mapping/Formula revision and term identities/contributions | A bad trace withholds only Derived trace; no zero or partial sum substitution | Collapse/reopen preserves a coherent parent module | Native disclosure buttons; keyboard operable; visible focus | `#7`; `D:\Projects\energyiq-datafoundry-artifacts\t07-derived-meter-trace-20260805\ngee-ann-overview-derived-trace-ready-1f79d81-1440x3400.png`, `...1920x3400.png` |
| Trend | Server daily totals or authoritative single-day hour grid | Retain and adapt | Scope switch; hover/focus/select point | Shows exact server point and quality for the same Period; Period change clears selection | `energyTrend`、`timeBehaviour.hourGrid` | Point/Scope selection local | `daily_totals_v1` or `time_bucket_grid_v1` and same Snapshot pins | Missing optional hour grid fails only hourly Trend; partial point displays health | New Period/Snapshot clears stale point | Points are focusable/selectable; motion is non-essential | `#8`; `D:\Projects\energyiq-datafoundry-artifacts\t08-time-behaviour-20260805\` |
| Day Profile | Server-owned day-type profile | Retain and adapt | Select Day Type and Scope | Shows 24 server values and sample-day count | `dayProfile` from `timeBehaviour` | Module-local | `time_bucket_grid_v1`, Calendar classification and same Snapshot pins | Unsupported Public Holiday is explicit Unavailable, never zero-filled | Selection remains local and resets with renderer/Snapshot | Keyboard-operable buttons; non-essential transitions respect reduced motion | `#8`; `D:\Projects\energyiq-datafoundry-artifacts\t08-time-behaviour-20260805\` |
| Usage Heatmap | Server-complete date/hour and Level/hour grid | Retain and adapt | Change View/Level; hover/focus/select a cell | Shows exact cell usage and health; no client aggregation | `usageHeatmap` from `timeBehaviour` | View/Level/cell local | `time_bucket_grid_v1` and same Snapshot pins | Partial/unavailable cell remains visibly qualified; invalid bundle withholds only module | Selection clears with Period/Snapshot; page context remains | Cells are keyboard focusable/selectable; motion is non-essential | `#8`; `D:\Projects\energyiq-datafoundry-artifacts\t08-time-behaviour-20260805\` |
| Daily anomaly incident | Server-owned triggered incidents and detail series | Retain and adapt | Open incident; choose comparison, Scope and category | Shows actual/baseline series and ordered driver Evidence; no client threshold or ranking | `dailyAnomalies` | `comparison`/`category` are URL context state; dialog/Scope are local | `time_slot_anomaly_v1`, Rule/Calendar and same Snapshot pins | Absent/invalid/suppressed payload fails closed locally and never means “normal” | Close/Escape returns focus; dialog closes on refresh; persisted comparison/category restore when reopened | Focus enters/traps in dialog; buttons keyboard operable; no browser alert/confirm | `#8`; `D:\Projects\energyiq-datafoundry-artifacts\t08-anomaly-20260805\chrome-*.png` |
| Decision priority → Evidence | Server-owned ranked priorities | Adapt for #9 | `View evidence` | Moves to the exact same-Snapshot incident card; priority remains Finding → Evidence → Impact → Action → confidence | `decisionPriorities` plus matching `dailyAnomalies` incident | Anchor fragment transient; no new analysis state | Priority pins, bundle/query/rule/metric/Period/Scope occurrence | Available/empty/partial/suppressed/unavailable are explicit; invalid child or pin mismatch withholds all priorities | Browser back/refresh keeps nine-field View State; fragment/dialog state is not persisted | Anchor is keyboard operable and visibly focused | `#9`; final Chrome evidence is recorded in the #9 delivery comment and `t09-overview-20260805` artifacts |
| AI Slot lifecycle | Current user authorisation、Renderer-validated deterministic projection、Published Release and Snapshot identity | Adapt for `#17/#9` | Deterministic Snapshot becomes ready | Automatically starts exactly one current-user Run for the Project/Scope/resource/Snapshot/cutoff identity; local comparison/category, disclosure and link changes do not restart it | `decisionPriorities`、Project/Scope/resource、Snapshot/cutoff and authoritative revision pins | Client page-lifecycle state keyed only by authoritative Run identity; no scheduler/cadence | Server-authorised scoped datasource、Analysis Pack、Context Package and same Snapshot/cutoff | Invalid deterministic projection withholds the Run; queued/running shows Thinking; unavailable Provider/model/tool state leaves deterministic Overview intact | Snapshot identity change replaces stale AI state; local UI remounts reuse the same current Run | Thinking status is announced; pulse stops for reduced motion; no explicit start control | `#17/#9`; `.scratch/overview-acceptance/ngee-ann-overview-stepfun-chrome-1440-ai.png`, `...1920-ai.png` |
| AI Finding Evidence / Ask AI deeper | Exactly three AI-labelled Findings from the current `#17` Run | Adapt for `#17/#9` | `View evidence` / `Ask AI deeper` | Opens Finding-specific SQL Evidence, or opens the full Analyst with an untrusted Project/Finding/Evidence draft prefilled without auto-submit | Finding What/Why/How/verify、horizons、relationship、Snapshot/cutoff、quality scope、tool result and audit refs | Evidence dialog is transient local state; Analyst resolves a newly authorised context | Same-Run SQL/query result and tool/audit references; deterministic values remain separate | Invalid Run output fails the AI layer closed; no Finding or handoff substitutes mock Evidence | Close/Escape/backdrop returns focus to the originating Finding; browser back returns to Overview | Focus enters/traps in Evidence; Close and native links are keyboard operable; no meaningful motion dependency | `#17/#9`; `.scratch/overview-acceptance/ngee-ann-overview-stepfun-chrome-1440-evidence.png`, `...1920-evidence.png`, `ngee-ann-ai-deeper-prefill-fixed-1920.jpg` |
| Project Explorer / AI Analyst handoff | Current nine-field URL View State | Retain and adapt | `Open Project Explorer` / `Ask AI Analyst` | Opens the downstream route with the same approved context fields; AI remains optional | Current Snapshot context; downstream resolves its own authorised context | URL context state | Project/Scope/Period/resource/grain/comparison/category; current Snapshot remains visible in Overview Evidence | Links remain honest when priority state is empty/unavailable; deterministic Overview does not depend on AI | Browser back returns to the same Overview View State | Native links, keyboard operable, no modal state persisted | `#9`; final Chrome evidence is recorded in the #9 delivery comment and `t09-overview-20260805` artifacts |
| Separate duplicate Key Highlight modal | Charles prototype-only duplicated interaction | Drop | None | Existing Level, Composition, Peak and Evidence modules answer the decision question without a second payload | None | None | None | No fallback mock | Not applicable | Not applicable | `#7/#9` stop list |

## 3. #9 whole-page acceptance record

The final #9 browser pass must verify both fixed states without changing this matrix:

1. Fixed Golden: `/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all`.
2. Default empty: the same Project/Scope/resource with `period=Last+7+days`, `grain=day`, `comparison=overlay`, `category=all`.
3. Actual Google Chrome at 1440px and 1920px: no horizontal overflow; priority-to-Evidence handoff; comparison/category refresh restoration; Peak and Anomaly Escape/Close/focus return; key Level/Composition/Day Profile/Heatmap interactions; Explorer/AI handoff links.
4. Chrome screenshots and automated tests are engineering evidence only. Charles' information-value, visual-equivalence and analysis-depth acceptance remains a separate human gate.

## 4. 2026-08-05 engineering acceptance

Integration acceptance was completed on `c70273c` plus the matrix-only documentation commit that follows this record.

- Fixed Golden resolves Published Release `ngee-ann-polytechnic-template-v6`, Snapshot `energy-snapshot-03499dcda183ae28c47f7d66`, `2,688 / 2,688`, 100% coverage and zero quality events.
- Server-owned priorities are exactly 13 Jun `105.626 kWh`, 14 Jun `64.6002 kWh`, and 11 Jun `49.514 kWh` above baseline. Headline display is `1,531.17 kWh`, `218.74 kWh/day`, `20.67 kW`, `26.4% higher`, and `S$489.97`; raw Evidence keeps its higher precision.
- Priority 1 `View evidence` resolves the exact 13 Jun Project incident. The target exists and is visible after navigation.
- Anomaly `Selected` + `Load` persists as `comparison=selected&category=load`; refresh restores both values but does not reopen the transient dialog. Close and Escape return focus to `Open incident detail`.
- Peak dialog opens with focus on Close, Level 7 returns `12.0637 kW`, its Circuit disclosure contains seven server rows, and Escape returns focus to `View peak breakdown`.
- Explorer receives the same Project/Scope/resource/Custom dates, shows `1,531.17 kWh` and the same Snapshot; the AI Analyst link receives the same nine URL fields and displays the Custom context.
- Default Last 7 remains on 29 Jul–4 Aug 2026 with 0% coverage, explicit Unavailable values, an honest Calendar limitation and a user-triggered `View latest available data` continuation. The CTA, and only the CTA, changes the URL to the latest complete 10–16 Jun range.
- Actual Chrome has no page-level horizontal overflow at either required viewport: Golden `1430 / 1430` and `1910 / 1910`; empty state `1440 / 1440` and `1920 / 1920`.

Artifacts are under `D:\Projects\energyiq-datafoundry-artifacts\t09-overview-20260805\`:

- `chrome-1440-golden-top.png`
- `chrome-1920-golden-top.png`
- `chrome-1920-priority-evidence.png`
- `chrome-1920-anomaly-selected-load.png`
- `chrome-1920-peak-level7.png`
- `chrome-1920-explorer-handoff.png`
- `chrome-1440-last7-empty.png`
- `chrome-1920-last7-empty.png`
- `chrome-1440-golden-where.png`
- `chrome-1920-golden-when.png`

Automated gates:

- focused API/Web/Explorer: 6 files, 230 tests passed;
- full Web: 81 files, 872 tests passed;
- root TypeScript, API production build and Web production build passed; 17 routes include `/register`;
- combined EnergyIQ seams: 79/80 passed in parallel; the only timeout was the unchanged Preschool portfolio case at 32.0 seconds against its 30-second test wrapper. The identical case passed alone in 22.6 seconds without changing its timeout or SQL safety boundary. This is retained as parallel-test contention evidence, not represented as an Overview regression.

No engineering gate is substituted for Charles' explicit human acceptance.
