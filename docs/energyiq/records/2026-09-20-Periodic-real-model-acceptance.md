# Periodic report real-model acceptance — 2026-09-20

Branch: codex/all-history-report-schedules. Base implementation: 291242e8. Tracking: #246.

## Scope and execution

Two real GPT-5.6 Sol runs used the production Pi Docker harness in a separate acceptance process. No production report, action, homepage or schedule was changed. Local Docker failed on its dockerInference listener; no reset was performed.

Frozen real Tuya inputs came from report a49a8e7d-c842-49ae-96ae-8dd4ba54d78e, snapshot energy-snapshot-6089247b3283ee7045129031. Data range: 16 August–13 September, 44,029 interval rows. This is a historical replay, NOT validation of the September 20 recovered snapshot or a live calendar trigger.

The new reportPrompt and scheduledAnalysisPrompt were used. Runtime image: energyiq-report-agent:quality-20260914-delivery. Weekly focus: September 7–13; monthly focus: August, explicitly missing August 1–15. Full-history inputs remained available to both.

## Verified

- Both real model runs produced HTML, action-suggestions.json, key-point-candidates.json, calculations, desktop/mobile screenshots and passed automated review.
- Independent raw CSV recomputation: weekly official usage 581.9897254781 kWh; August observed official usage 1363.8433552084 kWh; full-history usage 2482.0152447694 kWh. Report figures agree after rounding.
- Weekly lighting scenario: 9.8847804745 kWh over five complete weekday 20:00–22:00 blocks, SGD 3.1542334494 before GST. Displays: 35.8188221623 kWh across seven complete weekend daytime blocks, SGD 11.4297861520 before GST. These are conditional upper-bound scenarios, not achieved savings.
- Both outputs passed actual quote/meter validation and registration against a disposable in-memory copy of local Action/Insight tables: created 0, linked 3, needsReview 0. All existing action states and revisions stayed unchanged. No synthetic user execution was added.
- All three featured action IDs remain stable across the two reports. Raw canonical action wording retains some old identifiers for matching; inspected HTML uses current display names.
- Monthly initial review requested correction of an invented measure key, unsupported responsible-role assignment and incomplete map text alternative. The model repaired these; final review passed.
- Desktop and mobile screenshots were inspected; spatial diagrams and numbered findings are present.

## Defect found and fixed

Before the fix, monthly evidence ending September 1 could overwrite weekly evidence ending September 12 because both analyses shared the September 14 full-history cutoff.

KeyPointStore now rejects a publication whose matching action has an older evidence end than the existing publication (KEY_POINT_STALE_EVIDENCE). The current homepage remains intact; the report remains available. Eight focused tests and API build passed. Replaying actual output confirms weekly publication succeeds and retrospective monthly publication is blocked.

This is a conservative publication guard, not automatic merging of mixed-freshness candidates. Separate homepage-current selection from retrospective report selection in the next iteration.

## Acceptance verdict

Technical historical replay: passed for generation, calculations, reference validation, deduplication and state preservation. Homepage stale-evidence protection: passed after repair.

Customer-content acceptance: not fully passed. Monthly HTML still mentions a historical software-validation replay despite instructions to exclude QA history. Weekly mobile header is cramped; wording such as bounded decisions remains too technical. Both reports choose the same three themes with period-specific evidence; this validates continuity but does not demonstrate novel high-value opportunities or a materially stronger monthly management review. Headline monetary figures should make their conditional nature visible beside the number.

Not verified here: fresh September 20 snapshot export, actual Monday/month-start trigger, new candidate creation with baseline registration, completed physical action outcomes, production deployment, or browser interaction with published new reports. Frozen replay must not be presented as completion of those checks.

## Artifacts

Local evidence: outputs/periodic-acceptance-20260920/ (untracked, contains prompts, runner, independent calculations, real outputs and replay validation).

- weekly/outputs/report.html
- monthly/outputs/report.html
- weekly/outputs/review-receipt.json
- monthly/outputs/review-initial.json and review.json
- independent-totals.json and independent-benefits.json
- registration-validation.json

Server evidence: /opt/energyiq-datafoundry/shared/backups/periodic-acceptance-20260920/. Model credentials were only read inside the existing API environment and are not part of artifacts.

## Fresh-data acceptance, second pass

The live service prepared inputs through run `ff6f5e88-eb85-46ed-8b48-1fc4f70491c1` from snapshot `energy-snapshot-674de3fddca404c4532bbc11`: 55,664 analysis rows, available history from 16 August through 20 September 01:45 SGT. This is actual latest individual interval end, not proof of complete coverage. The weekly issue 14–20 September is intentionally an incomplete current-week acceptance example, not a completed scheduled week.

Both weekly and monthly real GPT runs produced reports and passed the old automatic review. The new cadence methods were included in the prompts; production project methods remained unchanged. This is an isolated harness run, not proof of deployed cadence loading or a live Monday trigger.

Independent CSV calculations in `outputs/periodic-acceptance-20260920/verify-v2.py` confirmed:

- Weekly observed official total: 618.0198055335 kWh.
- Comparable complete weekdays: 543.4258826888 versus 506.3444196035 kWh.
- Lighting 20:00–22:00: 16.4714798692 kWh across 40 intervals, conditional SGD 5.2560492262 before GST.
- Three display channels on Saturday 09:00–18:00: 5.1211702733 kWh across 108 intervals, conditional SGD 1.6341654342 before GST.
- August observed official total: 1363.8433552084 kWh. Later readings were not added to the month.

The weekly report selected two decisions rather than filling a third slot. Disposable registration replay linked two existing actions, created none, preserved states, and again rejected retrospective monthly homepage publication with `KEY_POINT_STALE_EVIDENCE`.

Manual desktop inspection caught internal QA history in the weekly body despite its automatic pass. Review Skill 0.4.2 and a narrow deterministic customer-prose guard now require revision for this leak; genuine site tests, showroom demonstrations and clearly labelled estimates remain allowed. The guard is run again after revision and blocks residual leakage. Seventeen related local tests and three calendar tests passed; API build passed. An isolated worker image was built from the existing production image with only this review module replaced. Production image selection was not changed.

Targeted model revision passed for weekly v3 and monthly v4. Both final receipts pass, the deterministic customer-prose check finds zero matches, and monthly totals remain unchanged. Monthly v3 returned an input-path clarification instead of a report and is explicitly NOT an accepted run; v4 uses absolute workspace paths and requires a passing receipt before recording success.

Final disposable registration replay still links two weekly actions without duplicates or state changes, and blocks stale monthly homepage evidence. Eighty-three related tests pass (63 service/library/action tests, 17 maintenance/review/selection tests, three calendar tests); API and Next production builds pass. No generated HTML was edited by the developer.

Remaining acceptance boundaries: no actual physical intervention was performed; model output remains modest in monetary opportunity, not proof of large customer savings. The fresh-data harness did not exercise the new service-generated insight-maintenance.json or production cadence loading. Production rollout and enabled schedule verification remain separate release steps.


## Production rollout and live acceptance — 20 September, 19:20 SGT

This section supersedes the earlier pending-deployment statements, which describe the isolated replay stages.

- Deployed code: `879b388492552f9a74c17024867b3b11f4a28245`; API and Web are active on energyiq.hima.sg. Candidate readiness was checked before switching. Rollback release `b0ab118686e1979cb8e90451afbb4c485bb510ba` and pre-release metadata/environment backups remain on the server.
- Worker image: `energyiq-report-agent:acceptance-review-20260920`, carrying the deterministic customer-prose review guard.
- Saved through the actual admin Automatic reports dialog: weekly-monthly, 03:00 Asia/Singapore, revision 19. Next eligible weekly trigger is 21 September; next monthly trigger is 1 October. A future calendar trigger has NOT yet been observed.
- Real production preview run: `5b51b7f5-2ab8-4c86-9c6c-3b6a50ea3961`, session `ed02728d-bdb4-40fc-8701-2bea40250ef0`. It succeeded and passed review at 11:20 UTC. This is a manually enqueued current-week preview through the live worker, not a completed scheduled week.
- Actual service inputs contain all available history `[2026-08-16, 2026-09-21)` and a separate weekly issue `[2026-09-14, 2026-09-21)`. `energy-weekly-brief` 0.1.0 was loaded; production analysis method remains 0.4.1. Candidate analysis 0.5.1 was not promoted.
- Service-generated insight-maintenance input grouped four considering, one following-up and two historical items. Registration linked three existing actions, created zero, and required zero manual reviews. Latest Key Points publication revision 2 references this run and contains three featured points.
- Stored Tuya action count remained 11 and stored state fields were unchanged versus the pre-release backup. This narrow check is not proof of unchanged event histories or a physical intervention.
- Independent calculations on the same frozen snapshot reconcile observed total 618.0198055335 kWh, lighting 16.4714798692 kWh / conditional SGD 5.2560492262, and displays 5.1211702733 kWh / conditional SGD 1.6341654342. The report qualifies those amounts as before-GST conditional ceilings, not achieved savings.
- Browser acceptance confirmed the published report, device display names, numbered conclusions, illustrative spatial map, coverage caveats and the updated Key Points page. Desktop 1440px inspection passed basic readability; the homepage lead remains too long. The visible wrapper calls the issue window Requested analysis period even though the model receives all history; this wording remains a UX follow-up.

Live output artifacts: `outputs/periodic-acceptance-20260920/production-preview/outputs/`. No generated HTML was manually edited.

### Remaining boundaries

The periodic generation → review → action linking → homepage publication path is now verified in production. Calendar-trigger acceptance remains pending its real date; missed whole publication days are not automatically backfilled. Monthly model output passed isolated real-model validation, but a live monthly calendar execution has not occurred. Actual physical action outcomes and large commercial savings are not proven. Same-run report/candidate delivery is still followed by server registration; a separate hard insight-acceptance stage has not been introduced. Customer review should focus on usefulness, shorter summaries and site confirmation of removable loads.
