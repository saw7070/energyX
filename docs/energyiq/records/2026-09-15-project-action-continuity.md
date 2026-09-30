# Project Action continuity — first integration slice

Status: implemented in Integration; not deployed or accepted in a live browser.

## Product contract

Actions belong to a project, with private and shared visibility preserved. A report contributes a recommendation and evidence to an action. Multiple reports may support the same action. Linking a report must never reset execution events, frozen baseline, scenario adoption or assessment revision. Old report bulk extraction remains paused.

## Implemented

- Integrated S2 split preview commit cd166cef as 94c744a8. Expanded desktop preview keeps report and Actions side by side; smaller view uses persistent panes. Existing mock-browser evidence remains separate from Integration acceptance.
- Added additive energyiq_action_sources storage. Original sourceReportId remains valid without migration or extraction. API verifies linked quotations through accepted report suggestions and matches affected meters. Shared-source linking requires admin; private records remain owner scoped.
- GET report-actions/:projectId/project-list returns scoped project actions. POST :actionId/sources links a verified sourceReportId and suggestionId. Report-local listing includes linked actions and provenance.
- Report action panel offers explicit linking to existing same-meter actions, and source report links/quotations. This is candidate assistance, not semantic auto-merge.
- Report runs receive inputs/project-actions.json, captured when execution starts. Includes shared actions, revisions, source references, execution events and checks. Private actions are excluded because general report artifacts are project-readable. Prompt distinguishes recorded implementation from demonstrated savings and requests selective progress reporting.

## Validation

- API TypeScript build passed.
- Action store 9 tests; Action API 10 tests; feedback 15 tests; preview 7 tests; action panel 42 tests; report worker 18 tests passed in focused runs.
- Tests verify source idempotency/conflicts, owner isolation, shared-only context, unchanged execution/baseline, API verified-suggestion linking and frontend source/link interactions.
- Full Next production build passed using .next-actions-project-list. Real browser integration is pending. No production changes or real model quality acceptance in this slice.

## Remaining work

- Dedicated project Actions page and priority controls, with priority revisions separate from execution revisions.
- Agent-managed candidate matching and automatic registration after report acceptance, with ambiguous matches retained for review; do not auto-merge solely by same meter.
- Explicitly link feedback reports to actions and retain prior assessment history in UI.
- Live browser and real-model validation of source navigation, observation progress and new-report continuity before release.
- Decide bounded context pagination/summary when project action count exceeds 200; the current query is limited to 200 most recently updated actions.


## Second slice — project overview and accepted-report registration

- Added /energyiq/actions and sidebar entry. Shows active/all actions, shared/private scope, priority, execution state, source count and links to the report action panel. Unknown priority defaults to medium with an explicit not-yet-prioritised reason.
- Separate priority storage/revisions protect execution evidence. Owner can prioritise private actions; only admins can prioritise shared actions. Stale updates fail with 409. Existing priorities are never overwritten by report registration.
- Accepted administrator reports register verified suggestions when Actions is enabled. New single-meter suggestions need matching published evidence snapshot before baseline capture. Exact repeated recommendation plus meter links a source; same-meter ambiguous/differently-worded suggestions remain available for explicit review rather than multiplying actions or silently merging them. Optional model existingActionId is not trusted for automatic merges. Optional model priority seeds a newly created action only.
- Registration failures emit project_actions_need_review and do not discard a successfully generated report. No old-report batch processing.
- API build passed; 68 targeted tests passed across store/API/suggestions/registration/report worker/navigation/overview. Full Next build passed before a surface-token CSS correction; final build is recorded separately below.
- Local API/Web were stopped before this session and restarted from the Integration worktree on 18769/3000. Browser reaches login, but supplied existing credentials failed. No account credentials were changed. Authenticated browser acceptance and a real-model automatic-registration run remain pending.
- Dedicated overview currently opens the source report to record progress; direct action detail routing and historical feedback navigation remain future UX improvements. The list remains limited to 200 actions; pagination and more advanced semantic review remain open.

Final CSS-corrected Next build and API build passed. Same-process concurrent registration test proves two simultaneous exact suggestions create one action with two sources. Authenticated browser and real model acceptance are still pending.


## Third slice — 2026-09-16 action detail, review queue and assessment history

- Project list opens one selected action in place using the existing report action component. Execution and scenario forms keep their original server authorization and revision contracts. Report recommendation creation controls are hidden in single-action mode.
- Filtered empty state distinguishes no active actions from no saved actions, with View all actions.
- Admin review queue derives unresolved suggestions only from succeeded runs with the new registration audit marker. It does not extract old reports. Queue resolves when a shared action is explicitly created/linked; customer accounts do not receive the queue. Exact-match auto-link remains deterministic; differently worded suggestions require explicit review.
- Prior successful feedback remains accessible through its scoped action even after execution revision changes or an action is paused. The response marks historical=true; UI separates earlier assessments and labels their preview as not the current outcome. Private action authorization and current-only retry rules remain intact.
- Limits: project list 200 recent actions, review queue 50 recent registered reports; no pagination or general semantic auto-merge. Detail selection currently lives in page state (refresh returns to list).

Validation:

- API TypeScript and complete Next production build (.next-actions-continuity) passed.
- 72 focused tests passed (Action API, feedback, registration, project list and panel). Includes unresolved review visibility/resolution, private historical-feedback denial and selected-action isolation.
- Required Integration seams: 7 files, 157 tests passed. Legacy regressions were not used to claim report quality.
- Actual Chrome login with existing local QA account passed. /energyiq/actions shows No active actions and opens All actions. Shared historical QA action opens in place; Earlier assessments opens the existing English report with the historical warning, then returns. No physical execution was recorded or changed by this browser check.
- Local API PID 78524, Web PID 44936, started only after ports were clear; current Integration build, local Tuya scheduler explicitly disabled. Production data sync remains owned by the new server.
- New real-model end-to-end registration/repeated-report/feedback acceptance remains pending. Local Docker Desktop fails at dockerInference runtime socket initialization; engine unavailable. Attempt to preserve/rename that single runtime file failed (system cannot access file). No factory reset, image or business-data removal.
- Delegated production QA run was blocked before execution by automatic safety review (Potentially unintended activity). No production QA changes from this request and no release triggered. Existing 9/16 data-sync acceptance remains independently valid.

Release boundary: these changes are Integration-only; main is still dde001e4. Complete real model loop and production acceptance before claiming the full Action loop is delivered.


## Fourth slice — 2026-09-16 real Pi continuity acceptance (in progress)

- Docker Desktop recovered by preserving and renaming only its stopped runtime socket directories (`Docker/run` and `docker-secrets-engine`) and recreating empty runtime directories. Server 29.3.1 and existing report image are available; no factory reset, image/volume deletion or business-data removal.
- Fixed automatic Action registration baseline: capture up to the preceding 28 calendar days ending at the earlier of report end and today's project-local midnight, rather than using the report window. Weekly reports otherwise provide fewer than the three prior matching weekdays required by effect checks. Missing baseline days remain missing; the readiness rule is unchanged. Existing frozen baselines are not rewritten.
- Focused registration/API/feedback tests: 28 passed. API build passed. Runtime restarted after the first report completed to load the fix (API PID 73808; Web PID 44936 unchanged).
- Real report `79880049-cfe7-4173-b93c-90480d682366` succeeded using published Tuya snapshot `energy-snapshot-6089247b3283ee7045129031`, for 2026-08-26 through 2026-09-01 inclusive. English report and automatic review passed. Accepted registration created shared Action `e9b9a4d7-0dcd-4e2a-9f01-913e9a76a936`, with source link and medium-priority rationale. This first run used the old seven-day baseline because it preceded the API restart.
- Authenticated Chrome verified the new Action on the project list, its in-place detail, and Source reports opening the actual HTML report. The report identifies its local QA status and does not claim a physical intervention or savings.
- Skill extraction `e9417f90-d3e1-4581-8bd3-532c87a2c8a7` succeeded but overemphasised internal review and included an imprecise artifact example. A normal in-system refinement `ca056597-07df-4aca-98a4-fc6f356a9d18` produced a fresh-generation-plus-review method and deferred artifact schemas to runtime instructions. Saved personal QA Skill `69c9b9e6-de07-431d-8b23-8c5779c155c4`, version 0.2.0; project defaults remain revision 25.
- Rerun `1a23e8b8-6f16-4e1a-bb3d-049f33d9e5cf` is in progress for 2026-08-18 through 2026-09-08 inclusive, focusing on meter B06. Manifest captures the explicitly selected saved Skill (hash `6e10d4d54bfc47fc9eaeb6bc7927bddfa3b3a69bc6f58515493cebd7c62b3b86`) and default Tuya style 1.0.0. Shared Action context contains the B05 proposal. Input inclusion alone is not proof of model application.
- Production delegation remains blocked by automatic safety review, including a subsequent read-only task request. No further production retries, changes or deployment were attempted. Local verification is independent of the previous new-server data-sync acceptance.


### Completed local replay and remaining boundaries

- Rerun `1a23e8b8-6f16-4e1a-bb3d-049f33d9e5cf` succeeded. Its visible HTML explicitly retains B05 as proposed/unimplemented, recalculates the new period and does not duplicate the action. B06 Action `1a095367-9c6d-4c5b-a179-481535b0f9b8` was automatically registered with baseline 2026-08-12..2026-09-09 exclusive. Source report has the full Tuya diagram and English analysis.
- Saved a clearly labelled hypothetical scenario (0.1 kW x 2 hours x 3 days = 0.6 kWh), adopted it, and recorded a LOCAL QA HISTORICAL REPLAY event effective 2026-09-09 19:00 SGT. No physical intervention happened. The regular event endpoint automatically woke the scheduler; no manual check/enqueue was called.
- Automatic scenario feedback `b469e30a-f77d-44cc-9e36-aac5cac48266` succeeded for 2026-09-10..2026-09-13 exclusive. Three comparable days: expected 41.0638564424 kWh, actual 41.0941233080 kWh, observed difference -0.0302668656 kWh; difference versus hypothetical estimate -0.6302668656 kWh. Actual HTML states the numbers, essentially level use, QA/no intervention and no causal savings claim. This proves software orchestration with real historical readings, not real-world action efficacy.
- QA action paused after completion (revision 4); accepted feedback remains historical evidence and no further evaluation should be scheduled for this QA action. No project default Skill or report frequency changed.
- Discovered and patched an additional continuity gap: shared report context previously carried action state but no completed comparison result. `action-progress.ts` now adds up to three accepted scoped assessment summaries per shared action, including observation/baseline windows, snapshot IDs, scenario comparisons and an explicit historical flag. It omits private report text/settings and queued/failed or wrong-workspace results. New integration test passes; API build passes. This final patch still needs a fresh report run after API restart to prove model use.
- Updated regression checks: registration 2 passed; feedback 16 passed (including accepted/historical/wrong-workspace context); Action API 12 passed previously this turn. The earlier context test initially failed because its fixture skipped queue claiming; corrected the fixture to exercise the real claim/finish transition and reran successfully.
- Client verification initially logged in on every API request and hit normal 429 throttling. After the rate window cleared, the local QA helper reused a session cookie instead. Authentication protections were not changed.

User direction received during replay: evolve the product to Report -> deduplicated Insight -> one or more Actions -> assumptions-based Simulation -> human execution -> data feedback/result report -> project experience and revised future simulations. Insight is a persistent finding, Action a proposed measure; distinct alternatives must not be merged solely because they share a meter. Tomorrow's demo may use clearly labelled mock physical actions/results. This is agreed direction for the next product slice, not a claim that Insight objects, semantic deduplication or simulation calibration are already implemented.

## 2026-09-16 — Insight and isolated demonstration implemented

- Decision: `../decisions/2026-09-16-Insight行动模拟与经验闭环.md`. Demo walkthrough: `../briefings/2026-09-17-Insight-Action-闭环演示.md`.
- Added scoped Insight records, action bindings and source quotations. Accepted report suggestions may contain a validated finding; exact recurring actions retain their status and add a source rather than duplicate. Multiple distinct measures from the same new report can share one finding. Ambiguous cross-report matches remain review items, not automatic merges.
- Added admin-only Demo execution/observation records, separate from actual action events, raw readings and feedback links. Estimation uses an independently saved scenario. Demo feedback uses the existing ReportStore queue, isolated Pi worker, acceptance/review and an owner-scoped endpoint. No separate fake report renderer.
- Real Pi run `37e28dd9-52a9-412c-8801-37b722229229` succeeded for Sep 9–12. It read the prior action context, produced an evidence-quoted Insight and linked B06 to its second source report. Existing B06 remained paused revision 4. Chrome confirmed the Insight card, source link and action detail.
- Browser submitted demo `d5a1140f-4859-4db0-b59a-12b059874e7e`, run `ae68435f-ffc1-4795-904c-3f2958679983`. It succeeded, but manual reading found some "measured"-style wording despite a demo banner. Fixed the system's action-feedback prompt, not the HTML, to label every observation and KPI as mock, and distinguish assumed complete days from verified coverage.
- Browser rerun demo `7e284310-e212-40b9-84cf-fe41168848f6`, run `be65aaed-1b7c-494c-9a54-b38375ebf8ce`, succeeded. Source baseline: 41.0638564424 kWh; mock daily values: 13.0226, 13.0112, 12.9769; mock total 39.0107; difference 2.0531564424; independent scenario 0.6; gap to scenario 1.4531564424. Accepted HTML consistently labels mock observations and says none were recorded by the meter. Chrome verified the iframe, numeric comparison and rendered experience.
- Experience output is a reproducible Markdown note from accepted immutable evidence and execution context. It records the gap and assumptions to recheck, not a claimed autonomous learning model. Real accepted feedback summaries are supplied to later normal reports; demo feedback is never linked into that shared experience path. No Skill or prediction parameter is silently changed.
- API readback after the demonstrations: B06 still paused/revision 4, only the previous historical QA feedback link exists; two demo runs are held in the separate demonstration table. Existing real baseline and execution are unchanged. No API ingestion or DuckDB mutation was performed by the demo workflow.

### Validation and delivery boundary

- API TypeScript build and Next production build `.next-insight-demo` passed. Current local UI: port 3000; API: 18769, Integration worktree.
- Focused checks: Action suggestions 4, registration 3, API 13, feedback 17, Insight store 1, project Actions UI 1 passed (39 distinct checks across focused runs). Covers multiple measures per finding, exact deduplication, cross-project scope, admin/private access, mock input separation, idempotency and frozen real records.
- Required Integration seams: 156/157 initially passed, one unchanged legacy Overview test timed out at 5s under the combined workload. The exact failed test passed on isolated rerun in 3.65s without source or timeout changes. This is not a fresh all-green combined run.
- Browser acceptance: complete demo submission, waiting status, actual Pi HTML, mock labels and rendered learning verified. Generated reports are English. This does not establish real-world savings or automated forecast calibration.
- Explicit Insight association API exists; complete semantic-merge UX and general-purpose simulation are follow-up work. Demo is currently three-day, Singapore-oriented UI using a sufficiently long comparable baseline.
- Production has NOT received this patch. The earlier delegated deployment was rejected by automatic safety review; no alternate deployment path was attempted. Main integration/production acceptance remain separate from this local demonstration.

## 2026-09-16 — Findings-to-actions navigation clarification

- Replaced disconnected Insight and Action lists with one two-column unit: What we found / What you can do. Bound actions appear once; unrelated legacy actions stay under Other tracked actions, explicitly not yet linked to a finding.
- Added a four-step user journey, explicit finding/action counts, readable status and a primary Review action button. All/Active filtering now applies equally to bound and unbound actions; defaults to All so paused evidence is not silently hidden.
- Action detail keeps its finding context and next-step guidance. Administrator Demo is an explicitly expandable separate section; existing feedback remains available.
- Visual direction: preserve EnergyIQ's emerald, pale green and white theme; use the tinted evidence column to encode the finding/action relationship, not decorative dashboard cards. Existing typography retained; two columns stack below 800px, focus indicators and reduced-motion rules included.
- Two focused UI tests and full Next build passed. Chrome verified the count (one stored Insight), explicit relation, Review action navigation, collapsed Demo entry and existing generated feedback after expansion. Local port 3000 now serves .next-actions-guided. No backend data, Insight extraction, action state or production deployment changed.
