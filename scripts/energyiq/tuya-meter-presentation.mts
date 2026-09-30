// Local integration helper. Run with: npx tsx scripts/energyiq/tuya-meter-presentation.mts plan <plan.json>
// After integration coordination: same command with apply <plan.json>.
// Requires ENERGYIQ_LOCAL_ACCESS_FILE; never prints credentials or raw setup documents.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { TUYA_OFFICE_METER_PRESENTATION } from "../../apps/api/src/energy/tuya-office-meter-presentation.js";

const [action, planPath] = process.argv.slice(2);
if (!["plan", "apply"].includes(action ?? "") || !planPath) throw Error("Expected plan|apply <plan.json>");
const origin = process.env.ENERGYIQ_LOCAL_API_ORIGIN ?? "http://127.0.0.1:18769";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw Error("Local integration only");
const credentials = JSON.parse(readFileSync(process.env.ENERGYIQ_LOCAL_ACCESS_FILE!, "utf8"));
const cookies = new Map<string, string>();
async function request(path: string, method = "GET", body?: unknown): Promise<any> {
  const headers = new Headers({"X-Workspace-Id":"tuya-office", Origin:"http://127.0.0.1:3000"});
  headers.set("Cookie", [...cookies].map(([k,v])=>`${k}=${v}`).join("; "));
  if (cookies.has("df_csrf")) headers.set("X-CSRF-Token", decodeURIComponent(cookies.get("df_csrf")!));
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(origin + path, {method,headers,...(body === undefined ? {} : {body:JSON.stringify(body)})});
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0]!; const index = pair.indexOf("=");
    cookies.set(pair.slice(0,index),pair.slice(index+1));
  }
  const result = await response.json();
  if (!response.ok || result.error) throw Error(`Request failed: ${method} ${path} (${response.status}, ${result.error?.code ?? "unknown"})`);
  return result.data;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const base = "/api/v1/energy/projects/tuya-office";
await request("/api/v1/auth/login", "POST", {email:credentials.email,password:credentials.password});
const state = await request(base + "/setup");
const document = structuredClone(state.draft.document);
const mapping = document.meter_mapping;
const meters = [...mapping.rows, ...(mapping.virtual_meters ?? [])];
if (meters.length !== 23 || new Set(meters.map(row=>row.id)).size !== 23 || meters.some(row=>!TUYA_OFFICE_METER_PRESENTATION[row.id])) throw Error("Tuya meter identity set changed; reverify source mapping");
// Refuse to publish unrelated setup work as a side effect.
const revision = state.published.revisions.find((item:any)=>item.id === state.project.hierarchy_revision_id);
if (!revision?.snapshot_json) throw Error("Published snapshot unavailable; verify published revision before proceeding");
const published = JSON.parse(revision.snapshot_json);
const unpublishedChanges = [...new Set([...Object.keys(published),...Object.keys(state.draft.document)])].filter(key=>!isDeepStrictEqual(published[key],state.draft.document[key]));
for (const row of meters) row.presentation = TUYA_OFFICE_METER_PRESENTATION[row.id];
const strip = (value:any) => { const copy=structuredClone(value); for(const row of [...copy.meter_mapping.rows,...(copy.meter_mapping.virtual_meters??[])]) delete row.presentation; return copy; };
if (!isDeepStrictEqual(strip(document),strip(state.draft.document))) throw Error("Unexpected non-presentation change");
const plan = {projectId:"tuya-office",origin,revision:state.draft.revision,unpublishedChanges,beforeHash:digest(state.draft.document),afterHash:digest(document),presentations:meters.map(({id,presentation}:any)=>({id,presentation}))};
if (action === "plan") {
  writeFileSync(planPath,JSON.stringify(plan,null,2));
  console.log(JSON.stringify({status:"planned",revision:plan.revision,meters:meters.length,unpublishedChanges,planPath}));
} else {
  const approved = JSON.parse(readFileSync(planPath,"utf8"));
  if (!isDeepStrictEqual(approved,plan)) throw Error("Plan is stale; regenerate and review against latest setup");
  if (unpublishedChanges.length) throw Error(`Unpublished setup changes exist (${unpublishedChanges.join(", ")}); reconcile before publication`);
  const [template,metric,rule] = await Promise.all([request(base+"/template-draft"),request(base+"/metric-config"),request(base+"/rule-config")]);
  const saved = await request(base+"/setup/draft","PUT",{expectedRevision:state.draft.revision,document});
  if (!isDeepStrictEqual(saved.draft.document,document)) throw Error("Saved draft differs; do not publish");
  const validation = await request(base+"/setup/validate","POST",{});
  if (validation.blocking) throw Error("Setup validation blocks publication");
  await request(base+"/setup/publish","POST",{expectedRevision:saved.draft.revision,expectedTemplateDraftRevision:template.draft.revision,expectedMetricConfigRevision:metric.config.revision,expectedRuleConfigRevision:rule.config.revision});
  const hierarchy = await request(base+"/hierarchy");
  for (const row of meters) {
    const visible = hierarchy.electricityMeters.find((meter:any)=>meter.id === row.id);
    if (visible?.displayGroup !== row.presentation.group || visible?.name !== (row.presentation.device_name || row.presentation.circuit_name)) throw Error("Published directory differs; verify publication pin");
  }
  console.log(JSON.stringify({status:"published_directory_verified",meters:meters.length,hierarchyRevision:hierarchy.project.hierarchy_revision_id}));
}
