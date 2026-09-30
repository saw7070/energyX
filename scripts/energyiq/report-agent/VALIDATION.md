# S1 first delivery — Pi report worker

Run all commands from the checked Integration worktree after S0 combines S1 and S2. No production configuration is changed by this delivery.

## Build and verification

```powershell
docker build -t energyiq-report-agent:pi-review-20260913 scripts/energyiq/report-agent
npx tsc -p scripts/energyiq/report-agent/tsconfig.json --pretty false
$env:S1_DOCKER_TEST='1'
npx vitest run --config scripts/energyiq/report-agent/vitest.config.ts
```

The scoped Vitest and TypeScript configurations resolve this checkout's package sources. They do not borrow another worktree's node_modules or require building the complete application. Full application build, three high-level Seams and browser acceptance remain S0 Integration work.

Docker tests run the real Pi 0.84.2 SDK with controlled OpenAI SSE responses: write tool → HTML transfer → saved Pi session → second container resumes identical session/history; in-flight cancellation; truncated stream rejection; container removal; no network, bind mounts, socket or provider key in the worker. The metadata test resolves the actual existing default Profile mechanism with a fixture encrypted secret. These are not real-provider or production results.

## Runtime configuration and boundaries

Use the existing server-owned Model Profile. First delivery supports its HTTPS OpenAI-compatible chat-completions endpoint (including DeepSeek); it does not rewrite DeepSeek to an Anthropic endpoint. No package/lock changes are required on the API host. Pi and Python readers are installed only in the image.

- `ENERGYIQ_REPORT_AGENT_ENABLED=true`
- `ENERGYIQ_REPORT_AGENT_HARNESS=pi` (default when enabled)
- `ENERGYIQ_REPORT_AGENT_IMAGE=energyiq-report-agent:pi-review-20260913`

The project-tools image advertises protocol version 1. Chat runs receive project-bound setup/context tools; report and scheduled runs do not. The host invokes the existing configuration services with the captured user's permissions. No database, HTTP credentials or host network access is passed to the worker. Old images cannot silently accept tool-enabled runs. Structure writes save drafts only; publication remains a separate operation. Project context updates persist independently of Skills. Tests for earlier file/session behavior still use the preserved pi-0.84.2 image; the new tool roundtrip test uses the project-tools image.

Only the API host needs Docker access. The worker has network `none`, read-only root, UID 1000, dropped capabilities, no-new-privileges, 2 GB RAM / 2 CPUs / 256 PIDs (headroom for Chromium verification; still bounded), and bounded tmpfs. Model requests and ordinary files cross stdio; the host fixes the endpoint/model and adds the credential. Redirects and incomplete SSE streams fail. Provider errors and raw tool arguments/results are not returned as events. Report HTML and Pi session state are saved per Run. A failed/cancelled revision cannot replace an accepted report. Service restart marks interrupted jobs; explicit resume creates a new Run and retains old history. A resumed conversation starts from its latest successful Pi checkpoint, not a partial failed checkpoint. Administrative prompts and Run history survive refresh in SQLite.

A single API process owns this first worker queue. Do not run multiple enabled API replicas against the same SQLite database: startup recovery is not a distributed lease. Host disk retention/quotas across many Runs remain operational follow-up; individual input transfer is capped at 100 MB, output+state at 48 MB, 2,000 files, tool calls at 160 and duration at 20 minutes. JSONL model responses are buffered within a 16 MB cap; UI events are tool/phase progress, not live token streaming. Model credentials never enter the container.

## Existing API plus compatible additions

Base: `/api/v1/energy/admin/report-agent/:projectId` with the existing authenticated administrator and project authorization. Responses retain the existing success/error envelope.

- `GET /`: existing settings/runs/files plus current user's `sessions` and `dataSummary`. Summary is from latest successful report's analysis dataset and is null for legacy input manifests.
- `POST /sessions`: creates `{id,projectId,workspaceId,actorUserId,createdAt}`.
- `POST /runs`: existing `{period:{from,toExclusive},prompt,kind?,parentRunId?}` plus optional `sessionId`. Without either ID, creates a fresh Session. With sessionId, continues its last successful report. Returns 202 `{id}`.
- `GET /runs/:id/events?after=0`: `{events:[{sequence,runId,time,type,tool?,isError?}]}`, ascending, maximum 200. Use last sequence as next cursor.
- `POST /runs/:id/stop`: returns Run, marks queued/running as cancelled and aborts active harness.
- `POST /runs/:id/resume`: failed/interrupted/cancelled only; 202 `{id}` for a new Run with `retryOfRunId` and same Session/settings. Retrying twice concurrently conflicts.
- `GET /output/:id`: existing `{content}`. Accepted project-authorized artifacts remain accessible; Session history/events/actions are restricted to the owning user.
- `PUT /settings`: existing fields plus `comparisonPeriod?`, `skillSourceRunId?`, `skillRefs?:[{name,version,content,sourceRunId?,sourceSessionId?}]`. Up to five self-contained Skills. Source Run must exist in this project, have succeeded and belong to the saving user. Skill-source Run must be a successful skill Run. Run settings preserve exact saved content/revision. Daily/weekly/monthly scheduling creates a fresh Session and deduplicates by project/frequency/period regardless of settings edits.

SQLite migration is additive: existing settings/revision/run tables plus sessions and events. Legacy Run JSON lacking sessionId remains readable. No shared metadata package changes. Artifact directories remain under the existing storage root's `report-agent/<runId>`.

## Import the two candidate Skills

```powershell
node scripts/energyiq/report-agent/import-skill.mjs <energy-report-investigation-directory> 0.2.1-review-candidate
node scripts/energyiq/report-agent/import-skill.mjs <tuya-report-composition-directory> 0.2.1-review-candidate
```

Each command prints a single skillRef object and preserves the original directory. Markdown references are embedded with their original text, and local reference paths become embedded section labels. Missing references or script dependencies fail instead of saving an unusable Skill. Attach sourceRunId/sourceSessionId when an actual application source exists; do not invent IDs for externally imported candidates. Candidates are not Charles-accepted Skills.

## S0 real integration acceptance

1. Combine S2 report-inputs/data export/UI and the existing energy-api.ts route with S1. Build and run the three Seams in Integration.
2. Enable the Pi worker in Integration with the existing configured Profile; do not alter production. In an authorized test Project, GET settings and save the current revision plus candidate skillRefs/materials. Never paste a provider key into settings or prompts.
3. POST an English report request for a known snapshot/period. Poll own runs/events; inspect returned HTML through the isolated preview. Verify actual model endpoint/tool execution and data numbers separately from the fixture tests.
4. POST a revision with its sessionId. Confirm same business Session and Pi sessionId, new immutable HTML, unchanged prior output, and fresh browser reload retains both prompts/results.
5. Stop an active Run, confirm cancelled and no container remains. Resume it and confirm a new Run, old cancelled history and same Session. Test a service restart during generation: interrupted must not become succeeded automatically.
6. Save reusable Skill provenance from a successful skill Run. In a test settings copy enable the intended daily/weekly/monthly cadence, confirm fresh Session and a fixed Skill revision; repeated ticks must not duplicate a period. Restore the intended schedule afterward.
7. Verify actual data cutoff/coverage from S2's manifest, all customer text in English, and report quality with Charles. Those checks, real-provider integration, deployment and acceptance have not been claimed by S1 local tests.


## Concurrent execution and review (2026-09-13)

One enabled API process owns this queue. Set `ENERGYIQ_REPORT_MAX_CONCURRENT`
(default 1, maximum 16) and `ENERGYIQ_REPORT_MAX_PER_USER` (default 1) according
to measured host capacity. These are running-task limits, not model instances.
Do not start multiple API queue owners: restart recovery has no distributed lease.
When capacity exceeds one, scheduled work can use at most capacity minus one slots.
Interactive eligible work is picked first; same-session submissions remain rejected
while a turn is pending. Pending work is bounded to 20 per user and 200 globally.

The new image advertises review protocol version 1; older images fail closed.
Every generated report receives one review prompt in its existing Pi Session and,
if requested by the review, one revision prompt. Plain text chat bypasses review.
The runner archives report-draft.html, review-initial.json and review-receipt.json.
Only a pass receipt matching the final report SHA-256 is accepted. A model verdict
is not independent human acceptance or a mathematical correctness guarantee.

Run Docker-backed tests with `S1_DOCKER_TEST=1` and
`PI_TOOLS_TEST_IMAGE=energyiq-report-agent:pi-review-20260913`.
The five-container test uses controlled model responses, not a real-provider load test.
