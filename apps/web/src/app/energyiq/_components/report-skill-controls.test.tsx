/** @vitest-environment happy-dom */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ reportAgentRequest: vi.fn() }));
vi.mock("../../../lib/config-api", () => ({ configApi: api }));
import { methodDescription, methodTitle, ReportSkillUsage, ReportSkillSelector, ReportSkillVersionDialog, type SkillSelection } from "./report-skill-controls";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY } from "./energyiq-messages";
let container: HTMLDivElement; let root: Root;
const method = {id:"method",name:"Baseline",version:"1",content:"Recompute",scope:"project" as const,revision:1,isDefault:true};
beforeEach(() => { vi.stubGlobal("React",React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true); api.reportAgentRequest.mockReset(); container=document.createElement("div");document.body.append(container);root=createRoot(container); });
afterEach(async () => { await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals(); });
async function click(text:string) { const button=[...container.querySelectorAll("button")].find(item=>item.textContent===text)!;expect(button).toBeDefined();await act(async()=>button.click()); }
async function version(value:string) {const input=container.querySelector<HTMLInputElement>('[aria-label="New version number"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});}
it("keeps visual styles out of analysis selection and analysis draft revision targets", async () => {
  const style = {...method,id:"style",name:"Office style",category:"presentation" as const};
  await act(async()=>root.render(<ReportSkillSelector skills={[method,style]} value={{mode:"selected",refs:[]}} onChange={()=>{}}/>));
  expect(container.textContent).not.toContain("Office style");
  await act(async()=>root.render(<ReportSkillVersionDialog canManageProject projectId="p" skills={[style,method]} content="A better analysis" onClose={()=>{}} onSaved={()=>{}}/>));
  expect([...container.querySelectorAll('option')].map(option=>option.textContent)).not.toContain("Office style");
});
it("keeps required review visible when optional methods are deselected without writing defaults",async()=>{
  let selected:SkillSelection|undefined;
  function Harness(){const [value,setValue]=useState<SkillSelection>({mode:"default",refs:[]});selected=value;return <ReportSkillSelector skills={[method,{...method,id:"review",name:"Report review",required:true}]} value={value} onChange={setValue}/>;}
  await act(async()=>root.render(<Harness/>));
  await click("Choose method");
  expect(selected).toEqual({mode:"selected",refs:[]});
  expect(container.textContent).not.toContain("Report review");
  expect(api.reportAgentRequest).not.toHaveBeenCalled();
});
it("saves a new version before a separate explicit default activation",async()=>{
  api.reportAgentRequest.mockImplementation(async(_project,path)=>path==="skills"?{...method,version:"2"}:{settings:{revision:9}});
  await act(async()=>root.render(<ReportSkillVersionDialog canManageProject projectId="p" skills={[method]} content="Revised baseline" onClose={()=>{}} onSaved={()=>{}}/>));
  await version("2");await click("Save new version");
  expect(api.reportAgentRequest.mock.calls.map(call=>call[1])).toEqual(["skills"]);
  expect(container.textContent).toContain("Project defaults are unchanged");
  await click("Set as project default");
  const activation=api.reportAgentRequest.mock.calls.find(call=>call[1]==="skills/default")!;
  expect(JSON.parse(activation[2].body)).toEqual({id:"method",version:"2",revision:9});
});
it("offers a member only personal storage and no project activation",async()=>{
  api.reportAgentRequest.mockResolvedValue({...method,version:"2",scope:"personal"});
  await act(async()=>root.render(<ReportSkillVersionDialog canManageProject={false} projectId="p" skills={[]} content="My method" onClose={()=>{}} onSaved={()=>{}}/>));
  expect(container.querySelector('option[value="project"]')).toBeNull();
  await version("2");await click("Save new version");
  expect(JSON.parse(api.reportAgentRequest.mock.calls[0]![2].body).scope).toBe("personal");
  expect(container.textContent).not.toContain("Set as project default");
});

it("groups versions by method and pins the chosen version",async()=>{
  let selected:SkillSelection|undefined;
  function Harness(){const [value,setValue]=useState<SkillSelection>({mode:"default",refs:[]});selected=value;return <ReportSkillSelector skills={[method,{...method,version:"2",isDefault:false}]} value={value} onChange={setValue}/>;}
  await act(async()=>root.render(<Harness/>));
  expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  await click("Choose method");
  expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  const select=container.querySelector<HTMLSelectElement>('select')!;
  await act(async()=>{select.value="2";select.dispatchEvent(new Event("change",{bubbles:true}));});
  await act(async()=>container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(selected).toEqual({mode:"selected",refs:[{id:"method",version:"2"}]});
  await click("Automatic");
  expect(selected).toEqual({mode:"default",refs:[]});
  expect(api.reportAgentRequest).not.toHaveBeenCalled();
});

it("keeps method evidence secondary and separates chosen, default and required methods",async()=>{
 await act(async()=>root.render(<ReportSkillUsage prepared skills={[{id:"a",name:"Night loads",version:"2",source:"explicit"},{id:"b",name:"Office report",version:"1",source:"default"},{id:"c",name:"Review",version:"3",source:"required"}]}/>));
 expect(container.querySelector('details')?.open).toBe(false);
 expect([...container.querySelectorAll('h4')].map(item=>item.textContent)).toEqual(['Your choices','Project defaults','Built-in checks']);
 expect(container.textContent).toContain('v2');expect(container.textContent).toContain('The advisor received these instructions');
});

it.each([true,false])("compares saved changes with enabled version or latest fallback (enabled=%s)",async(enabled)=>{
 const old={...method,isDefault:false,version:"1",content:"Old content"};
 const current={...old,version:"2",content:"Enabled content",isDefault:enabled};
 const latest={...old,version:"3",content:"Latest content"};
 await act(async()=>root.render(<ReportSkillVersionDialog canManageProject projectId="p" skills={[old,current,latest]} initial={old} content="Proposed content" onClose={()=>{}} onSaved={()=>{}}/>));
 expect(container.textContent).toContain(`Compare with ${enabled ? "2" : "3"}`);
 expect(container.querySelector('pre')?.textContent).toBe(enabled ? "Enabled content" : "Latest content");
});

it("names methods in plain words and tells same-named methods apart by version",async()=>{
  expect(methodTitle("tuya-interactive-report")).toBe("Tuya interactive report");
  expect(methodTitle("Report review")).toBe("Report review");
  expect(methodDescription('---\nname: x\ndescription: "Reusable report analysis method"\n---\nBody')).toBeNull();
  expect(methodDescription("---\nname: x\ndescription: Explore interval data.\n---\nBody")).toBe("Explore interval data.");
  const a={...method,id:"a",name:"tuya-interactive-report",version:"1.1.1"}, b={...method,id:"b",name:"tuya-interactive-report",version:"1.0.1"};
  await act(async()=>root.render(<ReportSkillSelector skills={[a,b]} value={{mode:"selected",refs:[]}} onChange={()=>{}}/>));
  expect([...container.querySelectorAll("strong[title]")].map(item=>item.textContent)).toEqual(["Tuya interactive report (version 1.1.1)","Tuya interactive report (version 1.0.1)"]);
});
it("closes with Done, Escape or a click outside",async()=>{
  await act(async()=>root.render(<ReportSkillSelector skills={[method]} value={{mode:"default",refs:[]}} onChange={()=>{}}/>));
  const details=container.querySelector("details")!;
  const openIt=async()=>{await act(async()=>{details.open=true;details.dispatchEvent(new Event("toggle"));});expect(details.open).toBe(true);};
  await openIt(); await click("Done"); expect(details.open).toBe(false);
  await openIt(); await act(async()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))); expect(details.open).toBe(false);
  await openIt(); await act(async()=>document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))); expect(details.open).toBe(false);
});

const LOCALISED = {
  "zh-Hans": {
    automatic: "分析方法 · 自动", selected: "分析方法 · 已选 0 项", heading: "分析方法", close: "关闭分析方法", group: "方法选择", auto: "自动", choose: "选择方法",
    meta: "版本 1 · 与此项目共享", advanced: "高级详情", versionSelect: "Baseline 的版本", savedName: "保存的名称：Baseline", done: "完成",
    dialog: "保存说明", review: "检查说明", newVersion: "新版本号", placeholder: "例如 1.1.0", instructions: "建议的顾问说明", create: "创建新说明", save: "保存新版本",
    saved: "已保存“Baseline”版本 2。项目默认设置保持不变。", setDefault: "设为项目默认", activated: "已更新项目默认方法。今后的消息和自动报告都会使用此方法。",
    groups: ["您的选择", "项目默认", "内置检查"], usage: "此回答使用的方法",
  },
  ms: {
    automatic: "Kaedah analisis · Automatik", selected: "Kaedah analisis · 0 dipilih", heading: "Kaedah analisis", close: "Tutup kaedah analisis", group: "Pemilihan kaedah", auto: "Automatik", choose: "Pilih kaedah",
    meta: "Versi 1 · Dikongsi dengan projek ini", advanced: "Butiran lanjutan", versionSelect: "Versi Baseline", savedName: "Nama yang disimpan: Baseline", done: "Selesai",
    dialog: "Simpan arahan", review: "Semak arahan", newVersion: "Nombor versi baharu", placeholder: "cth. 1.1.0", instructions: "Arahan penasihat yang dicadangkan", create: "Cipta arahan baharu", save: "Simpan versi baharu",
    saved: "Baseline 2 telah disimpan. Lalai projek kekal tidak berubah.", setDefault: "Tetapkan sebagai lalai projek", activated: "Lalai projek dikemas kini. Mesej dan laporan automatik akan datang akan menggunakan kaedah ini.",
    groups: ["Pilihan anda", "Lalai projek", "Semakan terbina dalam"], usage: "Kaedah untuk jawapan ini",
  },
} as const;
describe.each(Object.entries(LOCALISED))("in %s", (locale, text) => {
  beforeEach(() => localStorage.setItem(LANGUAGE_STORAGE_KEY, locale));
  afterEach(() => localStorage.clear());
  it("translates the analysis method picker but keeps Skill names and versions as saved", async () => {
    function Harness(){const [value,setValue]=useState<SkillSelection>({mode:"default",refs:[]});return <ReportSkillSelector skills={[method]} value={value} onChange={setValue}/>;}
    await act(async()=>root.render(<EnergyIqLocaleProvider><Harness/></EnergyIqLocaleProvider>));
    expect(container.querySelector("summary")?.textContent).toBe(text.automatic);
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(text.heading);
    expect(container.querySelector("strong")?.textContent).toBe(text.heading);
    expect([...container.querySelectorAll("button")].find(button => button.textContent === "×")?.getAttribute("aria-label")).toBe(text.close);
    expect(container.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe(text.group);
    expect(container.textContent).not.toContain("Analysis method");
    await click(text.choose);
    expect(container.querySelector("summary")?.textContent).toBe(text.selected);
    expect(container.querySelector('input[type="checkbox"]')?.getAttribute("aria-label")).toBe("Baseline");
    expect(container.textContent).toContain(text.meta);
    expect(container.textContent).toContain(text.advanced);
    expect(container.querySelector("select")?.getAttribute("aria-label")).toBe(text.versionSelect);
    expect(container.textContent).toContain(text.savedName);
    await click(text.auto);
    expect(container.querySelector("summary")?.textContent).toBe(text.automatic);
    expect([...container.querySelectorAll("button")].map(button => button.textContent)).toContain(text.done);
  });
  it("translates the Review Skill version dialog and its save and activation messages", async () => {
    api.reportAgentRequest.mockImplementation(async(_project,path)=>path==="skills"?{...method,version:"2"}:{settings:{revision:9}});
    await act(async()=>root.render(<EnergyIqLocaleProvider><ReportSkillVersionDialog canManageProject projectId="p" skills={[method]} content="Revised baseline" onClose={()=>{}} onSaved={()=>{}}/></EnergyIqLocaleProvider>));
    expect(container.querySelector("dialog")?.getAttribute("aria-label")).toBe(text.dialog);
    expect(container.querySelector("h2")?.textContent).toBe(text.review);
    const input = container.querySelector<HTMLInputElement>(`[aria-label="${text.newVersion}"]`)!;
    expect(input.placeholder).toBe(text.placeholder);
    expect(container.querySelector(`[aria-label="${text.instructions}"]`)).not.toBeNull();
    expect([...container.querySelectorAll("option")].map(option => option.textContent)).toEqual(expect.arrayContaining([text.create, "Baseline"]));
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"2");input.dispatchEvent(new Event("input",{bubbles:true}));});
    await click(text.save);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(text.saved);
    await click(text.setDefault);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(text.activated);
  });
  it("keeps the default name of a new Skill in English because it is saved", async () => {
    await act(async()=>root.render(<EnergyIqLocaleProvider><ReportSkillVersionDialog canManageProject projectId="p" skills={[]} content="A method" onClose={()=>{}} onSaved={()=>{}}/></EnergyIqLocaleProvider>));
    expect(container.querySelector<HTMLInputElement>("input:not([aria-label])")?.value).toBe("Project analysis");
  });
  it("translates the methods used for an answer", async () => {
    await act(async()=>root.render(<EnergyIqLocaleProvider><ReportSkillUsage prepared={false} skills={[{id:"a",name:"Night loads",version:"2",source:"explicit"},{id:"b",name:"Office report",version:"1",source:"default"},{id:"c",name:"Review",version:"3",source:"required"}]}/></EnergyIqLocaleProvider>));
    expect(container.querySelector("summary")?.textContent).toBe(`${text.usage} 3`);
    expect([...container.querySelectorAll("h4")].map(item => item.textContent)).toEqual(text.groups);
    expect(container.textContent).toContain("Night loads");
  });
});
