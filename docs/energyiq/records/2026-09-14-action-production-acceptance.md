# Action feedback — production release and online acceptance

## Release identity

- User authorized merging into main, production deployment, and the complete online workflow.
- Main merge: `55dba822092e58349186e249a91c24f5e1202050`. Preserved main's Models functionality and integrated task history, project capabilities, and Action feedback. Three textual conflicts in admin navigation/workbench/config client were resolved by retaining both features.
- Production physical release and Web BUILD_ID both equal `55dba822092e58349186e249a91c24f5e1202050`.
- Subsequent `38cbec90` changes only the stale Explorer test assertion: Daily average in kWh/day plus Peak power replaces the old Average power expectation. No runtime change between these commits.
- Application CI on `38cbec90` passed Core Smoke Tests, Build and Web Tests, and Docs. The earlier run had 1 stale assertion failure out of 1,824 Web tests. GitHub Pages deployment separately fails because the integration lacks permission to create the Pages site; this is not the EnergyIQ application deployment.
- Local merge validation: TypeScript build, 33 focused tests, complete Next production build, and 10 UI regression tests after the assertion correction passed.
- Release archive SHA-256: `219b34c2be03ee4d0bb05f8024e8a0a0fad0b80309aead86c7a6a4adb5d8b78c`.

## Backup, flags and operations

- Backup: `/var/backups/energyiq/managed-daily/backup-20260914T150712Z/storage.tar.zst`.
- Isolated restoration passed archive/file checksums, SQLite integrity, DuckDB opening, expected energy stores, and service-account read/write probes. Temporary restoration was cleaned up.
- Enabled `ENERGYIQ_ACTIONS_PILOT_ENABLED=true` and `ENERGYIQ_ACTIONS_CUSTOMER_ENABLED=true`; preserved other environment settings and credentials. Previous environment retained as `shared/api.env.pre-actions-55dba822`.
- Actual API process limits remain 2 global / 2 per account. Automated tasks reserve a slot for interactive work, so these Action feedback jobs ran sequentially. This is not evidence of a new load test or increased capacity.
- API/Web/nginx and deployment smoke checks passed; deployment lock cleared.
- Immediate rollback release: `694a84bbc3d9077bea96eb1cea1a61f4f9653b26`. Corrected the stale `previous` symlink to this release.
- Removed only obsolete releases `8dfa9208...` and `c02cf055...`, after physical-path, release identity, current/rollback exclusion and process-reference checks. Final free space approximately 11 GB; current, rollback, other retained releases, and backups preserved.

## Real online acceptance

Browser actions used `https://energyiq.top`, not localhost. Created a dedicated QA administrator and two ordinary Tuya members with random credentials. Existing accounts, including Charles's admin account, were not changed. All execution events explicitly say **historical QA replay, no physical intervention**.

| Flow | Evidence | Result |
| --- | --- | --- |
| Online conversation generates English HTML | Report `81fb5191-b3fa-4d89-a334-a35abc5bbb1e`, session `08167957-8a6b-4d00-bd51-ca1ef8c4de1d` | Generated from connected Tuya data; opened from the conversation preview. Approximately 2m36s execution. |
| Generated recommendation becomes an Action | Suggestion `5dbc02742ae9b05369dad39c`, Action `7d215af9-1514-4786-8115-72831de797ee` | UI prefilled recommendation and LED Display 1 mapping; saved with source report and suggestion linkage. |
| New-report Action automatically gets feedback | Run `e70df070-4f0d-4489-936c-a700523bd537` | Succeeded; opened through its Action in Reports. No manual check/generate endpoint called. |
| Shared Action and simulation | Action `a4878e3e-bc50-46af-8485-664373f80920`, source `df690c69-839f-4f41-a12e-2c3babd74a35` | Admin explicitly shared; saved and adopted 0.8 kW × 3 h/day × 3 days = 7.2 kWh hypothetical scenario. Adoption did not mark execution. |
| Ordinary member records shared execution | Scenario feedback `e7b12977-0789-41fb-a68c-9dbd1c08b9e7` | Member event recorded actor name and SGT timestamp; automatic job succeeded; non-owner member opened Scenario comparison. |
| Ordinary member creates private Action | Action `83a63dd9-811c-45d7-b8f0-363ddafa739c`, feedback `78448292-de2d-4503-9b99-20973f28ed43` | No sharing checkbox offered; automatic initial feedback succeeded and owner opened HTML. |
| Isolation | Separate authenticated browser contexts and API requests | Other member and admin both received 404 for private Action and its feedback; general Reports output route also returned 404. Foreign project returned 403. Ordinary user could read the limited conversation DTO with canChat=false but creating an Agent session returned 403. |
| Presentation | Desktop expanded preview and 390px mobile preview | Rendered English HTML visibly inspected; mobile page had no horizontal overflow. |

The initial report already produced a valid machine-readable recommendation. Clicking Find recommendations reused it, as designed; this production test does **not** demonstrate a separate extraction model call for an older report with no suggestion artifact. That fallback was validated locally in the preceding acceptance record.

## Numerical and execution evidence

- Baseline: 18 August–8 September inclusive. Test boundary: 9 September 19:00 SGT. Observation: 10–12 September, three complete days.
- Snapshot: `energy-snapshot-5bf94a088af8ae271ed1e7f6`; meter `panel-c-meter-01` / LED Display 1.
- Same-weekday expected use: `13.354207876076302` kWh; observed: `13.356894881541319` kWh; expected minus observed: `-0.0026870054650167674` kWh. HTML presents 13.3542, 13.3569, and -0.0027 kWh.
- Scenario report separates the 7.2 kWh assumption from observed difference and explicitly disclaims a real physical intervention or causal savings.
- Three feedback jobs have independent sessions and no parentRunId. Their input package contains the scoped Action receipt and project configuration; it is not a continuation of the source author's private conversation.
- No manual HTML editing was used to improve generated results.

## Cleanup and demonstration

- Two private QA Actions were paused after verification to prevent later weekly test runs. Their original outputs and receipts were preserved as acceptance evidence; current UI deliberately does not expose obsolete-revision feedback after a state change.
- Two temporary ordinary-member accounts were disabled after browser verification.
- The clearly labelled **shared three-day QA scenario** is retained for demonstration. Its complete scenario feedback exists and no later stages are required. The QA administrator remains its owner; credentials are private and not committed.
- Online entry: `https://energyiq.top/energyiq/library?projectId=tuya-office&reportId=df690c69-839f-4f41-a12e-2c3babd74a35`. Select **Actions & effects → QA shared LED trial — historical replay → Scenario comparison**. For a wider view, expand first, then open Scenario comparison.
- Local evidence directory: `D:/Projects/energyiq-datafoundry-integration/outputs/action-release-20260914/live/` (untracked), including generated HTML, receipt JSON and inspected desktop/mobile screenshots. No credentials committed.

## Acceptance boundaries and next improvements

The deployed software loop is demonstrated: report → recommendation/action → execution record → automatic data comparison → linked HTML feedback, including scenario and personal/shared scopes. Actual energy-saving effectiveness is **not** demonstrated: no site intervention occurred, and historical readings were used to avoid pretending to wait for future physical data.

Remaining quality/UX issues observed, not silently treated as passed:

1. The scenario HTML calls 8 September 2026 “Mon” in its baseline description; it is Tuesday. Computed totals agree, but prose calendar auditing still needs improvement beyond primary analysis-period labels.
2. The new-report feedback says complete coverage means the difference is “not a data-quality artifact”; coverage alone cannot establish that. Some headings also use “trial” although the body correctly says no physical trial occurred. Tighten review of evidence strength and headlines.
3. Some feedback uses “Panel C meter” instead of the business name LED Display 1. Supply/follow the display-name mapping consistently.
4. Expanding the outer preview or crossing the mobile breakpoint remounts the Action panel; the user must reopen the feedback. Preserve the selected feedback across layout changes in a subsequent UI improvement.
5. Pausing/revising an Action hides old-revision feedback in the current UI. A clearly marked history view would improve later audit/review without presenting old evidence as current.
6. Automatic wake-up was tested with existing later readings, not by waiting for another night's API ingestion. Retry failure injection and fresh multi-user stress testing were not repeated on production.

These are not claims of Charles's final report-quality acceptance. GitHub Pages configuration and future BI work remain outside this release.
