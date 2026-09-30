# Periodic Insight and Action maintenance

Tracking: GitHub #246. Accepted product direction: 2026-09-20.

## Product contract

- The project owns a persistent Insight/Action list. Reports are dated views of that list, not independent duplicate lists.
- First analysis initializes the list. Weekly analysis explores all available history, emphasizing recent changes; monthly analysis revisits long-term patterns and observed outcomes.
- Daily source synchronization updates data only. It does not automatically rewrite reports or homepage priorities.
- Explore independently, reconcile with existing records, select up to six useful candidate pairs, feature up to three, then compose the report. Never invent entries to meet a quota.
- One new Insight has one primary Action. A measure may span several meters. Matching equipment alone is not sufficient to merge different measures.
- Six slots bound recommendations being considered, not historical records or implemented actions awaiting follow-up.
- User feedback records implementation immediately. Effect assessment waits for sufficient comparable readings. Implementation is not verified savings.
- Preserve planned/implemented/paused/resolved history. Completed actions cannot be silently resurrected as new recommendations.
- Homepage shows current priorities; weekly reports show changes and progress; monthly reports summarize performance and outcomes without adding overlapping savings.

## Implemented in this branch

- Added weekly + monthly schedule option to API and settings UI.
- Due dates use project timezone: Monday for weekly, first day for monthly, after configured local hour. Both can occur on one day.
- Analysis period resolves all currently available project/attached data. Reporting period is independently stored on the run and manifest.
- Idempotency remains project + cadence + reporting period, independent of new data arrival or settings revisions.
- Previous-report continuity uses reporting periods, preserving owner/workspace boundaries. Retries retain the issue period; inherited conversation context retains it unless dates are explicitly changed.
- Library titles and output scope stamps use the issue period. Full-history calculations must be separately labelled.
- Scheduled prompt specifies exploration, reconciliation, ranking, preserved execution state, current display names and customer-facing weekly/monthly distinctions.
- Async schedule lookup is serialized; settings changed during lookup prevent enqueue. Unknown data bounds fail instead of falling back to a seven-day dataset.

## Acceptance and remaining work

Local: 49 tests passed across report-schedule-policy, report-agent, report-library-api, action-registration and key-point-candidates. API TypeScript build passed. Includes simultaneous weekly/monthly enqueue, period deduplication, overlapping all-history continuity and customer-visible issue dates.

Not yet production enabled or deployed. Real model generation and visual acceptance remain required.
The current harness still delivers HTML and companion candidates in one run and registers them after successful report validation. The prompt establishes analysis order; it is NOT an enforced two-stage insight acceptance gate.
Existing six-slot publication checks are reused. Separate waiting-for-results/history presentation and automatic stale-item revalidation are not completed by this scheduling change.
Existing legacy one-to-many findings remain readable; their migration is not part of this change.

Schedule limitation: only the configured local calendar day is eligible. Retries of a queued failed report use the existing resume path. A whole publication day missed during downtime is not silently backfilled.

Next: validate real all-history Tuya weekly and monthly output; strengthen candidate reconciliation/publication and review new-vs-follow-up selection; promote verified analysis Skill; then deploy and enable production schedules with live acceptance.


## Follow-up implementation: cadence methods and list lifecycle

- Added shared built-in weekly and monthly methods at version 0.1.0. Scheduled runs load exactly the matching method alongside existing project methods/style and persist its hash in skillUsage. Daily runs retain their previous method selection.
- Both methods require evidence, conditional benefits and useful decisions. Weekly emphasizes change and next steps; monthly emphasizes overall performance, persistent drivers and observed outcomes. Neither may invent value or fill a quota.
- Each run receives insight-maintenance.json, grouping proposed, following-up (scheduled/implemented) and history (paused/declined) actions. Proposed entries with unknown evidence or evidence at least 14 days behind the available-data end are flagged for revalidation; this is a prompt input, not proof that the model actually revalidated them.
- Candidate acceptance, direct publication API and homepage GET now exclude scheduled/implemented actions from recommendation slots. Existing action records and feedback are retained. This does not yet add a separate homepage results panel.
- Publication records retain added, retained and omitted action IDs. Omission explicitly does not mark an issue resolved; detailed AI rationale for individual omitted records remains future work.
- Local tests: 31 cadence/worker/maintenance/candidate/store tests and 22 Action API tests passed. New methods have not yet been through a fresh real-model run or deployed; prior real-model acceptance predates them.
- Remaining: real-model revalidation of these new methods, detailed stale/omitted decisions, fresh production-data chain, customer-facing follow-up grouping, production rollout and enabled schedule acceptance. Do not claim the complete product loop is finished based on these changes.
