# UI interaction simplification — 2026-09-13

## Changes

- Skill selection has explicit Project defaults / Choose methods controls. One row per method, with versions and full instructions disclosed on demand. Selection retains exact id/version references and the five-method limit; required methods remain mandatory and saving defaults remains a separate permission-controlled action.
- Composer dates distinguish dates for the next message, available reading dates and missing-date warnings. Starter guidance is shortened; no date computations changed.
- Explorer distinguishes Analysis dates from chart grouping (Daily / Weekly / Monthly / Average day) and the exceptional Yesterday only view. Each chart displays its actual dates. The independent quality check retains its own period, visible coverage and expandable dates.
- Device heatmap has a short legend and expandable instructions. Space/device totals show their own analysis dates; numerical totals are emphasized.
- Added answer_progress cumulative text rendering for the selected running run. Completion uses the saved answer. Text progress is excluded from activity rows.

## Validation

- Final rerun after all changes: five focused test files passed, 59 tests (including 36 panel tests). Covers exact version pinning, default reset, final answer precedence and activity filtering.
- Impeccable detector returned no findings. Diff whitespace check passed.
- Whole-web TypeScript check is not green: existing unrelated test typing failures remain, including project-explorer.test.ts fixture properties. No errors reported in changed production components.
- Real 3008 browser: default/custom method switch and grouped names; desktop viewport 2560px and actual narrow viewport 480px had no page horizontal overflow. The browser viewport override clamped to 480px, so this does not claim 390px acceptance. Expanded narrow composer is height-bounded and scrollable, retaining access to sending controls.
- Real DB1 Explorer: analysis dates displayed Aug 14–Sep 10; Yesterday only loaded Sep 12 with no usable readings and 0% coverage. Dates were not silently shifted and missing energy was not converted to zero. Heatmap and space/device readings were inspected. Temporary viewport override reset.

## Integration boundary

No API edits, time computation changes, shared 3000 restart or deployment. Live provider streaming acceptance belongs to the backend Integration Agent; frontend progress rendering is verified with component tests, not claimed as an end-to-end provider result. Project details / singular Skill for this message strings were absent in this checkout; the existing per-run Skills explanation and composer controls were simplified instead.

Integration follow-up: a2b4738c was applied as 209c69ee. `.next-composer` production
build passed and is running on local 3000. Real browser selection of Last month
produced August 1–31 in both date inputs. At 390×844, after closing the navigation
overlay, there was no document horizontal overflow and the send button ended at
y=821, within the viewport. Desktop/mobile screenshots: Integration
outputs/report-integration-20260911/composer-{desktop,mobile}.png. Existing 400ms
answer polling was preserved. This is local verification, not production deployment.


## Follow-up: conversation entry hierarchy

Synchronized Integration 485b2237, including its active-run 400ms and full-page immediate event polling; those behaviors remain unchanged. No installed frontend-design/SKILL.md was found under the local agent skill directories or plugin cache. Applied frontend-orchestrator routing to impeccable distill for an existing product surface, without a new visual identity.

The composer now shows one current date summary. Date presets, custom fields and multi-month selection appear when expanded; available-reading dates and missing-date warnings remain immediately visible. Recent reports are available in an expandable section rather than competing with the initial question flow. No underlying date or Skill behavior changes.

Validation: 36 agent-panel tests passed after the structural change, diff check clean, design detector empty. Real 3008 browser desktop 2560px and narrow 480px: default date controls collapsed, opening and choosing Last month updated both inputs and the summary to Aug 1–31; no horizontal overflow. At narrow height 844px the send button bottom was 821px, within the viewport. No 390px claim; viewport override reset. This patch does not deploy or restart shared services.
