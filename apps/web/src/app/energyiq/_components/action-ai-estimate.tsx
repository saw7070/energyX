"use client";
import { useEffect, useRef, useState } from "react";
import { configApi } from "../../../lib/config-api";
import styles from "./action-ai-estimate.module.css";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import { around } from "./project-actions-messages";
import { aiEstimateMessages, type AiEstimateMessage } from "./report-action-panel-messages";

type Estimate = {
  id:string;version:number;status:"pending"|"succeeded"|"failed";runStatus:string;createdAt:string;
  notes?:string;period?:{from:string;toExclusive:string};timezone?:string;
  result?:{recommendation:string;expectedEffect:string;evidence:string[];assumptions:string[];questions:string[];
    quantification:{status:"not_quantified";reason:string}|{status:"estimated";energyKwhLow:number;energyKwhHigh:number;horizonDays:number;method:string;calculationEvidence:string}};
};
type PublishedBenefit={reportId:string;publishedAt:string;benefit:string;evidence:string;evidenceFrom:string;evidenceToExclusive:string;scenario:{referenceYear:number;method:string;assumptions:string[];condition:string;money?:{tariffSource:string;taxBasis:"inclusive"|"exclusive"}}};
type AssessmentResponse={items:Estimate[];canGenerate:boolean;publishedBenefit?:PublishedBenefit};
export function ActionAiEstimate({projectId,actionId}:{projectId:string;actionId:string}) {
  const t=useMessages(aiEstimateMessages),{locale}=useEnergyIqLocale();
  const [data,setData]=useState<AssessmentResponse|null>(null);
  const [error,setError]=useState<AiEstimateMessage|"">("");
  const [busy,setBusy]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [notes,setNotes]=useState("");
  const [selectedVersion,setSelectedVersion]=useState<string|null>(null);
  const initialRequest=useRef(crypto.randomUUID());
  const path=`${encodeURIComponent(actionId)}/estimates`;
  useEffect(()=>{
    let alive=true;let timer:ReturnType<typeof setTimeout>|undefined;
    async function load() {
      try {
        const next=await configApi.reportActionRequest<AssessmentResponse>(projectId,path);
        if(!alive)return;
        if(!Array.isArray(next.items))throw new Error("Invalid assessment response");
        setData(next);
        if(!next.items.length&&next.canGenerate&&!next.publishedBenefit){
          await configApi.reportActionRequest(projectId,path,{method:"POST",body:JSON.stringify({requestId:initialRequest.current,update:false})});
          if(alive)timer=setTimeout(load,1000);
        } else if(next.items.some(i=>i.status==="pending")) timer=setTimeout(load,3000);
      }catch{if(alive)setError("loadFailed");}
    }
    void load();return()=>{alive=false;if(timer)clearTimeout(timer);};
  },[projectId,path,refresh]);
  const current=data?.items.find(i=>i.status==="succeeded"&&i.id===selectedVersion) ?? data?.items.find(i=>i.status==="succeeded");
  const pending=data?.items.find(i=>i.status==="pending");
  async function update(){
    setBusy(true);setError("");
    try{await configApi.reportActionRequest(projectId,path,{method:"POST",body:JSON.stringify({requestId:crypto.randomUUID(),update:true,...(notes.trim()?{notes:notes.trim()}:{})})});setNotes("");setSelectedVersion(null);setRefresh(v=>v+1);}
    catch{setError("startFailed");}
    finally{setBusy(false);}
  }
  const quantification=current?.result?.quantification;
  const [reductionBefore,reductionAfter]=around(t("potentialReduction",{days:quantification?.status==="estimated"?quantification.horizonDays:""}),"range");
  return <section className={styles.assessment} aria-label={t("label")} aria-busy={busy||!!pending}>
    <h3>{t("title")}</h3>
    {(pending||!data||(data.canGenerate&&!data.items.length&&!data.publishedBenefit))&&!error&&<p role="status">{pending?.runStatus==="queued"?t("waiting"):t("reviewing")}</p>}
    {error&&<p role="alert">{t(error)} <button onClick={()=>{setError("");setRefresh(v=>v+1);}}>{t("tryAgain")}</button></p>}
    {data?.items[0]?.status==="failed"&&<p>{t("latestFailed")}</p>}
    {data?.publishedBenefit && <section aria-label={t("annualLabel")}>
      <p className={styles.benefit}><strong>{data.publishedBenefit.benefit}</strong></p>
      <p>{t("annualScenario",{year:data.publishedBenefit.scenario.referenceYear})}</p>
      <details><summary>{t("howEstimated")}</summary>
        <p>{data.publishedBenefit.evidence}</p><p>{data.publishedBenefit.scenario.method}</p>
        <ul>{data.publishedBenefit.scenario.assumptions.map((text,i)=><li key={i}>{text}</li>)}</ul>
        {data.publishedBenefit.scenario.money&&<p>{data.publishedBenefit.scenario.money.tariffSource}</p>}
        <a href={`/energyiq/library?projectId=${encodeURIComponent(projectId)}&reportId=${encodeURIComponent(data.publishedBenefit.reportId)}`}>{t("readSource")}</a>
      </details>
    </section>}
    {current?.result&&<>
      {data?.publishedBenefit&&<h4>{t("separateAssessment",{version:current.version})}</h4>}
      {current.period&&<p className={styles.period}>{t("readingsPeriod",{from:current.period.from,to:new Date(Date.parse(current.period.toExclusive+"T00:00:00Z")-86400000).toISOString().slice(0,10),timezone:current.timezone??""})}</p>}
      <p><strong>{current.result.recommendation}</strong></p>
      <p>{current.result.expectedEffect}</p>
      {current.result.quantification.status==="estimated"?<p className={styles.benefit}>{reductionBefore}<strong>{current.result.quantification.energyKwhLow.toFixed(1)}–{current.result.quantification.energyKwhHigh.toFixed(1)} kWh</strong>{reductionAfter}</p>:<details><summary>{t("whyNoFigure")}</summary><p>{current.result.quantification.reason}</p></details>}
      {!!current.result.questions.length&&<><h4>{t("beforeDecide")}</h4><ul>{current.result.questions.map((q,i)=><li key={i}>{q}</li>)}</ul></>}
      <details><summary>{t("evidence",{version:current.version})}</summary>
        {current.result.quantification.status==="estimated"&&<><p>{current.result.quantification.method}</p><p>{current.result.quantification.calculationEvidence}</p></>}
        <ul>{[...current.result.evidence,...current.result.assumptions].map((s,i)=><li key={i}>{s}</li>)}</ul>
        <time dateTime={current.createdAt}>{new Date(current.createdAt).toLocaleString(intlLocale(locale))}</time>
      </details>
      {current.notes&&<details><summary>{t("yourInformation")}</summary><p>{current.notes}</p></details>}
    </>}
    {data?.canGenerate&&<div className={styles.reply}><label htmlFor={`assessment-notes-${actionId}`}>{t("addInformation")}</label><textarea id={`assessment-notes-${actionId}`} value={notes} onChange={e=>setNotes(e.target.value)} maxLength={4000} disabled={busy||!!pending} placeholder={t("notesPlaceholder")} /><button disabled={busy||!!pending||(!data.items.length&&!data.publishedBenefit&&!error)} onClick={()=>void update()}>{notes.trim()?t("reassess"):current||data.publishedBenefit?t("updateLatest"):t("retryAssessment")}</button><p>{t("updateNote")}</p></div>}
    {(data?.items.filter(i=>i.status==="succeeded").length??0)>1&&<details><summary>{t("previous")}</summary><div className={styles.versions}>{data!.items.filter(i=>i.status==="succeeded").map(i=><button key={i.id} aria-pressed={current?.id===i.id} onClick={()=>setSelectedVersion(i.id)}>{t("version",{version:i.version})}</button>)}</div></details>}
    {data&&!data.canGenerate&&!current&&!pending&&!data.publishedBenefit&&<p>{t("notPrepared")}</p>}
  </section>;
}
