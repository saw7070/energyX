# Member-facing cloud Agent acceptance

## Accepted product direction

Prioritize the new cloud Agent experience: private conversations, project data,
reports, preview, Skills and automation. Pause legacy Overview and AI analysis;
legacy test failures do not block this iteration. Keep the legacy implementation
available in source rather than deleting historical data or deployments.

## Permissions

- Project members may create and continue their own Sessions, upload their own files,
  generate reports and maintain personal Skill versions.
- Shared project settings/configuration, project Skill updates and project defaults
  require administration. Member Pi runs receive no project configuration write tools.
- Never inherit an administrator's private file attachments into a member Run. Published
  project data and shared project context remain available without manual CSV attachment.
- Personal Skill versions are owner-only. A new version updates the same Skill identity;
  saving does not activate it as a project default. Runs pin version, content hash and
  prepared input path. The UI distinguishes provided inputs from proven model use.
- Generic configuration mutation cannot forge report ownership or overwrite report
  Skill history. Project sharing also checks the record author's administration rights.

## Local acceptance

Created five password accounts on the local validation database: Tuya three,
Preschool one, Ngee Ann one. Each has user role, member workspace access and viewer
access only to its project. Credentials remain in an ignored local access file;
no passwords are committed. These accounts are not yet provisioned in production.

Three Tuya users logged in through separate authenticated clients and submitted
ordinary chat concurrently. Three Docker containers were observed simultaneously.
All three completed through deepseek-flash and returned their own markers.
Each account receives 403 for other-user event access, shared-settings writes and
cross-project access; each list excludes other users' Sessions.
Preschool and Ngee Ann accounts also logged in and read their own project successfully,
with cross-project requests denied. Their report generation was not exercised here.

Five independent browser contexts logged in through the real login page. The new
chat composer loaded for all five; Tuya conversations display only the matching
user's marker. Legacy navigation is hidden. Screenshots are local acceptance artifacts.

Personal Skill test: save V1, update same ID to V2, select V1 for a fresh Run.
Both versions remain; other users cannot discover/select it; public writes are denied;
project defaults stay unchanged. Real Run 606a06db-6cb2-46fb-8d73-4cae42ffed4f
returned METHOD_V1, verifying the selected content was read.

Member report Run a66e1367-6fe2-4674-9ed7-889e0e526119 succeeded. Its same-session
review corrected three issues (meter coverage, occupancy inference and continuous
operation wording) and recorded 16 checks. The final English HTML is 41,419 bytes;
the receipt hash matches the accepted file. The member browser displays the completed
conversation and Review completed after expanding Activity details. This verifies
the workflow, not full editorial equivalence with Charles's reference report.

The latest API was restarted only after all workers finished. A real member request
to forge report metadata through the generic Skill endpoint returns 403. Attempts
to stop or continue another user's Session also return 403 for all three Tuya users.
The focused Skill guard/library/UI suite passed 19 tests. Legacy prewarm now defaults
off in source, as well as being disabled in the local runtime configuration.

## Scope of evidence

API member/runtime suite: 52 passed. Sidebar suite: 24 passed. Production Web build
passed and local 3000 is running .next-members. Five real-provider isolated short
file-reading runs also passed in 12.8–14.5 seconds each; this does not establish
production capacity for five long reports. No production changes or main merge.
Legacy seam run was stopped following the product decision. One old Overview timeout
passed when rerun alone; the interrupted whole suite is not a green acceptance result.

Credentials: original worktree outputs/report-integration-20260911/customer-cohort-20260913.json.
Evidence: Integration outputs/report-integration-20260911/customer-cohort-results.json,
member-browser-results.json, member-skill-results.json and live-five/summary.json.

## Charles trial walkthrough

The trial is for an existing project first. A successful local test is not Charles's
acceptance of the analysis quality, and is not a production release.

1. Select Tuya Office. Open Project Configuration to inspect saved information and
   Explorer to inspect the published meter hierarchy/data. The Agent can edit the
   hierarchy, mapping, display labels and virtual meters through project tools;
   Explorer's chart layout remains an application feature. Unknown physical
   relationships must be supplied or clarified, never inferred as confirmed facts.
2. Start a new conversation, select a period and ask for a property-manager report.
   Project data is already connected; uploaded PPT/Excel/documents supplement it.
   Ask follow-up questions naturally without being forced to generate a file.
3. Open the generated HTML from the conversation in the preview. Read the key
   findings, enlarge when necessary, and ask for a revision in the same conversation.
   Publication follows the internal review/revision step. Reports is the intended
   user-facing name for the former Knowledge report library.
4. When satisfied, extract the report method with Skill Creator. Inspect the draft,
   save a new version of the existing method where appropriate, and explicitly
   choose whether to make it the project default. Draft generation is not saving;
   saving is not activation. Personal methods must not overwrite the shared default.
5. Configure a daily/weekly/monthly report schedule. Future runs use a fresh period
   and the saved method, with findings recalculated from project data. API ingestion
   and report generation are separate jobs; a static CSV project does not acquire
   new readings merely because its report schedule runs.

The trial should establish that Charles can find each next action without verbal
developer guidance. Plugins are optional remedies for a demonstrated missing
capability, not substitutes for clear navigation, preview and execution feedback.

Additional trial checks on the current Integration runtime:

- Project setup/context read through the live Agent succeeded (Run
  d5edf7bf-df12-43f9-8fba-54e76128a949); no configuration was changed. The focused
  project tools/data suites passed 20 tests.
- Skill Creator succeeded in the ordinary member's report Session (Run
  c63e425d-ae19-4875-b9e2-90551b001d7d). It proposed a revision instead of activating
  a new project method. No shared default was overwritten.
- A separate SQLite backup was used to exercise the current scheduler with this
  exact method and 3 September data, following the 2 September source report.
  Run 6fce8c24-3090-4e8b-bb31-5ad9770a911d succeeded; the supplied project-skill.md
  equals the Creator output. Review recorded 20 checks and zero issues; the final
  HTML hash matches the receipt. The local live schedule was not changed.
- The 35,619-byte English replay HTML renders offline without page errors,
  external requests or desktop horizontal overflow. Visual inspection confirms
  conclusions precede evidence, though some headline language remains stronger
  than ideal (for example, 'always-on base load'). Review success is not proof of
  perfect semantic quality or visual equivalence with Charles's reference.

Replay evidence: outputs/report-integration-20260911/charles-replay.json and
charles-replay-preview.json in Integration. This tests the scheduler path with a
controlled clock; it does not prove a future production timer or fresh API ingestion.

UI Integration follow-up: S2 commit 4dab1343 was integrated as fa0c6941. The Web
production build with `.next-charles` succeeded and replaced the local 3000 preview.
An ordinary member's real report was opened in Reports; desktop Expand/Exit worked,
Skill Creator's content dialog rendered after its entry animation, and the 390px
preview closed correctly without document horizontal overflow. Screenshots and
results are in charles-ui-{desktop,mobile,skills}.png and charles-ui-check.json.
This completes the previously outstanding visual checks for those paths. It does
not claim every page, production deployment, or Charles's own trial is accepted.
