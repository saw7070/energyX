/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { EnergyAccessContextDto, EnergyProjectDto } from "../../../lib/config-api";
const api = vi.hoisted(()=>({getEnergyAccessContext:vi.fn()}));
vi.mock("../../../lib/config-api",()=>({configApi:api}));
import { ProjectSwitcher } from "./project-switcher";
let container: HTMLDivElement, root: Root;
const project = (id:string, workspaceId:string, status:EnergyProjectDto["status"]="published"):EnergyProjectDto=>({id,name:id,workspaceId,status,timezone:"Asia/Singapore"});
const current=project("Office","a");
const access:EnergyAccessContextDto={role:"admin",user:{id:"u"},activeWorkspaceId:"a",projects:[current],workspaces:[{id:"a",name:"Customer A",kind:"customer",disabled:false},{id:"b",name:"Customer B",kind:"customer",disabled:false},{id:"c",name:"Disabled customer",kind:"customer",disabled:true}]};
const onSelect=vi.fn(),onCreate=vi.fn();
beforeEach(()=>{vi.stubGlobal("React",React);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);container=document.createElement("div");document.body.append(container);root=createRoot(container);onSelect.mockReset();onCreate.mockReset();api.getEnergyAccessContext.mockReset();api.getEnergyAccessContext.mockResolvedValue({...access,activeWorkspaceId:"b",projects:[project("School","b"),project("Draft","b","draft"),project("Wrong tenant","c")]});});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
async function open(role:"admin"|"user"="admin") {await act(async()=>root.render(<ProjectSwitcher access={{...access,role}} activeProject={current} projects={[current]} allowDrafts={role==="admin"} allowArchived={false} busy={false} canCreate={role==="admin"} onSelect={onSelect} onCreate={onCreate}/>));await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Choose project"]')!.click());}
describe("single project picker",()=>{
 it("choosing the current project closes without resetting the current conversation",async()=>{await open();await act(async()=>container.querySelector<HTMLButtonElement>("button[data-project]")!.click());expect(onSelect).not.toHaveBeenCalled();expect(container.querySelector("dialog")).toBeNull();});
 it("has one entry, loads only authorised customers, and selects a specific project",async()=>{await open();expect(api.getEnergyAccessContext).toHaveBeenCalledTimes(1);expect(api.getEnergyAccessContext).toHaveBeenCalledWith(expect.objectContaining({workspaceId:"b"}));expect(container.textContent).not.toContain("Wrong tenant");expect(container.textContent).not.toContain("Disabled customer");await act(async()=>[...container.querySelectorAll<HTMLButtonElement>("button[data-project]")].find(b=>b.textContent==="School")!.click());expect(onSelect).toHaveBeenCalledWith("b","School");expect(container.querySelector("dialog")).toBeNull();});
 it("does not offer draft projects or create for a normal reader",async()=>{await open("user");expect(container.textContent).not.toContain("Draft");expect(container.textContent).not.toContain("Create project");});
 it("searches customer and project names and supports keyboard focus",async()=>{await open();const input=container.querySelector<HTMLInputElement>("input")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"School");input.dispatchEvent(new Event("input",{bubbles:true}));});expect(container.querySelectorAll("button[data-project]")).toHaveLength(1);await act(async()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true})));expect(document.activeElement?.textContent).toBe("School");});
 it("keeps the picker open on switching failure and retries loading errors",async()=>{api.getEnergyAccessContext.mockRejectedValueOnce(new Error("network"));await open();expect(container.textContent).toContain("Retry");await act(async()=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.includes("Retry"))!.click());onSelect.mockRejectedValueOnce(new Error("denied"));await act(async()=>[...container.querySelectorAll<HTMLButtonElement>("button[data-project]")].find(b=>b.textContent==="School")!.click());expect(container.querySelector('[role="alert"]')?.textContent).toContain("Unable to switch");expect(container.querySelector("dialog")).not.toBeNull();});
 it("retains the admin create action scoped to the current customer",async()=>{await open();const create=[...container.querySelectorAll<HTMLButtonElement>("footer button")][0]!;expect(create.textContent).toContain("Customer A");await act(async()=>create.click());expect(onCreate).toHaveBeenCalledOnce();});
});
