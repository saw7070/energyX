/** @vitest-environment happy-dom */
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {beforeEach, afterEach, it, expect, vi} from "vitest";
import {CreateProjectDialog} from "./create-project-dialog";
const api=vi.hoisted(()=>({createEnergyProject:vi.fn()}));
vi.mock("../../../lib/config-api",()=>({configApi:api}));
let container: HTMLDivElement; let root: Root;
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.stubGlobal("React",React);container=document.createElement("div");document.body.append(container);root=createRoot(container);api.createEnergyProject.mockReset();api.createEnergyProject.mockResolvedValue({project:{id:"created-project"}});});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
async function enterName(){const input=container.querySelector("input")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"New School");input.dispatchEvent(new Event("input",{bubbles:true}));});}
async function submit(){await act(async()=>{container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});}
it("creates only project identity then hands off to initialization, without manual meter configuration",async()=>{
 const created=vi.fn(async()=>{});await act(async()=>root.render(<CreateProjectDialog workspaceName="School FM" onCreated={created} onClose={()=>{}}/>));
 expect(container.textContent).toContain("School FM");
 await enterName();await submit();
 expect(api.createEnergyProject).toHaveBeenCalledWith({name:"New School",timezone:"Asia/Singapore"});
 expect(created).toHaveBeenCalledWith("created-project");
});
it("retries navigation to the same created project instead of creating a duplicate",async()=>{
 const created=vi.fn().mockRejectedValueOnce(new Error("refresh failed")).mockResolvedValue(undefined);
 await act(async()=>root.render(<CreateProjectDialog workspaceName="School FM" onCreated={created} onClose={()=>{}}/>));
 await enterName();await submit();
 expect(container.querySelector('[role="alert"]')?.textContent).toContain("Your project was created");
 await submit();expect(api.createEnergyProject).toHaveBeenCalledTimes(1);expect(created).toHaveBeenCalledTimes(2);
});
it("does not continue after a rejected create request",async()=>{
 api.createEnergyProject.mockRejectedValueOnce(new Error("forbidden"));const created=vi.fn();
 await act(async()=>root.render(<CreateProjectDialog workspaceName="School FM" onCreated={created} onClose={()=>{}}/>));
 await enterName();await submit();expect(created).not.toHaveBeenCalled();expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
