---
name: report-presentation
description: Compose conclusion-first English HTML reports with concise openings and developed analysis from verified findings for project decision makers. Applies when creating or revising a report, including scheduled reports.
metadata:
  version: "1.8.0"
---

# Report Presentation

## Project spatial reference

When manifest.spatialReference is present, read its dataFile and imageFile. A complete project report, including a weekly or monthly rerun, must include a compact Spaces and meter distribution figure after the key findings. Embed the supplied SVG offline; the project style may change colours and typography, never room geometry or equipment containment. Keep source attribution and the illustrative/not-to-scale qualification. Do not imply room-level measurements or infer wiring from the picture. Reference labels yield to published configuration where they conflict; disclose unresolved conflicts. Short conversational answers need no figure. An explicit request for a map-free/abridged report can override inclusion; record that exception in review.json. Do not copy historical energy chips into the reusable map.

## Scope and project style

This shared Skill owns English delivery, conclusions first, evidence readability, responsive layout and working interactions. The separately supplied project-style.md owns palette, typography, visual layout and reference appearance. Apply that project's bound style while satisfying these delivery rules. Examples and prior reports supply evidence or analytical ideas, not another project's visual identity. If legacy analytical instructions contain conflicting visual rules, use project-style.md for appearance. Adapt section content to findings within the project style; changing analysis does not authorize changing the saved style.

## Reader-first structure

Open with 3–4 important conclusions, fewer when evidence warrants. Each conclusion states the finding, one meaningful number or comparison, why it matters and the next action. These summarize the body; they are not extra findings to fill a quota. A time-constrained reader should understand this period's priorities from the first screen.

Make the opening a visual briefing: compact title and period, then short finding headlines with a prominent decision-relevant number and one implication/action sentence. Do not put a preamble, contents list, methodology, evidence-boundary paragraph or dense metric grid before the findings. Put a material qualification beside its affected number (for example, "conditional" or "complete days only"); explain it once in the evidence. Do not turn each opening finding into a miniature essay. On a desktop viewport, the finding headlines should be visible together before the first detailed analytical section; on mobile, preserve their order without shrinking text.

Read outputs/analysis-brief.md for a full report. After the concise opening, explain the overall project, useful composition and time comparisons, then develop the significant findings and one prioritized action table: action, conditional potential, responsible role and next-period verification. Use concise captions to explain what each chart demonstrates. Keep detailed calculations, provenance, rejected candidates and technical identifiers in supporting notes.

Give each decision theme one main evidence section. A headline may repeat its key number in the supporting chart, but do not restate the same interpretation in a paragraph, table, callout and checklist. Choose a chart OR table when both show identical values; retain both only if they answer different questions. Use takeaway-led headings (what the evidence shows) rather than generic labels such as "Detailed analysis". Connect each selected conclusion to evidence and the final action table; include evidence-backed contextual findings that help the reader understand performance even without an associated action; omit filler.

Before writing HTML, save an editorial outline in exploration notes mapping the project overview, contextual comparisons and deeper findings to their evidence, and the opening priorities to their actions. Explain material omissions from analysis-brief.md. Preserve freedom over chapter names, chart types and HTML layout. If several takeaways merely name components of one total, merge them unless they require genuinely different decisions. In the final HTML, remove internal snapshot/revision IDs, quality_status literals, workspace paths and implementation-file names from customer copy. Keep them in supporting notes. Check the headlines themselves for causal claims or certainty not supported by the evidence; qualifications buried at the end do not make an overconfident headline acceptable.

Do not impose a default word count, page count or chart count on a full report. Size the report to useful findings and evidence, keeping the opening brief and the analysis sufficiently developed. Apply a length limit only when the user explicitly requests it; a short release-validation prompt is not a reusable report default. Replace weaker or repeated content when adding a new finding. Adapt section titles, order and charts to current evidence rather than repeating a fixed chapter list. A stable or improving period is a valid story; never invent novelty.

## Continuity and selection

Where prior evidence is available, distinguish new findings, persistent issues, verified improvements and resolved issues. Report what changed since the previous period without copying its conclusions. Lack of previous records is not evidence of resolution or a newly arising problem.

Keep key metrics comparable by naming scope, units, window and changed definitions. Internal averages and modelled baselines are references, not external efficiency targets. Put material limitations next to affected claims; consolidate repeated qualifications.

## HTML and evidence

Deliver complete offline English HTML with inline styles, SVG/charts and supplied assets. Every chart needs units, readable labels and a meaningful caption. Use project visual preferences when supplied. Maps use source-supported layout, label schematic/not-to-scale where appropriate, and show room energy only when a verified room-to-meter relationship supports it.

Use readable body text and restrained emphasis. Keep charts and tables useful in expanded reading and narrow preview: wrap text, give wide tables their own scroll container, and avoid whole-page horizontal overflow. Prefer simplified labels or a separate large diagram over shrinking important map text into illegibility. Include print styling.

Use one clear reading column for narrative with ample chart space and a consistent heading hierarchy. Reserve the accent colour for findings, selected series and priorities; avoid a stack of equally prominent cards. A spatial figure should orient the reader to equipment or findings, not serve as a decorative full-page introduction. Before saving, check the opening order in the generated HTML, long captions, repeated claims and narrow-width overflow. If no browser rendering tool is available, record that limitation in supporting notes rather than claiming visual verification.

Before delivery, reconcile headline, chart, table and action figures against computed results and declared rounding. Explain assumptions for cost/savings scenarios. Separate actual valid-reading totals, common aligned coverage and latest individual readings when they differ. Preserve previous artifacts when revising. This Skill applies to report deliverables, not every conversational answer.

## Calendar and periodic continuity

Use manifest.calendarLabels for the analysis start and inclusive end labels. Weekdays must be calculated, never guessed. If showing preparation time, label it Prepared; the system adds the final completion time separately.

When previous-report-context.json is supplied, include a compact follow-up only for material changes: new findings, unresolved questions and verified action progress. Different coverage or exposure must qualify comparisons. A fall in consumption does not prove an action was implemented. Retire stale content to make room for better-supported findings without imposing a fixed novelty quota. Save the compact findings and next actions in outputs/report-followup.json; project facts and accepted Skills remain separate.

For the opening key decisions, visibly number the findings 1, 2, 3 (or fewer when evidence supports fewer). Keep each number with its concise finding and corresponding action. Use the full supplied analysis scope; any seven-day comparison is a dated supporting window, not a replacement for the report scope.

## Plain language for decision makers

Readers are facility managers and key decision makers, not energy or data specialists. Use everyday words ("power left on after working hours", "equipment that never switches off", "readings missing"), explain an unavoidable term such as kWh or peak demand in a short clause the first time, and express results in money and in comparisons the reader knows (share of the bill, a normal day, last month). Say whether a change is large or small. Keep facts, likely explanations and assumptions visibly apart, and state what would change a conclusion. When a decision involves options, show the benefit, effort, risk and the recommended option.

## Customer-facing names and short opening cards
Call the site's weekly schedule "operating hours", matching the Facility settings (for example "outside operating hours"); when it is not yet confirmed, say "assumed operating hours". Do not say opening, business, office, published or provisional hours, or operating window.
Use project-configuration.json meterDisplayNames verbatim, matching Explorer. Internal meter IDs belong in calculation files and structured references, not visible report titles, legends or recommendations. A generic published name must remain explicitly unidentified; never invent the served equipment.
Keep Key Points to one short issue, one short action and one short conditional benefit. Put detailed calculations and qualifications in evidence/details. Retain the estimate duration and essential condition in the visible benefit; brevity must not turn potential savings into achieved savings.

## Decision-led evidence graphics

Give each selected decision one primary evidence figure, chosen for the question it answers. Use an hourly profile with the proposed control window highlighted for a switching decision; a weekday-by-hour heatmap for a recurring schedule mismatch; aligned daily bars for comparable periods; or an intervention-marked before/after comparison when execution is confirmed. A table is appropriate when a chart would obscure a small exact comparison. Do not add chart types merely for variety.

Put a short takeaway above each figure. Label device names, units and actual dates; distinguish observed, missing and estimated values visually and in a text key. Missing cells are not zero and must not use the zero-value colour. Annotate the actionable hours or changed values. Put the essential coverage/sample qualification in the caption. When several figures are necessary, each must answer a different decision question. Preserve the project style and spatial reference.

Present measured use, the eligible controllable portion and conditional savings as separate quantities. A cost scenario needs its duration and material condition beside the amount. Never label baseline spending as savings. Prefer a clear conditional amount to an invented uncertainty range. Put detailed assumptions and calculations in expandable evidence, without hiding conditions that could reverse the recommendation.

For key-point-candidates.json use a plain-English summary of at most 18 words, describing the main decision rather than listing every finding. Each opening finding needs a short device-specific title, one action sentence and one concise conditional benefit. Keep numbered findings. Detailed explanations belong beside the evidence; do not truncate sentences or remove material caveats to meet the target.

Keep structured companion files compatible with the supplied output contracts. Shorter copy or richer charts do not authorize renamed or omitted fields. Save chart metadata in separate supporting files when the contract has no such field.

## School-calendar evidence

For a full school report with published academic phases, show the school-break versus normal-teaching comparison from the analysis brief alongside ordinary weekday/weekend/public-holiday analysis. Use a concise phase/day-type comparison and overlaid 24-hour curves when supported; label dates, units, sample days and material exclusions. Keep study/exam separate. If the brief lacks this analysis, compute it before composing; if the calendar or comparable samples are absent, state the specific limitation. Do not turn a short holiday into a full-period total comparison or equate school break with office closure. These comparisons may explain performance without creating an action.
