# Quiet analysis defaults

- Removed draft-save status copy while retaining composer draft persistence.
- Analysis method defaults to Automatic. Opening the control does not show a disabled method catalog; Choose method explicitly reveals optional methods. Advanced details retain exact version selection and instructions. Required backend methods are unchanged.
- Moved method audit beneath Activity details, itself collapsed, so no separate method entry competes with the answer. Backend records remain intact.
- Renamed Extract Skill to Save report method; updated Skills & Tools usage guidance to match.
- Combined reading availability and out-of-range warning into one concrete date line; no date calculation or missing-data behavior changes.

Verification: 3 test files, 64 tests passed, including draft behavior, explicit version pinning and nested audit visibility. Real 3008 browser confirmed zero method checkboxes in Automatic and optional list after Choose method. At actual 480x844 viewport no horizontal overflow; Send bottom 821 remained visible. Viewport reset. No 390px or live member-answer visual claim for this patch; Integration owns final member acceptance. Shared 3000/API and streaming polling untouched.

Integration: f6fea445 applied as dc8174cb. Production Web build .next-quiet passed and is running on local 3000. Real member browser verified Automatic renders zero checkboxes, Choose method exposes the list, draft hint is absent, and 390px has no horizontal overflow with send button bottom at 821px. Screenshots: outputs/report-integration-20260911/quiet-desktop.png and quiet-mobile.png. No production deployment.
