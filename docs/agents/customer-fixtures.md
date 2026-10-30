# Customer fixtures

Real customer workbooks, reports and screenshots are not stored in git. The repository used to carry them under
`docs/template/Net-Zero Product/`, `docs/template/Preschool/` and `outputs/`; those paths are now ignored.

A few golden tests read the real Ngee Ann workbooks and are skipped when the files are absent:

- `apps/api/src/energy/ngee-ann-two-snapshot-acceptance.test.ts`
- `apps/api/src/report-agent/project-configuration-tools.test.ts` ("imports a real Ngee Ann workbook…")

To run them, get the fixture pack from the team's private storage (not from a public channel) and either place the
files in `docs/template/Net-Zero Product/` or point `ENERGYX_CUSTOMER_FIXTURES_DIR` at the folder that holds them.
Anyone with access to a clone made before the files were removed can extract them without tracking them again:

```bash
git archive d567cd2 "docs/template/Net-Zero Product" | tar -x
```

Never commit customer data. New test fixtures must be synthetic and live under an `__fixtures__` folder next to the
test that uses them.
