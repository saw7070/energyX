# Data Retention and Deletion Policy

**Owner:** DPO · **Approved by:** [CEO name] · **Effective:** [YYYY-MM-DD] · **Review:** yearly · **Maps to:** C1.2, CC6.5; PDPA Retention Limitation

## Schedule

| Data | Kept for | Removal |
|---|---|---|
| Customer data (readings, settings, files, reports, saved AI conversations) | Subscription term, plus a 30-day export window; deleted from the live service within 60 days | Retention job (Phase 1); until then, manual deletion recorded in the log |
| Local nightly backups | 7 copies | Backup rotation |
| Offsite encrypted backups | 35 days | Storage lifecycle rule |
| Security and audit records | 24 months | Daily retention job (`ENERGYX_AUDIT_RETENTION_MONTHS`, default 24) behind a signed checkpoint; the off-host copy expires under its storage bucket's retention rule, which must also be 24 months |
| User accounts | Until removed by an admin, the contract ends, or a verified erasure request | Admin removal; erasure (Phase 1) |
| System logs | [90 days] | journald or log platform |
| Support correspondence | [3 years] | Mailbox retention |

These periods match the published privacy policy and DPA (`apps/web/src/app/legal/documents.ts`). Change both together.

## Individual requests (access, correction, erasure)

1. Requests go to the DPO at [dpo email]. Verify the requester's identity.
2. If [Company] holds the data as a data intermediary, pass the request to the customer within [5 business days] and follow their instructions.
3. Reply within 30 days using the export and erasure tools (Phase 1), and log each request.
4. Erased data stays in backups until they expire (at most 35 days). If a backup is restored, apply the logged erasures again before go-live.
5. Erasure blanks the person's email, IP address and browser in the audit log, which stays verifiable because those fields are not part of its hash chain. The off-host audit copy is write-once and keeps them until it expires (24 months).

## Contract end

1. Confirm the export window and the deletion date to the customer in writing.
2. Delete the data and record who, when and what.
3. Confirm completion to the customer on request.

## Legal hold

The DPO can pause deletion of a specific dataset. The hold must be documented and released when no longer needed.
