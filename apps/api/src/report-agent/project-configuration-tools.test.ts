import { LocalFileAssetService } from "@datafoundry/files";
import { vi, afterEach, expect, it } from "vitest";
import { createMetadataStore, type MetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectConfigurationTools } from "./project-configuration-tools.js";
import { ReportStore } from "./report-store.js";
import { buildTuyaOfficeSetup } from "../energy/tuya-office-project.js";
const cleanup: Array<() => void> = [];
afterEach(() => { for (const action of cleanup.splice(0)) action(); });
it("lets a member read the setup but refuses every change, whatever project access row they hold", async () => {
  const { metadata, run } = fixture();
  metadata.workspaceMemberships.upsert({ workspace_id: "workspace", user_id: "outsider", role: "member" });
  metadata.energyIq.upsertProjectAccess({ project_id: "project", user_id: "outsider", role: "editor" });
  const tools = createProjectConfigurationTools({ metadata, canPublish: false, run: { ...run, actorUserId: "outsider" } });
  expect(tools.tools.map(tool => tool.name)).not.toContain("project_setup_publish");
  // A member cannot read or change the project's setup through the advisor; the project pages show it read-only.
  expect(await tools.executeTool("project_setup_read", {})).toMatchObject({ ok: false });
  // Only administrators change a project; a member asks the advisor and reads.
  for (const name of ["project_setup_save_draft", "project_setup_publish", "project_source_import", "project_source_materialize"]) expect(await tools.executeTool(name, {})).toMatchObject({ ok: false });
  metadata.workspaceMemberships.remove({ workspace_id: "workspace", user_id: "outsider" });
  expect(await tools.executeTool("project_setup_read", {})).toMatchObject({ ok: false, code: "REPORT_PROJECT_FORBIDDEN" });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "project-config-tools-")); const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  cleanup.push(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });
  for (const id of ["admin", "outsider"]) metadata.users.upsertDevUser({ id, email: `${id}@example.test`, display_name: id, dev_token: id });
  metadata.energyIq.upsertUserRole({ user_id: "admin", role: "admin" });
  for (const id of ["workspace", "foreign"]) metadata.workspaces.upsert({ id, owner_user_id: "admin", name: id, kind: "customer" });
  for (const [id, workspace_id] of [["project", "workspace"], ["other", "foreign"]]) metadata.energyIq.upsertProject({ id: id!, workspace_id: workspace_id!, name: id!, status: "published" });
  const store = new ReportStore(metadata.db);
  const settings = store.saveSettings({ projectId: "project", workspaceId: "workspace", actorUserId: "source-owner", timezone: "Asia/Singapore", contextNotes: "initial", fileRefIds: ["existing-supplement"], useProjectData: false, skill: "keep method", skillRefs: [{ name: "Existing analysis", version: "v1", content: "Keep saved Skill" }], revision: 0, frequency: "daily", localHour: 3, scheduledPrompt: "keep schedule" });
  const run = { actorUserId: "admin", workspaceId: "workspace", projectId: "project" };
  const tools = createProjectConfigurationTools({ metadata, run });
  return { root, metadata, store, settings, run, ...tools };
}
it("constructs plain tool definitions without reading or authorizing metadata", () => {
  const metadata = new Proxy({}, { get: () => { throw Error("MUST_NOT_READ"); } }) as MetadataStore;
  const tools = createProjectConfigurationTools({ metadata, run: { actorUserId: "u", workspaceId: "w", projectId: "p" } });
  expect(tools.tools).toHaveLength(13);
  expect(JSON.parse(JSON.stringify(tools.tools))[1].parameters.additionalProperties).toBe(false);
});
it("round trips a valid structure/meter/virtual draft through the existing store without publishing", async () => {
  const { metadata, executeTool } = fixture();
  const before = metadata.energyIq.getProject("project");
  const initial = await executeTool("project_setup_read", {}) as any;
  expect(initial).toMatchObject({ ok: true, status: "draft", published: false });
  expect(initial.activeProject.status).toBe("published");
  expect(initial.documentSchema.properties.meter_mapping.properties.virtual_meters).toBeDefined();
  const document = buildTuyaOfficeSetup(); document.project.name = "Updated Office";
  const saved = await executeTool("project_setup_save_draft", { expectedRevision: initial.revision, document }) as any;
  expect(saved).toMatchObject({ ok: true, status: "saved", kind: "draft", revision: initial.revision + 1, published: false, document: { project: { name: "Updated Office" } } });
  const reread = await executeTool("project_setup_read", {}) as any;
  expect(reread.document).toEqual(saved.document);
  expect(reread.document.meter_mapping.rows[0].presentation).toEqual(document.meter_mapping!.rows[0]!.presentation);
  expect(reread.document.meter_mapping.virtual_meters[0].presentation).toEqual(document.meter_mapping!.virtual_meters![0]!.presentation);
  expect(metadata.energyIq.projectSetup.getDraft({ project_id: "project", user_id: "admin" }).document).toEqual(saved.document);
  expect(metadata.energyIq.getProject("project").hierarchy_revision_id).toBe(before.hierarchy_revision_id);
  expect(metadata.energyIq.getProject("project").data_snapshot_id).toBe(before.data_snapshot_id);
  expect(await executeTool("project_setup_save_draft", { expectedRevision: initial.revision, document })).toEqual({ ok: false, code: "ENERGYIQ_SETUP_REVISION_CONFLICT" });
});
it("rejects invalid drafts and unknown fields without advancing draft revision", async () => {
  const { executeTool } = fixture(); const initial = await executeTool("project_setup_read", {}) as any;
  const document = buildTuyaOfficeSetup(); document.nodes[0]!.parent_id = "missing-scope";
  expect(await executeTool("project_setup_save_draft", { expectedRevision: initial.revision, document })).toMatchObject({ ok: false, code: "PROJECT_CONFIGURATION_DRAFT_INVALID" });
  expect(await executeTool("project_setup_save_draft", { expectedRevision: initial.revision, document: { ...buildTuyaOfficeSetup(), unknown: true } })).toMatchObject({ ok: false, code: "PROJECT_CONFIGURATION_ARGUMENTS_INVALID", issues: expect.any(Array) });
  expect((await executeTool("project_setup_read", {}) as any).revision).toBe(initial.revision);
});
it("keeps server identity fixed and rechecks authorization on each tool call", async () => {
  const { metadata, run, executeTool } = fixture();
  expect(await executeTool("project_setup_read", { projectId: "other" })).toMatchObject({ ok: false, code: "PROJECT_CONFIGURATION_ARGUMENTS_INVALID", issues: expect.any(Array) });
  expect(await createProjectConfigurationTools({ metadata, run: { ...run, projectId: "other" } }).executeTool("project_setup_read", {})).toEqual({ ok: false, code: "REPORT_PROJECT_FORBIDDEN" });
  run.projectId = "other"; // Mutating the caller's object cannot retarget an existing tool closure.
  expect(await executeTool("project_context_read", {})).toMatchObject({ ok: true, contextNotes: "initial" });
  metadata.energyIq.upsertUserRole({ user_id: "admin", role: "user" });
  expect(await executeTool("project_context_update", { expectedRevision: 1, contextNotes: "forged" })).toEqual({ ok: false, code: "REPORT_PROJECT_FORBIDDEN" });
});
it("updates independent project notes with revision checks and preserves all other settings", async () => {
  const { executeTool, store, settings, metadata } = fixture();
  const draft = metadata.energyIq.projectSetup.getDraft({ project_id: "project", user_id: "admin" });
  expect(await executeTool("project_context_read", {})).toEqual({ ok: true, status: "read", revision: 1, contextNotes: "initial" });
  expect(await executeTool("project_context_update", { expectedRevision: 1, contextNotes: "Business hours 09:00-18:00" })).toEqual({ ok: true, status: "saved", kind: "project_context", revision: 2, contextNotes: "Business hours 09:00-18:00" });
  expect(store.settings("project")).toEqual({ ...settings, revision: 2, contextNotes: "Business hours 09:00-18:00" });
  expect(await executeTool("project_context_update", { expectedRevision: 1, contextNotes: "stale" })).toEqual({ ok: false, code: "REPORT_SETTINGS_CHANGED" });
  expect(await executeTool("project_context_update", { expectedRevision: 2, contextNotes: "bad", userId: "outsider" })).toMatchObject({ ok: false, code: "PROJECT_CONFIGURATION_ARGUMENTS_INVALID", issues: expect.any(Array) });
  expect(metadata.energyIq.projectSetup.getDraft({ project_id: "project", user_id: "admin" })).toEqual(draft);
});
it("rejects credential fields and foreign source manifests with stable errors", async () => {
  const { executeTool } = fixture(); const initial = await executeTool("project_setup_read", {}) as any;
  const document = buildTuyaOfficeSetup(); document.nodes[0]!.metadata = { access_secret: "DO_NOT_ECHO" };
  expect(await executeTool("project_setup_save_draft", { expectedRevision: initial.revision, document })).toEqual({ ok: false, code: "PROJECT_CONFIGURATION_FIELD_FORBIDDEN" });
  delete document.nodes[0]!.metadata;
  document.source_manifest = { id: "foreign", source_sha256: ["a".repeat(64)], confirmed: true };
  expect(await executeTool("project_setup_save_draft", { expectedRevision: initial.revision, document })).toEqual({ ok: false, code: "PROJECT_CONFIGURATION_SOURCE_FORBIDDEN" });
  expect(await executeTool("publish", {})).toEqual({ ok: false, code: "PROJECT_CONFIGURATION_TOOL_UNKNOWN" });
});

it("saves validated policy revisions without activating, rejects stale writes and foreign ownership", async () => {
  const { metadata, executeTool } = fixture();
  const weekly = { monday: [{ from: "09:00", to: "18:00" }], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] };
  const body = { expectedLatestVersion: null, entries: [{ id: "office", owner: { kind: "project" }, effective_from: "2026-01-01", weekly }], academicPeriods: [{ id: "break", from: "2026-09-07", to: "2026-09-11", phase: "term_break", source: { label: "Test fixture only" } }] };
  expect(await executeTool("project_calendar_save_revision", body)).toMatchObject({ ok: true, active: false, revision: { academic_periods: body.academicPeriods } });
  expect(await executeTool("project_calendar_save_revision", body)).toMatchObject({ ok: false, code: "PROJECT_CONFIGURATION_POLICY_REVISION_CONFLICT" });
  const tariff = { expectedLatestVersion: null, entries: [{ id: "rate", owner: { kind: "project" }, effective_from: "2026-01-01", currency: "SGD", rate_per_kwh: 0.3 }] };
  expect(await executeTool("project_tariff_save_revision", tariff)).toMatchObject({ ok: true, active: false });
  expect(await executeTool("project_tariff_save_revision", tariff)).toMatchObject({ ok: false, code: "PROJECT_CONFIGURATION_POLICY_REVISION_CONFLICT" });
  const read = await executeTool("project_policy_read", {}) as any;
  expect(read.calendarRevisions).toHaveLength(1); expect(read.tariffRevisions).toHaveLength(1);
  expect(metadata.energyIq.operationalPolicy.getActivePolicyVersions("project")).toEqual({});
  expect(await executeTool("project_tariff_save_revision", { ...tariff, expectedLatestVersion: read.tariffRevisions[0].version_id, entries: [{ ...tariff.entries[0], owner: { kind: "scope", scope_id: "foreign" } }] })).toMatchObject({ ok: false });
  expect(metadata.energyIq.operationalPolicy.listTariffSchedules("project")).toHaveLength(1);
});

it("explains incomplete initialization without calling a published shell ready", async () => {
  const {executeTool} = fixture();
  const status = await executeTool("project_initialization_status", {}) as any;
  expect(status).toMatchObject({ok:true,status:"awaiting_source_data",importedBatchCount:0,data:{status:"not_configured"}});
  expect(status.needs).toEqual(expect.arrayContaining([
    expect.objectContaining({code:"SOURCE_DATA_NEEDED",requiredFor:"data_analysis"}),
    expect.objectContaining({code:"TARIFF_NEEDED",requiredFor:"cost_analysis_only"}),
    expect.objectContaining({code:"OPERATING_HOURS_NEEDED",requiredFor:"after_hours_analysis_only"}),
  ]));
  expect(await executeTool("project_initialization_status", {projectId:"other"})).toMatchObject({ok:false,code:"PROJECT_CONFIGURATION_ARGUMENTS_INVALID"});
});
it("does not expose initialization state after administrator access is revoked", async () => {
  const {metadata, executeTool} = fixture();
  metadata.energyIq.upsertUserRole({user_id:"admin",role:"user"});
  expect(await executeTool("project_initialization_status", {})).toEqual({ok:false,code:"REPORT_PROJECT_FORBIDDEN"});
});

it("keeps lifecycle operations project-bound and propagates failed publication without false success", async () => {
  const {metadata,run} = fixture();
  const materialize = vi.fn(); const publish = vi.fn().mockRejectedValue(Error("ENERGYIQ_SETUP_REVISION_CONFLICT"));
  const {executeTool} = createProjectConfigurationTools({metadata,run,lifecycle:{materialize,publish}});
  expect(await executeTool("project_source_materialize", {batchId:"another-project-batch"})).toMatchObject({ok:false,code:"REPORT_PROJECT_SOURCE_FORBIDDEN"});
  expect(materialize).not.toHaveBeenCalled();
  expect(await executeTool("project_setup_publish", {expectedRevision:1,expectedTemplateDraftRevision:0,expectedMetricConfigRevision:0,expectedRuleConfigRevision:0})).toMatchObject({ok:false,code:"ENERGYIQ_SETUP_REVISION_CONFLICT"});
});
it("never imports an arbitrary file reference or server path", async () => {
  const {executeTool} = fixture();
  expect(await executeTool("project_source_import", {attachmentIndex:1,sourceKind:"excel"})).toMatchObject({ok:false,code:"REPORT_SOURCE_ATTACHMENT_REQUIRED"});
  expect(await executeTool("project_source_import", {attachmentIndex:1,sourceKind:"excel",path:"other.xlsx"})).toMatchObject({ok:false,code:"PROJECT_CONFIGURATION_ARGUMENTS_INVALID"});
});

it("imports a real Ngee Ann workbook once and returns source evidence for mapping", async () => {
  const {root,metadata,run} = fixture();
  const files = new LocalFileAssetService(metadata,{storageRoot:join(root,"files")});
  const {ref} = files.createRef({user_id:run.actorUserId,workspace_id:run.workspaceId,filename:"source.xlsx",source:"upload",content:readFileSync("docs/template/Net-Zero Product/Ngee Ann Poly Level 6 (19 May - 17 June).xlsx"),declared_mime_type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const {executeTool} = createProjectConfigurationTools({metadata,run,files,fileRefIds:[ref.id]});
  const imported = await executeTool("project_source_import",{attachmentIndex:1,sourceKind:"excel"}) as any;
  expect(imported).toMatchObject({ok:true,duplicate:false,status:"inspected"});
  expect(imported.inspection.validRowCount).toBeGreaterThan(0);
  expect(imported.inspection.sourceLabels.length).toBeGreaterThan(1);
  expect(await executeTool("project_source_import",{attachmentIndex:1,sourceKind:"excel"})).toMatchObject({ok:true,duplicate:true,batchId:imported.batchId});
  expect(metadata.energyIq.listImportBatches(run.projectId)).toHaveLength(1);
  expect(metadata.energyIq.findCurrentDataSnapshot(run.projectId)).toBeUndefined();
});
it("rejects new node IDs already owned by another project without changing either draft",async()=>{
 const {metadata,executeTool}=fixture();const document=buildTuyaOfficeSetup();const node=document.nodes[0]!;
 metadata.energyIq.upsertProjectNode({id:node.id,project_id:"other",name:"Private other node",node_type:"space"});
 const before=metadata.energyIq.projectSetup.getDraft({project_id:"project",user_id:"admin"});
 expect(await executeTool("project_setup_save_draft",{expectedRevision:before.revision,document})).toMatchObject({ok:false,code:"PROJECT_CONFIGURATION_NODE_ID_CONFLICT",submittedIds:[node.id]});
 expect(metadata.energyIq.projectSetup.getDraft({project_id:"project",user_id:"admin"}).revision).toBe(before.revision);
 expect(metadata.energyIq.listProjectNodes("other")[0]?.name).toBe("Private other node");
});

it("selects saved policies with conflict and project isolation checks", async () => {
  const { metadata, executeTool } = fixture();
  const saved = await executeTool("project_tariff_save_revision", { expectedLatestVersion: null, entries: [{ id: "rate", owner: {kind: "project"}, effective_from: "2026-01-01", currency: "SGD", rate_per_kwh: 0.3 }] }) as any;
  const args = { tariffVersion: saved.revision.version_id, expectedCalendarVersion: null, expectedTariffVersion: null };
  expect(await executeTool("project_policy_select", args)).toMatchObject({ok:true,published:false,status:"selected_for_publication"});
  expect(await executeTool("project_policy_select", args)).toMatchObject({ok:false,code:"PROJECT_CONFIGURATION_POLICY_REVISION_CONFLICT"});
  const foreign = createProjectConfigurationTools({metadata, run:{actorUserId:"admin",workspaceId:"foreign",projectId:"other"}});
  expect(await foreign.executeTool("project_policy_select", args)).toMatchObject({ok:false});
  expect(metadata.energyIq.operationalPolicy.getActivePolicyVersions("other")).toEqual({});
});
