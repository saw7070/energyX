# Validation workspace completeness — 2026-09-13

Preschool metadata was copied into the validation store, but its workspace fact database was omitted: the old ignored prepare.mjs copied only energy/default/energy.duckdb. The ordinary-member API therefore could not resolve the published data.

Run `node scripts/energyiq/check-workspace-data.mjs <storage-root>` before starting a copied validation environment. It enumerates every project with a data snapshot, checks its workspace DuckDB exists and is nonempty, and exits unsuccessfully if any is missing. This checks file presence only, not snapshot contents, coverage or member permissions.

The local ignored preparation script now copies every referenced workspace, refuses an existing target, and refuses a source WAL requiring a consistent backup. Source writers must be stopped before preparation; this script is not a live backup mechanism. Do not rerun preparation on the current validation store.

Validation: recovered current storage passes all five snapshot-backed project file checks; a synthetic absent workspace is reported missing. Preparation script syntax passes. S2 owns the separate Preschool snapshot/workbook parity and real report validation.
