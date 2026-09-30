# Report UI redesign handoff — 12 September 2026

Base: `a0de6f7f9c3ff77c55ae2d9e51fa66eae184e8af`. Branch: `codex/energyiq-ui-redesign`. Developed in an isolated UI worktree; use `git worktree list` to locate it on the development machine.

## Change

Introduces a scoped mineral-grey / graphite / evergreen visual system for the report workbench. Updates the shell, explicit New conversation action, actionable chat starters, composer, HTML preview controls, Knowledge thumbnails, configuration icons and surfaces, and Skill listing. New starters only prefill and focus the existing composer. Report and configuration APIs, authorisation, upload, approval and persistence logic are unchanged.

## Validation

- 66 tests passed across report-agent-panel, report-library, report-file-preview, project-configuration-view and energyiq-shell.
- Desktop 1440×1000 and narrow 390×844 screenshots cover chat, Knowledge, Skills, configuration and report preview. Narrow routes show no document-level horizontal overflow.
- Seven browser checks passed: starter fill/focus without sending; reduced motion; navigation overlay; mobile preview/source/Escape; Tools tab; Skill dialog; visible library request failure.
- Browser page-error capture: empty. CSS design detector: empty findings. `git diff --check`: passed.
- `npm ci` completed, including the repository TypeScript project build in postinstall.
- Full `tsc -p apps/web/tsconfig.json --noEmit` did not pass. It reports broad errors in existing DataTasks/test files (including CopilotKit Attachment typing and test mocks). This is not a clean Web typecheck or production-build claim. Integration must run its normal release gates.
- No live Provider, production login, real upload, real report generation or deployment acceptance was performed. The preview API contains synthetic examples and rejects all writes.

## Finish review (performed in this task)

Independent reviewer/documenter agents were not used because the task explicitly prohibited additional agents. No external visual comp was supplied; this review is against the requested light/graphite/energy-colour direction. The existing canonical domain documentation supplies product context.

Disposition: **ship for integration review**; this is not deployment approval.

| Check | Result |
| --- | --- |
| Persistence | Visual system recorded in root DESIGN.md; fixture harness is reproducible. |
| Type | Matches the operational UI contract; clear title, reading and metadata levels. |
| Material | Matches: flat, differentiated work surfaces and white report paper; no decorative effects. |
| Navigation / colour | Matches: graphite context, evergreen selection, explicit New conversation action. |
| Mobile composer | Resolved: natural scroll; starter selection focuses the reachable editor. |
| Album / Skill alignment | Resolved: entries align at the top. |
| Interaction | Browser checks above passed; reduced-motion respected. |
| Ceiling | No additional decorative motion needed for this operational interface. |
| Material fixes | None remaining from the two visual inspection rounds. |
| Keep | Preserve the scoped theme, report sandbox, readable controls and restrained surface hierarchy. |

Screenshots and machine-readable results are in local `artifacts/ui-preview/`. They are not checked in. Preview starts at `http://127.0.0.1:3185/energyiq/reports?projectId=ui-demo&sessionId=new`; fixture API is port 3186. Existing listeners on 3000 (PID 16316) and 18769 (PID 25764) remained unchanged during this task. No Integration file, server, deployment or other worktree was modified.

## Follow-up: supplied Codex chat and preview references

The user supplied two screenshots and requested visual alignment specifically for the composer, conversation process and right preview. Replaced the chat's broad green surfaces with a white reading canvas, charcoal user bubbles, a compact execution disclosure above the answer, and a fixed rounded composer with circular send/stop. Moved period controls into an accessible disclosure; added keyboard send with IME protection, auto-height input, long-message expansion and return-to-latest behaviour. The preview now uses a filename tab, compact icon actions and a Preview/Source row.

Browser checks additionally verified Enter/Shift+Enter/IME semantics, scrolling through a long transcript, server-returned tool events, period disclosure and stop requests. These use intercepted synthetic fixtures; they do not prove live Provider streaming. The existing seven interaction checks also pass. Desktop and 390px screenshots include the updated side preview and composer; no page errors were recorded. The design detector returned no findings. No other worktree or production service was changed.

Run `node scripts/energyiq/ui-preview/chat-contract.mjs` with the documented Playwright environment for the additional checks. Follow-up screenshots are in the same ignored artifacts directory. This follow-up supersedes the earlier natural-scroll mobile chat design: the transcript now scrolls independently while the composer remains visible.

## Follow-up: account row and administrator dialog

Replaced the separate bottom Admin link and avatar control with a full-width account button and trailing settings icon. Personal information shows identity, email, role and Workspace from the current authenticated context; Sign out reuses the existing identity action. Only administrators receive the Admin console menu item. The actual admin workbench is lazy-loaded into a modal with section route replacement suppressed in embedded mode. The original standalone route retains its behaviour.

Added role-gating, account details, sign-out invocation, keyboard and focus-return tests. Added a dropdown-in-dialog regression test because a body-level portal becomes inert behind a native modal. 26 focused tests passed. Browser checks covered desktop/narrow menus and profile, Admin overview, opening/closing its project dropdown, Escape and route preservation; page-error capture was empty. CSS detector returned no findings.

The local fixture supports Admin overview for visual inspection, not complete admin configuration or mutations. Real account/server and end-to-end admin editing acceptance remain Integration work. No production or other-worktree changes were made.


## AI Analysis navigation and settings follow-up

Renamed the report conversation surface to AI Analysis and removed the deprecated AI Analysis sidebar link (legacy URL remains available). A single New conversation action sits above collapsible analysis sessions and Knowledge reports. Sidebar report selection on the analysis page opens the existing safe preview without navigating or erasing the draft; Discuss this report explicitly adds context. Knowledge deep links also open the selected report, with an explicit route into a new referenced analysis.

Analysis period now exposes This month, Last month and All data directly, with a persistent inclusive date range, Singapore timezone and available-data dates. Custom dates open directly from the range. Previous-month calculation now handles January independently of the server default range. Invalid partial/reversed dates are rejected before sending rather than silently dropping the period.

Removed the configuration/preferences toolbar from the main analysis surface. Project background/default materials are accessed from Project configuration; scheduled reporting from Knowledge. Both reuse the existing versioned settings save and conflict handling. Textareas have bounded scrolling without native resize grips. Attachment persistence remains the existing shared project settings contract; no new conversation-private attachment backend is claimed.

Validation: 74 tests across period, shell, agent panel, library and preview passed using scripts/energyiq/ui-preview/vitest.config.mjs (isolates component tests from Next's PostCSS configuration). Five chat browser checks and six navigation/settings checks passed against local read-only fixtures. Desktop and 390px screenshots were inspected; save-button contrast was corrected after visual inspection. Full Web typecheck still fails on existing DataTasks/test typing errors; no diagnostics were found for the changed production components. No real Provider, automatic scheduler execution, admin mutation or deployment acceptance is claimed.

Latest visual feedback supersedes the collapsible-sidebar design above: restored flat AI Analysis and Knowledge links, with Conversations below. Twenty shell regressions pass. Recent-report thumbnails on the new-analysis start page remain a design proposal.

## Approved report-thumbnail implementation
Implemented the now-approved sidebar/start-page/reply thumbnails. Sidebar uses two reports by default, expands to six, and shares one scroll region with sessions; account footer remains fixed. Report thumbnail rendering is extracted into a shared component, retaining lazy loading and script-disabled CSP/sandbox. Existing full report preview isolation remains unchanged.

Validation: 65 focused component tests passed. The new recent-reports.mjs browser check covers default count/expansion, sidebar opening without route/draft/reference changes, start-page opening, desktop fullscreen/Escape, mobile modal/draft, horizontal overflow and page errors. Desktop and mobile screenshots inspected; initial start-page crowding was corrected with compact starter actions. Tests use synthetic read-only fixtures, not Provider or production acceptance.
