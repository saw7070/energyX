# Tuya Explorer meter groups

User-approved presentation: DB → optional end-use group → meter/circuit. A group is an expandable directory, not an accounting scope. Multiple main meters can remain attached to one DB. Official aggregation routes and virtual formulas stay independent of the directory.

`presentation.device_name` takes precedence over `presentation.circuit_name`, then legacy `display_name`. Circuit codes remain visible to distinguish identical device names. Unclassified projects retain direct meter children. Main/sub/virtual roles remain visible in circuit details; missing readings remain missing.

Tuya labels use PPT slides 2–3 and the Device-ID-joined business mapping from 2026-09-06. All 20 physical circuit/category labels were checked against the current PPT. Raw Device IDs and credentials are excluded. AV / TV, Blind, Access Control, Plug Load, Pantry, Lighting, Total Power and LED come from the source; Other consumption groups the two residual virtual meters. LED Display Total shares the LED group with its three physical inputs.

User correction supersedes the erroneous PPT DB2 diagram: DB2 Other = DB2 L2 Power − its eight measured Power subcircuits (panel-b-meter-03 through 10). Neither Light nor DB1 Main Entrance is subtracted. The existing formula already matches this correction; regression coverage now pins it explicitly.

## Delivery and verification

- Optional fields persist through metadata normalization, setup HTTP parsing and Agent setup schema, then come from the pinned published hierarchy in both directory and analysis.
- Presentation changes do not alter the metering fingerprint or routing revision. Opening groups issues no artificial scope query; selecting a leaf keeps its meter URL while querying the attachment DB.
- 42 focused regressions passed across metadata, API, navigation and circuit UI. API and focused web type checks passed. Agent setup compatibility has additional round-trip coverage.
- Local helper: `npx tsx scripts/energyiq/tuya-meter-presentation.mts plan <plan.json>`; requires `ENERGYIQ_LOCAL_ACCESS_FILE`. `apply <plan.json>` uses reviewed hashes, fresh optimistic revisions, setup validation/publication and verifies the published directory. Local hosts only. It never writes settings/contextNotes or historical snapshots.
- Initial read-only live preflight found setup draft revision 3 differs from the published snapshot only at `source_manifest`. Plan contains only hashes and the 23 presentation entries. Apply refuses unrelated unpublished changes. Integration owns reconciliation and coordinated publication after its in-flight report completes.
- Browser acceptance of this new grouping remains pending that integration/publication. Existing prior sidebar acceptance does not prove new groups are live.
