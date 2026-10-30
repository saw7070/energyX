# Information Security Policy

**Owner:** Security lead · **Approved by:** [CEO name] · **Effective:** [YYYY-MM-DD] · **Review:** yearly · **Maps to:** CC1–CC5

## Scope

This policy covers all [Company] staff, contractors, systems and vendors that handle [Company] or customer data, including EnergyX production, source code and CI. The other policies in this folder sit under it.

## Roles

| Role | Responsible for |
|---|---|
| CEO | Accountable for the programme; approves policies and risk acceptances |
| Security lead | Policies, risk register, control matrix, quarterly control check |
| Engineering lead | Secure development and application controls |
| Operations lead | Production host, backups, monitoring, vendors |
| DPO | PDPA compliance, individual requests, breach notification |
| Everyone | Following the policies; reporting incidents straight away |

## Data classification

| Class | Examples | Handling |
|---|---|---|
| Public | Legal pages, marketing | None |
| Internal | Source code, runbooks | Staff only |
| Confidential | Production secrets, backup key, staff records | Named people; password manager or files with mode 600 |
| Customer Confidential | Meter readings, facility details, accounts, files, AI conversations, connector credentials | Encrypted in transit and at rest; access by role; never on unmanaged devices or in unapproved tools |

## Baseline

1. TLS 1.2 or later in transit; encryption at rest for Confidential data and above.
2. Unique accounts, least privilege and MFA ([access control](access-control.md)).
3. Reviewed, verified changes ([change management](change-management.md)).
4. Tested backups ([BC/DR](business-continuity-dr.md)).
5. Vulnerabilities fixed within set deadlines ([vulnerability management](vulnerability-management.md)).
6. Approved vendors only, AI providers included ([vendor management](vendor-management.md)).
7. No secrets in code, tickets, chat or AI tools.

## Risk, exceptions, enforcement

- **Risk assessment.** Done every year and after major change. Each risk has an owner. The CEO signs any risk acceptance.
- **Exceptions.** Must be written down with a compensating control and an expiry of no more than 12 months. The Security lead and the CEO approve.
- **Enforcement.** Violations can lead to disciplinary action.
