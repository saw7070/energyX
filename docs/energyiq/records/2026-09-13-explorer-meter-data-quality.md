# Explorer meter data quality

Incremental frontend change on `bf41706a` (Tuya categories). Meter tables and circuit detail share the same interpretation of canonical analysis data:

- Valid zero period energy: “Zero consumption”; may be unused/no load, switch state and fault status unconfirmed. Unchanged cumulative readings can represent zero consumption.
- No usable intervals: “Missing readings”; check connectivity, collection and source quality. This does not distinguish absent raw records from unusable raw records or establish equipment failure.
- Partial coverage: “Incomplete data”, percentage and count of missing/unusable expected intervals. Zero over available data carries both labels. Exact missing timestamps are not exposed by this per-meter API, so no timestamps are invented.
- Quality events: independent “Quality review” notice, including when period energy is zero.
- Virtual input absent: “Inputs incomplete” with published input names/circuit codes. Numeric virtual totals with partial input coverage carry “Input quality review”. Calculated zero is not evidence of a switched-off physical circuit.

No raw readings, formulas, aggregation, setup publication or shared processes are changed. Existing period totals remain canonical. Eight focused UI/quality tests pass; focused web TypeScript passes. Tests cover valid zero vs absent data, partial zero, nonzero values that round to zero, quality events, missing virtual inputs, partial numeric virtual inputs, and table/detail rendering while loaded/loading.

## Read-only local data audit

On 2026-09-13 the existing API was queried for DB1, DB2 and DB3 using its pinned current-overview-28d window (2026-08-14 through 2026-09-10, Asia/Singapore). All 23 directory entries were checked against the new quality classifier; this is canonical API verification, not physical meter calibration or raw-device troubleshooting.

- 17 physical meters have positive period energy with incomplete coverage (approximately 86.1–90.4%). No physical meter in this window had valid zero period energy.
- Director Room Power (L1P15), Showroom Blind (L2P11), Showroom Blind (L2P8) have no usable readings in the analysis response.
- DB1 Other and DB2 Other have incomplete inputs and null calculated energy. Missing inputs are not replaced with zero.
- LED Display Total is 344.8762 kWh from 112.5233 + 112.1039 + 120.2490 kWh, with partial input coverage flagged.

Local audit artifact: `D:/Projects/energyiq-explorer-children/outputs/explorer-verification/meter-quality-audit.json`. Names in the audit are projected from the reviewed presentation patch; those new labels are not yet published on the running service. No login secrets are included in the artifact.

Integration must apply `bf41706a` before this increment, reconcile the previously identified source_manifest draft difference, and coordinate runtime update. Real browser acceptance of the new quality UI remains pending that update.
