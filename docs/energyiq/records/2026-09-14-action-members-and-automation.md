# Action access and automatic follow-up

## Scope and deployment boundary

This change extends the administrator pilot to project members behind `ENERGYIQ_ACTIONS_CUSTOMER_ENABLED=true`, together with the existing `ENERGYIQ_ACTIONS_PILOT_ENABLED=true`. No ordinary conversation, Skill-management or configuration-write capability is granted by enabling Actions. Main and production are unchanged until an explicit release.

## Permissions

- Personal Actions default to private. Only their owner can see or operate them; platform administrator status does not silently expose another person's private Action.
- Only an administrator can create a project Action by explicitly selecting shared visibility. Current members of that project may see it and record progress. Every event retains the actual actor and displays their name and effective/recorded time.
- Visibility is set at creation. There is no generic endpoint allowing members to change private records into project records.
- Members can track suggestions already extracted from a project report, or create a personal Action. Model-based extraction remains restricted to the source report's administrator author.
- Feedback is visible through its authorized Action, not flattened into the shared report library. Source-report linkage lives in the Action receipt. The worker does not inherit the original author's conversation, checkpoint, files or private analytical Skills.
- Each run belongs to the Action owner. Current owner access and Action revision/state are checked before execution and before output acceptance. Revoked access stops generation; it does not silently transfer job ownership to another member.

## Automatic execution

The existing single API queue owner handles execution; no additional daemon, second SQLite queue owner or cron service is introduced.

1. Recording progress wakes the Action scanner immediately.
2. The queue's existing 30-second tick detects changes to published data snapshot/hierarchy IDs for implemented Actions and starts a check. A five-minute periodic sweep covers unchanged snapshot IDs, day boundaries and transient query failures.
3. The scanner reads the current authorized data through the established Snapshot/DuckDB path. Missing or non-comparable days produce a waiting state, not a fabricated result.
4. Sufficient comparable readings enqueue the existing Pi report job. A transaction links Action revision, stage and run; repeated checks or restart cannot create a second run for that stage.
5. Failed/interrupted generation receives at most two automatic retries, due after one and five minutes respectively and processed on the normal queue tick. Retry state and previous run IDs persist. Cancelled runs never restart automatically. Invalid data/permission/revision errors require attention rather than repeated model calls.
6. The UI shows waiting, queued, retry time and exhausted retry states. Users do not need to press a data-check button to complete the normal flow.

All observations remain comparisons, not proof of causal savings. This slice does not add weather/occupancy adjustment, multi-meter Actions, assignment, or automatic hardware control.

## Verification inventory

- Unit/integration: member private records, explicit shared records, actor attribution, cross-project denial, existing private-admin feature flag, member feedback without chat permission/private author context, data-availability transition, snapshot-triggered dispatch, duplicate checks, bounded retry, cancellation, revoked access.
- UI: server capability-driven Action entry, default-private/explicit sharing, existing suggestions without extraction permission, scenario lock, event history, automatic status and preserving drafts after errors/retries.
- Live acceptance: independent administrator/member/editor browser contexts; create shared and personal Actions; record historical execution from member UI without manual data check; read Pi-generated feedback; verify another member can access shared but not private output; pause QA Actions afterwards.

Live results and final release evidence are recorded below after execution. Test historical records must be labelled clearly; no physical intervention or real-world savings should be claimed.

## Build and regression evidence

- 88 backend tests passed across Action API/feedback, report preparation/execution/API/library.
- After UI integration, 80 tests passed: 40 Action panel/entry tests, 25 library tests and 15 Action feedback tests. These overlap with the backend count and are not an additional 80 independent backend tests.
- TypeScript build and full Next production build (`.next-actions-members`) passed. A final retry-wakeup adjustment passed the 15 feedback tests and TypeScript build again.
- Real member API: project report recommendations readable, zero administrator-private Actions returned, direct private Action access 404, foreign project request 403. No existing customer passwords or account grants were changed.

## Live browser acceptance

Reference report `57082111-1ca9-48dc-92db-6fbe8ae27021` is the local QA import of Charles's Tuya reference HTML. All actions below are explicitly labelled historical QA, not real equipment operations.

- Administrator created project Action `190ce50a-eddf-4d8f-b0b9-58e1f78259ae` through the UI. The sharing checkbox was initially unchecked and was explicitly selected. Baseline 18 August–8 September inclusive; LED Display 1.
- Ordinary member opened the shared Action and recorded the 9 September 19:00 SGT historical event. No check endpoint/button was called. The backend automatically enqueued Pi run `4d7177e1-9c46-4512-a6b2-a7183d9fe965`, which succeeded. Event actor display was `Action member QA`, not the administrator owner.
- A second project account opened the generated shared feedback through the actual Action UI. It received only the shared Action; direct access to the first member's personal Action/feedback returned 404.
- Ordinary member also created private Action `211c3363-95c4-4cb6-b376-8bc48826fcc0` through the UI. There was no sharing checkbox for this account. Recording execution automatically enqueued Pi run `8837abd1-e9b0-4b56-9bdc-baa371131f34`; both users' runs were observed running concurrently. Administrator access to this member's personal Action returned 404.
- Actual worker inputs for both runs: creation notes `[]`, zero attachments, no previous-report copy, `frozen_action_evidence` manifest. Source-author private context was not inherited.
- Desktop and 390px Action panel were inspected; no page-width overflow at 390px. Progress history shows actual actor and project-local effective/recorded timestamps.

The shared feedback numbers matched the supplied baseline/observation receipts and explicitly stated no physical intervention or attributable savings. Its headline numbers retained excessive decimal precision and internal identifiers; the central feedback generation prompt now requires readable two-to-four-place display and keeps internal identifiers out of the main narrative. That prompt refinement is not a manual rewrite of the generated HTML and has not been re-evaluated through another model run in this slice.

Snapshot-change triggering, missing-data waiting, failure retry/backoff, cancelled-run behavior and access revocation were exercised in isolated integration tests. The live browser replay proves immediate automatic dispatch on recording historical execution; it is not a new overnight production API-sync acceptance or a real field intervention.

The private member run also succeeded and was opened by its owner through the actual UI. It correctly compared 13.3542 kWh expected versus 13.3569 kWh observed, identified the -0.0027 kWh difference, and stated no physical intervention occurred. The same user's request for a shared feedback succeeds; other users' requests for the personal feedback are denied. This establishes the local member-to-automatic-feedback path without granting arbitrary chat execution.

Final hardening: the Action source endpoint rejects feedback reports as source reports, preventing a private feedback artifact from becoming a new shared source. Access is rechecked after asynchronous baseline reading, before Action creation. After initial feedback succeeds but seven-day evidence is still insufficient, check status is updated to waiting_data rather than retaining queued. These changes passed the Action regression tests and TypeScript build.

After the final local API restart, both Actions correctly read back as waiting_data with three comparable days, while their accepted initial feedback remained linked. QA Actions were then paused through the ordinary member UI, preventing further background test generation. Main and production remain unchanged. Local API is on 18769 and Web on 3000 using `.next-actions-members`.
