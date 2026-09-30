# Action feedback: measurement and follow-up execution

Status: implemented in `codex/action-feedback`, not merged into main or deployed. Issue #245.
This supplements [the first slice](2026-09-14-action-feedback-first-slice.md) and implements the measurement-to-follow-up portion of [the feature design](../product/2026-09-14-行动反馈闭环与情景模拟功能设计.md). It does not close the full feature scope.

## Delivered flow

1. The report author adds an Action with one published meter and a baseline date window. Default baseline: 28 days ending at the earlier of the source report end or today; dates can be adjusted before creation. Creation and baseline storage are atomic.
2. The server reads the existing authorized Snapshot/DuckDB path used by Explorer. It stores immutable daily evidence, snapshot, mapping/hierarchy revisions, timezone and actual interval cutoff. Missing, duplicate, overlapping, bad-quality or coarser-than-hourly intervals invalidate a day. Coverage units are explicitly minutes.
3. An execution event records what changed and when in the project timezone. The partially executed first day is excluded. An overlapping baseline or changed mapping blocks evaluation.
4. An hourly service sweep checks implemented Actions without blocking normal report dispatch. At most 100 Actions per sweep, oldest checked first. Manual 'Check latest readings' is also available. The sweep runs only while the existing report service is running and the pilot flag is enabled; it is not an independently deployed cron service.
5. An initial report needs three complete comparable observation days; an extended report needs seven. Each observation weekday needs at least three valid historical samples of that same weekday. Seven comparable days need not equal seven calendar days. Observation is bounded to the first 60 days after execution. Baseline windows are bounded to 90 days and interval reads to 40,000 rows.
6. Server arithmetic calculates same-weekday baseline expectation minus observed usage. No causal savings, weather, occupancy, holiday or concurrent-intervention adjustment is claimed. The Pi worker receives the frozen daily receipt rather than silently fetching changing live data.
7. A stage creates a separate report Session and uses the existing Pi queue, sandbox, model configuration and review flow. The original report remains unchanged. The feedback links to the source report and Action through a dedicated authorized endpoint; it is excluded from ordinary shared report lists and monthly continuity selection.
8. Current feedback opens from the original report's Actions & effects panel. UI refreshes every 30 seconds while visible. Failed/interrupted/cancelled stages have explicit retry; retries preserve evidence and prior run references and deduplicate repeated clicks. Generic chat/resume cannot strip Action scope.
9. Revision checks at execution and acceptance invalidate results after the recorded action changes. Earlier receipts remain stored; stale reports are not shown as current effects.

## Permissions and enablement

This remains a private administrator-owner pilot, one Action/meter per evaluation. Report-reading or conversation grants are not Action-write grants. Do not change this restriction when integrating S2 capabilities without a separate Action permission design/test.

Both switches remain off by default:
- API process: `ENERGYIQ_ACTIONS_PILOT_ENABLED=true`
- Web build: `NEXT_PUBLIC_REPORT_ACTIONS_PILOT=true`

No production configuration, queue allowance, source readings or original reports were changed by this work.

## Validation

- Temporary SQLite and actual HTTP handler tests: execution records, owner/project isolation, stale revision conflicts, queued feedback, repeated checks/retries and preserved evidence.
- Existing DuckDB fixture: actual guarded scoped interval reads; old Snapshot queries rejected. No replacement parallel data store.
- ReportService integration: actual input preparation and accepted output persistence, with a controlled test generator; dedicated feedback output succeeds for the owner and fails for another admin and the shared library endpoint. Pausing invalidates output access.
- Final focused suite: 59 tests passed across nine files; six optional harness tests were skipped. Covers the existing concurrent report scheduler and preview regressions, project timezone and Action-panel interactions. The separate real Pi run is recorded below.
- Root `npm run build` passed. Full Web typecheck was not clean at baseline due to existing fixture/React declaration errors; no full web/browser application acceptance is claimed.
- Live Docker/Pi/DeepSeek flash run `f2b44b11-f9b8-47d2-924c-236310482275` succeeded with synthetic daily evidence, automatic review and 1440/390px browser checks. Expected 72 kWh, observed 36 kWh, difference +36 kWh. The page explicitly labels the data synthetic and states no physical action occurred.
- The first live attempt exposed a real quality defect: generic `expectedSlots` fields were described as 1,440 intervals instead of minutes. The input contract and generator prompt were corrected to `expectedMinutes` / `validMinutes`, and a fresh model run verified the fix. The old HTML was not patched into a passing result.
- Verification files are local under `outputs/action-feedback-validation/live-v2/`; `feedback.html`, `result.json`, report receipts and browser screenshots provide evidence. These generated artifacts are not production reports or repository source assets.

## Remaining acceptance and scope

The active local Tuya DuckDB is held by the running API. A read/copy attempt was denied by the file lock; the shared API was not stopped or reconfigured. Therefore the complete `readActionEvidence` path against the live Tuya publication has not been certified by this turn. Gateway and domain behavior were verified with controlled fixtures, not a physical-action result.

Still required before customer rollout:
- Integration of this branch with current S2 changes; full webpage interaction checks and authorized live Tuya read validation.
- Explicit ordinary-user/shared Action permissions and end-user presentation.
- Agent-generated structured suggestion import/tool, assignment, richer execution schedules, and multi-action feedback grouping.
- Scenario adoption/history selection and expected-versus-observed comparison. Current lighting what-if is saved arithmetic from user assumptions, not an inferred physical model.
- Real implementation of a chosen action and enough subsequent comparable readings. Neither a green test nor model review proves attributable savings.

Baseline evidence is frozen deliberately: a poor historical baseline is not repaired just by waiting for future readings. The operator must provide an appropriate pre-execution baseline; current pilot can record a corrected Action. There are only initial/extended stages, not unlimited rolling follow-ups. Automatic failure retries/backoff, notifications and multi-process queue ownership are not added here; explicit retry and the existing single queue owner are retained.
