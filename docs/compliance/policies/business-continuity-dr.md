# Business Continuity and Disaster Recovery Policy

**Owner:** Operations lead · **Approved by:** [CEO name] · **Effective:** [YYYY-MM-DD] · **Review:** yearly, and after each drill · **Maps to:** A1.2, A1.3, CC9.1

## Objectives

| Objective | Target |
|---|---|
| Recovery point (RPO) | 24 hours |
| Recovery time (RTO) | 4 hours |
| Availability | 99.5% per month (published SLA) |

## Current setup and limits

- **Single host, no HA or standby.** `energyiq.hima.sg` runs on Alibaba Cloud in Singapore under systemd. Losing the host or its zone means restoring from backup.
- **Backups.** A stopped-write backup runs nightly at 02:15 (UTC+8) and 7 copies are kept. An AES-256-encrypted offsite copy is made at 03:30 and kept for 35 days. The offsite role cannot delete objects.
- **Releases** are immutable and roll back automatically.
- **No full restore drill has been done.** Until one is, the 4-hour RTO is an unproven target.

Runbooks:

- `docs/energyiq/runbooks/offsite-backup-and-recovery.md`
- `docs/energyiq/plans/2026-08-24-生产Shared-Storage自动备份与隔离恢复Runbook.md`
- `docs/energyiq/plans/2026-08-18-生产不可变Release部署与回滚Runbook.md`

## Scenarios

| Scenario | Response | Expected loss |
|---|---|---|
| Bad release | Automatic rollback, or redeploy the previous release | Minutes |
| Data corruption | Restore a local nightly backup | Up to 24h |
| Host or disk loss | Build a new host and restore the newest offsite copy | Up to 24h of data; 4h target |
| Zone or region outage | As for host loss, elsewhere. Needs the bucket to be outside the affected region. | As above |
| Backup key lost | Use the copy in the password manager (check it quarterly) | None |
| Tuya, LLM or SMTP outage | Core service keeps running. AI can be switched off per organisation. Tuya readings are fetched again at the next daily sync. | Reduced features |
| Key person unavailable | Sealed break-glass credentials plus the runbooks | Delay |

## Restore drill

Run a drill every quarter. **The first one must happen before Type I.**

1. Restore the newest offsite copy onto a clean host.
2. Start the API and confirm that a project's Overview and Analysis load.
3. Record the backup used, the timings, the actual RPO and RTO, and any problems.
4. File GitHub Issues for fixes.

## Maintenance

- Check `offsite-backup.sh status` every day, and alert on failure once Phase 1 alerting is live.
- Keep contacts and customer message templates current.
