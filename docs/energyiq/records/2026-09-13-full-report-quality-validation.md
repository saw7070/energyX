# Full report quality validation — 2026-09-13

## User decision

Full customer reports must not inherit smoke-test limits. Keep the leading 3–4 conclusions easy to scan, then develop the evidence, diagrams and actionable analysis. Do not use word count as a proxy for quality.

The deployed validation prompt explicitly limited its output to 600 English words and one chart. The shared presentation Skill also recommended 1,200–1,500 words. The source Skill is now version 1.0.1 with no default word, page or chart count. Length limits apply only when explicitly requested by the user. This source change is separate from production activation; the real online run overrides the old recommendation through the normal conversation prompt.

## Real production run

- Session: `5e133985-3836-4c2f-817f-ef39185bddb7`.
- Full initial report: `c0a1a4c8-e6b9-4124-9eed-aa688f248710`.
- Editorial revision: `f75b5877-682b-4869-8c28-52cfce440251`.
- Complete-day comparison correction: `ba772024-819e-4ed1-b85c-8c65000d72c1` (completed; output and key calculations verified).
- Submitted through the authenticated production conversation UI; no temporary session creation was used.
- Actual analysis: 17 August–11 September 2026, Asia/Singapore. The UI selected all available data; the Agent filtered to the requested window. Current library title uses the wider requested transport window (16 August–12 September); this display mismatch remains to fix. Report body and calculation window are explicit.

## Checks and findings

Initial full report: 53,595 bytes, approximately 2,802 English words including table/chart labels, 6 inline SVGs, 5 tables, no external asset URLs or Chinese text. It contains a nine-room schematic, daily consumption, continuous load analysis, internal benchmarks, circuit findings, conditional controls and ranked actions. Full-screen browser preview loaded successfully.

Independent calculation from the actual run input: seven official routes total 2,387.517057825137 kWh; 18 fully covered weekdays and six weekend days. Full-day project means: 99.88140926299137 and 68.04097846945551 kWh/day. The aggregate agrees with the first full report, but its original weekday daily means divided partial Lighting days by 20. Requested an explicit calculation correction, preserving partial days in actual observed totals.

Editorial revision requested removal of causal occupancy claims and customer-visible technical identifiers, with business labels from published configuration. Electricity patterns alone do not establish presence or operating schedules. Do not treat successful file creation as evidence that all analytical statements are correct.

Reference comparison: Charles HTML has approximately 1,365 visible English words. Its five analytical sections, clear charts and spatial context are the useful comparison criteria; a longer generated report is not automatically better. Reference HTML source was inspected; direct local-file browser opening was blocked by browser policy, and no browser workaround was used.

Source input-packaging regression: 15 report-input tests passed; `git diff --check` passed. Supporting input, artifacts and independent calculation evidence remain under ignored `outputs/report-integration-20260911/full-report-review/` rather than committing project data.

## Final result

Final HTML: 56,319 bytes, approximately 3,265 visible English words including labels, six SVGs and five tables; no external assets or Chinese text. Independent official total and complete-day project averages agree within 1e-6. Unsupported occupancy-causal phrases and technical header identifiers were removed. Final production full-screen preview loaded.

Report: https://energyiq.top/energyiq/library?projectId=tuya-office&reportId=ba772024-819e-4ed1-b85c-8c65000d72c1

Acceptance is bounded: the real online full-report and conversational-revision loop works, and the audited headline/comparison figures agree. It is not yet equivalent to Charles editorial acceptance. The result remains more verbose than his reference, puts a long evidence caveat before conclusions, and some visible business labels still use generic meter names. The next refinement should improve editorial selection and naming, not restore a fixed word cap. No periodic automation was enabled and no new production application release was deployed in this task.
