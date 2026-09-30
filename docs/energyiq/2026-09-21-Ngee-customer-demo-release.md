# Ngee Ann customer demo release

## Published scope

- Production: https://energyiq.hima.sg. Release `28c7ba25cb74a93442c2b65828a91eb6766cb78b`, pushed to GitHub main and activated by SSH with rollback guard. API and web readiness passed.
- Existing report workflow retained; the new analysis-package architecture remains opt-in, not enabled globally.
- Reviewed GPT acceptance report `ngee-analysis-package-v4` imported as `04a6e4e8-5f95-4315-9aeb-8181549572c0`. This is a reviewed artifact import, not proof of a new production scheduled model execution.
- HTML SHA256: `74465840ee546c7dfd75dd9e891e31e2213186ded35e7bd3d02284cf63d343b7`.
- Three additional investigation actions registered: May–July increase, weekend service requirements, and Level 7 school-break hours. Existing conditional annual-saving action retained. Four active items, three featured on Key Points.
- Dry-run and production replay both created zero duplicates on second registration. All twelve pre-existing action documents were unchanged; Tuya Key Points publication was unchanged.
- Retained saving card links to original report `451aa082-6926-4161-b48c-7f3ec97aed04`; new cards link to the new report.

## Evidence and boundaries

- Eighteen independent raw-data numeric checks passed for the v4 report, including totals, monthly usage and academic-calendar cohorts. Model review passed.
- School-break comparison: nine common complete non-public-holiday weekdays; two Level 7 circuits used 405.3 kWh in 00:00–06:00 and 18:00–22:00. Observed exposure is not proven avoidable consumption; service requirements must be confirmed before changing controls.
- Historical input period: 21 April through 20 August 2026. No new physical intervention or measured saving is claimed.
- Card currency highlighting now uses explicit supported currency tokens and a boundary, preventing `SOL 1` inside `ISOL 1/2` from being treated as money. Regression test and Next build passed; online screenshot confirmed normal equipment-name sizing.
- Focused registration/selection/UI tests passed (21 before the currency change, UI regression rerun after it). API and web builds passed.

## Tuya display names

Published through the existing setup revision mechanism, not by modifying raw readings:

- DB1 → Office Area; Power / Light use Office Area Power / Office Area Light.
- DB2 → Showroom Area; Power / Light use Showroom Area Power / Showroom Area Light.
- DB3 → LED; existing individual device names retained.
- Hierarchy `tuya-office-hierarchy-v5`, template `tuya-office-template-v7`, including calculated-meter prefixes. Data snapshot, tariff and operating calendar bindings preserved. Old reports remain historical artifacts and are not rewritten. Online Project information verified Office Area, Showroom Area and LED, and Showroom Area Power / Light.

## Claude status

Initial production inventory had no Claude profile. Following the user's clarified display-only request, configured `report-model-claude-opus-5` for the existing administrator using the authorized local `.env` key, encrypted by the production secret store. Anthropic's model-list endpoint returned this model; no inference request was made. Status remains `untested`, activation disabled, GPT default unchanged. Native Anthropic implementation exists in another checkout/commit `276faac8`, but is not included in this release. Do not describe Claude switching as complete; integrate native transport and validate separately before activation.

## Operations and follow-up

### Follow-up release: Claude and Safety status

- Production code advanced to `90c23abefd0f9999c20bd8c856a86d73e0627a4f`; worker `energyiq-report-agent:claude-20260921` layers the native-protocol runner onto the existing reviewed image.
- Real production Anthropic probe passed with streamed tool-result roundtrip; an isolated Pi worker called a synthetic connection-check tool once and returned its marker. No project data was used. Receipt: `claude-probe-receipt.json` in the same backup directory.
- Models browser acceptance: compatibility passed, switch GPT → Claude Opus 5 → GPT succeeded; final default remains GPT. This supersedes the earlier display-only status above. Full Claude report generation/review quality remains untested in this release.
- Safety status box added when the current active selection has no safety item: no safety alerts in current analysis, energy readings alone cannot confirm electrical safety, not a site inspection. Existing Saving green / Safety warm-red styling remains.
- Focused tests: 11 passed, 6 Docker tests skipped locally; real server worker roundtrip is recorded separately. API and Next production builds passed. Environment backup `api-before-claude.env` retained for rollback; stage used hardlinks with copy-on-replacement to preserve the old release without another full dependency copy.

- Backup: `/opt/energyiq-datafoundry/shared/backups/periodic-acceptance-20260920/metadata-before-demo.sqlite.gz`; scoped publication and alias receipts are in the same directory.
- A full SQLite backup temporarily exhausted disk during staging. Compressed this task's backup and removed only a never-activated candidate release; production remained on its previous release until the new candidate passed. Approximately 1.7 GB remained after staging. Capacity cleanup/expansion still needed before retaining more full releases.
- Tomorrow: resume the project-understanding / analysis-package implementation, automate more independent evidence checks, improve recommendation specificity after facility feedback. Do not conflate reviewed imported demo output with full autonomous production acceptance.
