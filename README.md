# EnergyX

EnergyX is an energy-management platform for facility managers, sustainability teams and the people who pay the
bills. It turns meter readings into plain answers: what a site used, what it cost, what changed, what to do about it,
and whether the change worked.

## What clients get

- **Portfolio**: every site side by side with energy, cost, energy per m², location-based Scope 2 carbon, monthly
  budgets with a month-end forecast, and PDF reports emailed weekly or monthly.
- **Overview and Analysis**: a headline finding, live power, forecast and data coverage for each site, and a
  five-step analysis that explains where the energy went.
- **Facility**: the site's layout, devices with heatmaps, data availability against a 95% target, opening hours,
  holidays, tariffs, budget and carbon settings.
- **Ask EnergyX**: an AI energy advisor that answers questions about a site's own data and writes reports, under
  per-client AI controls (on/off, model choice, monthly limits, audit and feedback).
- **Actions**: recommendations followed through to a measured result.
- **Alerts**: budget, overnight use, meters going offline, failed data updates and new reports, in the app and by
  email.
- **Data in**: Tuya IoT meters (daily official readings plus live power) and Excel/CSV uploads with smart import.

## Security and trust

- Read [SECURITY.md](SECURITY.md) to report a vulnerability.
- Per-client isolation: every API request is checked against the person's memberships and roles in that client.
- Passwords are hashed with Argon2id; session, CSRF and invitation tokens are stored only as keyed hashes; stored
  connector credentials are encrypted with AES-256-GCM.
- The AI report worker runs in a locked-down container with no network access.
- Immutable, verified releases with automatic rollback; nightly backups with encrypted offsite copies.
- Compliance readiness material (SOC 2 control matrix, policies, gap register) is in [docs/compliance](docs/compliance).

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js web app. EnergyX lives under `src/app/energyiq`; the Trust center under `src/app/legal`. |
| `apps/api` | Node API: sign-in, client and project administration, energy data and analysis (`src/energy`), the AI report agent (`src/report-agent`). |
| `packages/*` | Shared libraries: metadata store (`metadata`), data gateway and fact store (`data-gateway`), contracts, AI providers and agent runtime. Package names still use the historical `@datafoundry/` scope. |
| `scripts/energyiq` | Release build and deploy, backups, report-agent image. |
| `deploy/` | nginx and systemd examples. |
| `docs/energyiq` | Product context, decisions, runbooks and implementation records (internal). |

The domain glossary is [docs/energyiq/CONTEXT.md](docs/energyiq/CONTEXT.md). Contributors and coding agents start with
[AGENTS.md](AGENTS.md).

## Running it locally

Requires Node.js 22.

```bash
npm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
npm run dev
```

Local development uses dev sign-in; deployed servers must use `DATAFOUNDRY_AUTH_MODE=password` and refuse to start
otherwise. `.env.example` documents every setting.

Checks:

```bash
npm run build
npm run test:packages
npm run test:web
npm run test:energyiq:seams
```

## Deploying

- Releases: [immutable release deploy and rollback](docs/energyiq/plans/2026-08-18-生产不可变Release部署与回滚Runbook.md)
- Staging: [staging environment](docs/energyiq/runbooks/staging-environment.md)
- Backups and recovery: [offsite backup and recovery](docs/energyiq/runbooks/offsite-backup-and-recovery.md)

## License and origin

Apache License 2.0. See [LICENSE](LICENSE).

EnergyX started as a fork of [DataFoundry](https://github.com/datagallery-lab/datafoundry), an open-source data-agent
workbench by datagallery-lab, released under the Apache License 2.0. It builds on [Mastra](https://github.com/mastra-ai/mastra),
[AG-UI](https://github.com/ag-ui-protocol/ag-ui), [CopilotKit](https://github.com/CopilotKit/CopilotKit) and
[MCP](https://modelcontextprotocol.io).
