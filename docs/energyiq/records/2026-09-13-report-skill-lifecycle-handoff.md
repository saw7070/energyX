# Report Skill lifecycle handoff — 2026-09-13

## Delivered behavior

Project members can create private report conversations and personal, project-bound Skills. Administrators manage shared methods and project defaults. Per-message selection resolves authorized Skill IDs and versions on the server and stores instruction snapshots and content hashes in the Run. Selecting an older version does not alter project defaults.

Saving a candidate preserves earlier versions under the same Skill ID. Activation is a separate **Set as project default** action. Skill Creator 1.2.0 prefers revising an existing method from conversation evidence and explicit feedback. Generated drafts do not automatically save, activate, or evolve after every report.

Platform presentation, Skill Creator, and report review remain required inputs. The UI distinguishes configured selection from the real `skill_inputs_prepared` event; neither is represented as proof that the model read or applied instructions. Review status uses real backend events.

## Implementation and integration

- Worker: `D:/Projects/energyiq-report-user-flow`, branch `codex/244-report-skill-lifecycle`.
- `2db8f970`: Skill catalog, version save/default endpoints, Run selection, manifest provenance, member permissions, and UI controls.
- `31bad5ed`: generic configuration bypass protection and additional interaction tests. S0 confirmed integration as `095e1171`.
- Main Agent owns the conversation access helper, runtime services, shell and route guards, account setup, and shared API/Web restarts. Its helper commit is `6e20f9f0`; worker equivalent is `af85b759`.

The implementation reuses `config_resources` Skill packages. `reportSkillVersions` holds up to 50 versions; `reportProjectId` binds their applicability. Generic configuration create/update/upload/delete and bulk toggle cannot inject reserved fields or modify these resources. Shared catalog records additionally require a currently authorized administrator as their author. Personal records are owner-only, including explicit Run selection. Platform methods cannot be overwritten or disabled.

Member Run defaults omit administrator-owned file references. Explicit attachments still pass the existing owner/workspace file authorization checks. Private Skill drafts and conversation activity remain author-only; shared report access does not grant access to the author's conversation. Project configuration writes and shared/default Skill changes require `canManageProject`.

## Validation evidence

Worker checks:

- Root TypeScript build passed.
- Report API, library API, and input packaging: 36 tests passed before the extra catalog rejection case; API/library subset subsequently passed 22 tests including that case.
- Existing panel/library UI suites: 55 tests passed.
- New Skill UI interaction suite: 3 tests passed for optional selection, save/activation separation, and member-only personal scope.
- Generic configuration rejection suite: 4 tests passed, covering JSON and multipart creation, patch, replacement, duplicate create, bulk toggle, and deletion. Existing generic Skill creation and rename remain permitted.
- Whole-Web type checking retains pre-existing errors; changed production files had no diagnostics. It is not reported as a green whole-Web type check.

S0 reported the following live integration evidence in task `01a081f5-e9b1-7943-becf-8ecbe06b4fbf`:

- Three Tuya member accounts completed concurrent chats with separate Sessions. Cross-session, settings-write, and cross-project requests returned 403.
- A personal Skill preserved V1 and V2 under one ID. Explicit V1 selection in real Run prefix `606a06db` returned `METHOD_V1`; other users could neither see nor select the method. Project defaults remained unchanged.
- All five test accounts had a visible browser composer, with Tuya account histories separated.
- S0's integration guard/API/UI subset passed 19 checks after the security patch was integrated.

These live checks are S0-reported evidence, not a second independent replay by this worker. The Run prefix above is deliberately not expanded into an invented full ID.

## Acceptance boundary

At handoff, S0 was still waiting for a member report's review run and the final API restart carrying the security patch. Those are not marked complete here. Browser layout and report acceptance remain separate from unit tests and the verified personal-Skill invocation. No production deployment is claimed.

This worker is closed for new functionality. Remaining integration/runtime acceptance belongs to S0; no further Skill or evolve expansion is part of this handoff.
