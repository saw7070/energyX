# Action feedback: local integration and Tuya replay

Status: local Integration acceptance of the private administrator pilot. Not merged into main or deployed to production. Issue #245. This updates the integration limitations recorded in [the second slice](2026-09-14-action-feedback-second-slice.md).

## Integrated scope

- Integration checkout: `D:/Projects/energyiq-datafoundry-integration`, `codex/244-report-integration`.
- Action slices `e2a3c5f4`, `28d7c29e`; project capability base `19899326`; S2 Task history `539dd039` were integrated. The subsequent S2 user-facing role work is still pending.
- Existing local API on 18769 and Web on 3000 now run this integration. Both Action pilot flags are enabled locally; defaults remain disabled. Production was not changed.
- A metadata backup was made before restarting the local API. Existing user credentials were not changed. A separate local QA administrator and explicitly labelled source report fixture were used for browser acceptance.

## Defects found and fixed against the live path

The Action evidence adapter passed `meter:<id>` as a hierarchy scope. The hierarchy resolver rejected it before reading the meter. It now resolves the authorized project context, validates the selected meter against the published route, and narrows the guarded read to that meter. A regression test rejects foreign meters and publication changes during a read.

The Action meter choices exposed raw source names. Choices now use the same published-configuration presentation helper as Explorer, retaining stable meter IDs and source-label fallback.

## Browser and real-data evidence

Through the actual local web application:

1. Created an Action, selected Tuya meter `panel-c-meter-01`, and froze baseline `[2026-08-18, 2026-09-09)` in Singapore time. All 22 days passed the complete-day check; total baseline energy was 97.99294589543283 kWh.
2. Recorded a clearly labelled historical software replay effective 9 September at 19:00 SGT. No physical action was performed.
3. Checked later readings through the existing Snapshot/DuckDB path. Observation dates were 10–12 September, all complete, with three same-weekday baseline samples per day.
4. The existing Pi queue generated and accepted follow-up run `0541fb7c-6002-4bb9-b5ad-4a4d36ea8d0c` in about 150 seconds. The report opened inside the original report's Actions & effects panel.
5. Independently read the stored receipt: expected 13.354207876076302 kWh, observed 13.356894881541319 kWh, expected-minus-observed difference -0.0026870054650167674 kWh. The generated English report correctly describes a close match, not proven savings, and explicitly says no physical action occurred.
6. Repeating the check retained one initial feedback stage and the same run. No duplicate report was generated.
7. A hypothetical lighting scenario of 0.8 kW × 3 hours × 22 days displayed 52.80 kWh. Changing power cleared the previous estimate. This is user-assumption arithmetic, not a measured Tuya load or savings prediction validation.
8. Inspected desktop feedback preview and 390px Action panel. The mobile action controls were visible without page-width overflow. This does not certify every application page or every report layout.

The original report is a UI fixture; subsequent feedback uses real project readings. This proves the software measurement-to-report route, not a real intervention or causal energy savings. The replay baseline and readings were not edited to create a desired result.

## Verification

- Root TypeScript build passed.
- Full Next production build passed using the isolated `.next-actions-pilot` output directory.
- Focused integration: 55 tests across Action feedback/API, report library, Task history API and UI.
- After the live meter-routing fix: 9 tests across Action data/API and Explorer meter presentation passed.
- The local metadata copy, QA credentials, generated HTML, logs and screenshots remain untracked and must not enter commits. Preview artifact: `outputs/action-integration-20260914/tuya-action-feedback.html`.

## Next execution order

1. Finish S2 user capabilities and integrate with explicit Action-specific authorization. Report-reading and conversation grants alone must not grant Action writes.
2. Add structured AI suggestion extraction into the Action table, with source-report linkage, stable identity and duplicate handling; users should not need to retype recommendations.
3. Connect a saved scenario to an adopted Action and compare its frozen assumptions with later observed changes. Preserve the distinction between estimates and causal savings.
4. Validate user-facing permissions and the complete scenario/adoption/execution/feedback interaction. Conduct an actual field action only with the customer's involvement and sufficient later readings.
5. Merge the accepted release to main and deploy. No production readiness claim until that release and browser acceptance are complete.

The private pilot still supports one meter per Action, initial/extended stages, manual retry, and an hourly in-process check. Assignment, multiple-action grouping, ordinary-user shared actions and automatic retry/backoff are not delivered by this integration.

## S2 capability integration follow-up

S2 `4b9551dd` is now integrated as `ddc93421`. The report-service import conflict retained Action checks and the new execution authorization. All other overlapping Action exclusions remain in place. Integration validation passed 194 tests across 15 files and the full API/Next builds. An additional editor-versus-private-Action regression test passed with the other five Action API tests.

Local browser checks used independent QA member/editor accounts, without changing existing customer grants:

- Member sees Reports, Explorer, Project information and own history. Direct new-conversation access is read-only; direct Skills access requires an editor. Published Tuya meter labels, operating hours and tariff were displayed.
- Editor sees report creation, chat, Skills and automation entry points. A real Pi chat completed in Session `21b78725-6ca3-40b0-be32-7881c5a3ef2d`, answering from the supplied Tuya context without creating a report. This is a minimal execution check, not an editor report-quality assessment.
- Existing administrator Action feedback still opens after the combined API/Web restart. The historical replay is paused after acceptance to prevent further background test reports.
- The member information page still needs user-friendly date labels instead of UTC/exclusive notation, and a clearer visual hierarchy. These are recorded presentation improvements, not a change to the authorization result.

API currently runs the combined Integration build on 18769; Web uses `.next-actions-capabilities` on 3000. Main and production are unchanged. Ordinary-user Action permissions and scenario adoption remain separate follow-up work; the new editor capability does not enable them implicitly.
