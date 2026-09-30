# Report progress and Explorer quality windows

Worker baseline: 3cfef50e. Frontend-only ownership; no backend, project configuration, shared service or production changes.

## Behavior

- Report tasks display their server status / recorded review phase, elapsed time and last activity, with an explicit background-work / return-to-conversation explanation. No estimated completion percentage. Stopped/interrupted/failed tasks explain recovery; Retry task uses the existing resume endpoint and retains history.
- Overview refresh failure is shown as a connection issue, not a failed task. Activity polling formerly stopped permanently after one request error; it now reconnects after three seconds. Opening a saved session reloads its server run.
- Daily/weekly/monthly charts formerly displayed the selected historical analysis but fetched yesterday/previous week/month for quality, which also overwrote sidebar health. Quality now follows the displayed dates; sidebar health follows the page analysis. Only the explicitly labelled Yesterday only view fetches yesterday and does not overwrite page health.
- Changing analysis dates clears prior analysis and withholds the old header coverage during loading. A period without accepted facts says No readings / No data, even when the backend classifies it as partial. Existing zero versus absent meter semantics are retained.

## Validation

62 tests passed in 5 files: report-agent-panel, explorer-trends, explorer-trend-model, project-explorer, explorer-meter-quality. Added restoration / polling reconnect and historical versus yesterday quality regressions.

Real Chrome against isolated worker Web3195 and real API18769: Tuya 10 September shows 100% historical coverage, explicit Yesterday only shows 0%, return to Daily restores 100%; whole-page Yesterday (12 September) shows 0%, no data and no historical 100%. No server data was mutated.

Real browser UI scenarios intercept report state APIs: running review / page reload / stop / retry, desktop1440 and mobile390 verified, no JavaScript errors after limiting the test initialization to the top frame. These are browser state-contract checks, not a new Provider generation or live stop/resume acceptance. Prior real generated runs remain intact. Evidence: worker outputs/progress-quality/browser-results.json and screenshots.

Full web TypeScript check is not green: existing errors remain across data-tasks and EnergyIQ test fixtures (including unchanged project-explorer.test.ts date fixture properties). No diagnostics in the changed production files or added tests; full output is outputs/progress-quality/typecheck.txt. Integration owns full checks and deployment acceptance.

Preview-generated next-env.d.ts and tsconfig.json were restored to their observed clean baseline after stopping this worker's preview server. Existing untracked outputs retained.
