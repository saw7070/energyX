# Concurrent report execution and automatic review

## Product decision

Implement concurrent execution and automatic review before advanced Skill selection.
S2 owns Skill version selection, provided-input display, update-in-place history and
personal/project scope. Integration owns queue execution, Pi runtime and review.

A Session is persisted conversation identity; a Run is a bounded execution. A user
can own many idle Sessions without keeping containers alive. Each active Run gets its
own Pi process and temporary Docker container. Remote DeepSeek inference is separate
from host CPU/RAM used for scripts. No framework replacement is required for concurrency.

## Implementation

- One API queue owner manages a map of running tasks, independent AbortControllers and
  cleanup. Completed tasks immediately make capacity available to another eligible task.
- Configurable global concurrency and per-user concurrency; same Session cannot have
  overlapping turns. Interactive tasks precede scheduled tasks, with one capacity slot
  protected from scheduled work when global concurrency exceeds one.
- Pending work capped at 20 per user and 200 globally. This is bounded admission, not
  a distributed fair scheduler. Continuous interaction can delay background work.
- Keep existing project/user authorization, scoped tools, immutable inputs and isolated
  containers. Account isolation is not achieved by Session IDs alone.
- Keep a single enabled API owner. Multi-host execution requires leases, heartbeats,
  checkpoint-aware recovery and shared durable artifacts; multiple replicas are unsafe
  with current recoverInterrupted semantics.

## Review

The runtime detects an HTML output after a successful generation turn. In the same Pi
Session it invokes builtin report-review 0.1.0, reads the actual draft and evidence, and
requires structured checks/issues. A revise verdict permits one revision turn. There is
no endless loop. A blocked or invalid verdict cannot become an accepted report.

Persist original draft, initial review and final hash-bound receipt. The host accepts
only a pass receipt matching the generated HTML, then applies its existing scope stamp.
The generated file is not manually edited by the development agent. Review uses the same
model/context and can share its blind spots: passing the process is not a guarantee of
correctness or Charles's acceptance. Missing-source causal claims must remain hypotheses.

Plain text conversations and Skill-only output bypass report review. Project settings
and accepted Skills are not automatically modified by the reviewer.

## Validation and rollout boundary

- API TypeScript build passed.
- Five-user scheduling test: independent active tasks, per-user limit, cancellation isolation.
- Reserved interactive slot and bounded queue tests passed.
- Five real Docker/Pi instances concurrently reached independent model bridges; those
  responses were controlled fixtures, not a five-user DeepSeek/report load test.
- Real local Tuya Run 6915325a-60df-4e5b-8640-e449c7372ab8 completed generation, review, one revision and acceptance.
  Concurrent ordinary chat 03eab3f7-b9dd-4415-b291-246ed92876b0 started without waiting.
- Local runtime configured to 5 total / 2 per user. Production remains unchanged; its
  previously measured 2 CPU / about 4 GB requires capacity measurement before enabling five.
- Receipt checks: 21; initial issues: 5, final issues marked resolved. Original and final
  HTML differ, final HTML is 38,761 bytes, receipt SHA-256 matches and accepted output exists.
  This validates the mechanism, not final editorial quality. The review itself suggested
  an overly strong equipment-state phrasing; the method now explicitly distinguishes
  nonzero 15-minute consumption from uninterrupted operation. That wording addition has
  not yet received a second full real-provider report run.
- Focused API/permission/runtime suite: 41 passed before the last two scheduling tests;
  latest scheduler/review/Docker suite: 25 passed (includes the two added tests).
- Not merged into main or deployed as of this record's initial creation.

## Architecture references

Manus publicly describes one isolated VM per task and parallel execution:
https://manus.im/blog/manus-sandbox
It does not document its complete internal scheduling implementation there.
OpenHands separates Conversation, Agent Server and Workspace:
https://docs.openhands.dev/sdk/guides/agent-server/overview
These inform the separation of API load balancing from long-running job scheduling;
we are not claiming to reproduce either platform's private infrastructure.
