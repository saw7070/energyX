# EnergyIQ report workspace

Scope: the AI Chat, Knowledge, and Skills & Tools surfaces introduced by #244.
This records their implemented design; it does not replace the legacy Overview
or Explorer product contracts. Canonical product decisions remain in
`docs/energyiq/product/PRD-云端能源报告与Project-Explorer-MVP.md`.

## User tasks

Charles discusses a project, requests an English HTML report, opens the file,
requests a revision, and extracts reusable instructions. Customers find and read
authorized project reports. The conversation is a creation entry point; the saved
report is a persistent deliverable. A discussion turn need not produce a file.

## Layout and behavior

- Keep project selection and navigation on the existing left sidebar, with recent
  conversations below primary destinations and legacy tools further down. AI Chat
  starts a new conversation; only history links restore an existing one. Show
  readable Singapore dates, never short session IDs.
- Use a bounded center pane with independently scrolling messages and a bottom
  composer. Send message is the only conversation action: the agent decides when
  the request calls for a report or Skill draft. Do not expose a report mode. Place the period selector above the composer. Recent means the
  previous calendar month plus this month through today; offer complete previous
  month/week/day, actual all-data bounds and custom inclusive dates. Show actual
  data cutoff separately. Reuse EnergySelect for project, period, frequency and
  conversation choices, with one shared surface/focus language for inputs. Keep
  context and scheduling in Report preferences. Attach file in the composer reuses the
  supported document upload flow; selected files remain visible and removable.
  The supported formats do not include images, DOCX or XLS.
- Project configuration has a dedicated sidebar page: project profile, Spaces & meters, Project notes, and Hours & tariffs. Explain the user task before showing data. Group meters by named locations, keep formulas readable, and distinguish inactive saved policy revisions from published and pending versions. School terms appear only when stored for that project. Edit with Agent opens a new configuration conversation without sending. Configure project inside Chat remains a shortcut. It appends
  a configuration prompt without sending it or discarding existing input, report
  context, dates or preview. Project configuration is separate from report
  preferences. Read saved draft/publication state on demand and refresh after
  a conversation turn finishes. An active published version can coexist with
  unpublished draft changes. Use the setup API state, never model text or report
  preference revision numbers, to display this distinction. Saving a draft does
  not publish it.
- A validated file appears as a clickable message card. Chat can produce both
  HTML and a Skill draft; use server artifact flags, never prompt keywords. Skill
  drafts require explicit approval before saving. Extract Skill can also use a
  successful conversation with no report. Open it in a right pane
  at widths of 768px and above; never automatically fill a new chat with an old file.
- Use the same Preview / Source / Download / Expand / Close controls for saved
  documents and chat artifacts. Expanded reading uses a native modal dialog;
  Escape returns to the side preview and Close returns focus to the opener.
  Below 768px, use the modal reading view directly.
- Knowledge is a searchable report-only album. Group one shared thumbnail grid
  by the Singapore generation date (finishedAt, falling back to createdAt), newest
  day first. Within each day put automatic reports first, then manual reports;
  each class is newest first. Mark automatic reports with a clear badge. There
  are no fixed automatic/manual columns. Keep actual HTML thumbnails and
  date/version labels. Classification comes from task ancestry, not current
  schedule preferences. Auxiliary files stay in chat. Limit each page to 12 cards
  and load thumbnails lazily.
- Skills and Tools are separate tabs. Skills retain General methods and Project
  skills sections with section counts and a total. Cards show name, purpose,
  version and explicit category; missing metadata means project/other. General
  does not mean public or cross-tenant. Clicking a card opens a modal with readable
  project name, scope, category, version and full instructions. No small disclosure
  arrows or raw source identifiers. Escape closes and focus returns to the card.
  YAML frontmatter stays in complete Source/editing content, not Markdown preview.
  Administrators edit inside the modal using the current settings revision and an
  explicit new version for changed named Skills; customers remain read-only.

## Visual language

Use existing surface, surface-subtle, border, muted and foreground tokens.
Keep the neutral application shell subordinate to customer reports. Use 20px
page headings, 16px chat copy with 1.7 line height, a 720px message measure,
compact secondary labels and restrained surfaces. A dark primary send button
anchors the composer. Use whitespace and pane borders for hierarchy. Select triggers have a restrained
raised surface; popover menus use soft shadows, clear hover and selected states.
Do not introduce decorative metrics or placeholder report cards.

Use visible keyboard focus rings, short color transitions and 180ms message/detail
reveals; disable animation for reduced-motion. Generated HTML stays inside the
restricted preview, and gallery thumbnails execute no scripts.

## Verification boundary

Integration screenshots checked the actual Tuya reports at 1440, 1011 and 900px.
Full builds and browser checks run only in the Integration worktree. These checks
establish local usability and behavior, not production deployment or Charles's
acceptance of report quality.


## Project configuration: Operate surface

Use a location navigator and a selected-location inspector, not a long table or explanatory essay. Preserve the main app sidebar. The current project and publication status occupy a compact header. Three segmented destinations separate spaces/meters, notes, and operating rules. A location click updates the meter inspector; aggregation internals are disclosed on demand. Each section links to an Agent conversation with the matching configuration prompt, never auto-sending. Empty sections offer the next action. Academic terms appear only for stored academic periods. Custom node metadata is rendered as nested labeled values in additional information.

Use slate navigation surfaces, white inspector space, a restrained green selection/action accent and clear amber unpublished status. Avoid repeated explanatory subtitles. Mobile stacks location selection above the inspector. UI rendering remains driven by canonical structured fields plus rendered Markdown notes; arbitrary new business semantics require a schema/tool/renderer extension.
