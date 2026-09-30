# Isolated visual preview

Run from the UI worktree only. The fixture API binds to 127.0.0.1:3186, serves synthetic examples, has no upstream connection and rejects writes. Never configure this preview against production. Only the five redesigned report surfaces have fixtures; legacy links are outside this fixture harness.

1. Run `node scripts/energyiq/ui-preview/fixtures.mjs --serve` in one terminal.
2. In a second PowerShell terminal, set `$env:NEXT_PUBLIC_CONFIG_API_URL='http://127.0.0.1:3186'`, `$env:NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE='dev'`, and `$env:NEXT_DIST_DIR='.next-ui-preview'`.
3. Run `npm --workspace @datafoundry/web run dev -- --hostname 127.0.0.1 --port 3185`.
4. Open `http://127.0.0.1:3185/energyiq/reports?projectId=ui-demo&sessionId=new`.

Knowledge, configuration and Skills links use the same synthetic project. Open the saved conversation for a report preview. Save, upload and send return an explicit preview-only error. No real account is needed in this local dev fixture mode.

For screenshots and functional checks, provide Playwright through the ordinary module resolution or set `PLAYWRIGHT_MODULE` to its installed absolute package path. Microsoft Edge is required by these scripts. Run `node scripts/energyiq/ui-preview/capture.mjs` and `node scripts/energyiq/ui-preview/interactions.mjs`. Evidence goes to ignored `artifacts/ui-preview/`. The browser is headless; screenshot capture is a visual fixture check, not live Provider or production acceptance.

The current preview also has an ignored `apps/web/.env.local` containing only these local preview settings. Do not copy it into Integration or deployment. Next may regenerate `next-env.d.ts` and `tsconfig.json` for its custom output directory; do not include those generated edits in the UI change.
