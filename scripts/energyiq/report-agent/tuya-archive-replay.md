# Tuya archive replay

This helper recovers stored cumulative kWh events from a Tuya DuckDB archive into the existing Tuya Import Batch -> source manifest -> materializer -> snapshot chain. It does not treat interval usage as cumulative energy, copy a database over running storage, or manufacture a snapshot pointer.

The verified source is `D:/Projects/energyiq-datafoundry/outputs/tuya-office-export-20260906/source-readonly.duckdb`: 30,133 raw rows in 29 source batches, producing 32,511 intervals across 17 meters. Its actual last interval ends at `2026-09-05T15:45:00.000Z` (23:45 Singapore). The separate report `readings.csv` has 40,948 rows through September 10; September 6-10 is **not restored** by this archive.

## Dry-run

From the Integration checkout after applying the helper commit:

```powershell
npx tsx --tsconfig scripts/energyiq/report-agent/tsconfig.json scripts/energyiq/report-agent/replay-tuya-archive.ts --source D:/Projects/energyiq-datafoundry/outputs/tuya-office-export-20260906/source-readonly.duckdb
```

The default only opens the archive read-only, verifies its hash has not changed, validates source labels against canonical meter IDs, and reports the replay plan. It does not open target metadata or write project state. Recovered artifacts have new content hashes and explicitly identify their original batch/hash/row provenance; replay scale 0 means values are already normalized kWh, not recovered native Tuya property evidence.

## Isolated end-to-end verification

```powershell
$env:S1_TUYA_ARCHIVE = 'D:/Projects/energyiq-datafoundry/outputs/tuya-office-export-20260906/source-readonly.duckdb'
npx vitest run --config scripts/energyiq/report-agent/vitest.config.ts apps/api/src/report-agent/tuya-archive-replay.test.ts
```

The gated test uses generated temporary SQLite/files/DuckDB storage and the existing manifest materializer. It compares every interval key, quality, usage and average power (9 decimal places) to the archive; verifies 20 meter attachments, actual cutoff, Explorer's September 2 official total, and the 1,632-row period export used by Pi. Windows may retain a temporary test directory if a native database handle remains busy; its exact path is printed. This is not live API or browser acceptance.

## Explicit apply (S0 only)

Supply the **existing local verification** metadata path, the API's exact FileAssetService storage root, the authorized admin user ID, and running API origin. Supply the existing authenticated cookie in `ENERGYIQ_REPLAY_COOKIE` or bearer header in `ENERGYIQ_REPLAY_AUTHORIZATION`; never put secrets in shell history or output. For cookie authentication also set `ENERGYIQ_REPLAY_ORIGIN` to the exact frontend origin (for example `http://localhost:3000`). The helper decodes `df_csrf` into `X-CSRF-Token` and sends that frontend `Origin`; missing or malformed CSRF/origin fails before target metadata is opened.

```powershell
npx tsx --tsconfig scripts/energyiq/report-agent/tsconfig.json scripts/energyiq/report-agent/replay-tuya-archive.ts --source D:/Projects/energyiq-datafoundry/outputs/tuya-office-export-20260906/source-readonly.duckdb --apply --metadata <existing-metadata.sqlite> --file-root <existing-file-asset-root> --user <admin-user-id> --api-url http://127.0.0.1:<api-port>
```

Apply validates project administration, the current draft's confirmed mapping, and absence of an already published data snapshot or unrelated sources. It registers immutable recovered artifacts and updates only the draft source manifest through metadata services. It then closes metadata and calls the existing authenticated `POST /api/v1/energy/projects/tuya-office/imports/{batchId}/materialize` API for atomic publication. It does not start services. Source IDs/hashes are deterministic, allowing retry after registration failure. If publication fails, inspect the returned API error and publication journal before retry; no fake success/snapshot is written by the helper.

After publication, validate the real Explorer request with `surface: project-explorer`, root `tuya-office-project`, `analysisWindow: current-overview-28d`, plus a known full day (September 2). Structural hierarchy is root + two spaces + three boards (six nodes); 20 meters live in mapping/attachments, and three meters have no interval evidence. Verify official routing rather than summing total and sub-meter consumption. Check `overview.projectData` reports the September 5 cutoff independently of attachments, and a run with `useProjectData:true,fileRefIds:[]` produces snapshot-pinned period CSVs for Pi. UI/browser acceptance and the September 6-10 backfill remain separate work.
