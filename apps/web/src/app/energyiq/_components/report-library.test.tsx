/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ role: "user", projectId: "p1", search: "projectId=p1", admin: vi.fn(), library: vi.fn(), select: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({replace:vi.fn(),push:vi.fn()}), useSearchParams: () => new URLSearchParams(mock.search) }));
vi.mock("./energyiq-access", () => ({ useEnergyIqAccess: () => ({ access: { role: mock.role, activeWorkspaceId: "w1", projects: [{ id: mock.projectId, workspaceId: "w1", status: "published" }] }, activeProject: { id: mock.projectId }, loading: false, error: null, selectProject: mock.select }) }));
vi.mock("../../../lib/config-api", () => ({ configApi: { reportAgentRequest: mock.admin, reportLibraryRequest: mock.library } }));
import { ReportProjectGate } from "./report-project-gate";
import { ReportLibraryView } from "./report-library";
import { ReportSessionNavigation, notifyReportSessionsChanged } from "./report-session-navigation";
let container: HTMLDivElement; let root: Root;
const library = { reports: [{ id: "report-one-11111111", title: "Scheduled office report", version: 1, category: "scheduled", kind: "report", period: { from: "2026-09-01", toExclusive: "2026-09-08" }, createdAt: "2026-09-08T10:00:00Z" }, { id: "report-two-22222222", title: "Custom office report", version: 2, category: "custom", kind: "report", period: { from: "2026-09-01", toExclusive: "2026-09-08" }, createdAt: "2026-09-08T11:00:00Z" }], skills: [{ id: "method", revision: 7, scope: "project", name: "Office method", version: "v3", content: "Analyze the baseline", sourceRunId: "skill-run", sourceSessionId: "source-session", projectId: "p1" }], tools: [{ name: "python", description: "Calculate from project inputs" }], canChat: false };
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal("React", React); mock.role = "user"; mock.projectId = "p1"; mock.search = "projectId=p1"; mock.admin.mockReset(); mock.library.mockReset(); mock.select.mockReset();
  mock.library.mockImplementation(async (_id, path = "") => path.startsWith("output/") ? { content: "<html><body>Project report</body></html>" } : library);
  mock.admin.mockResolvedValue({ sessions: [{ id: "s1", createdAt: "2026-09-11" }], runs: [{ sessionId: "s1", createdAt: "2026-09-11", prompt: "Analyze office loads" }] });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
describe("report navigation and read-only library", () => {
  it("blocks a direct AI Chat route for a normal user before mounting chat content", async () => {
    const chat = vi.fn(() => <div>Private chat</div>);
    await act(async () => root.render(<ReportProjectGate adminOnly>{chat}</ReportProjectGate>));
    expect(container.textContent).toContain("Administrator access required"); expect(chat).not.toHaveBeenCalled(); expect(mock.admin).not.toHaveBeenCalled();
  });
  it("rejects a project URL outside the active authorized workspace", async () => {
    mock.role = "admin"; mock.search = "projectId=forbidden";
    const child = vi.fn(() => <div>Private</div>);
    await act(async () => root.render(<ReportProjectGate>{child}</ReportProjectGate>));
    expect(child).not.toHaveBeenCalled(); expect(container.textContent).toContain("do not have access");
  });
  it("reads reports as a normal user without requesting admin history and distinguishes versions", async () => {
    await act(async () => root.render(<ReportProjectGate>{(projectId) => <ReportLibraryView projectId={projectId} view="reports" />}</ReportProjectGate>));
    expect(mock.admin).not.toHaveBeenCalled();
    expect(container.textContent).toContain("v1"); expect(container.textContent).toContain("v2");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open Scheduled office report"]')!.click());
    expect(mock.library).toHaveBeenCalledWith("p1", "output/report-one-11111111", expect.anything());
    expect(container.querySelector('aside iframe')?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(container.textContent).not.toContain("Working files");
  });
  it("filters using report category metadata and keeps owner working files out of customer views", async () => {
    mock.library.mockResolvedValue({ ...library, canChat:true,canManageProject:true, artifacts: [{ runId:"r1",filename:"private.csv",mimeType:"text/csv",bytes:10,createdAt:"2026-09-11" }] });
    await act(async () => root.render(<ReportLibraryView projectId="p1" view="reports" />));

    expect(container.querySelector('[aria-label="Project reports"] [aria-label="Open Scheduled office report"]')).not.toBeNull(); expect(container.querySelector('[aria-label="Project reports"] [aria-label="Open Custom office report"]')).not.toBeNull();
    expect(container.textContent).not.toContain("private.csv"); expect(container.textContent).not.toContain("Working files");
  });
  it("sorts by completion time within each report group",async()=>{
    mock.library.mockResolvedValue({...library,reports:[{...library.reports[1],id:"older",title:"Older completion",createdAt:"2026-09-12",finishedAt:"2026-09-12T01:00:00Z"},{...library.reports[1],id:"newer",title:"Latest completion",createdAt:"2026-09-10",finishedAt:"2026-09-12T02:00:00Z"}]});
    await act(async()=>root.render(<ReportLibraryView projectId="p1" view="reports" />));
    const cards=[...container.querySelectorAll('[aria-label="Project reports"] button[aria-label^="Open"]')];expect(cards[0]?.getAttribute("aria-label")).toBe("Open Latest completion");expect(container.querySelector('[aria-label="Automatic reports"]')).toBeNull();
  });
  it("uses explicit Skill scope and category without treating project composition as general",async()=>{
    mock.library.mockResolvedValue({...library,skills:[{...library.skills[0],name:"Investigation",scope:"general",category:"analysis"},{...library.skills[0],id:"style",name:"Tuya composition",scope:"project",category:"presentation"}]});
    await act(async()=>root.render(<ReportLibraryView projectId="p1" view="skills" />));
    const general=container.querySelector('[aria-label="Open Investigation"]')!;
    expect(general.textContent).toContain("Built in");expect(general.textContent).toContain("Analysis");
    const project=container.querySelector('[aria-label="Open Tuya composition"]')!;expect(project.textContent).toContain("Shared");expect(project.textContent).toContain("Report style");
    expect(container.textContent).toContain("2 saved");
  });
  it("groups reports by Singapore generation day with automatic reports first in the same grid",async()=>{
    mock.library.mockResolvedValue({...library,reports:[{...library.reports[1],title:"Later manual",finishedAt:"2026-09-11T18:00:00Z"},{...library.reports[0],title:"Earlier automatic",finishedAt:"2026-09-11T16:30:00Z"},{...library.reports[1],id:"previous-day",title:"Yesterday",finishedAt:"2026-09-11T15:59:00Z"}]});
    await act(async()=>root.render(<ReportLibraryView projectId="p1" view="reports" />));
    const today=container.querySelector('[aria-label="Reports generated 2026-09-12"]')!;expect(today).not.toBeNull();const cards=today.querySelectorAll('button[aria-label^="Open"]');expect(cards[0]?.textContent).toContain("Earlier automatic");expect(cards[0]?.textContent).toContain("Automatically generated");expect(cards[1]?.textContent).toContain("Later manual");expect(container.querySelector('[aria-label="Reports generated 2026-09-11"]')?.textContent).toContain("Yesterday");
  });
  it("opens Skill metadata and full instructions in a modal and restores focus on Escape",async()=>{
    await act(async()=>root.render(<ReportLibraryView projectId="p1" view="skills" />));
    const opener=container.querySelector<HTMLButtonElement>('[aria-label="Open Office method"]')!;
    await act(async()=>{opener.focus();opener.click();});const dialog=container.querySelector("dialog")!;expect(dialog.textContent).toContain("Analyze the baseline");expect(dialog.textContent).toContain("Version");expect(dialog.textContent).toContain("This project");expect(dialog.textContent).not.toContain("skill-run");
    await act(async()=>dialog.dispatchEvent(new Event("cancel",{cancelable:true})));expect(container.querySelector("dialog")).toBeNull();expect(document.activeElement).toBe(opener);
  });
  it("shows only twelve document cards per page", async () => {
    mock.library.mockResolvedValue({ ...library, reports: Array.from({length:13},(_,i)=>({...library.reports[0], category:"custom", id:`r${i}`, title:`Report ${i}`})) });
    await act(async () => root.render(<ReportLibraryView projectId="p1" view="reports" />)); expect(container.querySelectorAll('button[aria-label^="Open Report"]')).toHaveLength(12);
    await act(async () => [...container.querySelectorAll("button")].find(item=>item.textContent === "Next")!.click()); expect(container.querySelectorAll('button[aria-label^="Open Report"]')).toHaveLength(1);
  });
  it("shows saved Skill version, provenance and only the actual tools returned by the service", async () => {
    await act(async () => root.render(<ReportLibraryView projectId="p1" view="skills" />));
    for (const text of ["Office method", "v3", "Other"]) expect(container.textContent).toContain(text);
    expect(container.textContent).not.toContain("skill-run"); expect(container.textContent).not.toContain("source-session"); expect(container.textContent).not.toContain("python");
    await act(async () => [...container.querySelectorAll('[role="tab"]')].find(item=>item.textContent === "Capabilities")!.dispatchEvent(new MouseEvent("click",{bubbles:true})));
    expect(container.textContent).toContain("python");
    expect(container.querySelector('[role="switch"]')).toBeNull(); expect(container.querySelector('input[type="checkbox"]')).toBeNull(); expect(mock.admin).not.toHaveBeenCalled();
  });
  it.each([
    ["---\nname: office-method\nversion: v3\ndescription: Analyze overnight consumption.\n---\n# Method", "Analyze overnight consumption."],
    ["---\nname: office-method\ndescription: >-\n  Analyze overnight consumption\n  and identify unusual loads.\nversion: v3\n---", "Analyze overnight consumption and identify unusual loads."],
    ["---\nname: office-method\ndescription: 'Analyze overnight\n  consumption safely.'\nversion: v3\n---", "Analyze overnight consumption safely."],
    ["---\nname: office-method\nversion: v3\n---\n# Office method\n\nAnalyze the baseline\nand compare daily loads.", "Analyze the baseline and compare daily loads."],
  ])("shows a meaningful Skill purpose from frontmatter or body", async (content, expected) => {
    mock.library.mockResolvedValue({...library,skills:[{...library.skills[0],content}]});
    await act(async () => root.render(<ReportLibraryView projectId="p1" view="skills" />));
    const summary=container.querySelector('[aria-label="Open Office method"] p'); expect(summary?.textContent).toBe(expected); expect(summary?.textContent).not.toContain("name:"); expect(summary?.textContent).not.toContain("version:");
  });
  it("edits only the selected named Skill with the current revision and leaves other settings intact",async () => {
    mock.library.mockResolvedValue({...library,canChat:true,canManageProject:true});
    const settings={revision:7,skill:"Legacy",contextNotes:"Keep context",skillRefs:[library.skills[0],{name:"Other",version:"v1",content:"Keep other"}]};
    mock.admin.mockResolvedValue({settings});
    await act(async () => root.render(<ReportLibraryView projectId="p1" view="skills" />));
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Open Office method"]')!.click());
    await act(async () => [...container.querySelectorAll("button")].find(item=>item.textContent === "Edit instructions")!.click());
    const version=container.querySelector<HTMLInputElement>('[aria-label="New version number"]')!;
    const content=container.querySelector<HTMLTextAreaElement>('[aria-label="Proposed advisor instructions"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(version,"v4"); version.dispatchEvent(new Event("input",{bubbles:true})); });
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(content,"Updated baseline method"); content.dispatchEvent(new Event("input",{bubbles:true})); });
    await act(async () => [...container.querySelectorAll("button")].find(item=>item.textContent === "Save new version")!.click());
    const saved=JSON.parse(mock.admin.mock.calls.find(call=>call[1] === "skills")![2].body);
    expect(saved).toMatchObject({id:"method",revision:7,name:"Office method",version:"v4",content:"Updated baseline method",scope:"project"});
    expect(mock.admin.mock.calls.some(call=>call[1] === "settings" || call[1] === "skills/default")).toBe(false);

  });
  it("clears a previous project report while a new project request is pending", async () => {
    await act(async () => root.render(<ReportLibraryView projectId="p1" view="reports" />)); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open Scheduled office report"]')!.click()); expect(container.querySelector("iframe")).not.toBeNull();
    mock.library.mockReturnValue(new Promise(() => undefined));
    await act(async () => root.render(<ReportLibraryView projectId="p2" view="reports" />)); expect(container.querySelector("iframe")).toBeNull(); expect(container.textContent).not.toContain("11111111");
  });
  it("links project Sessions and reloads only the changed project index", async () => {
    await act(async () => root.render(<ReportSessionNavigation projectId="p1" currentSessionId="s1" />));
    expect(container.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe("/energyiq/reports?projectId=p1&sessionId=s1");
    expect(container.textContent).toContain("Analyze office loads");
    await act(async () => notifyReportSessionsChanged("other")); expect(mock.admin).toHaveBeenCalledTimes(1);
    await act(async () => notifyReportSessionsChanged("p1")); expect(mock.admin).toHaveBeenCalledTimes(2);
  });
});
it("shows the product Skill Creator without offering to overwrite a project Skill", async () => {
  mock.library.mockResolvedValue({...library,canChat:true,canManageProject:true,skills:[{required:true,name:"Skill Creator",version:"1.1.0",content:"# Creator",projectId:"p1",scope:"general",category:"other",readOnly:true}]});
  await act(async()=>root.render(<ReportLibraryView projectId="p1" view="skills" />));
  await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Open Skill Creator"]')!.click());
  expect(container.textContent).toContain("Save report method");
  expect(container.textContent).toContain("save a new version");
  expect(container.textContent).toContain("All projects (built in)");
  expect([...container.querySelectorAll("button")].some(button=>button.textContent==="Edit instructions")).toBe(false);
  expect(mock.admin).not.toHaveBeenCalled();
});

it("hides superseded reports by identity while retaining independent reports with the same title", async () => {
  mock.library.mockResolvedValue({...library,reports:[...library.reports,{...library.reports[0],id:"revision",parentRunId:library.reports[0]!.id,version:2}]});
  await act(async()=>root.render(<ReportLibraryView projectId="p1" view="reports" />));
  expect(container.querySelectorAll('[aria-label="Open Scheduled office report"]').length).toBe(1);
  await act(async()=>container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(container.querySelectorAll('[aria-label="Open Scheduled office report"]').length).toBe(2);
});
it("shows only explicitly saved project materials, never unrelated workspace uploads", async () => {
  mock.library.mockResolvedValue({...library,canChat:true,canManageProject:true});
  mock.admin.mockResolvedValue({settings:{fileRefIds:["saved"],contextNotes:"Office background"},files:[{id:"saved",filename:"office.pdf",bytes:200},{id:"unrelated",filename:"private.csv",bytes:100}]});
  await act(async()=>root.render(<ReportLibraryView projectId="p1" view="reports" />));
  await act(async()=>[...container.querySelectorAll("button")].find(item=>item.textContent==="Project materials")!.click());
  expect(container.textContent).toContain("office.pdf");expect(container.textContent).not.toContain("private.csv");
});

it("does not offer discussion for another author's report", async () => {
  mock.library.mockImplementation(async (_id,path="")=>path.startsWith("output/")?{content:"<html><body>Shared report</body></html>"}:{...library,canChat:true,canManageProject:true,reports:library.reports.map(item=>({...item,canDiscuss:false}))});
  await act(async()=>root.render(<ReportLibraryView projectId="p1" view="reports" />));
  await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Open Scheduled office report"]')!.click());
  expect(container.textContent).not.toContain("Discuss this report");
});

it("shows one card per Skill identity and opens enabled content with selectable history", async()=>{
 const old={...library.skills[0],version:"1",content:"Old instructions",isDefault:false};
 const enabled={...old,version:"2",content:"Enabled instructions",isDefault:true};
 const latest={...old,version:"3",content:"Latest instructions"};
 mock.library.mockResolvedValue({...library,skills:[old,enabled,latest,{...old,id:"another",name:"Office method",version:"4"}]});
 await act(async()=>root.render(<ReportLibraryView projectId="p1" view="skills"/>));
 const cards=container.querySelectorAll<HTMLButtonElement>('[aria-label="Open Office method"]');expect(cards).toHaveLength(2);
 expect(cards[0]!.textContent).toContain("Enabled instructions");expect(container.textContent).toContain("2 saved");
 await act(async()=>cards[0]!.click());
 const select=container.querySelector<HTMLSelectElement>('[aria-label="Version history"]')!;expect(select.value).toBe("2");expect(select.options).toHaveLength(3);
 await act(async()=>{select.value="1";select.dispatchEvent(new Event("change",{bubbles:true}));});
 expect(container.querySelector('dialog')?.textContent).toContain("Old instructions");expect(mock.admin).not.toHaveBeenCalled();
});
it("shows latest saved version when no version is enabled",async()=>{
 const skill=library.skills[0]!;mock.library.mockResolvedValue({...library,skills:[{...skill,version:"10",content:"Old"},{...skill,version:"2",content:"Saved most recently"}]});
 await act(async()=>root.render(<ReportLibraryView projectId="p1" view="skills"/>));
 expect(container.querySelector('[aria-label="Open Office method"]')?.textContent).toContain("Saved most recently");
});
it("shows inclusive end dates in the earlier-report list across a month boundary",async()=>{
 const old={...library.reports[0]!,id:"old",period:{from:"2026-08-01",toExclusive:"2026-09-01"}};
 mock.library.mockResolvedValue({...library,reports:[old,{...library.reports[1]!,previousReportId:"old"}]});
 await act(async()=>root.render(<ReportLibraryView projectId="p1" view="reports"/>));
 const history=[...container.querySelectorAll('details')].find(e=>e.querySelector('summary')?.textContent?.startsWith('Earlier versions'))!;
 expect(history.textContent).toContain("1–31 Aug 2026");expect(history.textContent).not.toContain("1 Sep");
});

it("requests an exact report for a task-history deep link",async()=>{
 mock.search="projectId=p1&reportId=report-one-11111111";
 await act(async()=>root.render(<ReportLibraryView projectId="p1" view="reports"/>));
 expect(mock.library).toHaveBeenCalledWith("p1","?reportId=report-one-11111111",expect.anything());
 expect(mock.library).toHaveBeenCalledWith("p1","output/report-one-11111111",expect.anything());
});

/**
 * Site reports are the ones the server writes for the whole site, and one of them is what the Overview shows. The
 * list has to make that recognisable without opening anything, and the existing filters have to keep working.
 */
describe("site reports in the list", () => {
  const siteLibrary = { ...library, overviewCadence: "monthly", canChat: true, reports: [
    { id: "site-month-33333333", title: "Monthly Site Report — 1 August 2026 to 31 August 2026", version: 1, category: "scheduled", kind: "report", period: { from: "2026-08-01", toExclusive: "2026-09-01" }, createdAt: "2026-09-01T03:00:00Z", source: "site", cadence: "monthly", canDiscuss: false },
    { id: "site-week-44444444", title: "Weekly Site Report — 24 August 2026 to 30 August 2026", version: 1, category: "scheduled", kind: "report", period: { from: "2026-08-24", toExclusive: "2026-08-31" }, createdAt: "2026-09-01T02:00:00Z", source: "site", cadence: "weekly", canDiscuss: false },
    { ...library.reports[1]!, source: "advisor", canDiscuss: true },
  ] };
  const card = (title: string) => container.querySelector(`[aria-label^="Open ${title}"]`)!;
  beforeEach(() => { mock.library.mockImplementation(async (_id: string, path = "") => path.startsWith("output/") ? { content: "<html><body>Site report</body></html>" } : siteLibrary); });

  it("marks every site report and says which one the Overview shows", async () => {
    await act(async () => root.render(<ReportLibraryView projectId="p1" view="reports" />));
    // This project's Overview shows the monthly one, so only that card claims it.
    expect(card("Monthly Site Report").textContent).toContain("Shown on your Overview");
    expect(card("Monthly Site Report").textContent).toContain("1 month");
    expect(card("Monthly Site Report").textContent).toContain("Automatically generated");
    expect(card("Weekly Site Report").textContent).toContain("Site report");
    expect(card("Weekly Site Report").textContent).not.toContain("Shown on your Overview");
    expect(card("Weekly Site Report").textContent).toContain("1 week");
    // A report somebody asked for is not a site report and carries neither marker.
    expect(card("Custom office report").textContent).not.toContain("Site report");
    expect(card("Custom office report").textContent).not.toContain("Shown on your Overview");
  });

  it("follows the project's cadence when deciding which report the Overview shows", async () => {
    mock.library.mockImplementation(async (_id: string, path = "") => path.startsWith("output/") ? { content: "" } : { ...siteLibrary, overviewCadence: "weekly" });
    await act(async () => root.render(<ReportLibraryView projectId="p1" view="reports" />));
    expect(card("Weekly Site Report").textContent).toContain("Shown on your Overview");
    expect(card("Monthly Site Report").textContent).toContain("Site report");
    expect(card("Monthly Site Report").textContent).not.toContain("Shown on your Overview");
  });

  it("keeps the Automatic, Custom and length filters working with them", async () => {
    await act(async () => root.render(<ReportLibraryView projectId="p1" view="reports" />));
    const filter = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Show"] button, [role="group"] button')].find(button => button.textContent?.startsWith(label))!;
    await act(async () => filter("Automatic").click());
    expect(container.querySelector('[aria-label^="Open Monthly Site Report"]')).not.toBeNull();
    expect(container.querySelector('[aria-label^="Open Weekly Site Report"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open Custom office report"]')).toBeNull();
    // Both lengths a site report can have are offered, shortest first.
    expect([...container.querySelectorAll("option")].map(option => option.textContent)).toEqual(["Any length", "1 week", "1 month"]);
    await act(async () => filter("Custom").click());
    expect(container.querySelector('[aria-label^="Open Monthly Site Report"]')).toBeNull();
    expect(container.querySelector('[aria-label="Open Custom office report"]')).not.toBeNull();
  });

  it("offers no advisor conversation on a site report and says what it is instead", async () => {
    await act(async () => root.render(<ReportLibraryView projectId="p1" view="reports" />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="Open Monthly Site Report"]')!.click());
    expect(container.textContent).toContain("written from your own meter readings");
    expect(container.textContent).not.toContain("Shared report.");
    expect([...container.querySelectorAll("button")].some(button => /advisor|Discuss/i.test(button.textContent ?? ""))).toBe(false);
  });
});
