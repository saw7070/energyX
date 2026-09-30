import { projectMeterNamingReadiness } from "../energy/energy-explorer-meters.js";
import { resolveEnergyProjectCapabilities } from "../energy/energy-project-capabilities.js";
import { inspectEnergyExcelWorkbook } from "../energy/energy-excel-import.js";
import { inspectEnergyTuyaArtifact } from "../energy/energy-tuya-import.js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { validateProjectSetupDocument, type MetadataStore, type EnergyIqProjectSetupDocument } from "@datafoundry/metadata";
import type { FileAssetService } from "@datafoundry/files";
import { readReportProjectData } from "./report-project-data.js";
import { authorizeReportProject } from "./report-inputs.js";
import { ReportStore, type ReportRun, type ReportSettings } from "./report-store.js";

const text = z.string().min(1);
const category = z.enum(["overall", "load", "light", "aircon", "other"]);
const resource = z.enum(["electricity", "water"]);
const object = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const presentation = object({ device_name: z.string().max(160).optional(), circuit_name: z.string().max(160).optional(), group: z.string().max(160).optional() }).optional();
const documentSchema = object({
  project: object({ name: text, timezone: text }), tier_structure_locked: z.boolean(),
  tiers: z.array(object({ id: text, ordinal: z.number().int(), alias: text, description: z.string().optional() })),
  nodes: z.array(object({ id: text, tier_definition_id: text, parent_id: text.optional(), name: text, sort_order: z.number().int(), area_sqm: z.number().nonnegative().optional(), occupant_count: z.number().nonnegative().optional(), metadata_status: z.enum(["provisional", "confirmed"]), effective_from: text.optional(), effective_to: text.optional(), independent_reason: z.string().optional(), metadata: z.record(z.string(), z.unknown()).optional() })),
  source_manifest: object({ id: text, source_sha256: z.array(z.string().regex(/^[a-f0-9]{64}$/i)).min(1), confirmed: z.boolean() }).optional(),
  meter_mapping: object({ schema_version: z.literal(2), source_kind: z.enum(["excel", "tuya"]), confirmed: z.boolean(),
    rows: z.array(object({ id: text, source_label: text, scope_id: text, navigation_scope_id: text.optional(), display_name: text, presentation, resource, category, coverage: z.enum(["whole", "partial", "reference"]), meter_role: z.enum(["total", "component", "standalone"]), aggregation_usage: z.enum(["official", "excluded"]) })),
    official_aggregation_routes: z.array(object({ scope_id: text, resource, category, meter_point_ids: z.array(text) })).optional(),
    virtual_meters: z.array(object({ id: text, display_name: text, presentation, scope_id: text, resource, category, terms: z.array(object({ mapping_row_id: text, coefficient: z.union([z.literal(1), z.literal(-1)]) })) })).optional(),
  }).optional(),
});
const owner = z.discriminatedUnion("kind", [object({ kind: z.literal("project") }), object({ kind: z.literal("scope"), scope_id: text })]);
const range = object({ from: text, to: text });
const day = z.array(range);
const calendarEntry = object({ id: text, owner, effective_from: text, effective_to: text.optional(), weekly: object({ monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day }), exceptions: z.array(object({ date: text, operating: day, label: text.optional(), classification: z.enum(["public_holiday", "special_closure", "special_operating_day"]).optional() })).optional() });
const academicPeriod = object({ id: text, from: text, to: text, phase: z.enum(["teaching", "term_break", "study_exam", "vacation"]), label: text.optional(), source: object({ label: text, url: text.optional() }) });
const tariffEntry = object({ id: text, owner, effective_from: text, effective_to: text.optional(), currency: text, rate_per_kwh: z.number().nonnegative(), rate_basis: z.enum(["tax_inclusive", "tax_exclusive"]).optional(), tax: object({ name: text, rate_pct: z.number().nonnegative() }).optional() });
export type ProjectLifecycle = {
  materialize: (batchId: string) => Promise<unknown>;
  publish: (revisions: Record<string, number>) => Promise<unknown>;
};
const schemas = {
  project_source_list: object({}),
  project_source_import: object({ attachmentIndex: z.number().int().min(1), sourceKind: z.enum(["excel", "tuya"]) }),
  project_source_materialize: object({ batchId: text }),
  project_setup_publish: object({expectedRevision: z.number().int().min(1), expectedTemplateDraftRevision: z.number().int().nonnegative(), expectedMetricConfigRevision: z.number().int().nonnegative(), expectedRuleConfigRevision: z.number().int().nonnegative()}),
  project_initialization_status: object({}),
  project_policy_read: object({}),
  project_policy_select: object({ calendarVersion: text.optional(), tariffVersion: text.optional(), expectedCalendarVersion: text.nullable(), expectedTariffVersion: text.nullable() }),
  project_calendar_save_revision: object({ expectedLatestVersion: text.nullable(), entries: z.array(calendarEntry).min(1), academicPeriods: z.array(academicPeriod) }),
  project_tariff_save_revision: object({ expectedLatestVersion: text.nullable(), entries: z.array(tariffEntry).min(1) }),
  project_setup_read: object({}),
  project_setup_save_draft: object({ expectedRevision: z.number().int().min(1), document: documentSchema }),
  project_context_read: object({}),
  project_context_update: object({ expectedRevision: z.number().int().nonnegative(), contextNotes: z.string().max(100000) }),
};
const descriptions: Record<keyof typeof schemas, string> = {
  project_policy_select: "Select this project's saved calendar and/or tariff for the next configuration publication. Read project_policy_read first and supply both expected active bindings (null when absent). This does not change the published report policy until project_setup_publish succeeds. Only select policies the administrator requested; preserve unrelated draft changes and read back publication status. Dates must use the project's timezone and exclusive end boundaries.",
  project_source_list: "List this conversation's selected attachments and this project's inspected import batches. Use the attachmentIndex to import a selected source, never invent file paths or IDs. Uploaded files are not readings until imported and materialized.",
  project_source_import: "Inspect and register a selected source attachment. Currently supports the existing Excel workbook and Tuya artifact formats. Ask about unsupported formats, units and ambiguous labels. Returns inspection, source hash and batch ID for the setup source_manifest. Duplicate bytes reuse the same project batch. Does not publish data.",
  project_source_materialize: "Materialize an inspected project batch through the existing canonical publication pipeline after saving a valid confirmed mapping and source_manifest. Read errors and resolve missing configuration. Never fabricate success. This changes published data and is only for requested project initialization or update. Use existing batch IDs from project_source_list.",
  project_setup_publish: "Publish the prepared project configuration through the same pipeline as Admin. Supply exact current revisions from project_setup_read. Only for requested initialization/update, after resolving missing information and materializing data; never for a report request alone. Preserves existing data and policy validation; failures mean publication is incomplete.",
  project_initialization_status: "Read this project's initialization checklist, draft structure counts, imported source count and actual published data availability. Start initialization here. Explain missing information and its impact to the administrator. Draft saved, source uploaded and data published are distinct states; do not claim a completed import or publication without evidence. Optional tariff, area and occupancy gaps do not block kWh analysis. This tool is read-only.",
  project_policy_read: "Read current and saved calendar/tariff revisions for this project. Read before modifying. Distinguish active bindings, published project versions, and inactive saved revisions.",
  project_calendar_save_revision: "Validate and save a new INACTIVE calendar revision. Read project_policy_read first; supply expectedLatestVersion (null if none), complete operating entries and all academicPeriods, preserving unrelated dates. School vacations/term breaks are academicPeriods, not public holidays and not automatically closures. Uses existing policy validation. Does not activate or publish the project.",
  project_tariff_save_revision: "Validate and save a new INACTIVE tariff revision with expectedLatestVersion from project_policy_read. Supply complete entries preserving unrelated scopes and dates. Use documented rates, currency and tax; never infer prices from meter readings. Does not activate or publish the project.",
  project_setup_read: "Read the bound project's current Admin Console setup draft, revision, validation and exact document schema. No credentials or other projects. Always read before editing.",
  project_setup_save_draft: "Validate and save the complete setup document as an unpublished draft using expectedRevision from project_setup_read. Retain unrelated fields. Never publishes or changes live meter routing. Revision conflict means reread before retry. Unknown fields are rejected; node.metadata is the documented custom metadata map.",
  project_context_read: "Read independent project explanation contextNotes and its ReportStore revision. This is separate from structural setup and reusable Skills.",
  project_context_update: "Save project explanation contextNotes with expectedRevision from project_context_read. Preserve existing spatial reference JSON and other notes unless explicitly updating them. A spatial reference is a fenced json block: schemaVersion:1, projectId (current project), provenance:{file,status}, layout:{viewBox:[x,y,width,height], zones:[{id,referenceBoard,rect?:[x,y,width,height],independentSpace?:false,physicalParentRoom?:roomName,equipment?:label}], rooms:[{name,zone,rect:[x,y,width,height]}]}. Use nonnegative finite coordinates within the viewBox; only use source-supported room geometry. Equipment subgroups use independentSpace:false and their actual parent room, not a fabricated separate space. It renders in Project Configuration and exports offline SVG/JSON to reports. It does not publish or override electrical mappings. Preserve all other report settings. Revision conflict means reread before retry.",
};
const forbiddenKeys = /^(?:projectid|workspaceid|actoruserid|userid|password|secret|accesssecret|clientsecret|apikey|accesskey|accesstoken|refreshtoken|authorization|cookie|credentials|devicebindings)$/;
function guardDocument(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.test(key.replace(/[_-]/g, "").toLowerCase())) throw Error("PROJECT_CONFIGURATION_FIELD_FORBIDDEN");
    guardDocument(child);
  }
}
const validationResult = (value: ReturnType<typeof validateProjectSetupDocument>) => ({ blocking: value.blocking, issues: value.issues.map(({ code, severity, path, message }) => ({ code, severity, message, ...(path ? { path } : {}) })) });

export function createProjectConfigurationTools(input: { canPublish?: boolean; metadata: MetadataStore; files?: FileAssetService; fileRefIds?: string[]; lifecycle?: ProjectLifecycle; run: Pick<ReportRun, "actorUserId" | "workspaceId" | "projectId"> }) {
  const { actorUserId, workspaceId, projectId } = input.run;
  const permissions = () => resolveEnergyProjectCapabilities({ metadataStore: input.metadata, userId: actorUserId, workspaceId, projectId });
  const adminTools = new Set(["project_setup_publish", "project_source_import", "project_source_materialize"]);
  const tools = (Object.keys(schemas) as Array<keyof typeof schemas>).filter(name => input.canPublish !== false || !adminTools.has(name)).map(name => ({ name, description: descriptions[name], parameters: z.toJSONSchema(schemas[name]) as Record<string, unknown> }));
  return { tools, async executeTool(name: string, args: unknown): Promise<unknown> {
    try {
      authorizeReportProject(input.metadata, actorUserId, workspaceId, projectId);
      if (adminTools.has(name) && !permissions().publishConfiguration) throw Error("PROJECT_CONFIGURATION_PUBLISH_FORBIDDEN");
      if (!Object.hasOwn(schemas, name)) throw Error("PROJECT_CONFIGURATION_TOOL_UNKNOWN");
      if (Buffer.byteLength(JSON.stringify(args) ?? "", "utf8") > 1024 * 1024) throw Error("PROJECT_CONFIGURATION_ARGUMENTS_INVALID");
      const policies = input.metadata.energyIq.operationalPolicy;
      if (name === "project_policy_select") {
        const body = schemas.project_policy_select.parse(args);
        const current = policies.getActivePolicyVersions(projectId);
        if ((current.business_calendar_version ?? null) !== body.expectedCalendarVersion || (current.tariff_schedule_version ?? null) !== body.expectedTariffVersion) throw Error("PROJECT_CONFIGURATION_POLICY_REVISION_CONFLICT");
        const selected = policies.activateProjectPolicies({ project_id: projectId, updated_by: actorUserId,
          ...(body.calendarVersion ? { business_calendar_version: body.calendarVersion } : {}),
          ...(body.tariffVersion ? { tariff_schedule_version: body.tariffVersion } : {}),
        });
        return { ok: true, status: "selected_for_publication", published: false, selected, nextStep: "Read project_setup_read, verify the full draft is intended, then use project_setup_publish with its exact revisions. Read project_policy_read afterwards to verify published versions." };
      }
      if (name === "project_source_list") {
        schemas.project_source_list.parse(args);
        const attachments = (input.fileRefIds ?? []).map((id, index) => {
          if (!input.files) throw Error("REPORT_FILE_SERVICE_UNAVAILABLE");
          const {ref} = input.files.getRef({user_id: actorUserId, workspace_id: workspaceId, id});
          return {attachmentIndex: index + 1, filename: ref.filename};
        });
        return {ok:true, attachments, batches: input.metadata.energyIq.listImportBatches(projectId).map(batch => ({id:batch.id, filename:batch.filename, sourceKind:batch.source_kind, sourceSha256:batch.source_sha256, status:batch.status, inspection:batch.inspection_json}))};
      }
      if (name === "project_source_import") {
        const body = schemas.project_source_import.parse(args);
        const id = input.fileRefIds?.[body.attachmentIndex - 1];
        if (!id || !input.files) throw Error("REPORT_SOURCE_ATTACHMENT_REQUIRED");
        const {ref} = input.files.getRef({user_id:actorUserId, workspace_id:workspaceId, id});
        const {body: content} = input.files.readRef({user_id:actorUserId, workspace_id:workspaceId, id});
        if (content.length > 200 * 1024 * 1024) throw Error("REPORT_ATTACHMENTS_TOO_LARGE");
        if (body.sourceKind === "excel" && !ref.filename.toLowerCase().endsWith(".xlsx")) throw Error("REPORT_SOURCE_FORMAT_UNSUPPORTED");
        const hash = createHash("sha256").update(content).digest("hex");
        const existing = input.metadata.energyIq.findImportBatchBySha({project_id:projectId,source_sha256:hash});
        if (existing) return {ok:true,duplicate:true,batchId:existing.id,sourceSha256:hash,status:existing.status};
        const inspection = body.sourceKind === "excel" ? await inspectEnergyExcelWorkbook(content) : inspectEnergyTuyaArtifact(content);
        authorizeReportProject(input.metadata,actorUserId,workspaceId,projectId);
        const batch = input.metadata.energyIq.createImportBatch({id:`energy-import-${randomUUID()}`,workspace_id:workspaceId,project_id:projectId,source_kind:body.sourceKind,source_sha256:hash,filename:ref.filename,file_asset_ref_id:id,status:"inspected",inspection,created_by:actorUserId});
        return {ok:true,duplicate:false,batchId:batch.id,sourceSha256:hash,status:batch.status,inspection};
      }
      if (name === "project_source_materialize") {
        const body = schemas.project_source_materialize.parse(args);
        if (!input.metadata.energyIq.listImportBatches(projectId).some(batch => batch.id === body.batchId)) throw Error("REPORT_PROJECT_SOURCE_FORBIDDEN");
        if (!input.lifecycle) throw Error("REPORT_PROJECT_LIFECYCLE_UNAVAILABLE");
        return await input.lifecycle.materialize(body.batchId);
      }
      if (name === "project_setup_publish") {
        const body = schemas.project_setup_publish.parse(args);
        if (!input.lifecycle) throw Error("REPORT_PROJECT_LIFECYCLE_UNAVAILABLE");
        return await input.lifecycle.publish(body);
      }
      if (name === "project_initialization_status") {
        schemas.project_initialization_status.parse(args);
        const project = input.metadata.energyIq.getProject(projectId);
        const draft = input.metadata.energyIq.projectSetup.getDraft({ project_id: projectId, user_id: actorUserId });
        const validation = input.metadata.energyIq.projectSetup.validateDraft(projectId);
        const batches = input.metadata.energyIq.listImportBatches(projectId);
        const data = await readReportProjectData(input.metadata, actorUserId, workspaceId, projectId);
        const nodes = draft.document.nodes;
        const mapping = draft.document.meter_mapping;
        const naming = projectMeterNamingReadiness(draft.document);
        const bindings = policies.getActivePolicyVersions(projectId);
        const needs: Array<{ code: string; requiredFor: string; message: string }> = [];
        if (!batches.length && data.status === "not_configured") needs.push({ code: "SOURCE_DATA_NEEDED", requiredFor: "data_analysis", message: "Provide a data file or API connection materials. Uploading a document alone does not import readings." });
        if (!nodes.length || !mapping?.rows.length) needs.push({ code: "STRUCTURE_AND_MAPPING_NEEDED", requiredFor: "publication", message: "Build the project structure and meter mapping from source evidence. Ask for unknown locations or relationships." });
        if (mapping?.rows.length && !mapping.confirmed) needs.push({ code: "MAPPING_UNCONFIRMED", requiredFor: "publication", message: "The meter mapping is a draft. Resolve ambiguous assignments and aggregation routes before publication." });
        if (!naming.ready) needs.push({ code: "METER_NAMES_NEEDED", requiredFor: "report_generation", message: naming.question });
        if (validation.blocking) needs.push({ code: "DRAFT_VALIDATION_BLOCKED", requiredFor: "publication", message: "The setup draft has blocking validation issues. Read project_setup_read for the specific fields and resolve them." });
        if (data.status !== "connected") needs.push({ code: "PUBLISHED_DATA_UNAVAILABLE", requiredFor: "data_analysis", message: data.reason ?? "No readable published measurements are available." });
        if (!bindings.tariff_schedule_version) needs.push({ code: "TARIFF_NEEDED", requiredFor: "cost_analysis_only", message: "A verified electricity price is needed for cost analysis. Energy analysis can proceed without it." });
        if (!bindings.business_calendar_version) needs.push({ code: "OPERATING_HOURS_NEEDED", requiredFor: "after_hours_analysis_only", message: "Provide actual operating hours before labelling use as outside operating hours. Do not assume school holidays or closures." });
        const unconfirmed = nodes.filter(node => node.metadata_status !== "confirmed").length;
        if (unconfirmed) needs.push({ code: "PROJECT_FACTS_UNCONFIRMED", requiredFor: "normalised_analysis_only", message: `${unconfirmed} nodes have provisional metadata. Verify area and occupancy before using them for normalised metrics.` });
        return { ok: true, status: data.status === "connected" ? "published_data_available" : !batches.length ? "awaiting_source_data" : "configuration_in_progress",
          project: { name: project.name, status: project.status, hasUnpublishedChanges: project.has_unpublished_changes },
          draft: { revision: draft.revision, tierCount: draft.document.tiers.length, nodeCount: nodes.length, meterCount: mapping?.rows.length ?? 0, unconfirmedNodeCount: unconfirmed, validation: validationResult(validation) },
          importedBatchCount: batches.length, data, needs, meterNaming: naming,
          nextStep: "Explain completed steps and missing inputs. Only use available tools; if import or publication cannot be performed here, explicitly say that it remains incomplete. Never infer account access or schedule activation from project creation." };
      }

      if (name === "project_policy_read") {
        schemas.project_policy_read.parse(args);
        const project = input.metadata.energyIq.getProject(projectId);
        const published = input.metadata.energyIq.templates.getLatestProjectRevision(projectId);
        return { ok: true, activeBindings: policies.getActivePolicyVersions(projectId), published: { tariffVersion: published?.tariff_schedule_version ?? project.tariff_schedule_version, calendarVersion: published?.business_calendar_version ?? project.business_calendar_version }, tariffRevisions: policies.listTariffSchedules(projectId), calendarRevisions: policies.listOperatingCalendars(projectId) };
      }
      if (name === "project_calendar_save_revision") {
        const body = schemas.project_calendar_save_revision.parse(args);
        if ((policies.listOperatingCalendars(projectId)[0]?.version_id ?? null) !== body.expectedLatestVersion) throw Error("PROJECT_CONFIGURATION_POLICY_REVISION_CONFLICT");
        const revision = policies.publishOperatingCalendar({ version_id: `calendar-${randomUUID()}`, project_id: projectId, entries: JSON.parse(JSON.stringify(body.entries)), academic_periods: JSON.parse(JSON.stringify(body.academicPeriods)), published_by: actorUserId, activate: false });
        return { ok: true, status: "saved_inactive_revision", active: false, revision, message: "Saved for review. Existing calendar remains effective; activate through the project publication workflow." };
      }
      if (name === "project_tariff_save_revision") {
        const body = schemas.project_tariff_save_revision.parse(args);
        if ((policies.listTariffSchedules(projectId)[0]?.version_id ?? null) !== body.expectedLatestVersion) throw Error("PROJECT_CONFIGURATION_POLICY_REVISION_CONFLICT");
        const revision = policies.publishTariffSchedule({ version_id: `tariff-${randomUUID()}`, project_id: projectId, entries: JSON.parse(JSON.stringify(body.entries)), published_by: actorUserId, activate: false });
        return { ok: true, status: "saved_inactive_revision", active: false, revision, message: "Saved for review. Existing tariff remains effective; activate through the project publication workflow." };
      }
      if (name === "project_setup_read") {
        schemas.project_setup_read.parse(args);
        const draft = input.metadata.energyIq.projectSetup.getDraft({ project_id: projectId, user_id: actorUserId }); guardDocument(draft.document);
        const project = input.metadata.energyIq.getProject(projectId);
        return { ok: true, status: "draft", revision: draft.revision, document: draft.document, validation: validationResult(input.metadata.energyIq.projectSetup.validateDraft(projectId)), documentSchema: z.toJSONSchema(documentSchema), published: false,
          identifierRules: {namespace:projectId+"-",rootScopeId:project.root_scope_id,instructions:"The Project root is created by the system; do not include it in nodes. New node IDs must be unique across projects: prefix new IDs with namespace, preserve existing IDs when editing. Tier ordinals run bottom-up: 1 is the deepest tier, highest is directly below Project. Highest-tier nodes have no parent_id; other nodes reference the next-higher tier."},
          mappingRules: ["Official aggregation routes are explicit meter sets, not a sum of every parent and child meter.", "Routes must cover all required analytical scopes and the reserved project scope id 'project'. Keep the actual project root node too.", "Each non-excluded physical meter requires an own navigation-scope/resource/category route including that meter. Use separate navigation scopes where total and submeter routes overlap; retain submeter visibility without adding it to parent official totals.", "Use validation issue messages and paths to correct the complete draft; never fabricate meter hierarchy to hide unknown relationships."],
          publicationRevisions: {expectedRevision:draft.revision,
            expectedTemplateDraftRevision:input.metadata.energyIq.templates.getProjectDraft({project_id:projectId,tier_definition_ids:draft.document.tiers.map(tier=>tier.id)}).revision,
            expectedMetricConfigRevision:input.metadata.energyIq.metrics.getProjectConfig(projectId).revision,
            expectedRuleConfigRevision:input.metadata.energyIq.rules.getProjectConfig(projectId).revision},
          activeProject: { status: project.status, hasUnpublishedChanges: project.has_unpublished_changes, hierarchyRevisionId: project.hierarchy_revision_id, dataSnapshotId: project.data_snapshot_id },
          canPublish: permissions().publishConfiguration, publicationNote: "Project administrators edit and publish configuration; everyone else reads charts and reports. This response edits the draft document. published:false does not mean the project has no active published version; inspect activeProject. Saving a draft leaves the existing published version active." };
      }
      if (name === "project_setup_save_draft") {
        guardDocument(args);
        const body = schemas.project_setup_save_draft.parse(args);
        // JSON transport omits optional undefined fields after strict shape validation.
        const document: EnergyIqProjectSetupDocument = JSON.parse(JSON.stringify(body.document));
        const collisions = document.nodes.filter(node => input.metadata.db.prepare("SELECT 1 FROM energyiq_project_nodes WHERE id = ? AND project_id <> ?").get(node.id, projectId)).map(node=>node.id);
        if (collisions.length) return {ok:false,code:"PROJECT_CONFIGURATION_NODE_ID_CONFLICT",submittedIds:collisions,message:"Prefix new node IDs and references with the current project ID. Do not rename existing nodes in other projects."};
        // Same semantic validation and canonical save service used by Project Setup.
        const validation = validateProjectSetupDocument(document);
        if (validation.blocking) return { ok: false, code: "PROJECT_CONFIGURATION_DRAFT_INVALID", validation: validationResult(validation) };
        const ownSources = new Set(input.metadata.energyIq.listImportBatches(projectId).map(batch => batch.source_sha256.toLowerCase()));
        if (document.source_manifest?.source_sha256.some(sha => !ownSources.has(sha.toLowerCase()))) throw Error("PROJECT_CONFIGURATION_SOURCE_FORBIDDEN");
        const draft = input.metadata.energyIq.projectSetup.saveDraft({ project_id: projectId, user_id: actorUserId, expected_revision: body.expectedRevision, document });
        return { ok: true, status: "saved", kind: "draft", revision: draft.revision, document: draft.document, validation: validationResult(input.metadata.energyIq.projectSetup.validateDraft(projectId)), published: false };
      }
      const store = new ReportStore(input.metadata.db);
      const project = input.metadata.energyIq.getProject(projectId);
      const settings: ReportSettings = store.settings(projectId) ?? { projectId, workspaceId, actorUserId, timezone: project.timezone, contextNotes: "", fileRefIds: [], useProjectData: true, skill: "", revision: 0, frequency: "off", localHour: 3, scheduledPrompt: "" };
      if (settings.workspaceId !== workspaceId) throw Error("REPORT_PROJECT_FORBIDDEN");
      if (name === "project_context_read") {
        schemas.project_context_read.parse(args);
        return { ok: true, status: "read", revision: settings.revision, contextNotes: settings.contextNotes };
      }
      const body = schemas.project_context_update.parse(args);
      const saved = store.saveSettings({ ...settings, revision: body.expectedRevision, contextNotes: body.contextNotes });
      return { ok: true, status: "saved", kind: "project_context", revision: saved.revision, contextNotes: saved.contextNotes };
    } catch (error) {
      if (error instanceof z.ZodError) return {ok:false,code:"PROJECT_CONFIGURATION_ARGUMENTS_INVALID",issues:error.issues.map(issue=>({path:issue.path,message:issue.message}))};
      if (error instanceof Error && !/^(?:PROJECT_CONFIGURATION_|REPORT_|ENERGYIQ_)/.test(error.message)) console.error("[project-tool]", name, error.name, error.stack?.split("\n").slice(1,5).join("\n"));
      const raw = error instanceof Error ? error.message.split(":")[0] : "";
      if (raw === "ENERGYIQ_TARIFF_TAX_BASIS_INCOMPLETE") return { ok: false, code: raw, message: "The supplied tax basis requires documented tax details. Ask the user for the missing tax name and percentage; do not assume a country's default rate. No revision was saved." };
      return { ok: false, code: error instanceof z.ZodError ? "PROJECT_CONFIGURATION_ARGUMENTS_INVALID" : raw && /^(?:PROJECT_CONFIGURATION_|REPORT_|ENERGYIQ_)[A-Z0-9_]+$/.test(raw) ? raw : "PROJECT_CONFIGURATION_FAILED" };
    }
  } };
}
