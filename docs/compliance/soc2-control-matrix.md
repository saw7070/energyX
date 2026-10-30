# SOC 2 control matrix: EnergyX

**Status key:**

- **Implemented:** in the repo or in operation; operating evidence still needed.
- **Phase 1:** being built now; not yet evidenced in production.
- **Gap:** not in place.
- **Carved out:** provided by a subservice organisation.

Repo paths were verified on 2026-10-30. "Process record" means evidence held outside the repo.

## CC1–CC5: Governance, communication, risk, monitoring

| ID | Control | Status | Evidence | Owner |
|---|---|---|---|---|
| CC1.1 | Staff acknowledge security policies at hire and yearly | Gap | `docs/compliance/policies/acceptable-use.md`; signatures | People lead |
| CC1.2 | Quarterly management security review with minutes | Gap | Process record | CEO |
| CC1.3 | Security lead and DPO appointed | Gap: DPO blank in `apps/web/src/app/legal/company.ts` | Appointment record | CEO |
| CC1.4 | Background checks; security training | Gap | HR records | People lead |
| CC2.1 | Audit history of sign-ins, access and role changes, project changes, AI requests | Implemented | `apps/api/src/energy/energy-change-audit.ts`, `apps/api/src/energy/energy-admin-access.ts`, `apps/api/src/energy/energy-ai-governance.ts` | Engineering lead |
| CC2.3 | Published privacy policy, terms, DPA, SLA, security overview, AI policy | Implemented (company details blank) | `apps/web/src/app/legal/documents.ts`, `apps/web/src/app/legal/company.ts` | CEO |
| CC2.3 | Security contact for reporters | Gap: `securityEmail` blank, no `SECURITY.md` | — | Security lead |
| CC3.1–3.4 | Yearly risk assessment and risk register | Gap | `docs/compliance/gap-register.md` (starting point) | Security lead |
| CC4.1–4.2 | Quarterly control self-check; deficiencies tracked to closure | Gap / Partial (GitHub Issues in use) | `docs/agents/issue-tracker.md` | Security lead |
| CC5.1–5.3 | Controls set by approved, published policies | Gap (templates drafted) | `docs/compliance/policies/` | Security lead |

## CC6: Logical and physical access

| ID | Control | Status | Evidence | Owner |
|---|---|---|---|---|
| CC6.1 | Argon2id passwords; HMAC-hashed session and CSRF tokens; session revocation | Implemented | `apps/api/src/auth/crypto.ts`, `apps/api/src/auth/service.ts` | Engineering lead |
| CC6.1 | Per-organisation role-based access | Implemented | `apps/api/src/energy/energy-permissions.ts`, `packages/metadata/src/energyiq-access-role-store.ts` | Engineering lead |
| CC6.1 | Connector credentials encrypted with AES-256-GCM | Implemented | `packages/metadata/src/config-store.ts` | Engineering lead |
| CC6.1 | Dev auth mode refused in production | Phase 1 (code in `apps/api/src/auth/config.ts`) | Same | Engineering lead |
| CC6.1 | OIDC SSO, per-organisation TOTP MFA, idle timeout | Phase 1 | Add when merged | Engineering lead |
| CC6.1 | MFA on staff admin accounts | Gap | Screenshots | Security lead |
| CC6.2 | Admin-managed customer users; SCIM 2.0 | Implemented / Phase 1 (SCIM) | `apps/api/src/energy/energy-admin-access.ts` | Engineering lead |
| CC6.2 | Staff leavers lose access within 1 business day | Gap | Leaver tickets | Operations lead |
| CC6.3 | Legacy config API limited to super-admin; stdio MCP blocked in production; support access audited | Phase 1 (work in progress in `apps/api/src/legacy-config-guard.ts`) | Same, once merged | Engineering lead |
| CC6.3 | Quarterly access review (SSH, cloud RAM, GitHub, super-admins) | Gap | Review record | Security lead |
| CC6.4 | Physical data-centre security | Carved out (Alibaba Cloud) | Vendor report | Operations lead |
| CC6.5 | Deletion within 60 days of contract end; backup expiry | Partial: commitment published; retention job is Phase 1 | `apps/web/src/app/legal/documents.ts` | Operations lead |
| CC6.6 | Sign-in rate limits; CSP, HSTS and security headers; CORS allowlist | Implemented | `apps/api/src/auth/service.ts`, `apps/api/src/http-security.ts`, `apps/web/next.config.mjs` | Engineering lead |
| CC6.6 | Client IP taken only from a trusted proxy, for rate limits and audit (the last committed version trusted the first `X-Forwarded-For` value) | Phase 1 (work in progress in `apps/api/src/client-ip.ts`) | `apps/api/src/client-ip.ts`, `apps/api/src/energy/energy-change-audit.ts` | Engineering lead |
| CC6.7 | TLS in transit; encrypted offsite backups | Implemented (TLS config lives on the host; the repo nginx example has none) | TLS scan; `scripts/energyiq/offsite-backup.sh` | Operations lead |
| CC6.7 | Live server disk encrypted at rest | Gap (recommended in runbook, not verified) | `docs/energyiq/runbooks/offsite-backup-and-recovery.md` | Operations lead |
| CC6.8 | Report agent sandbox: no network, read-only, non-root, capabilities dropped, resource limits | Implemented | `apps/api/src/report-agent/pi-report-harness.ts` | Engineering lead |
| CC6.8 | Staff devices under MDM | Gap | MDM report | Operations lead |

## CC7–CC9: Operations, change, risk mitigation

| ID | Control | Status | Evidence | Owner |
|---|---|---|---|---|
| CC7.1 | Dependabot, CodeQL, npm audit; CI runs all API tests and ESLint | Phase 1 (today: build, web and package tests, selected API and smoke tests) | `.github/workflows/ci.yml` | Engineering lead |
| CC7.1 | Yearly penetration test | Gap | Report | Security lead |
| CC7.2 | Hash-chained audit log that client admins can export | Phase 1 | — | Engineering lead |
| CC7.2 | Request-ID logging, readiness checks, error tracking, job-failure alerts | Phase 1 (basic `/ready` in `apps/api/src/server.ts`) | Same | Engineering lead |
| CC7.2 | Backup failures surface as failed systemd units | Implemented (no alerting yet) | `deploy/systemd/energyiq-shared-storage-backup.service`, `deploy/systemd/energyiq-offsite-backup.service` | Operations lead |
| CC7.3–7.5 | Incident response plan; yearly tabletop | Gap (template drafted) | `docs/compliance/policies/incident-response.md` | Security lead |
| CC8.1 | PR-based changes with CI | Implemented | `.github/workflows/ci.yml`, PR history | Engineering lead |
| CC8.1 | Branch protection with required review | Gap (not verifiable from repo; no CODEOWNERS) | GitHub settings export | Engineering lead |
| CC8.1 | Immutable verified releases, deploy lock, smoke checks, automatic rollback | Implemented | `scripts/energyiq/build-release-artifact.mjs`, `scripts/energyiq/deploy-release.mjs`, `docs/energyiq/plans/2026-08-18-生产不可变Release部署与回滚Runbook.md` | Engineering lead |
| CC8.1 | Staging environment | Phase 1 | — | Engineering lead |
| CC9.1 | BC/DR plan | Gap (template drafted) | `docs/compliance/policies/business-continuity-dr.md` | Operations lead |
| CC9.2 | Sub-processors disclosed with 30 days' notice of changes | Implemented | `apps/web/src/app/legal/documents.ts` | CEO |
| CC9.2 | Per-organisation AI on/off, monthly limit and audit; international endpoint by default | Implemented / Phase 1 (endpoint) | `apps/api/src/energy/energy-ai-governance.ts` | Engineering lead |
| CC9.2 | Yearly vendor review (DPA, assurance report, data location) | Gap | Vendor register | Operations lead |

## A1: Availability and C1: Confidentiality

| ID | Control | Status | Evidence | Owner |
|---|---|---|---|---|
| A1.1 | Uptime and capacity monitoring against the 99.5% SLA | Gap / Phase 1 (alerting) | Monitoring record | Operations lead |
| A1.2 | Nightly stopped-write backups (7 kept); encrypted offsite copy (35 days); cloud role cannot delete | Implemented | `scripts/energyiq/backup-shared-storage.sh`, `scripts/energyiq/offsite-backup.sh`, `deploy/systemd/energyiq-shared-storage-backup.timer`, `deploy/systemd/energyiq-offsite-backup.timer` | Operations lead |
| A1.2 | Redundant infrastructure | Gap (single host) | — | Operations lead |
| A1.3 | Quarterly restore drill (RPO 24h, RTO 4h) | Gap (procedure written, never run) | `docs/energyiq/runbooks/offsite-backup-and-recovery.md`, `docs/energyiq/plans/2026-08-24-生产Shared-Storage自动备份与隔离恢复Runbook.md` | Operations lead |
| C1.1 | Data separated per organisation, with role-based access | Implemented | `apps/api/src/energy/energy-permissions.ts` | Engineering lead |
| C1.1 | Data classification | Gap (defined in template) | `docs/compliance/policies/information-security.md` | Security lead |
| C1.2 | Retention job; user erasure and export | Phase 1 | — | Engineering lead |
| C1.2 | Contract-end deletion recorded | Gap | Deletion log | Operations lead |
