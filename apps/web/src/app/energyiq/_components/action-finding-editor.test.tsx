/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ActionFindingEditor } from "./action-finding-editor";
import { configApi } from "../../../lib/config-api";

it("keeps an evidence draft after failure and submits the scoped relation on retry", async () => {
 vi.stubGlobal("React",React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const save=vi.fn(), request=vi.spyOn(configApi,"reportActionRequest").mockRejectedValueOnce(new Error("quote mismatch")).mockResolvedValueOnce({});
 const host=document.createElement("div"); document.body.append(host); const root=createRoot(host);
 try {
  await act(async()=>root.render(<ActionFindingEditor projectId="p" action={{id:"a",title:"Check the timer",sourceReportId:"r"}} findings={[]} onSaved={save} onCancel={()=>{}}/>));
  const fields=[host.querySelector("input")!,...host.querySelectorAll("textarea")];
  const values=["Night demand","Demand stays high outside operating hours.","Demand stays high outside operating hours."];
  for(let i=0;i<fields.length;i++) await act(async()=>{
   const field=fields[i]!; const proto=field.tagName==="TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
   Object.getOwnPropertyDescriptor(proto,"value")!.set!.call(field,values[i]); field.dispatchEvent(new Event("input",{bubbles:true}));
  });
  const submit=()=>act(async()=>{host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
  await submit(); expect(save).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.querySelector("textarea")?.value).toBe(values[1]);
  await submit(); expect(save).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenLastCalledWith("p","insights",{method:"POST",body:JSON.stringify({actionId:"a",title:values[0],summary:values[1],sourceQuote:values[2]})});
 }finally{await act(async()=>root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();}
});
