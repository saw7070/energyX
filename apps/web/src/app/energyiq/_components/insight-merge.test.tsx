/** @vitest-environment happy-dom */
import React,{act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
import {InsightMerge} from "./insight-merge";
import {configApi} from "../../../lib/config-api";
it("requires explicit confirmation to undo and preserves notes when saving fails",async()=>{
 vi.stubGlobal("React",React);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const request=vi.spyOn(configApi,"reportActionRequest").mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
 const host=document.createElement("div"),root=createRoot(host),saved=vi.fn();
 try {
 await act(async()=>root.render(<InsightMerge projectId="p" finding={{id:"i",title:"Night load",summary:"Steady demand",actionIds:[],sources:[],mergeId:"m",mergedFindings:[{id:"j",title:"Night routine",summary:"Overnight demand"}]}} findings={[]} onSaved={saved}/>));
 const submit=()=>act(async()=>{host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
 await submit();expect(request).not.toHaveBeenCalled();
 await act(async()=>{const text=host.querySelector("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(text,"These causes need separate investigation");text.dispatchEvent(new Event("input",{bubbles:true}));host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();});
 await submit();expect(saved).not.toHaveBeenCalled();expect(host.querySelector("textarea")?.value).toBe("These causes need separate investigation");expect(host.querySelector('[role="alert"]')).not.toBeNull();
 await submit();expect(saved).toHaveBeenCalledOnce();expect(request).toHaveBeenLastCalledWith("p","insight-merges/m/undo",{method:"POST",body:JSON.stringify({reason:"These causes need separate investigation"})});
 }finally{await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();}
});

it("does not suggest grouping findings about different meters",async()=>{
 vi.stubGlobal("React",React);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const host=document.createElement("div"),root=createRoot(host);
 const finding={id:"a",title:"Night load",summary:"Overnight power",version:"v",meterIds:["B05"],actionIds:[],sources:[]};
 try {
 await act(async()=>root.render(<InsightMerge projectId="p" finding={finding} findings={[finding,{...finding,id:"b",meterIds:["B06"]}]} onSaved={()=>{}}/>));
 expect(host.textContent).toBe("");
 await act(async()=>root.render(<InsightMerge projectId="p" finding={finding} findings={[finding,{...finding,id:"b"}]} onSaved={()=>{}}/>));
 expect(host.textContent).toContain("Compare related findings");
 expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled ?? host.querySelector('form')?.lastElementChild?.hasAttribute('disabled')).toBe(true);
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
