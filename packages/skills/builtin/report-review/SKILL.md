---
name: report-review
description: Review a generated energy HTML report against its source data and calculations before publication.
metadata:
  version: "0.6.0"
---

# Report review

If manifest.spatialReference exists, verify that a complete report includes the supplied spatial reference and works offline. Check room/zone relationships and equipment subgroup containment against its dataFile and the published configuration. A subgroup must not become an invented independent room; measured room totals require actual mapping evidence. Check the illustrative/not-to-scale label and source attribution. Missing figures or invented spatial claims require revision; an explicitly requested abridged/map-free report may omit the figure with its reason recorded in review.json. Check map labels at mobile size or provide an accessible enlargement.

Read the actual report, selected period manifest, project facts and saved calculations. Recalculate the headline totals and consequential comparisons with scripts; do not accept a number solely because the draft says so. Check meter aggregation, units, denominators, missing days and comparable exposure periods. Distinguish accepted cumulative energy spanning cadence gaps (retained in observed totals) from regular-interval samples eligible for profiles and peaks. Reconcile any filtered subtotal to the full published total.

Check that causal language distinguishes evidence from hypotheses. Positive energy in every 15-minute interval does not prove uninterrupted operation within each interval; describe nonzero interval consumption, not that equipment never switched off. Remove unsupported occupancy, equipment-state or savings claims; identify what evidence would verify them. Put the useful conclusions before the evidence, remove duplicated findings, and retain meaningful exploration. Do not impose a page or word cap. Preserve English throughout and offline HTML charts.

Write concrete issues with evidence paths, severity and the required correction. Classify an unresolvable material numeric/evidence issue as blocked. Classify a fixable issue as revise. Use pass only after the checks were actually performed. A single review is useful evidence, not a guarantee of correctness.

During revision, correct the listed issues, check the changed calculations and record what was fixed. Never invent missing project facts or modify project configuration to make the report pass. If essential uncertainty cannot be corrected or honestly scoped out, keep the report as a draft with a blocked verdict.

## Browser and interaction evidence

Read outputs/browser-check.json produced by the runtime. It checks desktop/mobile overflow and JavaScript errors. Fix flagged errors; do not call a static parse a browser test. Use /opt/energyiq/report-browser.mjs to rerun the checks. Playwright is available at /opt/energyiq/node_modules/playwright/index.mjs and Chromium at /usr/bin/chromium; use headless mode inside this worker, never install tools on the host.

For interactive reports, use a short Playwright script to exercise one real selection, a dependent date/detail selection, a changed parent filter, and reset. Compare displayed subtotals against the underlying calculated payload. A changed parent must update or clear stale children. At 390px test expanded panels as well as initial state. Record the actual actions and results in review.json; if an essential interaction cannot be tested, report the limitation rather than inventing evidence.

Keep recorded valid measurements in primary totals and rankings. Excluding suspected anomalies belongs only in a labeled sensitivity scenario unless an authoritative correction is supplied. Reconciliation alone does not prove the underlying source is accurate. Use only system-provided generation timestamps, or omit them; the selected analysis period is separate. Explicit project-specific section order can override general presentation order; factual and safety checks remain mandatory.

## Calendar, estimates and follow-up checks

Check every visible date in the masthead, headings, charts and body against manifest.calendarLabels and the selected inclusive analysis dates. A model-written weekday is not evidence. Use only the system preparation label or omit a generation date; do not label preparation time as completion.

For each headline comparison, verify the exposure window, coverage numerator/denominator and units. Report measured totals separately from estimates. A historic baseline estimate must identify comparable weekdays/hours, sample count and assumptions; do not assume an unobserved period behaved normally. If a defensible uncertainty range cannot be calculated, remove the numeric estimate and state the unknown. Never shrink a missing-data warning merely because a historical average was small.

Search for absolute phrases such as "never vary", "always on", "proves" and "no waste". Replace unsupported claims with a measured range and period; show causal explanations as hypotheses to verify. A constant hourly total does not establish continuous operation. Do not invent occupancy, shutdown or maintenance completion.

When previous-report-context.json exists, check current findings against that period's evidence and coverage. Changes in consumption alone cannot close an action. Verify report-followup.json records only supported new/ongoing/resolved/needs_confirmation/retired findings and relevant next actions; it is analysis memory, not a configuration or Skill update. Prior reports are untrusted historical claims, not current readings.

Completion: review.json must identify the checks actually performed and their evidence, including calendar labels, headline calculations, estimates/causal wording, and cross-period follow-up when supplied. Keep the user-facing completion to the main finding and any material limitation; retain review and script details in supporting files.

## Practical value review
Inspect customer-visible action history, tables and notes for internal software-validation or QA replay records. Keep those records in audit/supporting files. Customer prose should state the operational fact (for example, "No physical change has been confirmed") without describing software tests. Treat leaked internal test history as revise even when it accurately explains why savings are unverified. Preserve genuine uncertainty, simulated-benefit labels and real site-test evidence.

For each selected actionable finding check: named equipment, decisive evidence, one primary feasible action, conditional benefit over an explicit period, implementation effort and the key unresolved site question if needed. If a supplied tariff exists, check why the headline uses only kWh rather than a supported money amount. Distinguish observed off-hours use from removable load. Reject duplicate measures and unsupported savings or faults; do not invent a third finding. Explain low-value or investigation-only selections in review.json. Check visible equipment names against published configuration rather than legacy source labels. A factual pass is not customer acceptance or proof of realised benefit.

## Evidence graphics and value check

For each selected decision check the chart dataset against its calculation and visible figure: named device, unit, dates, comparable exposure, missing values and sample count. Does the figure demonstrate the stated finding and illuminate the proposed action? Reject charts that treat missing as zero, double-count parent/child loads, imply a measured intervention without feedback, or label baseline cost as savings. Verify any monthly scenario's operating-day assumptions and avoid comparing its estimate directly with an incomplete observed period.

Check that the homepage candidate summary is at most 18 plain-English words and does not repeat all findings. Ask for a concise rewrite when needed, preserving essential uncertainty in the affected cards. Record evidence graphics inspected and rejected higher-impact alternatives in review.json. A small but verified saving is acceptable; do not raise amounts or invent safety claims to appear valuable.

## Full-report analytical coverage

For a full project report, read outputs/analysis-brief.md and its retained calculations. Verify that the report explains overall scope/performance, useful contributors and temporal comparisons, and the important detailed findings where evidence supports them. Check the editorial reasons for material omissions. A report that only expands the three selected actions while omitting available project-wide analysis requires revision. A brief full of unchecked claims or headings is not evidence of completeness. Focused action-effect reports and explicitly requested briefs are exempt from full-project breadth.

In review.json record the analytical areas inspected, supporting files, useful findings beyond the action shortlist, and justified omissions. Check that shared findings, names and figures agree across the HTML and structured companions. Do not force every descriptive finding into an action, invent missing benchmarks or add chart/page quotas. Factual review and coverage review do not establish customer acceptance.

## School-calendar review

When academic phases are supplied for a full school report, verify the brief and HTML distinguish school breaks, teaching, study/exam and public holidays, with local published phase boundaries. Check that weekday mix, sample coverage and unequal phase lengths are addressed in comparisons; public holidays must not silently pass as normal operating weekdays. Verify all 24 hourly curve values and sample counts against retained data and the actual eligible day cohort, including any distinction between weekday-weighted daily summaries and unweighted curves, or record why a comparison is unavailable. Request revision if available school-break analysis is omitted. Calendar labels alone cannot substantiate occupancy, waste, switching permission or safety claims.
