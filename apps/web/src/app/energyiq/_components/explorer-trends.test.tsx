/** @vitest-environment happy-dom */
import React, {act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
import type {EnergyScopeAnalysisDto} from "../../../lib/config-api";
const api=vi.hoisted(()=>({executeEnergyScopeAnalysis:vi.fn()}));
vi.mock("../../../lib/config-api",()=>({configApi:api}));
vi.mock("recharts",()=>({ResponsiveContainer:()=>null,AreaChart:()=>null,Area:()=>null,XAxis:()=>null,YAxis:()=>null,CartesianGrid:()=>null,Tooltip:()=>null}));
import {ExplorerTrends} from "./explorer-trends";
it("keeps all aggregation views in one window without querying different dates",async()=>{
 vi.stubGlobal("React",React);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
 const analysis={context:{projectId:"p",scopeId:"project",from:"2026-09-09T16:00:00Z",to:"2026-09-10T16:00:00Z",timezone:"Asia/Singapore",dataSnapshotId:"snap"},explorerMeters:[],explorerTrends:[{id:"__scope__",expectedMinutesPerHour:60,cells:Array.from({length:24},(_,h)=>["2026-09-10",h,0,60,0])}]} as unknown as EnergyScopeAnalysisDto;
 const yesterday={...analysis,context:{...analysis.context,from:"2026-09-11T16:00:00Z",to:"2026-09-12T16:00:00Z"},explorerTrends:[{id:"__scope__",expectedMinutesPerHour:60,cells:[]}]} as EnergyScopeAnalysisDto;
 api.executeEnergyScopeAnalysis.mockResolvedValue(yesterday);const health=vi.fn();
 try {
  await act(async()=>root.render(<ExplorerTrends analysis={analysis} onHealth={health}/>));
  expect(el.querySelector('[aria-label="Trend quality"]')?.textContent).toContain("Selected dates");
  expect(el.querySelector('[aria-label="Trend quality"]')?.textContent).toContain("100.0% coverage");
  expect(api.executeEnergyScopeAnalysis).not.toHaveBeenCalled();
  const click=async(text:string)=>act(async()=>{[...el.querySelectorAll("button")].find(b=>b.textContent===text)!.click()});
  await click("Hourly");
  expect(api.executeEnergyScopeAnalysis).not.toHaveBeenCalled();
  expect(el.textContent).not.toContain("Yesterday only");
  expect(el.textContent).not.toContain("Weekly");
  expect(el.textContent).toContain("Average 24-hour profile");
  expect(el.querySelector('[aria-label="Trend quality"]')?.textContent).toContain("100.0% coverage");

 } finally {await act(async()=>root.unmount());el.remove();vi.unstubAllGlobals();}
});
