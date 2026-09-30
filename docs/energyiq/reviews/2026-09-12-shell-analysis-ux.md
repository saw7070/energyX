# Shell and analysis UX follow-up

Base: `43909991`, branch: `codex/244-shell-analysis-ux`.

## Changes

- Unified customer/project picker with search, authorised customer groups, retry/loading/error states, keyboard navigation, and current-customer admin Create project entry.
- Picker reads candidate access contexts using request-local workspace headers; it does not mutate the global workspace while browsing options.
- AI Analysis resumes the last visited session for the active project; New conversation explicitly opens a new session. Session recall lasts for the mounted shell, not across reloads. Project matching prevents recording an old route against a newly selected project.
- Initialization uses an editable plain-language request and a project-files entry. It permits evidence-backed import/mapping/publish without claiming success. No automatic submission. Composer resizes after asynchronous settings load.
- GFM Markdown tables scroll inside the answer. Labelled run IDs and file hashes are masked for readability; this is not general redaction. Report delivery cards are compact horizontal previews, and report references show their title/version.
- Preview fixtures include two synthetic customers and a Markdown table. No Explorer or backend behavior changed.

## Verification

- UI preview Vitest config: 76 tests across seven suites passed (picker, shell, Markdown, report panel, file preview, create project, periods).
- Separate `npx vitest run apps/web/src/lib/config-api/__tests__/access-context-project-picker.test.ts`: one test passed.
- Browser: project search and cross-customer selection, anchored picker, readable table/report card, initialization page, and loaded composer height checked. Narrow picker checked at actual CSS width 480px; the browser minimum prevented a 390px check. Initialization textarea clientHeight and scrollHeight both 110px after refresh at width 1152px.
- `git diff --check` passed. Full TypeScript check remains failing on existing repository errors (including existing React act-environment declarations); no errors were reported for the new production components or API client.
- Fixture backend rejects mutations. No real Provider initialization, real publishing, production deployment, or complete build acceptance is claimed. Parent performs integrated build.

## Follow-up

- Unsaved composer drafts can still be lost when leaving the page; session recall is not draft persistence.
- Attachment/project-default scope needs a separate product and persistence change.
- Cross-customer context transition may briefly display the existing unavailable gate before the route commits.
- Backend responses should avoid internal execution identifiers and clearly separate imported, mapped, published and pending states. Generic CSV support remains backend-adapter dependent.
- Generated Next environment/tsconfig changes are excluded from this commit.

## Composer follow-up (after 93265fef)

Unsent text, dates, period preset and report reference now restore through sessionStorage, scoped by authorised user/customer/project/conversation/setup focus. They persist across route navigation and reload within the tab; no cross-device or closed-tab persistence is promised. Project attachment preferences are deliberately not included in the local text draft. The composer states this boundary and identifies pending document-default changes, including removal of the last document. Upload messaging now describes the actual shared-project contract.

An accepted chat POST clears the draft before the subsequent refresh; failed submission preserves it. Skill extraction does not clear or move the typed chat draft. The input is disabled while its submission is in progress. Account/customer changes remount the composer to prevent in-memory draft reuse across scopes. Storage errors do not prevent typing or sending and do not display a saved indicator.

Validation: 53 focused tests passed across panel, draft storage and shell suites. Browser verified text entry -> Knowledge -> analysis return restores the exact text and displays the local-tab indicator; test text was cleared afterwards. TypeScript remains baseline-failing, with no reported errors in the changed panel/draft files. Attachment mutation semantics are covered by unit tests, not real backend writes. Shared attachment defaults still require a separate backend contract to become per-message attachments.

## Admin navigation simplification

User authorised removing unused navigation after the Integration 44d57602 review. Accounts/access, project configuration/publication, and run diagnostics remain. Legacy Overview Design, AI Insights and Methods/SOP are grouped in a collapsed Legacy features section (opens for an active legacy route). Placeholder Data Map/Knowledge/Assets and unavailable operations are omitted from navigation. Duplicate HTML Reports entry is replaced with a project-scoped Open AI Analysis link. Existing routes and implementations remain for compatibility; this is not backend deletion or proof of zero production use. Header labels and stale Admin overview capability copy were aligned.

Validation: six existing sidebar/render/route tests passed with updated assertions for hidden placeholders and collapsed legacy group. Browser confirmed simplified navigation, default collapsed legacy group, expandable legacy buttons, and corrected homepage descriptions using the synthetic preview. Shared runtime processes were not changed. New Agent coverage of operations endpoints and per-message attachment contracts remain separate work.
