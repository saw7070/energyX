# Gap register: after Phase 1

This register assumes the Phase 1 controls in the [control matrix](soc2-control-matrix.md) ship. Track each item as a GitHub Issue labelled `compliance`. Dates assume a Type I around March 2027.

**Priority:** **P1** before Type I · **P2** before or early in observation · **P3** before Type II.

| # | Pri | Gap | Action | Owner | Target |
|---|---|---|---|---|---|
| G-01 | P1 | **No restore drill has ever been run**, but the public Security overview (`apps/web/src/app/legal/documents.ts`) says one runs every quarter | Run a full offsite restore on a clean host and time it against RTO 4h. Fix the public wording until the drill is done. | Operations lead | 2026-12-15 |
| G-02 | P1 | **Trust-center details blank** (`apps/web/src/app/legal/company.ts`): company, DPO, security contact, hosting region. The example region in the code comment is not production's Singapore. | Fill them in. Disclose the hosting region and each AI provider's region. | CEO | 2026-11-30 |
| G-03 | P1 | **No DPO appointed or published** (required by PDPA) | Appoint a DPO and publish their contact | CEO | 2026-11-30 |
| G-04 | P1 | Phase 1 controls not yet evidenced in production | Deploy them, capture evidence, update the matrix | Engineering lead | 2027-01-31 |
| G-05 | P1 | Branch protection and CODEOWNERS cannot be verified | Protect `main` (review plus CI); export the settings | Engineering lead | 2026-11-30 |
| G-06 | P1 | Policies not adopted or acknowledged | Approve the templates; collect signatures | Security lead | 2026-12-31 |
| G-07 | P1 | No risk assessment | Run the first one, seeded from this register | Security lead | 2027-01-15 |
| G-08 | P1 | Staff MFA not evidenced; no access reviews | Enforce MFA; run the first quarterly review | Security lead | 2026-12-31 |
| G-09 | P1 | Staff devices not managed | Roll out MDM | Operations lead | 2027-01-31 |
| G-10 | P1 | Live disk encryption at rest not confirmed | Verify ECS disk encryption, or schedule enabling it | Operations lead | 2027-01-31 |
| G-11 | P1 | **No vendor assurance reports or DPAs on file** | Collect them for Alibaba Cloud, Tuya, DeepSeek, DashScope, SMTP and GitHub. Record regions and training terms. Risk-accept vendors with no report. | Operations lead | 2027-01-31 |
| G-12 | P1 | No security training | Train at onboarding and yearly (phishing, AI-tool data handling) | People lead | 2027-01-31 |
| G-13 | P1 | No auditor or tooling chosen | Select an auditor; decide on a compliance platform | CEO | 2026-12-31 |
| G-14 | P2 | **Single host, no HA**, which puts the 99.5% SLA at risk | Sign a risk acceptance now. Decide between warm standby and a second-zone replica, and use a backup bucket in another region. | Operations lead | Accept 2027-01; decide 2027-06 |
| G-15 | P2 | No penetration test | Commission an external test of the app, API and host | Security lead | 2027-03-31 |
| G-16 | P2 | No background checks | Check staff with production access, as SG/MY law allows | People lead | 2027-02-28 |
| G-17 | P2 | No key rotation procedure | Rotate the session secret, the credential master key (re-encrypting secrets), the backup key, and the SMTP, LLM and Tuya keys: yearly and when staff leave | Engineering lead | 2027-03-31 |
| G-18 | P2 | Logs live only on the host; no uptime monitor | Ship logs off the host; add uptime checks and on-call alerts | Operations lead | 2027-03-31 |
| G-19 | P2 | No IR exercise; no `SECURITY.md` | Run a tabletop (including the PDPC 3-day notice); publish a security contact | Security lead | 2027-02-28 |
| G-20 | P2 | Deletions and individual requests not logged | Start a log tied to the Phase 1 tools | DPO | 2027-02-28 |
| G-21 | P2 | Key-person dependency | Set up break-glass access; train a second admin | CEO | 2027-03-31 |
| G-22 | P3 | Offsite backups use AES-256-CBC plus a separate checksum, which is not authenticated (`scripts/energyiq/offsite-backup.sh`) | Move to authenticated encryption; turn on bucket versioning or a retention lock | Operations lead | 2027-06-30 |
| G-23 | P3 | Backup units run as root (`deploy/systemd/`) | Use a dedicated user and systemd sandboxing | Operations lead | 2027-06-30 |
| G-24 | P3 | Privacy criteria not assessed | If customers ask: a record of processing, and a DPIA for the AI features | DPO | 2027-09-30 |
