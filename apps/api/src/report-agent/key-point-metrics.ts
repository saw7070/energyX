import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import type { MetadataStore } from "@datafoundry/metadata";

/** RFC-style quoted CSV, including escaped quotes and embedded newlines. */
export function csvRecords(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"'){field+='"';i++;} else quoted=!quoted; }
    else if(c===','&&!quoted){row.push(field);field="";}
    else if(c==='\n'&&!quoted){row.push(field.replace(/\r$/,""));rows.push(row);row=[];field="";}
    else field+=c;
  }
  if(quoted) throw new Error("KEY_POINT_CSV_INVALID");
  if(field||row.length){row.push(field.replace(/\r$/,""));rows.push(row);}
  return rows;
}
type Reading = {meter:string;scope:string;start:string;end:string;kwh:number};
export function metricReadings(csv:string, officialIds:Set<string>, from:string,to:string):Reading[] {
  const [header,...rows]=csvRecords(csv); if(!header) throw new Error("KEY_POINT_CSV_INVALID");
  const col=(key:string)=>{const i=header.indexOf(key);if(i<0)throw new Error("KEY_POINT_CSV_INVALID");return i;};
  const m=col("meter_node_id"),s=col("scope_id"),a=col("interval_start"),b=col("interval_end"),k=col("usage_kwh"),q=col("quality_status"),o=col("official_aggregation_eligible");
  const seen=new Set<string>(); const result:Reading[]=[];
  for(const r of rows){
    if(!officialIds.has(r[m]!)||!['true','1'].includes(r[o]!)||r[q]!=="ok")continue;
    const start=Date.parse(r[a]!),end=Date.parse(r[b]!),kwh=Number(r[k]);
    if(!r[k]?.trim()||!Number.isFinite(kwh)||kwh<0||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||start<Date.parse(from)||end>Date.parse(to))throw new Error("KEY_POINT_INTERVAL_INVALID");
    const key=`${r[m]}:${start}`;if(seen.has(key))throw new Error("KEY_POINT_DUPLICATE_INTERVAL");seen.add(key);
    result.push({meter:r[m]!,scope:r[s]!,start:r[a]!,end:r[b]!,kwh});
  }
  for(const id of officialIds){let last=-Infinity;for(const r of result.filter(r=>r.meter===id).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))){if(Date.parse(r.start)<last)throw new Error("KEY_POINT_OVERLAP");last=Date.parse(r.end);}}
  return result;
}
export function summarizeReadings(rows:Reading[],meterCount:number,from:string,to:string){
  const slots=new Map<string,{meters:Set<string>;kwh:number}>();let energy=0,minutes=0;
  for(const r of rows){energy+=r.kwh;const duration=(Date.parse(r.end)-Date.parse(r.start))/60000;minutes+=duration;
    if(duration!==15)continue;const key=`${r.start}/${r.end}`;const slot=slots.get(key)??{meters:new Set<string>(),kwh:0};slot.meters.add(r.meter);slot.kwh+=r.kwh;slots.set(key,slot);
  }
  const powers=[...slots.values()].filter(s=>s.meters.size===meterCount).map(s=>s.kwh*4);
  return {energyKwh:rows.length?energy:null,peakKw:powers.length?Math.max(...powers):null,
    coverage:meterCount?minutes/(meterCount*(Date.parse(to)-Date.parse(from))/60000):0};
}

/** Compute only from the exact archived analysis input, never today's dataset. */
export function computeKeyPointMetrics(directory:string,metadata:MetadataStore) {
  const input=join(directory,"inputs");const manifest=JSON.parse(readFileSync(join(input,"manifest.json"),"utf8"));
  const config=JSON.parse(readFileSync(join(input,"project-configuration.json"),"utf8"));
  const dataset=manifest.datasets?.find((d:{name:string})=>d.name==="analysis");
  if(!dataset || basename(dataset.filename)!==dataset.filename)throw new Error("KEY_POINT_DATA_UNAVAILABLE");
  const raw=readFileSync(join(input,dataset.filename));
  if(createHash("sha256").update(raw).digest("hex")!==dataset.sha256)throw new Error("KEY_POINT_DATA_HASH_MISMATCH");
  const csv=dataset.compression==="gzip"?gunzipSync(raw,{maxOutputLength:256*1024*1024}):raw;
  const ids=new Set<string>(dataset.coverage.filter((c:{officialAggregation:boolean})=>c.officialAggregation).map((c:{meterPointId:string})=>c.meterPointId));
  const rows=metricReadings(csv.toString("utf8"),ids,dataset.utcPeriod.from,dataset.utcPeriod.toExclusive);
  const totals=summarizeReadings(rows,ids.size,dataset.utcPeriod.from,dataset.utcPeriod.toExclusive);
  let cost=0,standby=0,currency:string|null=null,costAvailable=rows.length>0,operatingAvailable=rows.length>0;
  const bases=new Set<string>();
  const project=metadata.energyIq.getProject(manifest.projectId);
  // Scope inheritance must not silently use a changed hierarchy.
  if(project.hierarchy_revision_id!==manifest.hierarchyRevisionId){costAvailable=false;operatingAvailable=false;}
  else for(const scope of new Set(rows.map(r=>r.scope))){
    const result=metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({project_id:manifest.projectId,scope_id:scope,
      period:{from:dataset.utcPeriod.from,to:dataset.utcPeriod.toExclusive},
      intervals:rows.filter(r=>r.scope===scope).map(r=>({start:r.start,end_exclusive:r.end,usage_kwh:r.kwh})),
      policy_source:{mode:"release-pinned",tariff_schedule_version:config.tariff?.revision?.version_id??"not-configured",business_calendar_version:config.calendar?.revision?.version_id??"not-configured"}});
    if(result.tariff.status==="available"){
      if(currency&&currency!==result.tariff.currency)costAvailable=false;
      currency=result.tariff.currency;cost+=result.tariff.total_cost;result.tariff.allocations.forEach(a=>bases.add(a.rate_basis??"unspecified"));
    }else costAvailable=false;
    if(result.operating.status==="available")standby+=result.operating.standby_kwh;else operatingAvailable=false;
  }
  return {version:1,projectName:manifest.projectName,period:dataset.period,snapshotId:manifest.dataSnapshotId,
    actualLastIntervalEnd:dataset.actualLastIntervalEnd,...totals,
    cost:costAvailable?cost:null,currency,costBasis:bases.size===1?[...bases][0]:"mixed",
    outsideHoursPercent:operatingAvailable&&totals.energyKwh?100*standby/totals.energyKwh:null};
}
