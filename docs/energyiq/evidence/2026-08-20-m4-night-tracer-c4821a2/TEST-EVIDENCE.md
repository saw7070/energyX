# M4 tracer test evidence

## Fixed identity

- Worktree: isolated `m4-night-tracer` Worktree
- Branch: `codex/m4-night-tracer`
- Baseline: `c4821a227987ddbf48bcbc56fa8a5ed2eb73fb80`
- Production Provider, shared service, deployment, publication and database operations: **not used**

## Source boundary

- Read: one controlled Preschool reference HTML.
- Read: Preschool Day01 / Day07 / Day30 synthetic/acceptance workbooks.
- Not read: either project's Renderer implementation or a compiled project definition.
- Not read: the production database or a Provider response.

These are project-specific clean-room source inputs. They establish process mechanics only; they do not establish customer Renderer parity, official production truth or cross-project reuse.

## RED

Command:

```powershell
node --test scripts/energyiq/m4-clean-room-tracer/index.test.mjs
```

Before implementation the eight agreed seams all executed and failed against `M4_TRACER_NOT_IMPLEMENTED`:

```text
tests 8
pass 0
fail 8
```

The eight seams were contamination, Design Intent leakage, typed Capability/Window gaps, deterministic compilation, pinned zero-side-effect Preview, same-Definition replay, customer Renderer proof boundary, and cross-project/G5 evidence boundary.

## GREEN

After the minimum implementation and three additional pure tracer checks:

```text
tests 11
pass 11
fail 0
duration_ms 179.1649
```

The public Contracts and Metadata packages were built before the consumer test, so the compiler test did not use stale `dist` output.

## Deterministic re-execution

The complete tracer was executed a second time in a separate temporary output root. These seven output files were byte-identical between runs:

- `design-intent.json`
- `binding-plan.json`
- `desired-definition.json`
- `compiled-template.json`
- `preview-manifest.json`
- `rerun-matrix.json`
- `active-draft-preview.html`

Definition fingerprint remained:

```text
f15af821c12ebb277fc90c871f64ce5c2a2bb3ea8be53b4a3d5a311bc244aeec
```

Manifest timestamps, automation elapsed time and the Ledger are intentionally not byte-stable provenance fields.
