import type { IncomingMessage } from "node:http";
import { createErrorResult, createSuccessResult } from "@datafoundry/contracts";
import type { ConfigApiContext, ConfigApiResponse } from "../routes/types.js";
import { resolveEnergyAccessContext } from "../energy/energy-query-context.js";
import { authorizeReportLibraryProject } from "./report-library-api.js";
import { findReportService } from "./report-service.js";
import { hasReportArtifact, type ReportRun } from "./report-store.js";

const statuses = ["queued", "running", "succeeded", "failed", "interrupted", "cancelled"];
const phases: Record<string,string> = {queued:"Waiting to start",started:"Started",skill_inputs_prepared:"Instructions prepared",review_started:"Reviewing report",revision_started:"Revising report",review_passed:"Review passed",review_blocked:"Review needs attention",succeeded:"Completed",failed:"Failed",cancelled:"Stopped",interrupted:"Interrupted",tool_execution_start:"Working",tool_execution_end:"Activity completed"};
const failures: Record<string,string> = {REPORT_REVIEW_BLOCKED:"The report did not pass review.",REPORT_TIMEOUT:"The task exceeded its time limit.",REPORT_MODEL_NOT_CONFIGURED:"No model was configured for this task.",REPORT_CANCELLED:"The task was stopped."};
export async function handleReportTaskHistoryApi(request: IncomingMessage, segments: string[], context: Required<ConfigApiContext>): Promise<ConfigApiResponse> {
  const headers = {"Cache-Control":"private, no-store"};
  const fail = (status:number, code:string): ConfigApiResponse => ({status,headers,body:createErrorResult(status===404?"RESOURCE_NOT_FOUND":"BAD_REQUEST",code)});
  try {
    const user=context.metadataStore.users.getById({user_id:context.userId});
    const access=resolveEnergyAccessContext({metadataStore:context.metadataStore,user,requestedWorkspaceId:context.workspaceId,rolePersistence:"read-only"});
    if(user.disabled_at || access.role!=="admin" || access.activeWorkspaceId!==context.workspaceId) return fail(403,"TASK_HISTORY_FORBIDDEN");
    const projects=access.projects.filter(p=>p.workspaceId===context.workspaceId);
    if(request.method!=="GET") return {...fail(405,"TASK_HISTORY_READ_ONLY"),headers:{...headers,Allow:"GET"}};
    if(segments.length>1) return fail(404,"TASK_NOT_FOUND");
    const query=new URL(request.url??"/","http://localhost").searchParams;
    const projectId=query.get("projectId"); const status=query.get("status");const origin=query.get("origin");
    const page=Number(query.get("page")??"0"), pageSize=20;
    if(!Number.isSafeInteger(page)||page<0||page>100000||(status&&!statuses.includes(status))||(origin&&!['manual','automatic'].includes(origin)))return fail(400,"TASK_FILTER_INVALID");
    if(projectId&&!projects.some(p=>p.id===projectId))return fail(404,"TASK_NOT_FOUND");
    const service=findReportService(context.metadataStore);if(!service)return fail(503,"REPORT_AGENT_NOT_ENABLED");
    const allowed=projects.filter(p=>!projectId||p.id===projectId);
    const where = `project_id IN (${allowed.map(()=>"?").join(",") || "NULL"}) AND json_extract(document,'$.workspaceId') = ?`;
    const params=[...allowed.map(p=>p.id),context.workspaceId];
    function summary(run:ReportRun) {
      let actor="User unavailable";try{actor=context.metadataStore.users.getById({user_id:run.actorUserId}).display_name || "Project member";}catch{}
      const own=run.actorUserId===context.userId;
      let reportHref:string|null=null;
      if(run.status==="succeeded"&&hasReportArtifact(run)){try{authorizeReportLibraryProject(context.metadataStore,context.userId,context.workspaceId,run.projectId);reportHref=`/energyiq/library?${new URLSearchParams({projectId:run.projectId,reportId:run.id})}`;}catch{}}
      return {id:run.id,projectId:run.projectId,projectName:projects.find(p=>p.id===run.projectId)!.name,title:run.kind==="skill"?"Save report method":run.kind==="report"?"Energy report":"AI analysis",origin:run.scheduleKey?"automatic":"manual",actor:run.scheduleKey?"Automatic report":actor,status:run.status,createdAt:run.createdAt,startedAt:run.startedAt??null,finishedAt:run.finishedAt??null,reportHref,conversationHref:own&&run.sessionId?`/energyiq/reports?${new URLSearchParams({projectId:run.projectId,sessionId:run.sessionId})}`:null};
    }
    if(segments[0]) {
      const row=context.metadataStore.db.prepare(`SELECT document FROM energyiq_report_runs WHERE ${where} AND id=?`).get(...params,segments[0]);
      if(!row)return fail(404,"TASK_NOT_FOUND");
      const run=JSON.parse(String(row.document)) as ReportRun;
      const events=context.metadataStore.db.prepare("SELECT document FROM energyiq_report_events WHERE run_id=? ORDER BY sequence DESC LIMIT 50").all(run.id).reverse().map(row=>JSON.parse(String(row.document))).filter(event=>phases[event.type]).map(event=>({time:event.time,label:phases[event.type],isError:event.isError===true}));
      const own=run.actorUserId===context.userId;
      return {status:200,headers,body:createSuccessResult({task:{...summary(run),period:run.period,timezone:run.settings.timezone,model:null,skills:(run.settings.skillUsage??[]).map(skill=>({name:own||skill.source==="required"?skill.name:"Private method",version:own||skill.source==="required"?skill.version:null,source:skill.source})),data:service.taskInputEvidence(run.id),failureReason:["failed","interrupted","cancelled"].includes(run.status)?failures[run.errorCode??""]??"The task did not complete. Further failure details are not recorded in this view.":null,events,sessionId:own?run.sessionId??null:null}})};
    }
    const filters=`${where}${status?" AND status=?":""}${origin?` AND ${origin==='automatic'?"schedule_key IS NOT NULL":"schedule_key IS NULL"}`:""}`;
    const values=[...params,...(status?[status]:[])];
    const total=Number(context.metadataStore.db.prepare(`SELECT COUNT(*) AS count FROM energyiq_report_runs WHERE ${filters}`).get(...values)!.count);
    const items=context.metadataStore.db.prepare(`SELECT document FROM energyiq_report_runs WHERE ${filters} ORDER BY json_extract(document,'$.createdAt') DESC, id DESC LIMIT ? OFFSET ?`).all(...values,pageSize,page*pageSize).map(row=>summary(JSON.parse(String(row.document))));
    return {status:200,headers,body:createSuccessResult({items,total,page,pageSize,projects:projects.map(p=>({id:p.id,name:p.name})),observedAt:new Date().toISOString()})};
  }catch{return fail(500,"TASK_HISTORY_UNAVAILABLE");}
}
