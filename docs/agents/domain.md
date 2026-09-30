# Domain Docs

## Before EnergyIQ work

1. Read the root `CONTEXT.md`.
2. Read `docs/energyiq/CONTEXT.md` for canonical terminology.
3. Read `docs/energyiq/当前共识与新会话入口.md`.
4. Read only the architecture, decision, or implementation documents relevant to the task.

## Layout

This repository uses one maintained product domain context even though its implementation is a monorepo:

- Root entry: `CONTEXT.md`
- Canonical glossary: `docs/energyiq/CONTEXT.md`
- Architecture and implementation records: `docs/energyiq/`
- Optional future ADRs: `docs/adr/`

Do not create duplicate README, CONTEXT, development-plan, or per-package domain files. Missing ADR directories should not block work.

Use glossary terms in tickets, plans, tests and code. Surface conflicts with accepted EnergyIQ decisions instead of silently replacing them.
