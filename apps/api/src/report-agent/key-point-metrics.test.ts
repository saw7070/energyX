import { expect, it } from "vitest";
import { csvRecords,metricReadings,summarizeReadings } from "./key-point-metrics.js";
const header="meter_node_id,scope_id,interval_start,interval_end,usage_kwh,quality_status,official_aggregation_eligible\n";
const from="2026-09-01T00:00:00Z",to="2026-09-01T00:30:00Z";
it("parses quoted commas, escaped quotes and newlines",()=>expect(csvRecords('a,b\n"a,b","say ""hi""\nnow"\n')).toEqual([['a','b'],['a,b','say "hi"\nnow']]));
it("excludes sub-meters and computes peak only from simultaneous complete groups",()=>{
 const csv=header+`a,p,${from},2026-09-01T00:15:00Z,1,ok,true\nb,p,${from},2026-09-01T00:15:00Z,2,ok,true\nsub,p,${from},2026-09-01T00:15:00Z,100,ok,false\na,p,2026-09-01T00:15:00Z,${to},20,ok,true\n`;
 const rows=metricReadings(csv,new Set(['a','b']),from,to);
 expect(summarizeReadings(rows,2,from,to)).toEqual({energyKwh:23,peakKw:12,coverage:.75});
});
it("rejects duplicate readings rather than inflating totals",()=>{
 const row=`a,p,${from},${to},1,ok,true\n`;
 expect(()=>metricReadings(header+row+row,new Set(['a']),from,to)).toThrow('DUPLICATE');
});
it("keeps absence distinct from zero and rejects negative readings",()=>{
 expect(summarizeReadings([],1,from,to)).toEqual({energyKwh:null,peakKw:null,coverage:0});
 expect(()=>metricReadings(header+`a,p,${from},${to},-1,ok,true`,new Set(['a']),from,to)).toThrow('INVALID');
});
