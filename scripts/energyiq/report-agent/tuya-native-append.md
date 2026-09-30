# Append a native Tuya bundle

Fixed project: `tuya-office`. Input is `index.json` with `sources: [{sha256, filename, coverageFrom?, coverageTo?}]`, plus exact original bytes at `sources/<sha256>.json`. Optional `projectId`, if supplied, must equal `tuya-office`; optional `path` must equal that fixed relative filename. This accepts the production-backfill bundle as downloaded. All sources are validated before any target writes: hash, path/link boundary, native artifact schema, unit/scale, valid cumulative readings, and source labels from the confirmed meter mapping. Replay artifacts are not accepted here.

Dry-run (does not open target metadata):

```powershell
npx tsx --tsconfig scripts/energyiq/report-agent/tsconfig.json scripts/energyiq/report-agent/append-tuya-native.ts --bundle D:/Projects/energyiq-datafoundry/outputs/report-integration-20260911/production-backfill
```

Apply using the existing wrapper's authenticated environment (`ENERGYIQ_REPLAY_COOKIE` with `df_csrf`, `ENERGYIQ_REPLAY_ORIGIN`; alternatively the configured authorization environment):

```powershell
npx tsx --tsconfig scripts/energyiq/report-agent/tsconfig.json scripts/energyiq/report-agent/append-tuya-native.ts --bundle D:/Projects/energyiq-datafoundry/outputs/report-integration-20260911/production-backfill --apply --metadata <existing-metadata.sqlite> --file-root <existing-file-asset-root> --user <admin-user-id> --api-url http://127.0.0.1:<api-port>
```

Apply revalidates against the target's current confirmed mapping, registers sources by their native SHA without altering their bytes, unions the current draft and published snapshot source manifests with new hashes, and calls the existing materialize HTTP endpoint. It does not change report settings, delete old artifacts, copy a database, or write snapshot pointers. Repeating registration reuses existing SHA batches. Publication errors are reported as failures; inspect actual publication/snapshot state before retrying. For an all-available prewarm error after successful publication, retry the dedicated prewarm endpoint rather than assuming no data was committed.

The seven-source September 12 bundle overlaps the earlier archive. One native artifact corresponds to an earlier reconstructed replay artifact with a different content hash. Both source records remain auditable; canonical normalized readings and intervals must be deduplicated by the existing fact writer. Do not compare total raw source-row counts to production without accounting for this retained provenance.

Isolated test (temporary metadata/files/DuckDB, no live API):

```powershell
$env:S1_TUYA_ARCHIVE='D:/Projects/energyiq-datafoundry/outputs/tuya-office-export-20260906/source-readonly.duckdb'
$env:S1_TUYA_NATIVE_BUNDLE='D:/Projects/energyiq-datafoundry/outputs/report-integration-20260911/production-backfill'
npx vitest run --config scripts/energyiq/report-agent/vitest.config.ts apps/api/src/report-agent/tuya-native-append.test.ts
```

Acceptance: 42,579 unique intervals and actual cutoff `2026-09-11T15:45:00.000Z` (September 11 23:45 Singapore), published fact-state identity matches metadata, prior source hashes remain and report settings are unchanged. Live Explorer, Pi, and scheduled sync remain S0's checks. Request watermark midnight is not measured interval cutoff.
