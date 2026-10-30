# Incident Response Policy

**Owner:** Security lead · **Approved by:** [CEO name] · **Effective:** [YYYY-MM-DD] · **Review:** yearly, and after every SEV1 · **Maps to:** CC7.3–CC7.5

## Severity

| Level | Examples | Start response |
|---|---|---|
| SEV1 | Confirmed customer-data breach; full outage; production host compromised | Within 1 hour, any time |
| SEV2 | Suspected breach; exposed credential; key feature down | Within 4 working hours |
| SEV3 | Limited impact; policy violation with no exposure | Within 2 working days |

## Roles

- **Incident lead:** Engineering lead or on-call engineer.
- **DPO:** breach assessment and notifications.
- **CEO:** customer and external communication.
- **Scribe:** keeps the timeline.

## Process

1. **Report** immediately to [security email / channel].
2. **Triage.** Set the severity and open an incident record.
3. **Contain.** For example: revoke sessions, rotate keys, switch off AI for an organisation, block IP addresses, or isolate the host.
4. **Preserve evidence** before changing anything: audit-log export, journald logs, a disk snapshot.
5. **Recover.** Redeploy a known-good release, or restore as set out in the [BC/DR policy](business-continuity-dr.md).
6. **Notify** as described below.
7. **Review.** Hold a post-incident review within 10 business days and track the actions in GitHub Issues.

## PDPA breach notification (Singapore)

**Customer data, where [Company] is the data intermediary:** notify the affected customer without undue delay, and within 48 hours as the DPA promises, so they can meet their own deadlines.

**Data [Company] controls itself:**

1. **Assess.** Decide quickly whether the breach is notifiable, and within 30 calendar days of first suspecting it. A breach is notifiable if significant harm to individuals is likely, or if it affects 500 or more people.
2. **Notify the PDPC** as soon as practicable, and no later than **3 calendar days** after deciding it is notifiable.
3. **Notify the people affected** as soon as practicable if significant harm is likely, unless an exception applies.

**Malaysia (if relevant):** notify the Commissioner within 72 hours. Confirm the details with counsel.

Record every assessment, including those found not to be notifiable.

## Readiness

Keep the contact list current: staff, Alibaba Cloud, AI providers, Tuya, counsel and the PDPC. Run a tabletop exercise every year.
