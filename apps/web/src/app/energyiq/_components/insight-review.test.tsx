/** @vitest-environment happy-dom */
import React, {act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
import {InsightReview} from "./insight-review";
import {configApi} from "../../../lib/config-api";
it("preserves a review draft on conflict and submits the expected revision",async()=>{
 vi.stubGlobal("React",React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const request=vi.spyOn(configApi,"reportActionRequest").mockRejectedValue(new Error("conflict"));
 const host=document.createElement("div"),root=createRoot(host),saved=vi.fn();
 const review={revision:3,status:"monitoring",importance:"high",urgency:"soon",reason:"Awaiting comparable observations"};
 try {
 await act(async()=>root.render(<InsightReview projectId="p" insight={{id:"i",title:"Night load",review}} onSaved={saved}/>));
 await act(async()=>{host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
 expect(request).toHaveBeenCalledWith("p","insights/i/review",{method:"POST",body:JSON.stringify(review)});
 expect(host.querySelector("textarea")?.value).toBe(review.reason);
 expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(saved).not.toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();}
});
