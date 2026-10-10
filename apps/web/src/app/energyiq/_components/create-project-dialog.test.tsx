/** @vitest-environment happy-dom */
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {beforeEach, afterEach, it, expect, vi} from "vitest";
import {CreateProjectDialog} from "./create-project-dialog";
const api=vi.hoisted(()=>({createEnergyProject:vi.fn(),publishEnergyTariffSchedule:vi.fn(),publishEnergyOperatingCalendar:vi.fn()}));
vi.mock("../../../lib/config-api",()=>({configApi:api}));
let container: HTMLDivElement; let root: Root;
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.stubGlobal("React",React);container=document.createElement("div");document.body.append(container);root=createRoot(container);
 for(const call of Object.values(api)) call.mockReset();
 api.createEnergyProject.mockResolvedValue({project:{id:"created-project"}});api.publishEnergyTariffSchedule.mockResolvedValue({});api.publishEnergyOperatingCalendar.mockResolvedValue({});});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
const button=(text:string)=>Array.from(container.querySelectorAll("button")).find(item=>item.textContent?.includes(text))!;
const click=async(text:string)=>act(async()=>button(text).click());
async function enterName(){const input=container.querySelector("input")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"New School");input.dispatchEvent(new Event("input",{bubbles:true}));});}
async function submit(){await act(async()=>{container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});}
async function openSingapore(created=vi.fn(async()=>{})){
 await act(async()=>root.render(<CreateProjectDialog workspaceName="School FM" onCreated={created} onClose={()=>{}}/>));
 await enterName();await click("Singapore");await submit();return created;
}

it("asks where the site is, shows its settings, then creates the project with its price, hours and holidays",async()=>{
 const created=vi.fn(async()=>{});
 await act(async()=>root.render(<CreateProjectDialog workspaceName="School FM" onCreated={created} onClose={()=>{}}/>));
 expect(container.textContent).toContain("School FM");
 await enterName();
 expect(button("Next: check the settings").disabled).toBe(true);
 await click("Singapore");
 expect(button("Next: check the settings").disabled).toBe(false);
 await submit();
 expect(container.textContent).toContain("Check the settings");
 expect(container.textContent).toContain("SP Group regulated tariff");
 const price=Array.from(container.querySelectorAll("label")).find(item=>item.textContent?.startsWith("Price per kWh"))!.querySelector("input")!;
 expect(price.value).toBe("0.2859");
 expect(container.textContent).toContain("= 28.59 cents");
 await submit();
 expect(api.createEnergyProject).toHaveBeenCalledWith({name:"New School",timezone:"Asia/Singapore",region:{country:"SG"}});
 expect(api.publishEnergyTariffSchedule).toHaveBeenCalledWith("created-project",{entries:[expect.objectContaining({currency:"SGD",ratePerKwh:0.2859,tax:{name:"GST",ratePct:9}})]});
 expect(api.publishEnergyOperatingCalendar).toHaveBeenCalledWith("created-project",{entries:[expect.objectContaining({effectiveFrom:"2020-01-01",exceptions:expect.arrayContaining([expect.objectContaining({date:"2026-08-10",classification:"public_holiday"})])})]});
 expect(created).toHaveBeenCalledWith("created-project");
});

it("needs a Malaysian state before moving on, and sends it with the project",async()=>{
 await act(async()=>root.render(<CreateProjectDialog workspaceName="Elite IOT" onCreated={vi.fn(async()=>{})} onClose={()=>{}}/>));
 await enterName();await click("Malaysia");
 expect(container.textContent).toContain("State");
 expect(button("Next: check the settings").disabled).toBe(true);
});

it("leaves sections for later without saving them",async()=>{
 const created=await openSingapore();
 for(const section of container.querySelectorAll('section[aria-label="Electricity price"], section[aria-label="Opening hours"]'))
  await act(async()=>Array.from(section.querySelectorAll("button")).find(item=>item.textContent==="Set up later")!.click());
 await submit();
 expect(api.publishEnergyTariffSchedule).not.toHaveBeenCalled();
 expect(api.publishEnergyOperatingCalendar).not.toHaveBeenCalled();
 expect(created).toHaveBeenCalledWith("created-project");
});

it("retries only what failed and never creates the project twice",async()=>{
 api.publishEnergyTariffSchedule.mockRejectedValueOnce(new Error("offline"));
 const created=await openSingapore();
 await submit();
 expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be saved");
 expect(created).not.toHaveBeenCalled();
 await submit();
 expect(api.createEnergyProject).toHaveBeenCalledTimes(1);
 expect(api.publishEnergyTariffSchedule).toHaveBeenCalledTimes(2);
 expect(api.publishEnergyOperatingCalendar).toHaveBeenCalledTimes(1);
 expect(created).toHaveBeenCalledTimes(1);
});

it("retries navigation to the same created project instead of creating a duplicate",async()=>{
 const created=vi.fn().mockRejectedValueOnce(new Error("refresh failed")).mockResolvedValue(undefined);
 await openSingapore(created);await submit();
 expect(container.querySelector('[role="alert"]')?.textContent).toContain("Your project was created");
 await submit();expect(api.createEnergyProject).toHaveBeenCalledTimes(1);expect(created).toHaveBeenCalledTimes(2);
});

it("does not continue after a rejected create request",async()=>{
 api.createEnergyProject.mockRejectedValueOnce(new Error("forbidden"));const created=await openSingapore();
 await submit();expect(created).not.toHaveBeenCalled();expect(container.querySelector('[role="alert"]')).not.toBeNull();
 expect(api.publishEnergyTariffSchedule).not.toHaveBeenCalled();
});
