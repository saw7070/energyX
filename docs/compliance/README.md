# SOC 2 readiness pack: EnergyX

> **Readiness material only.** [Company] has not been audited and holds no SOC 2 report. Nothing here claims compliance. SOC 2 is an auditor's attestation, not a certification.

## What's here

- [soc2-control-matrix.md](soc2-control-matrix.md): Trust Services Criteria (CC1–CC9, A1, C1) mapped to controls, status, evidence and owner.
- [gap-register.md](gap-register.md): prioritised gaps that remain after Phase 1.
- Policy templates:
  - [information security](policies/information-security.md)
  - [access control](policies/access-control.md)
  - [change management](policies/change-management.md)
  - [incident response](policies/incident-response.md)
  - [vendor management](policies/vendor-management.md)
  - [data retention and deletion](policies/data-retention-and-deletion.md)
  - [business continuity and DR](policies/business-continuity-dr.md)
  - [vulnerability management](policies/vulnerability-management.md)
  - [acceptable use](policies/acceptable-use.md)

## Recommended scope

**System:** the web app (`apps/web`), the API (`apps/api`), the sandboxed report agent, the production host `energyiq.hima.sg` (Alibaba Cloud; confirm the region and record it in `apps/web/src/app/legal/company.ts`), backups, GitHub and CI, and the people who run them.

**Criteria:**

- **Security (CC1–CC9).** Mandatory.
- **Availability (A1).** Recommended: a 99.5% SLA, RPO 24h and RTO 4h are already published.
- **Confidentiality (C1).** Recommended: customer energy data and connector credentials.
- **Privacy.** Optional. The DPA, the privacy policy and these policies cover PDPA. Add it if customers ask.

**Carve-outs:** Alibaba Cloud, Tuya, the LLM providers and the SMTP provider.

**Customer responsibilities (CUECs) to state in the report:** manage their own users and roles, turn on MFA or SSO, review their audit history, and protect their own Tuya and AI credentials.

## Path and timeline

| Phase | Window | Exit criteria |
|---|---|---|
| Readiness | Nov 2026 – Feb 2027 | Phase 1 live with evidence; policies adopted; P1 gaps closed; auditor engaged |
| Type I | about Mar 2027 | Control *design* tested at a point in time |
| Observation | 3–6 months (Apr – Sep 2027) | Controls operate: access reviews, restore drills, vulnerability tickets, change records |
| Type II | about Q4 2027, then yearly | Operating effectiveness |

Start observation only after the first restore drill and access review are done.

## Tooling categories

Vendor names in this pack are examples, not requirements.

- **Compliance automation platform:** evidence collection, policy sign-off, auditor portal. Optional, but it saves time.
- **MDM:** enforces disk encryption, screen lock, updates and remote wipe on staff laptops.
- **Password manager** with enforced MFA. It already holds the backup key.
- **Vulnerability scanning:** dependencies, SAST, host and container images, plus a yearly external penetration test.

## Using it

1. Replace the `[Company]` and other bracketed placeholders, then have the CEO approve each policy.
2. Track gaps as GitHub Issues labelled `compliance`.
3. Move Phase 1 rows to *Implemented* once they are in production with evidence.

**Owner roles used:** CEO, Engineering lead, Operations lead, Security lead (can be the Engineering lead), DPO, People lead.
