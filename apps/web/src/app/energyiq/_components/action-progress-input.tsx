"use client";
import {useEffect,useState} from 'react';
import {configApi} from '../../../lib/config-api';
import styles from './action-ai-estimate.module.css';
import {useEnergyIqLocale,useMessages} from './energyiq-locale';
import {intlLocale} from './energyiq-messages';
import {labelFor} from './project-actions-messages';
import {progressInputMessages,type ProgressInputMessage} from './report-action-panel-messages';
type Draft={id:string;status:string;text:string;confirmedAt?:string;result?:{type:string|null;effectiveAt:string|null;summary:string;questions:string[]}};
export function ActionProgressInput({projectId,actionId,timezone,onSaved}:{projectId:string;actionId:string;timezone:string;onSaved:()=>void}){
 const t=useMessages(progressInputMessages),{locale}=useEnergyIqLocale();
 const [text,setText]=useState(''),[draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<ProgressInputMessage|''>(''),[reload,setReload]=useState(0);
 useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;const load=async()=>{try{const r=await configApi.reportActionRequest<{items:Draft[]}>(projectId,`${actionId}/progress-drafts`);if(!active)return;const d=r.items[0]??null;setDraft(d);if(d?.status==='pending')timer=setTimeout(load,2000);}catch{if(active)setError('loadFailed');}};void load();return()=>{active=false;clearTimeout(timer);};},[projectId,actionId,reload]);
 async function submit(confirm=false){setBusy(true);setError('');try{await configApi.reportActionRequest(projectId,`${actionId}/progress-drafts${confirm?'/'+draft!.id:''}`,{method:'POST',body:JSON.stringify(confirm?{}:{requestId:crypto.randomUUID(),text})});setReload(n=>n+1);if(confirm){setText('');onSaved();}}catch{setError('saveFailed');}finally{setBusy(false);}}
 const pending=draft?.status==='pending';
 const typeLabel=(type:string|null)=>type===null?'':labelFor(t,progressInputMessages,`type.${type}`,type);
 return <section className={styles.assessment} aria-label={t('label')}><h3>{t('title')}</h3><p>{t('intro')}</p><div className={styles.reply}><label htmlFor={`progress-${actionId}`}>{t('yourUpdate')}</label><textarea id={`progress-${actionId}`} value={text} onChange={e=>setText(e.target.value)} maxLength={2000} placeholder={t('placeholder')}/><button disabled={busy||pending||!text.trim()} onClick={()=>void submit()}>{t('organise')}</button></div>{pending&&<p role="status">{t('organising')}</p>}{error&&<p role="alert">{t(error)}</p>}{draft?.status==='failed'&&<p>{t('failed')}</p>}{draft?.result&&<div><h4>{draft.confirmedAt?t('recorded'):t('checkBeforeSaving')}</h4><p>{draft.result.summary}</p>{draft.result.effectiveAt&&<p>{t('effectiveLine',{time:new Date(draft.result.effectiveAt).toLocaleString(intlLocale(locale),{timeZone:timezone}),timezone,type:typeLabel(draft.result.type)})}</p>}{draft.result.questions.map(q=><p key={q}>{q}</p>)}{!!draft.result.questions.length&&<p>{t('addDetails')}</p>}{!draft.confirmedAt&&draft.result.type&&draft.result.effectiveAt&&!draft.result.questions.length&&<button disabled={busy} onClick={()=>void submit(true)}>{t('confirm')}</button>}{draft.confirmedAt&&<p>{t('afterConfirm')}</p>}</div>}</section>;
}
