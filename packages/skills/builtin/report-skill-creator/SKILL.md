---
name: report-skill-creator
description: Distill report conversations and verified feedback into reusable Skill drafts and maintain existing project methods inside EnergyIQ.
metadata:
  version: "1.4.0"
---

# EnergyIQ Skill Creator

Use this method when the administrator asks to extract or improve a reusable Skill from the current conversation or report. Produce an English draft for review; do not activate it or modify saved settings.

## Separate analysis from visual identity

The default extraction produces an **analysis** Skill: questions, comparisons, evidence, exploration and editorial reasoning. The project's bound project-style.md separately owns palette, fonts, layout and reference appearance. Preserve that binding. Extracting a method from an attractive report is not permission to change style or copy another project's visual identity.

Only an explicit request to create or revise a visual style produces a **presentation** Skill draft. Identify the target project and proposed style version; include visual rules and reference appearance, leaving analytical methods and measured values out. If both kinds of changes are requested, produce one kind at a time and explain the second pending change. Saving and binding each version are separate actions. A style draft never activates itself.

Read creation-notes.json for the actual successful turns, project-context.md for supplied facts, any saved project Skills, and previous-report.html when present. Distinguish explicit accepted revision requests from an assistant suggestion that was never confirmed. If essential intent is unclear, explain the gap instead of inventing an accepted requirement.

1. Identify the repeated task, when this Skill should apply, required inputs and the useful outcome. Give it a concise lowercase-hyphen name and a discriminating description. Do not generalize a one-off example into a universal rule.
2. Separate reusable analysis methods (calculations, checks, comparison selection, uncertainty handling) from project facts (meter topology, operating assumptions, tariff/area inputs and their provenance) and presentation requirements (audience, language, layout and evidence disclosure). General applicability is not permission to share private project facts with another tenant.
3. Preserve reasoning that should be repeated, not old measured values, dates, conclusions or unverified causal explanations. Turn hypotheses into checks. Treat missing facts as inputs to confirm. Keep accepted preferences distinct from optional techniques.
4. Write only instructions that help a future fresh Session make good decisions. Specify inputs, calculations or tools needed, outcome checks and failure/missing-data handling. Use the existing read/bash/edit/write/grep/find/ls tools and installed readers. No host configuration, credentials, tool installation or access expansion.
5. Keep the draft self-contained: embed essential reference material or describe required future inputs. Do not point at absent references, scripts, prior Session files or temporary workspace paths. Source Session/report IDs are provenance, not dependencies for execution.
6. Check a different-period scenario: the same method should recompute from new data without copying old findings. Include a small acceptance checklist or illustrative test scenario. If a live replay was not performed, say so; do not label the draft validated or customer-accepted.

Write /workspace/outputs/project-skill.md with name, description and category (analysis by default; presentation only for an explicit style request) in YAML frontmatter. For analysis, cover applicability/inputs, method, project facts to supply or verify and validation; reference shared delivery rules instead of copying visual specifications. Retain only sections that have useful substance. Keep proposed scope explicit. Finally explain the draft's intended reuse and any unresolved assumptions. The administrator chooses whether to save a version in this Project.

## Maintain an existing method

When refining a report method, start from the accepted version and the user's requested improvement. Prefer a revision of that method over a new Skill per conversation. Extract reusable analytical choices and editorial preferences; keep project facts in project context and per-period discoveries in analysis records. Include exploration, candidate ranking, replacement within a stable length budget and evidence-backed continuity. Do not hard-code a period's findings or require novelty.

For report presentation, retain the shared conclusion-first structure: summarize 3–4 important findings (fewer if warranted), then project-wide context, evidence-backed comparisons and deeper findings from the complete analysis brief, followed by an action table. The shortlist does not limit analytical coverage. Refer to report-presentation.md supplied by the product; avoid duplicating a private project's facts in general methods.

Describe which existing method the draft revises, proposed version, what changed, evidence behind the change and what still needs validation. The product's Save new version action preserves a reviewed candidate without activating it. Set as project default is a separate explicit action. Personal versions stay private to their author; shared versions stay within the authorized project. Never claim saving merely because a file was generated, and never evolve or activate a method automatically after each report. Platform-provided methods are shared read-only baselines; propose improvements or project overrides instead of claiming to modify platform files.
