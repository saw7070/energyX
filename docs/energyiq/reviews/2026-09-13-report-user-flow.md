# Report user flow implementation — 2026-09-13

Worker: codex/244-report-user-flow, based on Integration b95c7320.

## Product rules

- Latest = 28 calendar days ending before the partial final data day, capped at today in Singapore. Coverage gaps never silently shrink the requested window. Date-only CSV coverage has no interval cutoff; its stated day boundary is used. This is not proof of complete readings across all meters.
- Last month remains the previous calendar month based on the server calendar day. Multiple months snap both boundaries to whole months; custom dates remain available. The UI displays inclusive ends; API/store use exclusive ends.
- Discussing a report inherits its exact period and version. Selecting Latest explicitly changes the next request. Requests outside known coverage show a limitation.
- Accepted new HTML includes a system-generated requested-window/generation-time banner. The prompt requires observed coverage and narrower diagnostic windows to be distinguished from requested report scope. This does not validate every natural-language date or numerical claim in model output. Existing artifacts are never rewritten.
- Attachments are authorized per run and captured in its settings snapshot. Sending does not save shared defaults. An explicit Save selection as project materials action changes defaults. Unsent selections are retained with the browser session draft.
- Knowledge separates reports, saved project materials and saved project context. Context is not presented as independently verified knowledge. Materials are admin-only, using the existing authorization boundary.
- Report versions follow ancestry, including intermediate chat nodes, with cycle/depth limits. Independent reports with identical names stay separate. Previous versions are expandable; all versions can also be shown.
- Preview identity is reflected in the URL; preview title includes version. Only the owning administrator can continue a report's private lineage; shared report reading does not expose private conversations.
- Conversations precede recent reports in the sidebar; project identity stays in the AI header. Supporting files and technical errors are expandable.

## Validation evidence

- Root TypeScript build passed.
- API period/API/service/scope tests: 27 passed, 1 existing skipped. Report library API: 11 passed, including owner/non-owner and intermediate chat ancestry.
- Web focused suite: 90 passed; final library extension adds one permission test (21 library tests passed). Tests cover old report date inheritance, per-run files without settings writes, project defaults, version identity, workspace materials isolation, shell and preview behavior.
- Full web `tsc --noEmit` remains non-green with errors in other modules/tests (including data-tasks/CopilotKit types). No errors were reported for the changed production frontend files. Do not present this as a full web typecheck pass.
- Real browser: isolated Web 3008 connected read-only to Integration API 18769. Verified Tuya project header, Knowledge tabs and project-material empty state; preview URL a8f79216-a2e1-4437-8abe-751de5909cf8 and v1 title; report-to-chat inherited 2026-08-17 through 2026-09-11. No message was sent and no shared settings changed.
- Actual narrow viewport was 480 CSS pixels (browser minimum/zoom prevented 390); sidebar collapsed, no document horizontal overflow, dates and composer visible. Override restored.

## Integration acceptance still required

- Integrate frontend and API together. The read-only browser used the old API, whose old default period does not implement the new 28-day rule. Verify the new endpoint plus actual submit snapshot after integration.
- Generate a real new report and check requested scope, measured coverage, model narrative, preview and download together. The system banner alone is not content acceptance.
- Final canDiscuss/previousReportId API additions were tested in isolation; repeat the owner/non-owner browser flow after integration.
- Keep Integration 870dbea0 Skill versions and dynamic presentation-version extraction. This worker only adds report metadata near the library report mapping.
- No shared service restart, data migration or deployment was performed.

## Integration verification (2026-09-13)

- Integrated as `df6f8a7b`, plus shared-report explanation `ba109c3c`, on top of `870dbea0`. Skill versions and dynamic presentation version remain intact (live API: 1.1.1).
- Integration API build and Next production build passed. Focused API: 40 passed / 1 existing skipped; Web: 85 passed; final two-file permission rerun: 49 passed. These counts overlap; do not add them as distinct tests.
- Local API 18769 and Web 3000 now serve the integrated build. No production deployment.
- Live authenticated API and browser agree: latest data ends 11 Sep 23:45 SGT; Latest 28 days is 14 Aug–10 Sep inclusive. UI explicitly warns that the window begins before available readings (16 Aug), rather than quietly trimming the request.
- Real chat submission `36cf8dab-a8af-47ca-91a8-8aa0eca6aed3` completed with the default period stored as `[2026-08-14,2026-09-11)`. Explicit per-run empty attachments left shared project settings unchanged. It only asked for the window; no report was generated.
- Owner API returns canDiscuss=true for `a8f79216-a2e1-4437-8abe-751de5909cf8`. A different administrator's actual browser can preview that report and sees the private-conversation explanation, with no Discuss action. Knowledge Project materials / Project context tabs are visible.
- End-to-end generation of a new full report with the system stamp remains unverified; prior reports are unchanged. Period inheritance, per-run authorization, version ancestry and stamp behavior have focused regression coverage. The previous report quality candidate still has the editorial limitations recorded separately.
