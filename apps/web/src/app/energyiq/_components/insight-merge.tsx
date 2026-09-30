"use client";
import {useState} from "react";
import {EnergySelect} from "./energy-select";
import {configApi} from "../../../lib/config-api";
import styles from "./project-actions.module.css";
import {useMessages} from "./energyiq-locale";
import {findingLabelMessages,insightMergeMessages,labelFor} from "./project-actions-messages";
export type MergeFinding = {
 id:string; title:string; summary:string; version?:string; meterIds?:string[]; actionIds:string[];
 sources:Array<{reportId:string;sourceQuote:string}>;
 review?:{status:string;importance:string;urgency:string};
 mergeId?:string; mergedFindings?:Array<{id:string;title:string;summary:string;review?:{status:string}}>;
};
export function InsightMerge({projectId,finding,findings,onSaved}:{projectId:string;finding:MergeFinding;findings:MergeFinding[];onSaved:()=>void}) {
 const t=useMessages(insightMergeMessages),labels=useMessages(findingLabelMessages);
 const statusLabel=(status?:string)=>labelFor(labels,findingLabelMessages,`statusInline.${status??"open"}`,status??"open");
 const [selected,setSelected]=useState(""); const [reason,setReason]=useState("");
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const [requestId]=useState(()=>crypto.randomUUID());
 const candidates=findings.filter(i=>i.id!==finding.id&&!i.mergeId&&i.version&&i.meterIds?.length&&JSON.stringify([...i.meterIds].sort())===JSON.stringify([...(finding.meterIds??[])].sort()));
 const other=candidates.find(i=>i.id===selected);
 if(!finding.mergeId&&(!candidates.length||!finding.version))return null;
 return <details className={styles.mergeControls}><summary>{finding.mergeId ? t("grouped") : t("compare")}</summary>
 <form aria-label={finding.mergeId?t("undoLabel"):t("groupLabel")} onSubmit={async e=>{
 e.preventDefault(); if(!confirmed||(!finding.mergeId&&!other))return;setBusy(true);setError(false);
 try {
 await configApi.reportActionRequest(projectId,finding.mergeId?`insight-merges/${finding.mergeId}/undo`:"insights/merge",{method:"POST",body:JSON.stringify(finding.mergeId?{reason}:{sourceId:other!.id,targetId:finding.id,sourceVersion:other!.version,targetVersion:finding.version,reason,requestId})});onSaved();
 }catch{setError(true);}finally{setBusy(false);}
 }}>
 {finding.mergeId ? <><h3>{t("keepOrSeparate")}</h3>{finding.mergedFindings?.map(i=><p key={i.id}><strong>{i.title}</strong><br/>{i.summary}<br/>{t("originalAssessment",{status:statusLabel(i.review?.status)})}</p>)}<p>{t("separatingNote")}</p></> : <>
 <h3>{t("sameIssue")}</h3><p>{t("sameMeters")}</p>
 <EnergySelect ariaLabel={t("findingToCompare")} value={selected} options={[{value:"",label:t("chooseFinding")},...candidates.map(i=>({value:i.id,label:i.title}))]} onValueChange={v=>{setSelected(v);setConfirmed(false);}}/>
 {other&&<div className={styles.mergeComparison}>{[finding,other].map((i,index)=><section key={i.id}><h4>{index===0?t("keepMain"):t("groupUnder")}</h4><strong>{i.title}</strong><p>{i.summary}</p><p>{t("summary",{status:statusLabel(i.review?.status),count:i.actionIds.length})}</p><details><summary>{t("sourceEvidence")}</summary>{i.sources.map((s,n)=><p key={n}><a target="_blank" rel="noreferrer" href={`/energyiq/library?projectId=${encodeURIComponent(projectId)}&reportId=${encodeURIComponent(s.reportId)}`}>{t("readSource")}</a><br/>{s.sourceQuote}</p>)}</details></section>)}</div>}
 <p>{t("mainStays")}</p></>}
 <label>{t("reason")}<textarea required minLength={12} maxLength={1200} value={reason} onChange={e=>setReason(e.target.value)} /></label>
 <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{finding.mergeId?t("confirmSeparate"):t("confirmSame")}</label>
 {error&&<p role="alert">{t("saveFailed")}</p>}<button className={styles.primaryButton} disabled={busy||!confirmed||(!finding.mergeId&&!other)}>{busy?t("saving"):finding.mergeId?t("undo"):t("group")}</button>
 </form></details>;
}
