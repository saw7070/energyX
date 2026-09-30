import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { ReportSettings } from "./report-store.js";
import type { ReportPeriod } from "./report-calendar.js";

/** Data exploration scope and the issue being published are deliberately independent. */
export function scheduledAnalysisPrompt(cadence: "daily" | "weekly" | "monthly", period: ReportPeriod, instructions: string): string {
  return `Create the ${cadence} energy report for ${period.from} to ${period.toExclusive} (end exclusive).
Explore ALL supplied available history. This reporting period is the editorial focus, not an input-data filter. State actual evidence dates and missing coverage; never imply the reporting period is complete when readings are missing.
First explore project data and site context for useful findings independently of previous conclusions. Then reconcile candidate Insight/Action pairs with project-insights.json and project-actions.json. One finding has one primary action, which may involve multiple meters. Reuse the same action only for the same problem, equipment scope and intended measure; a matching meter alone is not enough.
Read insight-maintenance.json before selection. Recheck previous recommendations, including stale entries, against the supplied readings. Scheduled and implemented actions belong to follow-up, not new recommendation slots. Explain material follow-up in the report without recommending the same action again. Paused, declined and resolved records remain history. Not selecting an item does not establish resolution.
Maintain at most six useful candidate pairs and select at most three for Key Points. Do not manufacture a quota. Rank supported savings, actionable benefit, evidence strength and implementation effort; safety urgency requires specific safety evidence. Preserve all reported implementation, paused, resolved and observation records. Never turn a completed action back into a new recommendation, or claim execution without user evidence.
Compose the HTML from these reconciled findings. Use current published device display names in customer-facing prose, even when historical records contain old names. Keep stable action IDs for continuity. Reconcile companion JSON with the final reviewed HTML before delivery.
${cadence === "monthly" ? "Review the month's overall performance, persistent opportunities and observed action outcomes. Do not concatenate weekly reports or count the same savings twice." : "Emphasize recent changes, new opportunities and progress on existing actions. If priorities have not changed, briefly update their evidence instead of repeating the previous explanation."}
Treat user-reported implementation as a reason to observe new data, not proof of savings. Distinguish predicted benefits from measured changes and attributable effects. Exclude QA/demo history from customer conclusions. Do not claim to have changed the shared list: the server validates and publishes it after report acceptance.
Additional project instructions:
${instructions.trim() || "Use the accepted project analysis and presentation Skills."}`;
}

export function withCadenceSkill(settings: ReportSettings, cadence: "daily" | "weekly" | "monthly"): ReportSettings {
  if (cadence === "daily") return settings;
  const name = cadence === "monthly" ? "energy-monthly-review" : "energy-weekly-brief";
  const content = readFileSync(new URL(`../../../../packages/skills/builtin/${name}/SKILL.md`, import.meta.url), "utf8");
  const version = cadenceSkillVersion(content);
  return { ...settings, skillRefs: [...(settings.skillRefs ?? []).filter(ref => !["energy-weekly-brief", "energy-monthly-review"].includes(ref.name)), { name, version, content, scope: "general", category: "analysis" }],
    skillUsage: [...(settings.skillUsage ?? []).filter(ref => !ref.id.startsWith("builtin:cadence:")), { id: `builtin:cadence:${name}`, name, version, source: "required", contentHash: createHash("sha256").update(content).digest("hex"), inputPath: "skill-references.json" }] };
}

/** The version in a built-in Skill's front matter, so the recorded version follows the file. */
export function cadenceSkillVersion(content: string): string {
  const front = content.startsWith("---") ? content.split("---")[1] ?? "" : "";
  return /^\s*version:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(front)?.[1] ?? "0.1.0";
}
