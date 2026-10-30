# Change Management Policy

**Owner:** Engineering lead · **Approved by:** [CEO name] · **Effective:** [YYYY-MM-DD] · **Review:** yearly · **Maps to:** CC8.1

## Scope

This policy covers changes to:

- code and database schema
- AI prompts, Skills and analysis methods
- systemd, nginx and backup configuration
- production environment settings

## Standard change

1. **Ticket.** Track the change in a GitHub Issue in `Zion74/energyiq-datafoundry`.
2. **Branch.** Work on a branch or worktree. Never push directly to `main`.
3. **Pull request.** State the purpose, the risk and the rollback plan.
4. **CI.** Build, tests, lint and security scans must pass.
5. **Review.** Someone other than the author approves. If only one engineer is available, the CEO or a second engineer reviews within 5 business days after merge, and the review is recorded.
6. **Release.** Build the immutable release artifact with `scripts/energyiq/build-release-artifact.mjs`.
7. **Staging.** Verify the release in staging (once Phase 1 provides it).
8. **Deploy.** Use `scripts/energyiq/deploy-release.mjs`. It verifies checksums, holds a deploy lock, runs smoke checks before and after the switch, and rolls back automatically. Keep the deploy log and the release manifest.

## Emergency change

Allowed to restore service or fix a critical vulnerability. The Engineering lead approves it (verbal is fine). Complete the PR, review and ticket within 2 business days afterwards.

## Production configuration

Record environment, systemd or nginx changes in a ticket with a before/after summary. Never include secret values.

## Supporting controls

- Branch protection on `main`: required review and required status checks.
- Deploy access limited to the people allowed to change production.

## Evidence

Keep PRs, CI runs, release manifests and deploy logs for at least 12 months.
