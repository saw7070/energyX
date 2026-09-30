# Report recommendations and adopted scenarios

## Delivered scope

The private administrator Action pilot now connects report recommendations, saved scenario assumptions, recorded execution, and later readings. S2 UI commit `878c2367` was integrated as `a39eee75`; backend changes remain in the same Integration worktree. Main and production are unchanged.

- AI can extract up to eight recommendations from an existing accepted report. Each needs a verifiable quotation from that report. A meter must be in the published project configuration, or remain unassigned. Extraction does not invent a meter for a multi-meter recommendation.
- Tracking a recommendation records its source report, extraction run and stable suggestion identity. Repeating acceptance returns the existing Action. The user can narrow the proposal and choose the affected meter.
- Saved lighting scenarios retain the inputs, formula, assumptions and timestamp. Adopting a scenario links it to the Action but does not record execution. The estimate is locked after execution, including if the Action is subsequently rescheduled.
- The existing Pi queue produces feedback. Scenario comparison uses the first N complete, consecutive calendar days after execution, with same-weekday baseline comparisons. Later days cannot silently replace a missing day. Initial and weekly observations are explicitly partial; only a matching scenario window can compare the full estimate.
- Extraction and feedback preserve private administrator authorization before execution and before acceptance. An editor grant alone cannot access this pilot. Generic run retry cannot bypass Action-specific validation.

## Real validation

The source was Charles's actual reference Tuya HTML, imported into a local QA administrator report as `57082111-1ca9-48dc-92db-6fbe8ae27021`. This is an imported reference, not a newly generated report.

Real Pi extraction `f121a2be-16e3-488f-b10f-1a3c08ae5149` succeeded with five recommendations: LED scheduling, Zone A lighting, showroom lighting, DB2 after-hours loads, and base-load reduction. Quotes were validated against the HTML. The LED and project-wide suggestions correctly retained an unassigned meter.

Through the local web UI, the LED recommendation was narrowed explicitly to LED Display 1 and saved as historical replay Action `735ad7db-d0c4-4624-9130-331fefd9569b`. Saving was disabled until a meter was selected. Baseline: 18 August–8 September inclusive. A hypothetical 0.8 kW × 3 hours/day × 3 days estimate was saved and adopted; the Action remained Not started. Only recording an explicitly labelled historical replay at 9 September 19:00 SGT enabled feedback.

The hypothetical power is not a measured device load. No physical intervention occurred. This validates software flow using real historical readings, not causal savings or forecast accuracy.

Initial feedback run `79093c20-27b4-44cc-b524-2ad5f50c3d1d` and scenario run `e9e3c870-b787-4c01-ad68-f03889b2579e` both succeeded through the real Pi queue, concurrently. The scenario report opened under the original report's Action. Its 10–12 September observation window matches the three-day estimate. Independently checked: expectation 13.354207876076302 kWh; actual 13.356894881541319 kWh; difference -0.0026870054650167674 kWh; scenario 7.200000000000001 kWh; difference from estimate -7.202687005465018 kWh. English text states no physical intervention and no verified savings. The sentence “the replay produced no material change” remains less precise than “no material difference was observed”; this is a wording follow-up, not proof of causal validation.

Desktop report and 390px Action controls were visually inspected. The test Action was paused after acceptance to prevent further test reports. Exported preview: `outputs/action-integration-20260914/tuya-scenario-feedback.html`. No generated HTML was manually rewritten.

## Checks

- 87 backend tests across eight relevant files passed; feedback tests were repeated after the missing-window regression was added.
- 27 panel/time UI tests passed in Integration.
- Root TypeScript build and full Next production build passed.
- Browser extraction acceptance, meter choice, scenario saving/adoption and execution recording passed. Desktop panel inspected.
- Generated reports, screenshots and readback receipts are local untracked evidence under `outputs/action-integration-20260914/`; credentials and metadata backups must never enter source control.

## Remaining boundaries

Ordinary-user/shared Action permissions, multiple affected meters, grouped Action feedback, assignment and automatic retry/backoff remain outside this slice. The estimator assumes the same reduction every calendar day; weekday-only scheduling is not supported.

Live acceptance exposed duplicate initial/scenario reports for a three-day estimate. The follow-up fix schedules preliminary observations only when they are shorter than the scenario window. A three-day plan therefore generates only the scenario report; a seven-day plan generates initial plus scenario, without a duplicate weekly report. Eleven feedback tests passed, including both window cases, and TypeScript build passed. Existing historical outputs remain unchanged; this scheduling refinement is covered by regression tests, not a second real-model replay.

UI follow-up: if an executed Action is later rescheduled, the server still locks scenario replacement correctly, but the UI should receive an explicit scenarioLocked field to suppress an unusable adoption button. This does not affect the first-adoption flow.
