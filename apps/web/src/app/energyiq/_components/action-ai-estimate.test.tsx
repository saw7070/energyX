/** @vitest-environment happy-dom */
import React, {act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
import {configApi} from "../../../lib/config-api";
import {ActionAiEstimate} from "./action-ai-estimate";
it("shows the published annual scenario without automatically generating another estimate",async()=>{
 vi.stubGlobal("React",React);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const request=vi.spyOn(configApi,"reportActionRequest").mockResolvedValue({canGenerate:true,items:[],publishedBenefit:{reportId:"r1",benefit:"Could save SGD 576/year if approved",evidence:"88 complete weekdays",scenario:{referenceYear:2027,method:"Observed evening windows",assumptions:["Confirm equipment needs"]}}} as never);
 const div=document.createElement("div");document.body.append(div);const root=createRoot(div);
 try{
  await act(async()=>root.render(<ActionAiEstimate projectId="p" actionId="a"/>));
  expect(request).toHaveBeenCalledTimes(1);
  expect(div.textContent).toContain("Could save SGD 576/year if approved");
  expect(div.textContent).not.toContain("Reviewing the readings");
  expect(div.querySelector("a")?.getAttribute("href")).toContain("reportId=r1");
  const update=Array.from(div.querySelectorAll("button")).find(b=>b.textContent==="Update with latest readings");
  expect(update?.disabled).toBe(false);
 }finally{await act(async()=>root.unmount());div.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
it("reuses saved assessments and keeps a written reply when a request fails",async()=>{
  vi.stubGlobal("React",React);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const request=vi.spyOn(configApi,"reportActionRequest").mockImplementation(async(_project,_path,options)=>{
    if(options?.method==="POST")throw new Error("Offline");
    return {canGenerate:true,items:[{id:"v1",version:1,status:"succeeded",createdAt:"2026-09-17T00:00:00Z",result:{recommendation:"Check the schedule",expectedEffect:"Identify unnecessary operation",evidence:["Measured overnight use"],assumptions:[],questions:["What does this circuit serve?"],quantification:{status:"not_quantified",reason:"Purpose unknown"}}}]} as never;
  });
  const div=document.createElement("div");document.body.append(div);const root=createRoot(div);
  try{
    await act(async()=>root.render(<ActionAiEstimate projectId="p" actionId="a"/>));
    expect(request).toHaveBeenCalledTimes(1);
    const area=div.querySelector("textarea")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(area,"It serves lights.");area.dispatchEvent(new Event("input",{bubbles:true}));});
    const button=Array.from(div.querySelectorAll("button")).find(b=>b.textContent?.includes("Reassess"));
    expect(button).toBeTruthy();
    await act(async()=>button!.click());
    expect(area.value).toBe("It serves lights.");
    expect(div.textContent).toContain("saved estimate is unchanged");
    expect(div.textContent).toContain("Check the schedule");
  }finally{await act(async()=>root.unmount());div.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
