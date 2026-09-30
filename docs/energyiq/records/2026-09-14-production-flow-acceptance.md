# Production acceptance — 14 September 2026

## Release and operations

- Initial Explorer release: 9330a549bcbe171d1bde2e5aae6804685d1c1f40. Final application release: 56bc2b78a300d4e3eef687dfa9cc807be3f3e0a9, including style isolation and preservation of unmigrated projects' own visual preferences.
- Scheduled Tuya sync actually ran at 02:00:00 SGT and succeeded at 02:00:10.114. Trigger was scheduled, not a manual replay. New snapshot: energy-snapshot-5bf94a088af8ae271ed1e7f6.
- 02:15 backup failed because available space was below its consistency-copy requirement. Six obsolete releases were removed after resolved-path checks; current and recent rollback releases were preserved. Space recovered from 2.4 GB to about 13 GB before new deployment.
- Replacement backup succeeded: /var/backups/energyiq/managed-daily/backup-20260914T004001Z/storage.tar.zst. Existing retention pruned one oldest managed backup. Deployment used this backup.
- 37 focused report-input and Explorer tests passed; clean release TypeScript and Next builds passed. Production deployment smoke checks passed.

## Data evidence

Yesterday means local [13 September 00:00, 14 September 00:00). Most active channels and all three LED channels have 96/96 intervals. panel-a-meter-07 has 95/96; panel-a-meter-04 has 88/96. Channels with no usable intervals must not be omitted from overall completeness claims: panel-a-lighting, panel-a-meter-06 and panel-b-meter-07 have older cumulative cutoffs; three other channels have insufficient history. Do not infer a hardware fault or zero energy from absence of derived intervals.

Real production browser: Fridge and Water Dispenser shows 2.34 kWh, 2.34 kWh/day, 0.14 kW peak and 100% coverage for 13 September; the hourly curve and global date strip agree.

Report input and Explorer use the same snapshot and the same local 7–13 September period. Input CSV has 10,781 rows. Its 4,504 valid official-route rows sum to 647.0380946561276 kWh; Explorer returns 647.0381 kWh. Difference is display rounding, not competing datasets. This is observed energy with incomplete channels disclosed, not a claim of complete physical consumption.

## Full report flow

Validation session a95b4d60-6164-4144-aad0-80884d7dd2ea; initial report run 072d318d-c232-4dcd-91fa-9a2750e61d22. Created by the existing integration administrator. Other administrator sessions cannot open this private conversation; project members can read its published report through Reports. This is expected scope separation.

At preflight, data sync was enabled but periodic reports were off. The completed report, extraction and timed rerun evidence is recorded below. Temporary test schedule/default changes were restored and independently checked.

## Project style isolation release

Release 9117759a427c514157ef362c74da82a26424553b deployed after TypeScript/Next builds and targeted tests (83 passed, 6 opt-in Docker tests skipped; 17 targeted tests passed after the final UI/permission additions). Main is clean. Runtime PID allowance is now bounded at 256: the preceding report stalled with 23 cgroup PID-limit denials at 128, no OOM; after increasing allowance and terminating only the stuck browser-check subprocess, it recovered and completed.

Production and local project bindings migrated through the report API. Tuya analysis tuya-interactive-report 1.1.0 and style tuya-office-editorial-style 1.0.0; Preschool analysis preschool-portfolio-report 1.1.0 and style preschool-portfolio-style 1.0.0. Old versions retained. Independent readback: only revision, skill and styleSkill changed; materials, data settings and scheduling remained unchanged. Both periodic report frequencies remain off.

Production browser and local browser both show separate presentation-category project styles, plus shared presentation 1.2.0 and Skill Creator 1.3.0. Final application release 56bc2b78 also preserves the existing project-specific visual preferences of projects not yet migrated. Main and production contain the implementation; this acceptance record is a subsequent documentation-only change.

## Completed production report and Skill loop

| Stage | Run | Result |
| --- | --- | --- |
| Tuya 7–13 September report | 6d7f51aa-5ab9-4fb0-bc73-812d9712019d | Succeeded 01:27:47 UTC; white/orange editorial style; desktop/mobile and filter checks passed. |
| Preschool May report | 4c74e569-cfd5-452c-a977-8887a0523420 | Succeeded 01:36:10 UTC; blue portfolio style; synthetic demo data explicitly labelled; browser and interaction checks passed. |
| Tuya Skill Creator | 6401758f-1686-42b2-b8d8-3ff5ebfda8e7 | Succeeded 01:37:25 UTC; analysis-category draft; separates methods from the project's palette/fonts/layout. |
| Actual scheduler: Tuya 13 September | fa7e56d5-1dea-48c9-b4aa-c1a9c8dfeb65 | Succeeded 01:49:51 UTC; new period plus extracted candidate method; pinned Tuya style retained; review and browser/interaction checks passed. |

For all four runs, the worker's actual project-style.md exactly matched the run's frozen style content. Tuya used tuya-office-editorial-style 1.0.0; Preschool used preschool-portfolio-style 1.0.0. The generated final reports were opened in the production Reports interface. Final scheduled-report screenshot confirms orange presentation and readable dates; literal Unicode escapes seen in the draft are absent in the final screenshot.

The extracted method was saved as 1.2.0-validation on the existing tuya-interactive-report resource, not as another independently proliferating Skill. Its candidate version was temporarily activated for an actual daily scheduler enqueue (schedule key tuya-office:daily:2026-09-13:2026-09-14). The formal default remains 1.1.0. Independent restoration comparison found only the expected revision increment; frequency is off and the original style and provenance are restored. Preschool settings were not changed by this test.

The scheduled run's 1,335 input rows include 576 valid official-route rows totalling 69.8283448651001 kWh. Explorer returns 69.8283 kWh for the same snapshot and Singapore day. Missing routes are disclosed; agreement does not imply complete physical coverage.

The production API and web services are active after the final deployment. Final available disk space is approximately 7.4 GB, close to the earlier 7.2 GB backup preflight requirement: future release retention/backup headroom needs monitoring. The fresh report worker recorded zero PID-limit denials with the bounded 256-PID allowance.

Acceptance boundary: style isolation, version pinning, extraction and actual scheduled reuse are demonstrated on these runs. This is not a guarantee that every future report has identical layout or Charles-level analytical quality. A few causal phrases in the weekly report still merit editorial improvement; model review passing is not equivalent to independent factual certification. Local project data was not refreshed in this style validation; data parity evidence above is from production.
