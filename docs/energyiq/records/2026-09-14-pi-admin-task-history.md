# Pi Admin Task history

Baseline main 74f96db5; isolated worker, no deployment or shared service changes.

## Contract

GET /api/v1/energy/admin/task-history accepts projectId, status, origin (manual/automatic), page (zero based); fixed page size20, counts and filters apply in SQL before pagination, no existing list100 truncation. GET /task-history/:id returns allowlisted details. Both authorize current organisation through resolveEnergyAccessContext (read-only role resolution); only existing admin management scope is accepted. Out-of-scope ID/project and absent IDs use the same404. New role adaptation is separate work.

Reads existing energyiq_report_runs / events and immutable input manifest; no new table or parallel log. Return only project/task-type/actor/status/time, requested period, recorded data version IDs, safe milestone labels and permitted links. No prompt/answer, settings, credentials, file names/paths, event text/tool arguments/results, or raw unknown error strings are serialized. Cross-owner optional Skill names/versions are private. Required platform Skill versions and the owner's supplied Skill metadata remain available. Skill delivery is not application proof.

Shared successful reports use existing report-library authorization and route. Explicit reportId lookups supplement the recent100 library page so older Task history links still open; absent, failed and foreign-workspace report IDs remain unavailable. Private conversations remain owner-only; no stop/retry write permissions added. Generic task titles deliberately avoid private prompts. The current Run/input-manifest contract has no sanitized historical model receipt; model is null / Not recorded, never inferred from current Models configuration. Data versions are read from that run's manifest, not the latest project settings.

## UI

Direct Task history and Models entries. Old Runs & Traces and Configuration overview remain in closed Legacy / Developer diagnostics; their APIs and stored records are intact. Filters reset pagination, details hide technical IDs by default, selected organisation/user remounts history, stale fetches abort, errors do not echo backend bodies. Table scrolls within its container at mobile width. Refresh states when status was observed; no fake live percentages.

## Validation

- npm run build: passed (TypeScript project build).
- API tests: 30 passed across report-task-history-api, report-library-api, report-api. Actual temporary SQLite records test paging25 rows, combined filters, management denial, cross-workspace IDs, non-owner private sentinels, report versus conversation links, safe failure details and read-only methods.
- Web tests: 30 passed across admin-task-history, admin-sidebar and report-library; filters/page reset, links, missing timestamps/evidence, private conversation notice, errors, Legacy grouping.
- Real Chrome against isolated worker3197, live admin shell and intercepted Task history responses: desktop1440 and mobile390, no JS errors and mobile document width390. This is UI scenario evidence, not new Provider execution or live API deployment. Screenshots/evidence are worker outputs/task-history.
- Full standalone web tsc retains unrelated pre-existing test diagnostics; no diagnostics in changed production files. Initial API standalone tsc ran before dependency builds and was superseded by the successful repository build.

## Bounded design review (inline, no additional agent)

Disposition: ship for Integration review.
Persistence: pass; existing design system and admin frame retained.
Fidelity: list/filters/detail match request; private names adapted to generic labels per explicit privacy boundary; unsupported historical model and mutation actions explicitly limited.
Ceiling: existing semantic table, labels, links and details used; no new visual identity.
Material fixes: none remaining from the bounded desktop/mobile check; production/human acceptance remains outside this local result.
Keep: server-side privacy allowlist and separation of report access from conversation ownership.
