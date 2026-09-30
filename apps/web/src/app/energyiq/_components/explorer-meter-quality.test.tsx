/** @vitest-environment happy-dom */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { EnergyCircuitAnalysisDto, EnergyVirtualMeterTraceDto } from "../../../lib/config-api/types";
import { meterQualityNotices, formatMeterEnergy } from "./explorer-meter-quality";
import { ExplorerMeterDetail } from "./explorer-meter-detail";
import { ExplorerChildren } from "./explorer-children";
import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";

const meter = {id:"m1",name:"Office TV",scopeId:"db",kind:"physical" as const,role:"component",coverage:"partial",category:"load",includedInOfficialTotal:false};
const circuit: EnergyCircuitAnalysisDto = {meterNodeId:"m1",name:"Office TV",appliance:"TV",category:"load",meterRole:"component",usageKwh:0,sharePct:0,peakKw:0,qualityEventCount:0,dataHealth:{coveragePct:100,expectedMeterIntervalCount:96,validIntervalCount:96,qualityEventCount:0}};
it("distinguishes valid zero, absent readings and zero with gaps without diagnosing a fault", () => {
  expect(meterQualityNotices(meter,circuit).map(item=>item.label)).toEqual(["Zero consumption"]);
  expect(meterQualityNotices(meter).map(item=>item.label)).toEqual(["Missing readings"]);
  const partial = {...circuit,dataHealth:{...circuit.dataHealth!,coveragePct:50,validIntervalCount:48}};
  expect(meterQualityNotices(meter,partial).map(item=>item.label)).toEqual(["Incomplete data","Zero in available data"]);
  expect(meterQualityNotices(meter,partial)[0]!.explanation).toContain("48 expected intervals");
  expect(meterQualityNotices(meter,{...circuit,usageKwh:0.001}).map(item=>item.label)).not.toContain("Zero consumption");
  expect(formatMeterEnergy(0.001)).toBe("<0.01 kWh");
  expect(formatMeterEnergy(0)).toBe("0.00 kWh");
  expect(meterQualityNotices(meter,{...circuit,dataHealth:{...circuit.dataHealth!,validIntervalCount:0}})[0]!.label).toBe("Missing readings");
  expect(meterQualityNotices(meter,{...circuit,qualityEventCount:1}).map(item=>item.label)).toContain("Quality review");
});
it("names missing virtual inputs and flags partially covered numeric inputs", () => {
  const virtual = {...meter,id:"v",kind:"virtual" as const};
  const trace: EnergyVirtualMeterTraceDto = {meterNodeId:"v",name:"Other",scopeId:"db",status:"partial",usageKwh:null,includedInOfficialTotal:false,missingTermMeterNodeIds:["m1"],terms:[]};
  expect(meterQualityNotices(virtual,undefined,trace,[meter])[0]!.explanation).toContain("Office TV");
  const available = {...trace,status:"available" as const,usageKwh:0,missingTermMeterNodeIds:[],terms:[{meterNodeId:"m1",name:"Old label",coefficient:1 as const,inputUsageKwh:0,contributionKwh:0,dataHealth:{...circuit.dataHealth!,coveragePct:50,validIntervalCount:48}}]};
  expect(meterQualityNotices(virtual,undefined,available,[meter]).map(item=>item.label)).toEqual(["Input quality review","Calculated zero"]);
});
it("renders quality explanations in both meter table and detail and suppresses them while loading", () => {
  vi.stubGlobal("React",React);
  const analysis = {context:{scopeId:"db",from:"2026-09-01T00:00:00Z",to:"2026-09-02T00:00:00Z",timezone:"Asia/Singapore"},circuits:[circuit],childScopes:[],explorerMeters:[meter]} as unknown as EnergyScopeAnalysisDto;
  try {
    for (const loading of [false,true]) {
      const detail=renderToStaticMarkup(<ExplorerMeterDetail meter={meter} analysis={analysis} loading={loading} error={null} breadcrumbs={[]} onSelect={()=>{}}/>);
      const table=renderToStaticMarkup(<ExplorerChildren selectedId="db" nodes={[{id:"db",parentId:null,name:"DB1"}]} analysis={analysis} loading={loading} onSelect={()=>{}}/>);
      for(const html of [detail,table]) {
        expect(html.includes("Zero consumption")).toBe(!loading);
        expect(html.includes("Meter data quality")).toBe(!loading);
      }
    }
  } finally {vi.unstubAllGlobals();}
});

it("keeps small gaps visible but neutral at 97 percent", () => {
 const notices=meterQualityNotices(meter,{...circuit,usageKwh:10,dataHealth:{...circuit.dataHealth!,coveragePct:97,expectedMeterIntervalCount:100,validIntervalCount:97}});
 expect(notices[0]).toMatchObject({label:"Minor gaps",warning:false});
 expect(notices[0]!.explanation).toContain("3 expected intervals");
});
