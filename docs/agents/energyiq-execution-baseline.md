# EnergyIQ execution baseline and Worktree pool

This document is the operational baseline for GitHub issue #2 (T01). Product
scope and acceptance criteria remain authoritative in GitHub issue #1 and the
current ticket. This file only records how the repository is protected, tested,
and assigned to isolated Worktrees.

## Baseline anchors

| Role | Path | Git state at creation |
| --- | --- | --- |
| Source checkpoint | `D:\Projects\energyiq-datafoundry` | `codex/t01-source-checkpoint` at `90ded6f` |
| Integration | `D:\Projects\energyiq-datafoundry-integration` | `codex/t01-integration` from `90ded6f` |
| Worker 1 | `D:\Projects\energyiq-datafoundry-worker-1` | detached at `90ded6f` |
| Worker 2 | `D:\Projects\energyiq-datafoundry-worker-2` | detached at `90ded6f` |
| Worker 3 | `D:\Projects\energyiq-datafoundry-worker-3` | detached at `90ded6f` |

The source checkout had 59 committed EnergyIQ changes beyond `origin/main`,
plus inherited uncommitted work. The inherited work was reviewed by feature
area and preserved without resetting or overwriting it:

| Commit | Preserved ownership area |
| --- | --- |
| `9ea18c1` | Published Template/Overview, Admin Review & Publish, Saved Analysis and metadata contracts |
| `e7348cf` | Customer/Admin navigation, Explorer and UI regression hardening |
| `a4f6872` | DataFoundry Energy Analyst context, providers, controlled charts and smoke scripts |
| `90ded6f` | Accepted EnergyIQ decisions, handoffs and source prototype reference assets |

Two `.scratch` trees remain only in the source checkpoint as untracked local
evidence. They were deliberately excluded from the integration baseline. No
tracked or untracked source file was reset, cleaned, stashed, or overwritten.

The files under `docs/template/` are reference assets, not runtime dependencies.
Their generated HTML and mock values cannot be used as authoritative EnergyIQ
facts.

## Three high-level test Seams

Run all three from the Integration Worktree:

```powershell
npm run test:energyiq:seams
```

| Seam | Executable baseline | Contract protected |
| --- | --- | --- |
| Project Analysis Resolver precursor | `apps/api/src/energy/energy-analysis.test.ts` | Trusted Scope analysis, repeatability, official aggregation, provenance, Ngee Ann and Preschool Golden facts |
| Project Renderer Registry precursor | `apps/web/src/app/energyiq/_components/energy-template-renderer.test.tsx` | Renderer states, no legacy calculation stack, advisories and published actions |
| Energy Analyst | `packages/agent-runtime/src/semantic/energy-query-semantic-provider.test.ts` | Server-scoped canonical fact view remains authoritative AI context |

T02 may deepen or rename the Resolver and Registry Interfaces. It must extend
these observable seams instead of replacing them with a parallel calculation or
rendering stack.

## Golden baseline

The baseline command must preserve at least these externally meaningful facts:

- Ngee Ann selected period: local `[2026-06-10, 2026-06-17)`, `1,531.1683 kWh`,
  peak interval-average power `20.6731 kW`, 18 Circuits, 100% expected coverage.
- Ngee Ann official aggregation is `1,531.1683 kWh`; the sum of all meters is
  `3,050.1648 kWh` and must not be presented as the official total.
- Ngee Ann virtual `Load 12` is `49.0218 kWh`, traceable to two inputs, and is
  excluded from the official total.
- Preschool portfolio: `24,921.8123 kWh`, 30 Centres and 270 Circuits.
- Preschool Centre A: `843.0985 kWh` and 9 Circuits.

The Golden tests use temporary test storage and must not lock or mutate the
long-running Integration DuckDB. The Ngee Ann fixture reproduces interval-level
quality and peak invariants. The compact Preschool fixture preserves the
portfolio/Centre totals, 30-by-9 topology, hour-of-day profile and operating
split without checking in or copying the 200,880-row workspace DuckDB.

## Worker lifecycle

1. The Orchestrator confirms the GitHub ticket is open, unblocked, assigned and
   labelled `ready-for-agent` using `--repo Zion74/energyiq-datafoundry`.
2. The Orchestrator confirms the selected Worker Worktree is detached and clean
   with `git status --short --branch`.
3. The Worker creates exactly one ticket branch from the reviewed Integration
   head, for example:

   ```powershell
   git switch -c codex/t03-tariff codex/t01-integration
   ```

4. The Worker receives one ticket, one owned module set, explicit forbidden
   paths, Acceptance Criteria and required tests. A second independent goal is
   returned to the Orchestrator for rescoping.
5. The Worker does not start the shared Web, API or DuckDB services. It may use
   the shared npm download cache, but it must not link another Worktree's
   `node_modules` into its own workspace.
6. The Worker commits its intended files and returns the handoff format from the
   Orchestrator handoff document. Interface changes and test evidence are also
   posted to the GitHub ticket.
7. The Orchestrator reviews and integrates the ticket branch only in the
   Integration Worktree, then runs the Seam command and the ticket-specific
   tests there.
8. A Worker slot is reusable only after its ticket is integrated and
   `git status --short` is empty. It is returned to detached mode at the reviewed
   Integration head. Branch deletion is a separate, explicit cleanup step.

At most three Worker Worktrees may exist concurrently. If two tickets touch the
same deep module or shared Interface, the Orchestrator serialises them or changes
module ownership before implementation.

## Integration environment ownership

- Only `D:\Projects\energyiq-datafoundry-integration` may run the long-lived
  EnergyIQ Web, API and DuckDB-backed environment.
- Full builds, browser checks and cross-ticket verification run only there.
- Source-checkpoint and Worker Worktrees do not own ports or the shared DuckDB.
- Before starting services, verify the listener PID and command line. A port
  number alone is not proof of repository identity.
- Do not stop or modify services belonging to the deprecated
  `energyiq-rebuild` checkout as part of EnergyIQ DataFoundry ticket work.

### Reproducible Overview restart

Run the tracked restart command only from the Integration Worktree after its API
and Web production builds are current:

```powershell
Set-Location D:\Projects\energyiq-datafoundry-integration
.\scripts\energyiq\restart-overview.ps1 -PreflightOnly
.\scripts\energyiq\restart-overview.ps1
```

The command loads a local `.env` into the API child process without copying,
printing, or forwarding server secrets to the Web child process. It
prefers the Integration `.env`; when that file is absent, it recognises the
authorised sibling source checkout at `..\energyiq-datafoundry\.env`. Use
`-EnvFile <absolute-path>` to select another user-approved local file. Startup
output reports only `secretMasterKeyConfigured: true/false` about the secret;
it never emits the value.

The API and all Workspace fact stores must share one authorised absolute
`STORAGE_ROOT_DIR`. The restart command resolves it in this order: explicit
`-StorageRoot`, an absolute value in the selected `.env`, then the single
checked sibling path `..\energyiq-datafoundry\storage`. Before any listener is
stopped it requires `metadata\workbench.sqlite` and at least one
`energy\<workspace>\energy.duckdb`, rejects relative paths and the
Integration-local `storage` tree, and reports only the resolved non-secret
root. This prevents a healthy-looking API from reading Metadata and Energy
facts from different checkout-relative trees.

The API must pass both `/healthz` and `/ready`; the Web must make
`/energyiq/overview` reachable on port 3000. On failure, the command terminates
only the PIDs it created. It refuses to stop a listener whose absolute command
does not identify this Integration Worktree.

The first migration from an older relative-command restart requires an explicit
operator check. Inspect the listener PID and command before passing the exact
PID once as `-ExpectedExistingApiPid` or `-ExpectedExistingWebPid`; never pass a
PID based on the port number alone. Subsequent restarts use absolute command
paths and need no migration arguments.

This command does not build, seed, materialise, migrate or validate a real model
Run. After restart, run the ticket-specific API/AI acceptance separately and
keep its evidence distinct from process readiness.

## Cleanup guard

Never use reset, clean, or checkout to discard work. Before reusing or removing
a Worker Worktree:

```powershell
git -C <worker-path> status --short --branch
git worktree list --porcelain
```

If output shows modifications or untracked files, stop and return ownership to
the ticket/Worker. Worktree removal is allowed only after the absolute target
path is verified to be one of the three named Worker slots and the Worktree is
clean.

## T01 validation evidence (2026-08-04)

- `npm run build`: passed for all 14 Workspaces.
- `npm run test:energyiq:seams`: 3 files and 9 tests passed.
- Full Web suite: 74 files and 642 tests passed.
- Supporting Energy data contracts: 5 files and 18 tests passed across the
  fact writer, metadata store, query context, Energy context item and data-tools
  cache.
- The copied metadata database contained 50 absolute file-asset paths from the
  source checkout. Before Integration startup, all 50 copied assets were
  verified present and only the Integration database paths were rewritten to
  `D:\Projects\energyiq-datafoundry-integration\storage\files`. The source
  database and source files remain unchanged as rollback evidence.
- Integration Web PID `42704` owned port `3001`; Integration API PID `41656`
  owned port `8787`. `/login`, `/energyiq/overview` and `/healthz` all returned
  HTTP 200, with `/healthz` returning status `ok`.
- Pre-existing listeners on `3002` (`energyiq-rebuild`) and `5173` (a source
  reference prototype) were not stopped or modified. They are not the shared
  DataFoundry Integration environment and are outside Worker ownership.

`npm ci` reported 34 inherited audit findings (9 low, 12 moderate, 12 high and
1 critical). T01 does not change dependencies; remediation requires a separate
scoped ticket rather than an unreviewed bulk upgrade.
