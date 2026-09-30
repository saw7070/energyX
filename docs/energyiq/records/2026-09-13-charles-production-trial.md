# Charles trial release — 2026-09-13

## Released code and runtime

- main and production code: `57bcd44c8b814e647ddf327088e223051d9f7571`.
- Immutable artifact SHA256: `9f7676e1083d263f6929c092f54bc20f49cb5a8bd3f91913b949e8eeb6d9be04`.
- Clean detached release worktree, Node v22.23.2; TypeScript and Next production builds passed. No local database, credentials or outputs included.
- Backup: `/var/backups/energyiq/managed-daily/backup-20260913T114454Z/storage.tar.zst`; completed successfully before cutover. Prior code: `a1ccbed472d044823abed152e94a6eaf70aaa783`.
- Pi image `energyiq-report-agent:release-review-20260913`; includes offline Chromium/Playwright review. Networkless non-root worker, no host mounts or secrets, 1 GB per worker in production. Total capacity 2, per-user capacity 1.
- Deployment override `/etc/systemd/system/energyiq-datafoundry-api.service.d/90-report-release.conf` must follow existing 60-report-agent.conf; initial 30-prefix was overridden. First scheduled attempt correctly failed readiness; corrected precedence and retried through the standard API.

## Five improvements

1. Agent can select a saved project calendar/tariff with expected-version checks, project ownership validation, then use existing publication tool. Saving, selecting and publishing remain distinct; unrelated draft changes must not be published implicitly.
2. Missing editable rule configuration inherits the latest published selected rules, including an explicitly empty set. New projects retain defaults. Regression reproduced before patch and passes after patch.
3. Report progress explains current phase, elapsed time, background continuation and retry. Network failures retry polling, not relabel the task failed. S2 browser scenarios are not provider load tests.
4. Explorer quality follows the displayed time window. Explicit Yesterday is separate; changing the page date clears stale analysis. Zero readings and missing data remain distinct.
5. Review now includes enforced desktop/mobile browser overflow and JavaScript checks before acceptance and after correction; remaining browser failures block acceptance. Skill also requires report-specific filter/detail/reset checks, primary actual totals versus sensitivity scenarios, and no invented generation timestamps. Automated smoke checks do not prove all semantic interactions.

## Validation and configuration

- 94 product/API/permission/UI tests passed, plus 18 focused configuration/review tests. Docker streaming, tool roundtrip, cancellation, truncated-stream handling and five isolated bridges passed. Browser-generation/resume test passed separately in ~15 seconds after replacing its obsolete five-second timeout. Five bridges are controlled fixtures, not five full live-model reports.
- Three production projects read connected. Project Skill/context migrated through standard authenticated APIs; original server data and accounts retained. Preschool pending setup draft was not published.
- Tuya calendar and tariff migrated through operational policy APIs and published with current revisions. Data snapshot unchanged. Calendar remains provisional Mon–Fri 09–18; tariff is an identified Q3 benchmark, not a confirmed contract price.
- Existing admin account retained; no password changes. Temporary API acceptance sessions revoked after each operation.
- Actual automatic report trial: scheduled attempt `2bd59665-81db-4ef8-83b4-dd506d89d7b6`, retry `44b53b8c-80de-4de0-a393-732ac778ee60`, period 12 September. Original schedule frequency restored after capture. Retry succeeded at 2026-09-13T12:06:49Z after 13m31s; final 72 KB English HTML published to Reports.

## Remaining acceptance boundaries

Charles's own business/aesthetic acceptance is still required. The previous local report tests do not automatically become production evidence. Runtime schedule UI audit currently shows an empty skillUsage list for scheduled tasks even though project-skill.md contains the correct pinned method; actual file version 1.0.1 was checked. Treat this display gap separately from method loading.

Rollback requires restoring the prior code pointer and removing/restoring the release systemd override. Project settings and policy publications are separate from code rollback; use the pre-release backup or saved versions rather than replacing production with local storage.

## Live acceptance observations

- Latest four Tuya source-sync jobs succeeded. Latest scheduled job completed 2026-09-12T16:54:07Z (13 September 00:54 SGT); website reports available readings through 12 September 23:45 SGT. A successful sync is not a claim that every meter has complete intervals.
- The scheduled retry produced a ~70 KB English HTML draft and executed 17 report-specific interaction checks. Initial desktop/mobile smoke checks passed.
- Automatic numerical review requested correction of missing-channel zeros, unlike-for-like overnight baselines, equipment-state wording, and supporting-table/caption inconsistencies. This is actual provider execution, not a fixture. Final revision acceptance is recorded below when completed.
- Production remained at ~1.1 GB overall used RAM during the check; the worker was under its 1 GB limit. This single run is not a concurrent load benchmark.

## Final report acceptance

- Run `44b53b8c-80de-4de0-a393-732ac778ee60` succeeded. Automatic review requested eight corrections and the model completed its one revision pass; review-receipt status pass, all eight issues resolved, SHA256 matches final report.html.
- Final browser check passed at 1440px and 390px, with collapsed and expanded details. Report-specific interaction results: 17/17 passed, including scope/filter changes and stale-detail/reset behavior.
- Opened the actual production Reports page as another logged-in admin: the Scheduled Energy Report for 12 September appears first, opens inline, and exposes download/expand. It explicitly preserves the author's private conversation. This is browser evidence against the deployed app.
- First-screen screenshot inspected: English title/date, three findings, then KPIs; useful missing-data and conditional-saving qualifiers retained. It is a usable trial result, not proof of Claude-equivalent quality for all future reports.
- The sample's observed total is 69.896 kWh, with missing DB1 lighting. Ingest success does not eliminate absent source channels; the report explicitly treats the total as incomplete and does not convert missing readings to zero.
- Production Skill Creator verification run: `2023e0e2-c8ac-45e1-9d4e-969769c0e587`; succeeded with hasSkillDraft=true and a 15,998-byte method draft returned through the standard draft-skill API. Draft extraction did not activate or replace the accepted project default.

- Report schedule was verified restored to `off`, matching its pre-acceptance frequency/hour/prompt. API source synchronization remains enabled independently. Enable a customer report schedule explicitly after choosing the desired cadence.
