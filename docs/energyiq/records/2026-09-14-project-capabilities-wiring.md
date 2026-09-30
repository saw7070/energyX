# Project capability enforcement and published information

This slice wires the capability contract in `74956c8c`. It does not create or
migrate role grants. A member needs an explicit project editor record and current
workspace membership to perform editorial work. Platform admin remains separate.

## Authorization changes

- Ordinary members can read published reports, Explorer, published project
  information and their own historical conversations. New sessions, messages,
  retries, uploads, Skill writes and schedule/settings writes are denied server-side.
  An owner can still stop an existing task after losing execution permission.
- Explicit project editors can create reports, manage project/personal Skills,
  manage the existing project schedule and prepare configuration drafts. Shared
  Skill editing preserves existing ownership and revision checks.
- Publishing, source importing and materializing remain platform-admin operations.
  The editor Agent does not advertise those tools and direct tool calls also deny
  them. Legacy operational-policy creation routes activate immediately, so those
  routes stay admin-only; editors use the Agent's inactive-save tools instead.
- Execution rechecks the actor before inputs/harness and after generation. The
  scheduler checks its stored owner, pauses on revoked permission and persists an
  explanation. It does not substitute a background admin. There is still one
  project-owned schedule, not a new personal-automation model.
- Conversation GET retains owner filtering. Read-only settings omit background,
  attachment IDs, Skill content and source IDs; shared report HTML remains on the
  existing library route. Members no longer receive the Skills/tools catalog.

## Published information and navigation

`GET /api/v1/energy/projects/:id/information` is a private, no-store allowlisted
DTO under the existing publication read lock. It returns published names, meter
locations, hours and tariffs using the published hierarchy and policy pins. It
omits setup drafts, arbitrary metadata, source material and audit internals.
Missing legacy policy revisions show as unconfigured rather than inventing values.

Members see Project information and Conversation history, without new-conversation,
Skill editing or settings controls. Editors retain configuration preparation.
Meters group by location ID even if two locations share a display name. Late
responses from a previously selected project cannot overwrite the current project.

## Validation

Focused verification: 13 files, 180 tests passed in the final combined run.
Evidence: `outputs/task-history/capabilities-final-tests.txt`. The standalone
Project information plus report-scope run also passed 3/3 in
`capabilities-information-tests.txt`.

The two Project information component checks verify duplicate-name location
isolation/missing-policy display and stale response isolation on project change.
Real temporary metadata tests verify editor session creation, downgrade retaining
only owner history, denied new/resumed execution, scheduler pause with no harness
call, editable drafts and forbidden publishing/import/materialization.

API TypeScript check passed. Standalone Web TypeScript check remains red with
existing unrelated test diagnostics (including the unchanged globalThis test
setup in energyiq-shell.test.tsx); it is not a green Web build. Full builds,
Integration Seams, live browser roles, real editor Agent invocation, real scheduler
execution and Charles acceptance remain Integration/owner verification.
No live services, grants, shared databases or deployments were changed.

## Action integration boundary

This worker predates Action commits e2a3c5f4 and 28d7c29e. When replaying, preserve
all Action private-run/session exclusion, artifact/output gating, parent links,
independent sessions and dedicated retry rules. In particular, merge capability
checks around existing Action checks rather than replacing their authorization.
Neither editor nor createReport is an Action write grant: admin-owner private
pilot gates and both default-off feature flags stay authoritative.

Verified overlap with e2a3c5f4/28d7c29e: energy-api.ts, report-inputs.ts,
report-library-api.ts, report-service.ts, report-store.ts and the Web config-api
client.ts. Later Integration changes may also overlap report-api.ts or the panel. The changes here
only add ordinary-project capabilities, scheduler revocation status and UI gates.
The orchestrator owns reconciliation against Integration HEAD 3a6e0fb3.

Grant-management UI/provenance migration and new user provisioning are not part
of this slice. Existing editor grants require an explicit administrative decision;
this code does not promote existing members.
