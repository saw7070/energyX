# Project capability contract — first integration slice

`apps/api/src/energy/energy-project-capabilities.ts` exports
`EnergyProjectCapabilities` and `resolveEnergyProjectCapabilities({ metadataStore,
userId, workspaceId, projectId, env? })`. It reads the current stored actor,
workspace membership, project and explicit project-access role without writes.
Missing/unauthorized scopes return all false; operational database errors propagate.
Callers must provide the authenticated actor rather than a body-supplied user ID.

| Capability | Workspace member/viewer | Explicit project editor with membership | Platform admin |
| --- | --- | --- | --- |
| readReports, readExplorer, readProjectInformation, readOwnHistory | yes | yes | yes |
| createReport, manageSkills, manageAutomation, editConfiguration | no | yes | yes |
| publishConfiguration | no | no | yes |

Existing project visibility is preserved: members/editors see published projects;
platform admins also see drafts. Configuration drafts here mean drafts of an
already visible project. The existing platform-admin access to disabled customer
workspaces remains available for administration. Disabled actors are always denied.

These are project capabilities, not resource ACLs. `readOwnHistory` still requires
session/run actor ownership; `readReports` does not expose another author's private
session, files or unpublished content. Automation execution must recheck the owner
and its personal/project scope. No Action, feedback or simulation permission is
granted or inferred from `createReport`. The Action module keeps its own explicit
authorization adapter.

The role resolver is extracted into `energy-user-role.ts`, retaining existing
allowlist/dev-user semantics and the existing `ensureEnergyIqUserRole` re-export.
The capability helper never calls the mutating ensure function. Neither new module
imports query-context, avoiding a cycle when query-context later exposes capabilities.

## Grant audit

Source assignments originate in `energy-bootstrap.ts` (three bootstrap grants)
and project creation in `energy-api.ts`. The access table has timestamps but no
grantor or provenance field, so an existing row alone cannot identify a real member
promotion versus a bootstrap/test grant.

A read-only audit of the local validation database on 14 September found six editor
rows belonging to platform admins (three with workspace membership, three without)
and six viewer rows belonging to members. This is local validation evidence, not a
production audit. No rows were migrated. A stale editor row without membership
does not grant a non-admin access.

## Validation and remaining integration

The new capability suite and existing query-context suite pass: 25 tests. They cover
member/editor/admin behavior, project and workspace isolation, revoked membership,
disabled actors, hidden drafts, missing scopes and read-only allowlist resolution.

This slice defines the contract only. Report endpoints, Skills writes, scheduler,
configuration tools, safe published-information DTO and navigation still need their
capability checks wired. It does not claim that the new permission matrix is already
enforced by those existing surfaces. No deployment or role migration is included.
