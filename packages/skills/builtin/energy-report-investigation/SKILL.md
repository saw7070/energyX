---
name: energy-report-investigation
description: Explore interval electricity data, select material findings and verify actionable energy-report conclusions across changing time windows.
metadata:
  version: "0.8.0"
---

# Energy Report Investigation

Read the current manifest, published project configuration, separate project context and selected time window. Inspect data with scripts or DuckDB, keeping large results in files. Published meter mappings define non-overlapping aggregation; relative meter magnitudes cannot establish wiring or independence. Project facts, source filenames and historical findings are inputs, not fixed Skill content.

## Complete analysis before editorial selection

For a full project report, save outputs/analysis-brief.md before composing HTML. This is the common evidence source for the full report and the smaller managed Insight-Action list. It is not another customer page. For a focused question or action-effect follow-up, scope the brief to that question.

Investigate project-wide use and cost where supported, non-overlapping contributors, changes over time, comparable day types and operating profiles, significant events, and supplied action progress. Follow additional evidence-led questions. For each applicable area retain the dated finding, scope/unit/coverage, reproducible calculation and chart-data paths, explanation versus hypothesis, practical meaning, and material limitations. Record why unavailable comparisons cannot be made. Stable performance and explanations that rule out an unnecessary intervention can be valuable findings without an action.

Complete the brief when a reviewer can reconstruct the project overview and important comparisons from retained calculations, distinguish measured facts from scenarios, and see which findings will appear in the report, enter the action list, or be omitted and why. Link actionable findings to the existing companion identifiers without inventing a second action store. The six active pairs and three homepage priorities limit managed recommendations, not the breadth of research or useful report evidence.

## Explore, select, replace

Start with the customer's decision before composing HTML. Independently calculate candidate opportunities, then compare with project-insights.json and project-actions.json. Match equipment, observed condition and intended change together. Preserve execution history. Propose updates; publication belongs to the application.

For each candidate retain the named circuit/location, evidence dates, measured magnitude, one primary action, conditional benefit, assumptions and calculation file. Prefer a specific operating decision over generic advice to investigate consumption. Estimate savings from controllable load and removable hours supported by readings, using the published tariff. Unknown switchability makes the scenario conditional and the next action a site check. Persistent consumption alone does not establish electrical leakage or a safety fault.

When all available data is supplied, use history for context and recheck relevance against the latest available complete seven days. Disclose actual dates and coverage; stale evidence is not a claim about today. Keep each comparison's denominator explicit.

Propose at most six active Insight-Action pairs and select at most three distinct decisions for the opening, with no minimum count. Record exclusions and proposed replacements in exploration-notes.md. An executed action awaiting data needs a progress update, not another instruction to execute it. Retain detailed evidence and spatial context in the report body; this shortlist is not an HTML template.

Recompute recurring questions, revisit prior unresolved issues when records are supplied, and independently explore changed load shares, weekday/weekend patterns, operating transitions, persistent loads, circuit events and data quality. Follow promising evidence beyond these examples. Compare equivalent windows and day types; expose changed definitions and missing comparison records.

Create candidate findings with evidence, magnitude, practical significance, uncertainty and a possible next action. Rank by impact, evidence strength, actionability and new information relative to prior reports. Select report evidence for both project understanding and operational decisions; the three opening priorities do not limit the body. Retain important persistent problems; retire resolved, duplicated, weak or lower-value material. There is no novelty quota and no obligation to reproduce an old headline or chapter.

Cluster candidates by the decision they support before choosing headlines. Continuous load, off-hours share and a switching scenario may be three pieces of evidence for one control decision, not three independent discoveries. Prefer distinct, supported decisions over a quota of findings. For each retained theme record its takeaway, decisive comparison, evidence/figure, material uncertainty and next action. Keep useful project context, descriptive comparisons and verified improvements in the report even when they do not yield an action. Keep redundant diagnostics and rejected unsupported claims in exploration notes. This is editorial selection after exploration, not a restriction on how widely to investigate.

Save facts and analysis/exploration notes containing selected and rejected candidates, selection reasons, unresolved hypotheses and prior-issue status supported by actual evidence. These are this run's records. Propose Skill changes only when a reusable method or explicit user feedback warrants them; do not silently overwrite accepted methods or schedules. Availability of stored prior notes does not imply they were loaded: inspect the supplied manifest before claiming continuity.

## Measurement and comparisons

- Sum published accepted interval energy, not cumulative registers; missing data is absence, not zero. Retain accepted cumulative differences spanning cadence gaps in observed energy totals, disclose them, and exclude them from regular-interval peaks/profiles unless a defensible allocation is explicitly supplied. Calculate group power by summing simultaneous channels before averaging. State exact time boundaries and complete-sample counts.
- For daily/day-type means, use fully covered comparable days or explicitly coverage-adjusted samples; never divide partial-day sums by all calendar days. Show eligible weekday/weekend counts. Partial valid readings may still belong in observed period totals, which must remain distinct from complete-day comparisons.
- Distinguish all valid channel-interval totals from totals on common aligned slots. Give the common coverage end and latest individual end separately when different; a single cutoff cannot describe both.
- Build hourly profiles from mean energy per complete one-hour sample (kWh per hour, numerically kW). Do not label energy summed across several days as hourly mean power. Attribute changes to coincident circuit contributions with explicit comparison hours.
- Define baseload statistic, hours and eligible days. Modelled constant-baseload share and measured night/off-hours share have different denominators and meanings; neither proves waste. Infer occupancy, equipment causes or faults only with corroborating evidence.
- Match exposure in every ratio: a constant-power estimate divided by common-slot energy must use the duration of those same common slots, not the entire requested calendar duration. A full-period model may be reported separately, but cannot be presented as a component of a shorter observed total. Reconcile stacked components to their stated whole.
- With no confirmed operating calendar, use "weekday daytime" and "outside the illustrative time window", not "occupied/unoccupied", "closed" or "shut-off works". Calendar/profile differences establish electrical patterns only. A later disclaimer cannot repair an unsupported causal headline. Compare historical findings only for the same circuit, hours and definition; omit an old percentage rather than juxtaposing unrelated dips.
- Screen against comparable per-circuit history, day type and operating segment; record training support. Use project-supplied relative AND absolute thresholds where appropriate, then inspect events rather than treating every threshold crossing as a fault. Account for normal switching from near-zero baselines.
- Internal weekday/weekend/baseload comparisons are not industry ratings. External benchmarks require an applicable source, matching scope, units, period and confirmed normalization inputs.

## Scenarios and validation

Separate measured usage/cost, normalized run rate, natural-month forecast and conditional savings. Use the supplied tariff or explicitly labelled scenario rate. Project only the day types actually represented: a weekday-only daily saving uses the target weekday count (for a standard 30-day approximation, 30×5/7), with weekend savings separately evidenced. Use actual calendar counts for a specified calendar month.

For overnight controls define whether samples are continuous cross-midnight windows or calendar-day bands. Retain complete windows or clearly justified coverage treatment; missing boundary slots must not dilute daily averages as zeros. State sample count, controllability/service assumptions, exclusions and whether scenarios overlap. Persistent load is an investigation target, not automatically removable consumption.

Verify the non-overlapping total independently and check the important derived quantities: time/day denominators, scenario weighting, subgroup attribution, baseline definition and all displayed occurrences. Keep useful conditional estimates when supported; name the missing site check rather than claiming realized savings. Save executable calculations, facts and notes; use the separate presentation Skill to compose HTML from the complete analysis brief and the selected actions.

Before delivery, audit every headline and caption against the computed facts and the published project information, not just the body text. Put the actual calculation script and headline facts in /workspace/outputs/ alongside the report so they survive the run; files left elsewhere are not archived supporting evidence. Do not state that a facts file was retained unless it exists there.

## Choose decisions with practical value
Explore broadly before ranking candidates by conditional benefit, evidence strength, implementation effort and new information. Prefer distinct feasible measures over three descriptions of the same load. Do not invent installation costs or payback; identify whether a timer setting, an inspection or a paid intervention is needed and state unknown costs. When a supplied tariff supports it, calculate the money value for the exact same eligible energy window. Never turn a small observed saving into an unsupported annual headline. An investigation is useful when it names the decision one concrete site answer would unlock; do not present every finding as a generic request to check equipment. Record selected and rejected candidates and trade-offs in exploration notes. Use the published device_name, not source labels or meter IDs, in visible content.

## Find decisions, not just patterns

Before selecting findings, investigate the main contributors to controllable energy across all available history, then verify relevance in recent complete comparable windows. For each candidate ask what specific decision the user can take, how much eligible energy it affects, how often the condition recurs, and what site fact could change the recommendation. Respect non-overlapping meter aggregation; do not add parent and child savings or overlapping measures.

Compare actionable hours with required operating hours only when the calendar and served equipment support that interpretation. Quantify recurrence with observed complete days/blocks, not a single unusual day extrapolated silently. Normalise unequal exposure only with a stated defensible method. Separate observed spending, eligible load and conditional removable energy. A forward monthly scenario must state expected operating days, removable hours, tariff and transfer assumptions; label it a scenario, never a measured monthly saving. Do not inflate a small opportunity to fill the homepage.

For every selected finding retain a reproducible chart dataset with time/scope/unit/coverage and the calculation that produced it in outputs. Choose a decisive comparison supporting the action, not merely a descriptive total. Explain in exploration notes why higher-consumption candidates were excluded (required service, overlap, uncertain identity, weak coverage or no feasible change). This is not a requirement to invent a safety warning, a third finding, or new findings every period.

When verified execution feedback exists, compare the same equipment and operating windows before and after, account for available calendar/context changes, and distinguish association from attributable savings. Without execution evidence, present a proposed scenario and the measurement plan; never fabricate an intervention or effect.

## Schools: academic breaks versus teaching periods

For school projects or inputs with published academic_periods, include academic-calendar analysis in the full analysis brief. Read the supplied project calendar; use its local half-open dates and source metadata. Keep three independent labels per date: weekday/Saturday/Sunday, public-holiday status, and academic phase. A weekend during term break has both labels. Treat term_break and vacation as school breaks; keep study_exam separate from normal teaching. Never infer breaks from low consumption or label missing calendar dates as teaching.

Compare school breaks with both preceding and following teaching periods when available. Report phase dates, complete sample days and daily mean/median rather than raw unequal-duration totals alone. For a like-for-like contrast first use non-public-holiday Monday-Friday samples in each phase; disclose weekday composition and use common weekday weighting or matched nearby weekdays when composition differs. Retain Saturday/Sunday and public-holiday views separately where sample support allows. Show missing comparison phases and small samples instead of inventing a representative baseline.

Calculate comparable 24-hour profiles for school break and teaching using the same eligible complete-day cohort as the primary phase comparison, preserving all 00:00-23:00 hours and per-hour sample counts. Distinguish equal-weekday-weighted daily summaries from unweighted sample-mean curves when both are used. Investigate changes in daytime demand, evening/night load, startup/shutdown timing and floor/circuit contributions. Use published operating windows only when confirmed; otherwise label clock-time bands. Keep the same meter set, units and coverage rules across curves. Follow material differences to the relevant equipment; explain stable patterns when no change is supported. Provide a compact phase comparison and a readable overlaid profile in a full school report when evidence supports them; chapter names and further figures remain flexible.

Distinguish calendar association from explanations and actions: school holidays do not prove office closure, lower occupancy, unnecessary operation, waste or electrical faults. Weather, maintenance and actual use may differ. A larger holiday load is a question to investigate, not automatically removable energy. Recommend a control change only when service needs and controllability support it; retain useful descriptive comparisons without forcing another Insight-Action entry. Save classification logic, sample selection, chart data and conclusions in outputs so the next period can recompute them from the current project's calendar. Dates and device identities remain project data, never hard-coded reusable Skill facts.
