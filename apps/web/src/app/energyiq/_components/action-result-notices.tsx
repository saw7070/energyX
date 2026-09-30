"use client";
import {useEffect,useState} from 'react';
import {configApi} from '../../../lib/config-api';
import {useMessages} from './energyiq-locale';
import {resultNoticesMessages} from './project-actions-messages';
type Notice={actionId:string;title:string;runId:string};
export function ActionResultNotices({projectId,compact=false,onOpen}:{projectId:string;compact?:boolean;onOpen?:(id:string)=>void}){
 const t=useMessages(resultNoticesMessages);
 const [items,setItems]=useState<Notice[]>([]);
 useEffect(()=>{let alive=true;const load=async()=>{try{const r=await configApi.reportActionRequest<{items:Notice[]}>(projectId,'notifications');if(alive)setItems(r.items);}catch{if(alive)setItems([]);}};void load();const timer=setInterval(()=>{if(!document.hidden)void load();},30000);return()=>{alive=false;clearInterval(timer);};},[projectId]);
 if(!items.length)return null;
 if(compact)return <span aria-label={t("count",{count:items.length})} className="ml-auto rounded-full bg-emerald-700 px-2 py-0.5 text-xs text-white">{items.length}</span>;
 return <section aria-label={t("label")} className="my-5 rounded-xl border border-emerald-200 bg-emerald-50 p-5"><h2>{t("title")}</h2>{items.map(n=><div key={n.runId}><button onClick={()=>onOpen?.(n.actionId)}>{t("viewResult",{title:n.title})}</button></div>)}</section>;
}
