# Issue tracker: GitHub

Issues, specs, and development tickets for this repository live in GitHub Issues at `Zion74/energyiq-datafoundry`. Use the `gh` CLI for tracker operations and always pass `--repo Zion74/energyiq-datafoundry`; the upstream repository metadata in `package.json` makes implicit repository inference unsafe here.

## Conventions

- Create, read, comment on, label, and close issues with `gh issue`, always with `--repo Zion74/energyiq-datafoundry`.
- Publish approved specs as GitHub issues and apply `ready-for-agent`.
- Create implementation tickets in blocker-first dependency order.
- Prefer GitHub native issue dependencies for `Blocked by` edges.
- If native dependencies are unavailable, record `Blocked by: #<issue>` in the issue body.
- Pull requests are not a request or triage surface.
- Existing `.scratch/` material remains historical or temporary working evidence; do not publish new formal specs or implementation tickets there.

## Common operations

- Create: `gh issue create --repo Zion74/energyiq-datafoundry --title "..." --body-file <file> --label ready-for-agent`
- Read: `gh issue view <number> --repo Zion74/energyiq-datafoundry --comments`
- List: `gh issue list --repo Zion74/energyiq-datafoundry --state open --json number,title,body,labels,comments`
- Comment: `gh issue comment <number> --repo Zion74/energyiq-datafoundry --body "..."`
- Label: `gh issue edit <number> --repo Zion74/energyiq-datafoundry --add-label "..."`
- Close: `gh issue close <number> --repo Zion74/energyiq-datafoundry --comment "..."`

## Wayfinding operations

- Map: one GitHub issue describing notes, settled decisions, and remaining uncertainty.
- Child ticket: one independently verifiable tracer-bullet issue.
- Frontier: open, unblocked, and unassigned tickets in map order.
- Claim: assign the ticket before implementation.
- Resolve: post the result and evidence, then close the ticket.

## When a skill refers to the tracker

- "Publish to the issue tracker" means create a GitHub issue in `Zion74/energyiq-datafoundry`.
- "Fetch the relevant ticket" means run `gh issue view <number> --repo Zion74/energyiq-datafoundry --comments`.
