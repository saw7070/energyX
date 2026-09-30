/** @vitest-environment happy-dom */
import React,{act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {configApi} from "../../../lib/config-api";
import {ProjectActions} from "./project-actions";
vi.mock("./action-result-notices",()=>({ActionResultNotices:()=>null}));
vi.mock("./report-action-panel",()=>({ReportActionPanel:({actionId,insightTitle}:{actionId:string;insightTitle?:string})=><div><div data-testid="selected-action">{actionId}</div>{insightTitle}</div>}));
it("shows finding-action relationships once and filters linked paused actions consistently",async()=>{
 vi.stubGlobal("React",React);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const a={id:"linked",title:"Review the operating hours",recommendation:"Confirm the schedule",state:"paused",sourceReportId:"r",canPrioritise:false,sources:[],priority:{revision:0,level:"medium",reason:"Check first"}};
 vi.spyOn(configApi,"reportActionRequest").mockResolvedValue({insights:[{id:"finding",title:"Persistent night load",summary:"Demand continues overnight. Confirm the equipment.",actionIds:["linked"],sources:[{reportId:"r",sourceQuote:"Demand continues overnight."}]}],actions:[a,{...a,id:"other",title:"Check lighting",state:"proposed"}]});
 const div=document.createElement("div");document.body.append(div);const root=createRoot(div);
 try{
  await act(async()=>root.render(<ProjectActions projectId="p"/>));
  expect(div.textContent).toContain("1 finding");expect(div.textContent).toContain("What we found");expect(div.textContent).toContain("What you can do");
  expect(div.textContent!.split(a.title)).toHaveLength(2);
  expect(div.textContent).toContain("not yet linked to a finding");
  await act(async()=>[...div.querySelectorAll("button")].find(b=>b.textContent==="Active actions")!.click());
  expect(div.textContent).not.toContain(a.title);expect(div.textContent).toContain("Check lighting");
  await act(async()=>[...div.querySelectorAll("button")].find(b=>b.textContent==="All actions")!.click());
  await act(async()=>[...div.querySelectorAll("button")].find(b=>b.textContent==="Review action")!.click());
  expect(div.querySelector('[data-testid="selected-action"]')?.textContent).toBe("linked");
  expect(div.textContent).toContain("Persistent night load");
 }finally{await act(async()=>root.unmount());div.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
it("orders actions by priority and saves priority without changing execution",async()=>{
 vi.stubGlobal("React",React);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const item={id:"low",title:"Low action",recommendation:"Review",state:"proposed",sourceReportId:"r",canPrioritise:true,sources:[{reportId:"r",recommendation:"Review"}],priority:{revision:0,level:"low",reason:"Low impact"}};
 const req=vi.spyOn(configApi,"reportActionRequest").mockResolvedValue({actions:[item,{...item,id:"high",title:"High action",priority:{revision:0,level:"high",reason:"High impact"}}]});
 const div=document.createElement("div");document.body.append(div);const root=createRoot(div);
 try{
 await act(async()=>root.render(<ProjectActions projectId="p"/>));
 expect(div.querySelector("article h2")?.textContent).toBe("High action");
 await act(async()=>[...div.querySelectorAll("button")].find(b=>b.textContent==="Set priority")!.click());
 await act(async()=>[...div.querySelectorAll("button")].find(b=>b.textContent==="Save priority")!.click());
 expect(req).toHaveBeenCalledWith("p","high/priority",{method:"POST",body:JSON.stringify({revision:0,level:"high",reason:"High impact"})});
 }finally{await act(async()=>root.unmount());div.remove();vi.restoreAllMocks();vi.unstubAllGlobals()}
});
