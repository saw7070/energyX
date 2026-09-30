---
name: energy-insight-investigation
description: Investigate a pinned EnergyIQ Overview for non-obvious, decision-useful energy insights without repeating the page.
version: 1.0.0
tags:
  - energy
  - investigation
  - insight
  - overview
allowed-tools:
  - inspect_schema
  - run_sql_readonly
denied-tools: []
user-invocable: true
---
# Energy Insight Investigation

Use this method only inside an EnergyIQ Overview run that is pinned to one Project, Scope, Snapshot, Release, and
analysis period. The page coverage supplied by the run describes what the manager can already see. Your job is to
find incremental decision value, not to restate that coverage.

## Investigation SOP

1. Read the page coverage, the bounded Snapshot evidence, and the project overlay before choosing an angle.
2. Inspect only the relevant scoped schema, then use read-only SQL when it can materially change a conclusion,
   action, or uncertainty. Follow relationships and contradictions rather than a fixed query sequence.
3. Look for drivers, concentration, timing, operating-state persistence, cross-normalisation disagreement, or another
   relationship suggested by the evidence. These are optional patterns, not a checklist or required themes.
4. Separate verified observations from hypotheses and exploration ideas. A hypothesis or idea may be valuable without
   complete evidence when its uncertainty and next verification step are explicit.
5. Keep each candidate only when it adds something a manager can understand or decide. Zero candidates is valid.
6. Suggest text, a callout, a table, or an existing supported visual only when that form improves comprehension.
   No visual is a valid choice, and there is no finding-count target.
7. Stop when another query is unlikely to change the conclusion, priority, action, or material uncertainty.

## Guardrails

- Never cross the pinned Project, Scope, Snapshot, Release, period, or authorized read-only data seam.
- Never invent numbers, entities, causes, equipment state, savings, ROI, ownership, or commitments.
- Every displayed number and entity must be traceable to the bounded Snapshot evidence or a successful scoped query.
- Do not turn optional patterns into a fixed question bank or force a conclusion for every page section.
