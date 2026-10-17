import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createSuccessResult } from "@datafoundry/contracts";
import type { MetadataStore, UserRecord } from "@datafoundry/metadata";

import { createMailDelivery } from "../email/mail-delivery.js";
import { DEFAULT_REPORT_AGENT_IMAGE, resolvePiReportModel } from "../report-agent/pi-report-harness.js";
import { readReportProjectData } from "../report-agent/report-project-data.js";
import type { ConfigApiContext, ConfigApiResponse } from "../routes/types.js";
import { resolveEnergyAccessContext } from "./energy-query-context.js";

/**
 * GET admin/system-health: one page that says whether the things EnergyX depends on are working, so an
 * administrator does not have to read server logs to find out why the advisor or a site's data stopped.
 */
export type HealthStatus = "ok" | "warning" | "problem";
export type HealthCheck = { id: string; group: string; title: string; status: HealthStatus; detail: string; fix?: string };
export type SystemHealth = { checkedAt: string; checks: HealthCheck[] };

const run = promisify(execFile);
type Exec = (file: string, args: string[]) => Promise<unknown>;
const defaultExec: Exec = (file, args) => run(file, args, { env: { PATH: process.env.PATH, HOME: process.env.HOME }, timeout: 8000 });

export const reportAgentImage = (env: NodeJS.ProcessEnv = process.env) => env.ENERGYIQ_REPORT_AGENT_IMAGE ?? DEFAULT_REPORT_AGENT_IMAGE;

/** Whether this server can start the advisor's worker: the advisor is switched on, Docker answers and the image exists. */
export async function checkAdvisorWorker(env: NodeJS.ProcessEnv = process.env, exec: Exec = defaultExec): Promise<HealthCheck> {
  const base = { id: "advisor-worker", group: "AI advisor", title: "Advisor worker" };
  if (env.ENERGYIQ_REPORT_AGENT_ENABLED !== "true") return { ...base, status: "warning", detail: "The advisor and AI reports are switched off on this server.", fix: "Set ENERGYIQ_REPORT_AGENT_ENABLED=true in the API settings and restart it." };
  if ((env.ENERGYIQ_REPORT_AGENT_HARNESS ?? "pi") !== "pi") return { ...base, status: "problem", detail: "No advisor worker is configured on this server.", fix: "Unset ENERGYIQ_REPORT_AGENT_HARNESS or set it to pi." };
  const image = reportAgentImage(env);
  try { await exec("docker", ["version", "--format", "{{.Server.Version}}"]); }
  catch { return { ...base, status: "problem", detail: "Docker is not running or cannot be reached, so the advisor cannot answer.", fix: "Start Docker on the server, then refresh this page." }; }
  try { await exec("docker", ["image", "inspect", "--format", "{{.Id}}", image]); }
  catch { return { ...base, status: "problem", detail: `The advisor's container image ${image} is missing, so every question fails.`, fix: `Build it: docker build -t ${image} scripts/energyiq/report-agent` }; }
  return { ...base, status: "ok", detail: `Docker is running and ${image} is installed.` };
}

/** Whether the organisation can use AI: a tested model is chosen and AI is switched on with requests left this month. */
export function checkAiModel(metadata: MetadataStore, workspaceId: string): HealthCheck[] {
  const checks: HealthCheck[] = [];
  try {
    const model = resolvePiReportModel(metadata, workspaceId);
    checks.push({ id: "ai-model", group: "AI advisor", title: "AI model", status: "ok", detail: `Answers use ${model.model} (${new URL(model.baseUrl).host}).` });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    checks.push({ id: "ai-model", group: "AI advisor", title: "AI model", status: "problem",
      detail: code === "ENERGYIQ_AI_MODEL_UNAVAILABLE" ? "The model chosen for this organisation is no longer available or has not passed its test." : code === "REPORT_MODEL_ENDPOINT_UNSUPPORTED" ? "The model's address is not supported (it must be a plain https address)." : "No AI model is set up, so the advisor cannot answer questions.",
      fix: "Open Admin → Models, add a model with its API key, run the test and activate it." });
  }
  const allowance = metadata.energyIq.ai.check(workspaceId);
  checks.push(allowance.allowed
    ? { id: "ai-allowance", group: "AI advisor", title: "AI use", status: "ok", detail: allowance.limit ? `On · ${allowance.used} of ${allowance.limit} requests used this month.` : `On · ${allowance.used} requests this month.` }
    : { id: "ai-allowance", group: "AI advisor", title: "AI use", status: "warning", detail: allowance.reason === "disabled" ? "AI is switched off for this organisation." : `This month's limit of ${allowance.limit} requests is used up.`, fix: "Change it in Admin → AI governance." });
  return checks;
}

export function checkEmail(env: NodeJS.ProcessEnv = process.env): HealthCheck {
  const mode = createMailDelivery(env).mode;
  const base = { id: "email", group: "Email", title: "Email delivery" };
  if (mode === "smtp") return { ...base, status: "ok", detail: "Alert, report and password emails are sent." };
  if (mode === "test") return { ...base, status: "warning", detail: "Test mode: emails are not actually sent, so nobody receives alerts or scheduled reports.", fix: "Set AUTH_EMAIL_DELIVERY=smtp with the SMTP settings and restart the API." };
  return { ...base, status: "problem", detail: "Email is not configured, so alerts and reports cannot be sent.", fix: "Add the SMTP settings to the API configuration." };
}

const DAY = 86_400_000;
const ago = (iso: string, now: number) => { const hours = Math.round((now - Date.parse(iso)) / 3_600_000); return hours < 1 ? "less than an hour ago" : hours < 48 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`; };
const tuyaFix = (code = "") => code.includes("1114") ? "Tuya refused this server's internet address. Add it to the Tuya Cloud project's IP allowlist." : "Check the site's Tuya connection under Admin → Data Sources.";

/** Each site's newest meter reading and, for live-connected sites, its last Tuya sync. */
export async function checkProjects(metadata: MetadataStore, userId: string, projects: ReadonlyArray<{ id: string; name: string; workspaceId: string; organisation?: string | undefined }>, now = Date.now()): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  for (const project of projects) {
    const group = project.organisation && project.organisation !== project.name ? `${project.organisation} · ${project.name}` : project.name;
    try {
      const data = await readReportProjectData(metadata, userId, project.workspaceId, project.id);
      const last = data.actualLastIntervalEnd;
      checks.push(data.status === "not_configured"
        ? { id: `${project.id}:data`, group, title: "Meter data", status: "warning", detail: "No published meter data yet.", fix: "Finish setup under Admin → Project configuration and publish." }
        : data.status === "unavailable" || !last
          ? { id: `${project.id}:data`, group, title: "Meter data", status: "problem", detail: "Meter data could not be read.", fix: "Open the site's Overview or Admin → Data Sources to see what is wrong." }
          : { id: `${project.id}:data`, group, title: "Meter data", status: now - Date.parse(last) > 7 * DAY ? "problem" : now - Date.parse(last) > 2 * DAY ? "warning" : "ok", detail: `Newest reading ${ago(last, now)} (${last.slice(0, 16).replace("T", " ")} UTC).`, ...(now - Date.parse(last) > 2 * DAY ? { fix: "Readings have stopped arriving. Check the meters' connection or upload the latest file." } : {}) });
    } catch {
      checks.push({ id: `${project.id}:data`, group, title: "Meter data", status: "warning", detail: "Could not check this site's meter data." });
    }
    const sync = metadata.energyIq.sourceSync.findState({ project_id: project.id, source_kind: "tuya" });
    if (sync) {
      const failing = !!sync.last_failure_at && (!sync.last_success_at || sync.last_failure_at > sync.last_success_at);
      checks.push(failing
        ? { id: `${project.id}:tuya`, group, title: "Live sync (Tuya)", status: "problem", detail: `Last sync failed ${ago(sync.last_failure_at!, now)}${sync.last_error_code ? ` (${sync.last_error_code.split(":").slice(0, 3).join(":")})` : ""}.`, fix: tuyaFix(sync.last_error_code) }
        : { id: `${project.id}:tuya`, group, title: "Live sync (Tuya)", status: "ok", detail: sync.last_success_at ? `Last synced ${ago(sync.last_success_at, now)}.` : "Connected; waiting for the first sync." });
    }
  }
  return checks;
}

export const handleSystemHealthApi = async (context: Required<ConfigApiContext>, user: UserRecord): Promise<ConfigApiResponse> => {
  const access = resolveEnergyAccessContext({ metadataStore: context.metadataStore, user, rolePersistence: "read-only" });
  if (access.role !== "admin") throw new Error("ENERGYIQ_ADMIN_REQUIRED");
  const workspaceId = access.activeWorkspaceId;
  const checks = [
    ...checkAiModel(context.metadataStore, workspaceId),
    await checkAdvisorWorker(),
    checkEmail(),
    // Super admins look after every client, so every site they can see is checked, labelled with its organisation.
    ...await checkProjects(context.metadataStore, context.userId, access.workspaces.filter(workspace => !workspace.disabled).flatMap(workspace => context.metadataStore.energyIq.listProjectsByWorkspace(workspace.id).map(project => ({ id: project.id, name: project.name, workspaceId: workspace.id, organisation: workspace.name })))),
  ];
  const body: SystemHealth = { checkedAt: new Date().toISOString(), checks };
  return { status: 200, headers: { "Cache-Control": "private, no-store" }, body: createSuccessResult(body) };
};
