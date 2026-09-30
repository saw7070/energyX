/** @vitest-environment happy-dom */
import React, {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({query:vi.fn(()=>new Promise(()=>{})),hierarchy:vi.fn()}));
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams("projectId=p&scopeId=db")}));
vi.mock("./energyiq-access",()=>({useEnergyIqAccess:()=>({access:{projects:[{id:"p",name:"Office",status:"published",workspaceId:"w"}],activeWorkspaceId:"w"},activeProject:{id:"p",name:"Office",status:"published",workspaceId:"w"},selectProject:()=>{}})}));
vi.mock("../../../lib/config-api",()=>({configApi:{getEnergyProjectHierarchy:mocks.hierarchy,executeEnergyScopeAnalysis:mocks.query}}));
import {ProjectExplorer} from "./project-explorer";
it.each([false,true])("keeps circuit selection and real scope with optional grouping: %s",async(grouped)=>{
 vi.stubGlobal("React",React);globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 mocks.query.mockClear();
 mocks.hierarchy.mockResolvedValue({nodes:[{id:"p",name:"Office",node_type:"project"},{id:"db",name:"DB1",parent_id:"p",node_type:"distribution board"}],electricityMeters:[{id:"m1",name:"Lighting",scopeId:"db",kind:"physical",role:"component",coverage:"partial",category:"light",includedInOfficialTotal:false,...(grouped?{displayGroup:"AV / TV",circuitName:"L1P17"}:{})}]});
 const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
 try{
  await act(async()=>root.render(<ProjectExplorer/>));
  const db=[...container.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')].find(el=>el.textContent?.includes("DB1"))!;
  await act(async()=>db.click());
  if(grouped){
   const calls=mocks.query.mock.calls.length;
   const group=[...container.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')].find(el=>el.textContent?.includes("AV / TV"))!;
   expect(container.textContent).not.toContain("L1P17");
   await act(async()=>group.click());
   expect(mocks.query.mock.calls.length).toBe(calls);
   expect(new URLSearchParams(window.location.search).get("scopeId")).toBe("db");
   expect(container.textContent).toContain("L1P17");
  }
  const meter=[...container.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')].find(el=>el.textContent?.includes("Lighting"))!;
  await act(async()=>meter.click());
  expect(new URLSearchParams(window.location.search).get("scopeId")).toBe("meter:m1");
  expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({projectId:"p",scopeId:"db"}));
  expect(container.querySelector('[aria-label="Circuit details"]')).not.toBeNull();
 }finally{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();}
});
