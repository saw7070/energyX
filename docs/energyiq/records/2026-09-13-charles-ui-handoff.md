# Charles trial UI handoff — 2026-09-13

## Scope

- Rename the Knowledge navigation and report library heading to Reports; retain existing routes.
- Add a create-report entry and starter guidance, without automatically submitting a message.
- Move the shared-report conversation privacy notice into its corresponding preview; make Download and Expand labels visible.
- Clarify report search, selected tabs, and narrow-screen preview action wrapping.
- Explain how to read, select, extract and save Skills. Saving a version does not activate a project default. Correct shared read-only Skill metadata so it is not automatically labeled a platform method.
- Explain that Project Configuration displays a draft while Explorer displays published structure.

No backend, authorization, scheduler, or Explorer behavior changes. The global earlier-versions checkbox remains; moving it into report details is a future proposal only.

## Verified

- Focused frontend tests: 4 files, 83 tests passed (report library, agent panel, file preview, shell).
- `git diff --check` passed.
- Impeccable detector on report library, file preview and workbench CSS returned no findings.
- Before these edits, the existing 3000 UI was exercised with real reports: open right preview, expand/close, new conversation and starter prompt prefill, Skills content, Configuration and Explorer expansion through circuit/device nodes. These observations establish existing behavior, not acceptance of this patch.

## Visual acceptance boundary

The worker preview was opened on 3008, but the completed desktop/narrow-screen visual acceptance results for this patch are not available in the handoff. Do not describe this patch as fully visually accepted or already deployed on 3000. Integration should build and check Reports title/date separation, preview controls and notice placement, Skills guidance, and new-conversation guidance at desktop and narrow widths.

No new real report was generated as part of this frontend patch. Real Creator, scheduler and report HTML acceptance belong to the Integration Agent's separate backend evidence. Shared 3000 and API processes were not restarted by this worker.
