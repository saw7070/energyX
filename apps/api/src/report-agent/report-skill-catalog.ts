import { authorizeReportConversation } from "./report-access.js";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { buildSkillResourcePayload, parseSkillPackage } from "@datafoundry/skills";
import type { ConfigApiContext } from "../routes/types.js";
import type { ReportSettings } from "./report-store.js";
import { REPORT_PRESENTATION_METHOD } from "./report-presentation.js";
import { REPORT_SKILL_CREATOR_METHOD } from "./report-skill-creator.js";
import { validateReportSkillContent } from "./report-skills.js";

type Context = Required<ConfigApiContext>;
export type ReportSkill = {
  id: string; name: string; version: string; content: string; projectId: string;
  scope: "general" | "project" | "personal"; category: "analysis" | "presentation" | "other";
  readOnly: boolean; required?: boolean; isDefault: boolean; revision: number;
  sourceRunId?: string | undefined; sourceSessionId?: string | undefined;
};
const review = readFileSync(new URL("../../../../packages/skills/builtin/report-review/SKILL.md", import.meta.url), "utf8");
const digest = (content: string) => createHash("sha256").update(content).digest("hex");
const methodVersion = (content: string) => content.match(/version:\s*["']?([^\s"']+)/)?.[1] ?? "unknown";
export function requiredReportSkills(projectId: string): ReportSkill[] {
  return [["presentation", "Report presentation", REPORT_PRESENTATION_METHOD], ["creator", "Skill Creator", REPORT_SKILL_CREATOR_METHOD], ["review", "Report review", review]].map(([id, name, content]) => ({
    id: `builtin:${id}`, name: name!, content: content!, version: methodVersion(content!), projectId,
    scope: "general", category: id === "presentation" ? "presentation" : "other", required: true, readOnly: true, isDefault: true, revision: 0,
  }));
}

export function defaultReportSkills(settings: ReportSettings): ReportSkill[] {
  const { projectId } = settings;
  const defaults: ReportSkill[] = [];
  if (settings.styleSkill) defaults.push({ ...settings.styleSkill, projectId, scope: "project", category: "presentation", readOnly: false, isDefault: true, revision: settings.revision });
  if (settings.skill.trim()) defaults.push({ id: `legacy:project:${digest(settings.skill).slice(0,16)}`, name: "Project Skill", version: `settings-${settings.revision}`, content: settings.skill, projectId, scope: "project", category: "other", readOnly: false, isDefault: true, revision: settings.revision });
  for (const ref of settings.skillRefs ?? []) defaults.push({ ...ref, id: `legacy:ref:${digest(ref.name + ref.version + ref.content).slice(0,16)}`, projectId, scope: ref.scope ?? "project", category: ref.category ?? "other", readOnly: false, isDefault: true, revision: settings.revision });
  return defaults;
}

/** Call only after authorizing this project. Personal records never cross owners. */
export function reportSkillCatalog(context: Pick<Context, "metadataStore" | "workspaceId" | "userId">, settings: ReportSettings, canManageProject: boolean): ReportSkill[] {
  const { projectId } = settings;
  const defaults = defaultReportSkills(settings).map(skill => ({ ...skill, readOnly: !canManageProject }));
  const saved: ReportSkill[] = [];
  const owners = context.metadataStore.db.prepare(`SELECT id, user_id FROM config_resources WHERE workspace_id = ? AND kind = 'skill' AND json_extract(payload_json, '$.reportProjectId') = ? AND (user_id = ? OR json_extract(payload_json, '$.scope') = 'workspace')`).all(context.workspaceId, projectId, context.userId);
  for (const owner of owners) {
    const resource = context.metadataStore.configResources.get({ id: String(owner.id), user_id: String(owner.user_id), workspace_id: context.workspaceId, kind: "skill" });
    if (resource.payload.scope === "workspace") {
      try { if (!authorizeReportConversation(context.metadataStore, resource.user_id, context.workspaceId, projectId).canManageProject) continue; }
      catch { continue; }
    }
    const versions = versionHistory.safeParse(resource.payload.reportSkillVersions);
    if (!versions.success) continue;
    for (const item of versions.data) saved.push({ ...item, id: resource.id, name: resource.name, projectId, scope: resource.payload.scope === "workspace" ? "project" : "personal", category: resource.payload.reportSkillCategory === "presentation" ? "presentation" : "analysis", readOnly: resource.builtin || (resource.payload.scope === "workspace" ? !canManageProject : resource.user_id !== context.userId), revision: resource.revision,
      isDefault: defaults.some(ref => ref.content === item.content && ((ref.name === resource.name && ref.version === item.version) || ref.name === "Project Skill")),
    });
  }
  return [...requiredReportSkills(projectId), ...saved, ...defaults.filter(ref => !saved.some(item => item.isDefault && item.content === ref.content))];
}

export const skillSelectionSchema = z.object({ mode: z.enum(["default", "selected"]), refs: z.array(z.object({ id: z.string().min(1), version: z.string().min(1) })).max(5).default([]) });
export function resolveReportSkillSelection(settings: ReportSettings, catalog: ReportSkill[], selection?: z.infer<typeof skillSelectionSchema>): ReportSettings {
  const explicit = selection?.mode === "selected";
  const selected = explicit ? selection.refs.map(ref => {
    const skill = catalog.find(item => item.id === ref.id && item.version === ref.version);
    if (!skill || skill.required || skill.projectId !== settings.projectId) throw new Error("REPORT_SKILL_SELECTION_CHANGED");
    if (settings.styleSkill && skill.category === "presentation") throw new Error("REPORT_STYLE_BINDING_REQUIRED");
    return skill;
  }) : catalog.filter(item => item.isDefault && !item.required);
  // Choosing analysis methods must not silently remove or replace the project's visual identity.
  const optional = selected.filter(item => item.id !== settings.styleSkill?.id);
  if (settings.styleSkill) {
    if (optional.some(item => item.category === "presentation")) throw new Error("REPORT_STYLE_BINDING_REQUIRED");
    optional.push({ ...settings.styleSkill, projectId: settings.projectId, scope: "project", category: "presentation", readOnly: true, isDefault: true, revision: settings.revision });
  }
  if (new Set(optional.map(item => item.id)).size !== optional.length) throw new Error("REPORT_SKILL_SELECTION_CHANGED");
  const skillUsage: NonNullable<ReportSettings["skillUsage"]> = [...catalog.filter(item => item.required), ...optional].map(item => ({
    id: item.id, name: item.name, version: item.version, source: item.required ? "required" : item.id === settings.styleSkill?.id ? "default" : explicit ? "explicit" : "default", contentHash: digest(item.content),
    inputPath: item.id === settings.styleSkill?.id ? "project-style.md" : item.id === "builtin:presentation" ? "report-presentation.md" : item.id === "builtin:creator" ? "skill-creator.md" : item.id === "builtin:review" ? "report-review.md" : explicit ? "skill-references.json" : item.content === settings.skill ? "project-skill.md" : "skill-references.json",
  }));
  if (!explicit) return { ...settings, skillUsage };
  return { ...settings, skill: "", skillSourceRunId: undefined, skillSourceSessionId: undefined, skillUsage,
    skillRefs: optional.filter(item => item.id !== settings.styleSkill?.id).map(item => ({ name: item.name, version: item.version, content: item.content, scope: "project", category: item.category })),
  };
}

const versionHistory = z.array(z.object({ version: z.string(), content: z.string(), sourceRunId: z.string().optional(), sourceSessionId: z.string().optional() }));
export const saveReportSkillSchema = z.object({ id: z.string().optional(), revision: z.number().int().nonnegative().optional(), name: z.string().trim().min(1).max(100), version: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,49}$/), content: z.string().trim().min(1).max(50_000), scope: z.enum(["personal", "project"]), category: z.enum(["analysis", "presentation"]).optional(), sourceRunId: z.string().uuid().optional() });
export async function saveReportSkill(context: Context, settings: ReportSettings, input: z.infer<typeof saveReportSkillSchema>, canManageProject: boolean, source?: { sourceRunId: string; sourceSessionId: string | undefined }): Promise<ReportSkill> {
  validateReportSkillContent(input.content);
  const existing = input.id ? reportSkillCatalog(context, settings, canManageProject).filter(item => item.id === input.id) : [];
  const category = input.category ?? (existing[0]?.category === "presentation" ? "presentation" : "analysis");
  if (category === "presentation" && (!canManageProject || input.scope !== "project")) throw new Error("REPORT_STYLE_ADMIN_REQUIRED");
  if (existing.length && existing[0]!.category !== "other" && existing[0]!.category !== category) throw new Error("REPORT_SKILL_CATEGORY_CHANGED");
  if (input.id && (!existing.length || existing.some(item => item.readOnly))) throw new Error("REPORT_SKILL_EDIT_FORBIDDEN");
  if (existing.length && input.revision !== existing[0]!.revision) throw new Error("REPORT_SKILL_VERSION_CHANGED");
  if (existing.length && existing[0]!.name !== input.name) throw new Error("REPORT_SKILL_NAME_CHANGED");
  if (existing.some(item => item.version === input.version)) throw new Error("REPORT_SKILL_VERSION_CHANGED");
  if (existing.length >= 50) throw new Error("REPORT_SKILL_VERSION_LIMIT");
  // Revision preserves visibility. Changing a personal method into a shared one requires an explicit new copy.
  if (existing.length && existing[0]!.scope !== input.scope && !(existing[0]!.scope === "general" && input.scope === "project")) throw new Error("REPORT_SKILL_SCOPE_CHANGED");
  const legacy = input.id?.startsWith("legacy:");
  const id = !input.id || legacy ? randomUUID() : input.id;
  // The catalog above authorizes the project and scope. A project manager can
  // append a shared version without transferring ownership or duplicating it.
  const owner = existing.length && !legacy
    ? context.metadataStore.db.prepare("SELECT user_id FROM config_resources WHERE id = ? AND workspace_id = ? AND kind = 'skill'").get(id, context.workspaceId)
    : undefined;
  const ownerUserId = owner ? String(owner.user_id) : context.userId;
  const packageContent = Buffer.from(`---\nname: ${JSON.stringify(input.name)}\ndescription: "${category === "presentation" ? "Project report visual style" : "Reusable report analysis method"}"\ncategory: ${category}\nversion: ${JSON.stringify(input.version)}\n---\n${input.content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/, "")}`);
  input = { ...input, content: packageContent.toString("utf8") };
  const versions = [...existing.map(({ version, content, sourceRunId, sourceSessionId }) => ({ version, content, sourceRunId, sourceSessionId })), { version: input.version, content: input.content, ...source }];
  const parsed = await parseSkillPackage({ filename: "SKILL.md", content: packageContent });
  const { ref } = context.fileAssetService.createRef({ user_id: ownerUserId, workspace_id: context.workspaceId, source: "skill-package", filename: "SKILL.md", content: packageContent, declared_mime_type: "text/markdown" });
  const resource = context.metadataStore.configResources.upsert({ id, workspace_id: context.workspaceId, user_id: ownerUserId, kind: "skill", name: input.name,
    default_enabled: false, status: "valid", ...(!legacy && input.id ? { expected_revision: input.revision! } : {}),
    payload: { ...buildSkillResourcePayload({ packageFileRefId: ref.id, parsed, fields: { scope: input.scope === "project" ? "workspace" : "user" } }), reportProjectId: settings.projectId, reportSkillCategory: category, reportSkillVersions: versions },
  });
  return { id, name: input.name, version: input.version, content: input.content, scope: input.scope, projectId: settings.projectId, category, readOnly: false, isDefault: false, revision: resource.revision, ...source };
}
