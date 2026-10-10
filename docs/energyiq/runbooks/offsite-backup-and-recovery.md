# Offsite backup and recovery

How EnergyX protects customer data against losing the production server, and how to get it back.

## What we promise

| | Promise | How |
|---|---|---|
| **Recovery point (RPO)** | At most **24 hours** of data lost | A full backup every night at 02:15 (server time), copied offsite at 03:30. Live Tuya readings missed during an outage are fetched again by the next daily sync. |
| **Recovery time (RTO)** | Service back within **4 hours** | Restore the newest offsite copy onto a fresh server with the steps below. |
| **Retention** | 7 nightly copies on the server, 35 days offsite | The backup tool keeps 7; an OSS lifecycle rule deletes offsite copies after 35 days. |
| **Encryption** | Offsite copies are encrypted with AES-256 | The key never leaves the server and a password manager; Alibaba only ever stores ciphertext. |

## How it works

1. `backup-shared-storage.sh create` (timer `energyiq-shared-storage-backup.timer`, 02:15) pauses the API for about a minute, copies all customer data (SQLite metadata, DuckDB readings, uploaded files), and writes a checked backup to `/var/backups/energyiq/managed-daily/backup-<time>/`.
2. `offsite-backup.sh upload` (timer `energyiq-offsite-backup.timer`, 03:30) takes the newest backup, checks its checksum, packs and encrypts it into `backup-<time>.tar.enc`, uploads it and its SHA-256 to OSS, and confirms the stored size. The result is written to `/var/lib/energyiq/offsite-backup.json`. A backup already offsite is never sent again.
3. A failed upload makes the systemd unit fail, visible with `systemctl status energyiq-offsite-backup.service`.

## One-time setup (done once by an administrator)

These steps need the Alibaba Cloud console and root on the server. Nothing in them should be pasted into chat or a ticket.

1. **Create the bucket.** In OSS, create a **private** bucket, ideally in a different region from the server (for example `energyiq-backups` in Singapore). Add a lifecycle rule: delete objects under `energyiq/production/` after **35 days**.
2. **Let the server write without stored keys.** In RAM, create a role for ECS with a policy that allows only `oss:PutObject`, `oss:GetObject` and `oss:GetObjectMeta` on `acs:oss:*:*:energyiq-backups/energyiq/production/*` (no delete, so a compromised server cannot erase its backups). Attach the role to the production ECS instance. On the server:
   ```bash
   aliyun configure --profile energyiq-offsite --mode EcsRamRole --ram-role-name <role-name> --region <bucket-region>
   ```
3. **Create the encryption key** on the server, then copy its contents into the company password manager. **Without this key the offsite backups cannot be opened.**
   ```bash
   mkdir -p /etc/energyiq && chmod 700 /etc/energyiq
   openssl rand -base64 48 > /etc/energyiq/backup-encryption.key && chmod 600 /etc/energyiq/backup-encryption.key
   ```
4. **Write the config** `/etc/energyiq/offsite.env` (mode 600):
   ```bash
   OFFSITE_BUCKET=energyiq-backups
   OFFSITE_PREFIX=energyiq/production
   OFFSITE_ENDPOINT=oss-ap-southeast-1.aliyuncs.com
   OFFSITE_PROFILE=energyiq-offsite
   BACKUP_ENCRYPTION_KEY_FILE=/etc/energyiq/backup-encryption.key
   ```
5. **Install and switch on** from the current release:
   ```bash
   install -m 755 /opt/energyiq-datafoundry/current/scripts/energyiq/offsite-backup.sh /usr/local/libexec/energyiq/offsite-backup.sh
   install -m 644 /opt/energyiq-datafoundry/current/deploy/systemd/energyiq-offsite-backup.{service,timer} /etc/systemd/system/
   systemctl daemon-reload && systemctl enable --now energyiq-offsite-backup.timer
   systemctl start energyiq-offsite-backup.service && journalctl -u energyiq-offsite-backup.service -n 20 --no-pager
   ```

## Checking it daily

```bash
/usr/local/libexec/energyiq/offsite-backup.sh status
```
`"status": "ok"` and a `checkedAt` from the last night means the newest backup is offsite.

## Restoring

1. On the new or repaired server, put the encryption key and `offsite.env` back in `/etc/energyiq/` (from the password manager) and configure the `aliyun` profile.
2. Download, check and decrypt the copy you want (the newest unless told otherwise):
   ```bash
   /usr/local/libexec/energyiq/offsite-backup.sh restore --object backup-<time>.tar.enc --to /var/restore/energyiq
   ```
   The script refuses a copy whose checksum does not match, before and after decryption.
3. Continue with the Shared Storage restore runbook (`docs/energyiq/plans/2026-08-24-生产Shared-Storage自动备份与隔离恢复Runbook.md`) using the restored `backup-<time>` folder, then deploy the release recorded in its `metadata.json`.

## Restore drill

Every quarter, restore the newest offsite copy onto a spare machine, start the API against it, and check that a project's Overview and Analysis load. Record the date, the backup used and how long it took. A backup that has never been restored is a hope, not a backup.

## Encryption of the live server

Offsite copies are encrypted by this tool. The live data and the local nightly backups sit on the server's cloud disk; turn on **ECS cloud disk encryption (KMS)** for that disk so they are encrypted at rest too. Alibaba encrypts a disk when it is created, so this means a planned maintenance window: snapshot the disk, create an encrypted disk from the snapshot, and swap it in. Plan about 30–60 minutes of downtime.
