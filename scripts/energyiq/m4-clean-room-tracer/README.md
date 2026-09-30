# M4 clean-room tracer

This is an internal Delivery Leverage tracer, not a customer Overview runtime.

It executes one narrow path:

```text
Reference Section
→ Design Intent
→ overview.consumption@1 + current-overview Binding Plan
→ energyiq-overview-definition@1 compilation
→ offline structured Preview
→ Day01 / Day07 / Day30 same-Definition replay
```

## Run

Build the shared contracts before running the consumer test:

```powershell
npm --workspace @datafoundry/contracts run build
npm --workspace @datafoundry/metadata run build
node --test scripts/energyiq/m4-clean-room-tracer/index.test.mjs
node scripts/energyiq/m4-clean-room-tracer/run.mjs <new-output-directory>
```

The output directory must not already exist. The runner creates a temporary physical allowlist kit, verifies its paths/content and deletes that temporary kit after producing the evidence package.

## Hard boundaries

- The clean-room source deliberately reads one controlled Preschool reference HTML and the
  Preschool Day01 / Day07 / Day30 synthetic acceptance workbooks.
- It does not read either project's Renderer implementation, a compiled project definition,
  the production database or a Provider response.
- No Provider, queue, shared service, publication, deployment or database.
- Reference numbers and JavaScript are never treated as runtime truth.
- XLSX replay is explicitly a source-level deterministic witness, not official Project aggregation.
- The offline Preview never proves customer Renderer parity.
- The conclusion remains `process-mechanics-only`; it cannot satisfy M1, M2, M5 or G5.

The first run is expected to remain `M4-NIGHT-TRACER-BLOCKED` until a sanitized, revision-pinned official Scope Summary input seam exists and human delivery time is measured.
