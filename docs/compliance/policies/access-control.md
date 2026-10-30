# Access Control Policy

**Owner:** Security lead · **Approved by:** [CEO name] · **Effective:** [YYYY-MM-DD] · **Review:** yearly · **Maps to:** CC6.1–CC6.3

## Principles

Everyone has their own account, with the least access their job needs. Access is denied unless granted. MFA is required wherever it is offered.

## Staff access

**Systems covered:** GitHub, Alibaba Cloud console and RAM, production SSH, EnergyX super-admin, password manager, email, and the SMTP, AI-provider and Tuya consoles.

- **MFA** on every system above.
- **Production host.** Named accounts with `sudo` and SSH keys only. No password login and no shared root. Access is limited to [n] named people.
- **Super-admin access** to a customer organisation is allowed only for a support request, and is logged (Phase 1).
- **Joiners.** The manager approves access in a ticket.
- **Movers.** Access is adjusted within 5 business days.
- **Leavers.** All access is removed within 1 business day (the same day if involuntary), and any secrets they knew are rotated.
- **Quarterly review.** The Security lead reviews access to all of the systems above, records the review, and fixes findings within 10 business days.

## Customer access to EnergyX

- Customer admins manage their own users and roles through per-organisation role-based access. [Company] creates customer users only at onboarding, on a documented request.
- Passwords are stored as Argon2id hashes with a minimum length of [12]. Sign-in is rate-limited. Sessions expire and are revoked on password change.
- From Phase 1, OIDC SSO, TOTP MFA (which an organisation can enforce), SCIM and idle timeout are available. Customers enable them (a CUEC).

## Secrets

- Keep secrets in the password manager or in server files with mode 600. Never commit them; `.env` is ignored by git.
- Stored connector credentials are encrypted with AES-256-GCM.
- Rotate secrets every year, when someone with access leaves, and immediately if one may have been exposed.

## Evidence

Keep access tickets, leaver checklists, review records and MFA screenshots for at least 12 months.
