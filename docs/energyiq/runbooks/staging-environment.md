# Staging environment

Staging is a second, separate EnergyX deployment where every release runs before it reaches customers. It uses the
same immutable release artifact as production, so what was tested is exactly what ships.

## Rules

- **Separate everything.** Own host (or VM), own DNS name (for example `staging.<your-domain>`), own TLS certificate,
  own `AUTH_SESSION_SECRET`, `SECRET_MASTER_KEY`, database, storage and backups. Never reuse a production secret.
- **No real customer data.** Seed staging with synthetic sites or the demo data. Do not copy the production database
  or storage. If a production problem can only be reproduced with real data, get the client's written agreement,
  erase personal data first (Admin API `DELETE /api/v1/energy/admin/users/:id/personal-data`), and delete the copy
  afterwards.
- **Separate integrations.** Use a separate Tuya Cloud project and test devices, and a separate AI provider key with
  a low spending limit. A staging server must never hold a client's live Tuya credentials.
- **No customer email.** Staging sends mail only to `ENERGYX_STAGING_EMAIL_ALLOWLIST`; everything else is dropped
  (scheduled reports, alerts) or, for invitations and password resets, returned as a link to the administrator, as in
  test mode. Subjects start with `[Staging]`.
- **Restricted access.** Only the team and named client testers have accounts. Put staging behind the same nginx
  hardening as production and, if possible, an IP allowlist or VPN.

## Configuration

Set these on both the API and the web service (systemd `EnvironmentFile`):

| Variable | Staging value |
| --- | --- |
| `ENERGYX_ENVIRONMENT` | `staging` (production: `production`) |
| `ENERGYX_STAGING_EMAIL_ALLOWLIST` | `@your-company.com,tester@client.com` |
| `DATAFOUNDRY_AUTH_MODE` | `password` (dev sign-in refuses to start on staging) |
| `AUTH_PUBLIC_BASE_URL` | `https://staging.<your-domain>` |
| `NODE_ENV` | `production` |

Every page shows an orange "Staging" strip at the top when `ENERGYX_ENVIRONMENT=staging` is set on the web service.

## Release flow

1. Build the artifact once on the Build Host from a clean checkout of the exact commit
   (`scripts/energyiq/build-release-artifact.mjs`; see the release runbook).
2. Deploy it to staging with the same command as production, pointing at the staging root, services and URLs:

   ```bash
   node scripts/energyiq/deploy-release.mjs \
     --app-root /opt/energyx-staging \
     --artifact energyiq-<SHA>.tar --manifest energyiq-<SHA>.manifest.json --checksum energyiq-<SHA>.sha256 \
     --release-sha <SHA> --metadata-backup /var/backups/energyx-staging/metadata-<SHA>.sqlite \
     --dependency-install transitional-npm-ci \
     --api-service energyx-staging-api.service --web-service energyx-staging-web.service \
     --smoke-url https://staging.<your-domain>/login
   ```

3. Check it: sign in, open each client-facing page on a demo site, run one advisor question, confirm the System health
   page is green except for the expected staging warnings, and check `/ready`.
4. Promote the **same** three artifact files to production with the production root, services and URLs. Do not
   rebuild between staging and production.
5. Record the SHA, who tested it and the result in the release record (change-management evidence for SOC 2).

## Database migrations

Migrations run forward when the API starts and have no down step. Staging is where a migration first meets a
database that has history: deploy to staging, then restart the staging API once more to confirm the migration is
idempotent before promoting.
