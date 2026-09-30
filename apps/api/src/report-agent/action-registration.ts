import type {MetadataStore} from "@datafoundry/metadata";
import {ActionStore} from "./action-store.js";
import type {ActionSuggestion} from "./action-suggestions.js";
import type {ReportRun} from "./report-store.js";
import {readActionEvidence, readActionGroupEvidence, localDate} from "./action-data.js";
import {shiftReportDate} from "./report-calendar.js";
import {InsightStore} from "./insight-store.js";

/** Accepted reports only. AI suggestions never record actual implementation. */
export async function registerReportActions(metadata:MetadataStore,run:ReportRun,items:ActionSuggestion[],snapshotId:string,
  readEvidence=readActionEvidence) {
 const scope={workspaceId:run.workspaceId,projectId:run.projectId,userId:run.actorUserId};
 const store=new ActionStore(metadata.db);let linked=0,created=0,skipped=0;
 // Weekly reports need a longer baseline: effect checks require three prior
 // instances of each comparable weekday. Never include the current partial day.
 const insights=new InsightStore(metadata.db);
 const meters=(item:ActionSuggestion)=>[...new Set(item.meterIds ?? (item.meterId?[item.meterId]:[]))].sort();
 const attach=(id:string,item:ActionSuggestion)=>{if(item.insight)insights.attach(scope,id,meters(item),run.id,item.insight);};
 metadata.db.exec("CREATE TABLE IF NOT EXISTS energyiq_action_measure_keys (action_id TEXT PRIMARY KEY, measure_key TEXT NOT NULL)");
 const measure=(id:string)=>metadata.db.prepare("SELECT measure_key FROM energyiq_action_measure_keys WHERE action_id=?").get(id)?.measure_key;
 const today=localDate(new Date(),run.settings.timezone);
 const toExclusive=run.period.toExclusive < today ? run.period.toExclusive : today;
 const baselinePeriod={from:shiftReportDate(toExclusive,-28),toExclusive};
 for(const item of items){
  const ids=meters(item);
  const equivalent=(a:ReturnType<ActionStore["listProject"]>[number])=>JSON.stringify([...a.meterIds].sort())===JSON.stringify(ids)&&(a.recommendation.trim().toLowerCase()===item.recommendation.trim().toLowerCase() || (!!item.measureKey && measure(a.id)===item.measureKey));
  if(!ids.length || !item.insight){skipped++;continue;}
  const existing=store.listProject(scope,true);
  // Exact repeats can be merged deterministically. Model-selected matches remain proposals:
  // they are displayed for explicit linking rather than silently merging different measures.
  const same=existing.filter(equivalent);
  if(same.length===1){store.linkSource(scope,same[0]!.id,{reportId:run.id,recommendation:item.recommendation,sourceQuote:item.sourceQuote});attach(same[0]!.id,item);linked++;continue;}
  if(item.existingActionId || (!item.measureKey && existing.some(a=>a.meterIds.some(id=>ids.includes(id))&&a.sourceReportId!==run.id))){skipped++;continue;}
  const evidence=await readActionGroupEvidence(metadata,scope,ids,baselinePeriod,readEvidence);
  if(evidence.snapshotId!==snapshotId){skipped++;continue;}
  // Evidence reading yields: another report may have registered the action meanwhile.
  const latest=store.listProject(scope,true).filter(equivalent);
  if(latest.length===1){store.linkSource(scope,latest[0]!.id,{reportId:run.id,recommendation:item.recommendation,sourceQuote:item.sourceQuote});attach(latest[0]!.id,item);linked++;continue;}
  if(latest.length>1){skipped++;continue;}
  metadata.db.exec("SAVEPOINT register_action");
  try {
  const action=store.create(scope,{sourceReportId:run.id,title:item.title,recommendation:item.recommendation,meterIds:ids,
    baseline:{...baselinePeriod,snapshotId},idempotencyKey:`report:${run.id}:${item.id}`,suggestionId:item.id,visibility:"project"});
  if(item.measureKey)metadata.db.prepare("INSERT OR IGNORE INTO energyiq_action_measure_keys VALUES (?,?)").run(action.id,item.measureKey);
  store.freezeBaseline(scope,action.id,evidence);
  attach(action.id,item);
  if(item.priority && store.priority(scope,action.id).revision===0) store.setPriority(scope,action.id,{revision:0,...item.priority});
  metadata.db.exec("RELEASE register_action");created++;
  } catch(error) {metadata.db.exec("ROLLBACK TO register_action; RELEASE register_action");throw error;}
 }
 return {created,linked,needsReview:skipped};
}
