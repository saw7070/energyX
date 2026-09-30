/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ reportAgentRequest: vi.fn(), reportLibraryRequest: vi.fn(), getEnergyProjectSetup: vi.fn() }));
vi.mock("../../../lib/config-api", () => ({ configApi: api }));
vi.mock("../_components/energyiq-access", () => ({ useEnergyIqAccess: () => ({ access: { user: { id: "test-user" }, activeWorkspaceId: "test-workspace" } }) }));
import { ReportAgentPanel } from "./report-agent-panel";
import { visibleAnswer } from "../_components/report-agent-panel";
let container: HTMLDivElement;
let root: Root;
function overview(status = "succeeded") { return { canChat: true, canManageProject: true, settings: { contextNotes: "Office", fileRefIds: [], useProjectData: true, skill: "", revision: 1, frequency: "off", localHour: 1, scheduledPrompt: "", timezone: "Asia/Singapore" }, sessions: [{ id: "session-1", createdAt: "2026-09-11" }], runs: [{ id: "run-1", sessionId: "session-1", status, kind: "report", prompt: "Investigate night consumption", answer: "Completed analysis", createdAt: "2026-09-11", period: { from: "2026-09-09", toExclusive: "2026-09-10" } }], files: [] }; }
beforeEach(() => {
  sessionStorage.clear(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React); api.reportAgentRequest.mockReset();
  api.getEnergyProjectSetup.mockReset();
  api.getEnergyProjectSetup.mockResolvedValue({project:{status:"published",has_unpublished_changes:true},draft:{revision:3,updated_at:"2026-09-12T02:00:00Z"}});
  api.reportLibraryRequest.mockResolvedValue({ reports: [], artifacts: [], canChat: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  api.reportAgentRequest.mockImplementation(async (_project, path = "") => path.includes("events") ? { events: [{ sequence: 1, time: "now", type: "tool_execution_end", tool: "python" }] } : path.startsWith("output/") ? { content: "<html><body>English report</body></html>" } : overview());
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function click(text: string) { const button = [...container.querySelectorAll("button")].find((b) => b.textContent === text); expect(button).toBeDefined(); await act(async () => button!.click()); }
it("keeps historical messages readable after execution permission is revoked", async () => {
  api.reportLibraryRequest.mockResolvedValue({ reports: [], artifacts: [], canChat: false });
  api.reportAgentRequest.mockImplementation(async (_project, path = "") => path.includes("events") ? { events: [] } : path.startsWith("output/") ? { content: "<html>Previous report</html>" } : { ...overview(), canChat: false, canManageProject: false });
  await act(async () => root.render(<ReportAgentPanel projectId="p1" initialSessionId="session-1" />));
  expect(container.textContent).toContain("Investigate night consumption");
  expect(container.textContent).toContain("read-only");
  expect(container.querySelector('textarea[aria-label="Report instructions"]')).toBeNull();
  expect(container.textContent).not.toContain("Discuss this report");
  expect(container.textContent).not.toContain("Report preferences");
});
describe("report workspace", () => {
  it("allows a new conversation while another conversation is running", async () => {
    api.reportAgentRequest.mockImplementation(async (_project, path = "") => path === "runs" ? { id: "new-run", sessionId: "new-session" } : path.includes("events") ? { events: [] } : overview("running"));
    await act(async () => root.render(<ReportAgentPanel projectId="p1" initialSessionId="new" />));
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Report instructions"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Explain my readings");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!;
    expect(send.disabled).toBe(false);
    await act(async () => send.click());
    expect(api.reportAgentRequest.mock.calls.some(([, path, options]) => path === "runs" && JSON.parse(options.body).prompt === "Explain my readings")).toBe(true);
    expect(api.reportAgentRequest.mock.calls.some(([, path]) => String(path).endsWith("/stop"))).toBe(false);
  });
  it.each([
    ["review_started", "Reviewing report"],
    ["revision_started", "Revising report"],
    ["review_passed", "Review completed"],
    ["review_blocked", "Needs attention"],
    ["skill_inputs_prepared", "Skill inputs provided"],
  ])("labels real %s activity", async (type, label) => {
    api.reportAgentRequest.mockImplementation(async (_project, path = "") => path.includes("events") ? { events: [{ sequence: 1, time: "2026-09-13T00:00:00Z", type }] } : overview("running"));
    await act(async () => root.render(<ReportAgentPanel projectId="p1" />));
    expect(container.textContent).toContain(label);
    expect(container.textContent).not.toContain("Skill loaded");
  });
  it("explains a blocked review without suggesting a data connection failure", async () => {
    const state = overview("failed");
    Object.assign(state.runs[0]!, { errorCode: "REPORT_REVIEW_BLOCKED" });
    api.reportAgentRequest.mockImplementation(async (_project, path = "") => path.includes("events") ? { events: [] } : state);
    await act(async () => root.render(<ReportAgentPanel projectId="p1" />));
    expect(container.textContent).toContain("Needs attention");
    expect(container.textContent).toContain("The draft is preserved with unresolved review issues");
    expect(container.textContent).not.toContain("Check the project data and try again");
  });
  it("restores unsent text after leaving, isolates projects and clears only after accepted submission", async () => {
    const render = async (projectId = "p1") => act(async () => root.render(<ReportAgentPanel projectId={projectId} initialSessionId="new" />));
    const input = () => container.querySelector<HTMLTextAreaElement>('[aria-label="Report instructions"]')!;
    await render();
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input(), "Investigate my draft"); input().dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => root.render(<div>Knowledge</div>));
    await render("p2"); expect(input().value).toBe("");
    await render(); expect(input().value).toBe("Investigate my draft");
    api.reportAgentRequest.mockImplementation(async (_project, path = "") => { if (path === "runs") throw new Error("Network unavailable"); return overview(); });
    await click("Send message"); expect(input().value).toBe("Investigate my draft");
    await act(async () => root.render(<div>Knowledge</div>)); await render();
    expect(input().value).toBe("Investigate my draft");
    api.reportAgentRequest.mockImplementation(async (_project, path = "") => path === "runs" ? { id: "run-1" } : path.includes("events") ? { events: [] } : overview());
    await click("Send message");
    await act(async () => root.render(<div>Knowledge</div>)); await render();
    expect(input().value).toBe("");
  });
  it("keeps attachment edits local until explicitly saved as project materials", async () => {
    const state = { ...overview(), settings: { ...overview().settings, fileRefIds: ["f1"] }, files: [{ id: "f1", filename: "bill.pdf", bytes: 10 }] };
    api.reportAgentRequest.mockResolvedValue(state);
    await act(async () => root.render(<ReportAgentPanel projectId="p1" initialSessionId="new" />));
    expect(container.textContent).toContain("Project defaults remain unchanged");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove attachment bill.pdf"]')!.click());
    expect(container.textContent).toContain("Save selection as project materials");
    expect(api.reportAgentRequest.mock.calls.some(call => call[1] === "settings")).toBe(false);
  });

  it("shows an editable initialization request without submitting and sizes it after loading", async () => {
    const height = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(156);
    await act(async () => root.render(<ReportAgentPanel projectId="p1" initialSessionId="new" initialConfigure configurationFocus="initialize" />));
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Report instructions"]')!;
    expect(container.textContent).toContain("Let’s set up your project");
    expect(container.textContent).toContain("Add project files");
    expect(input.value).toContain("Import, map and publish");
    expect(input.value).not.toContain("project_source_");
    expect(input.style.height).toBe("156px");
    expect(api.reportAgentRequest.mock.calls.some(call => call[1] === "runs")).toBe(false);
    height.mockRestore();
  });

  it("renders model Markdown safely while keeping the user prompt as plain text", async () => {
    const state = overview(); state.runs[0]!.prompt = "**Keep my prompt literal**";
    state.runs[0]!.answer = "## Findings\n\n**Baseload** uses `usage_kwh`.\n\n<script>alert(1)</script>";
    api.reportAgentRequest.mockImplementation(async (_project, path = "") => path.includes("events") ? { events: [] } : path.startsWith("output/") ? { content: "<html>Report</html>" } : state);
    await act(async () => root.render(<ReportAgentPanel projectId="p1" />));
    const answer = container.querySelector('[data-safe-ai-markdown="true"]')!;
    expect(answer.querySelector("strong")?.textContent).toBe("Baseload");
    expect(answer.textContent).toContain("Findings"); expect(answer.textContent).toContain("usage_kwh");
    expect(answer.textContent).not.toContain("##"); expect(answer.textContent).not.toContain("**"); expect(answer.textContent).not.toContain("`");
    expect(answer.querySelector("script")).toBeNull();
    expect(container.querySelector("article > div")?.textContent).toBe("You**Keep my prompt literal**");
    expect(container.querySelector("article > div:first-child strong")).toBeNull();
  });
  it("sends a discussion without dates and never requests an HTML output for chat", async () => {
    const state = overview(); state.runs[0]!.kind = "chat";
    api.reportAgentRequest.mockImplementation(async (_project,path="",init) => path === "settings" ? state.settings : path === "runs" ? { id:"run-1" } : path.includes("events") ? {events:[]} : state);
    await act(async () => root.render(<ReportAgentPanel projectId="p1" initialSessionId="new" />));
    const input=container.querySelector<HTMLTextAreaElement>('[aria-label="Report instructions"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Help me plan the analysis"); input.dispatchEvent(new Event("input",{bubbles:true})); });
    await click("Send message");
    const posted=api.reportAgentRequest.mock.calls.find(call=>call[1] === "runs"); expect(posted).toBeDefined(); expect(JSON.parse(posted![2].body)).toMatchObject({kind:"chat",prompt:"Help me plan the analysis"}); expect(JSON.parse(posted![2].body)).not.toHaveProperty("period");
    expect(api.reportAgentRequest.mock.calls.some(call=>String(call[1]).startsWith("output/"))).toBe(false);
    expect(container.querySelector("iframe")).toBeNull();
  });
  it("uses Recent for a new conversation, submits an exclusive end, and skips unchanged settings writes", async () => {
    const state={...overview(),periodOptions:{defaultPeriod:{from:"2026-08-01",toExclusive:"2026-09-13"},availablePeriod:null}};
    api.reportAgentRequest.mockImplementation(async (_project,path="")=>path === "runs" ? {id:"run-1"} : path.includes("events") ? {events:[]} : state);
    await act(async()=>root.render(<ReportAgentPanel projectId="p1" initialSessionId="new" />));
    expect(container.textContent).toContain("1 Aug – 12 Sep 2026");
    expect([...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent?.includes("All data"))?.disabled).toBe(true);

    const input=container.querySelector<HTMLTextAreaElement>('[aria-label="Report instructions"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Create the report");input.dispatchEvent(new Event("input",{bubbles:true}));});
    await click("Send message");
    const posted=JSON.parse(api.reportAgentRequest.mock.calls.find(call=>call[1] === "runs")![2].body);
    expect(posted).toMatchObject({kind:"chat",period:{from:"2026-08-01",toExclusive:"2026-09-13"}});
    expect(api.reportAgentRequest.mock.calls.some(call=>call[1] === "settings")).toBe(false);
  });
  it("submits All data by preset and allows returning from report creation to discussion", async()=>{
    const state={...overview(),periodOptions:{defaultPeriod:{from:"2026-08-01",toExclusive:"2026-09-13"},availablePeriod:{from:"2025-01-01",toExclusive:"2026-09-12"}}};
    api.reportAgentRequest.mockImplementation(async(_project,path="")=>path === "runs" ? {id:"run-1"} : path.includes("events") ? {events:[]} : state);
    await act(async()=>root.render(<ReportAgentPanel projectId="p1" initialSessionId="new" />));
    await act(async()=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent === "All data")!.click());
    expect(container.textContent).toContain("1 Jan 2025 – 11 Sep 2026");
    const input=container.querySelector<HTMLTextAreaElement>('[aria-label="Report instructions"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Discuss all available readings");input.dispatchEvent(new Event("input",{bubbles:true}));});
    await click("Send message");
    const posted=JSON.parse(api.reportAgentRequest.mock.calls.find(call=>call[1] === "runs")![2].body);
    expect(posted).toMatchObject({kind:"chat",periodPreset:"all"});expect(posted).not.toHaveProperty("period");
  });
  it("opens validated report and Skill artifacts from an ordinary chat without saving the draft automatically",async()=>{
    const state=overview();state.runs[0]!.kind="chat";Object.assign(state.runs[0]!,{hasReport:true,hasSkillDraft:true});
    api.reportAgentRequest.mockImplementation(async(_project,path="")=>path.includes("events")?{events:[]}:path.startsWith("draft-skill/")?{content:"# Draft method"}:path.startsWith("output/")?{content:"<h1>Accepted report</h1>"}:state);
    await act(async()=>root.render(<ReportAgentPanel projectId="p1" />));
    expect(container.textContent).not.toContain("Create report");
    await act(async()=>[...container.querySelectorAll("button")].find(item=>item.textContent?.includes("HTML report"))!.click());
    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toContain("Accepted report");
    await act(async()=>[...container.querySelectorAll("button")].find(item=>item.textContent?.includes("Skill draft"))!.click());
    expect(container.querySelector('[aria-label="File preview"]')?.textContent).toContain("Draft method");
    expect(api.reportAgentRequest.mock.calls.some(call=>call[1] === "settings")).toBe(false);
  });
  it("extracts a Skill from successful chat without inventing a parent report",async()=>{
    const state=overview();state.runs[0]!.kind="chat";
    api.reportAgentRequest.mockImplementation(async(_project,path="")=>path === "runs"?{id:"skill-new"}:path.includes("events")?{events:[]}:state);
    await act(async()=>root.render(<ReportAgentPanel projectId="p1" />));await click("Save report method");
    const body=JSON.parse(api.reportAgentRequest.mock.calls.find(call=>call[1] === "runs")![2].body);expect(body).toMatchObject({kind:"skill",sessionId:"session-1"});expect(body).not.toHaveProperty("parentRunId");
  });
  it("attaches a supported document using the existing input endpoint and includes it in the next send",async()=>{
    const state=overview();
    api.reportAgentRequest.mockImplementation(async(_project,path="",init)=>{if(path === "inputs"){state.files.push({id:"file-new",filename:"context.csv",bytes:5} as never);return {id:"file-new"};}if(path === "settings")return JSON.parse(init.body);if(path === "runs")return {id:"run-1"};return path.includes("events")?{events:[]}:path.startsWith("output/")?{content:"Report"}:state;});
    await act(async()=>root.render(<ReportAgentPanel projectId="p1" />));
    const upload=container.querySelector<HTMLInputElement>('[aria-label="Attach supporting document"]')!;expect(upload.accept).not.toContain("image");expect(upload.accept).toContain(".pdf");
    await act(async()=>{Object.defineProperty(upload,"files",{value:[new File(["a,b"],"context.csv",{type:"text/csv"})]});upload.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(container.textContent).toContain("context.csv");
    const input=container.querySelector<HTMLTextAreaElement>('[aria-label="Report instructions"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Read this document");input.dispatchEvent(new Event("input",{bubbles:true}));});await click("Send message");
    expect(JSON.parse(api.reportAgentRequest.mock.calls.find(call=>call[1] === "runs")![2].body).fileRefIds).toEqual(["file-new"]);
    expect(api.reportAgentRequest.mock.calls.some(call=>call[1] === "settings")).toBe(false);
  });
  it("does not infer a project connection from selected CSV dates or historical report data",async()=>{
    const state={...overview(),periodOptions:{defaultPeriod:{from:"2026-08-01",toExclusive:"2026-09-13"},availablePeriod:{from:"2026-08-01",toExclusive:"2026-09-11",actualLastIntervalEnd:"2026-09-10T15:45:00Z"}},dataSummary:{actualLastIntervalEnd:"2026-09-10T15:45:00Z",rows:100}};
    api.reportAgentRequest.mockImplementation(async(_project,path="")=>path.includes("events")?{events:[]}:path.startsWith("output/")?{content:"Report"}:state);
    await act(async()=>root.render(<ReportAgentPanel projectId="p1" />));
    const status=container.querySelector('[aria-label="Project data"]')!;expect(status.textContent).toContain("Status unavailable");expect(status.textContent).not.toContain("Connected");expect(status.textContent).not.toContain("Latest reading");
  });
  it("keeps Project data connected when removing a supplementary attachment",async()=>{
    const state={...overview(),projectData:{status:"connected",actualLastIntervalEnd:"2026-09-10T15:45:00Z"},files:[{id:"extra",filename:"notes.txt",bytes:5}],settings:{...overview().settings,fileRefIds:["extra"]}};
    api.reportAgentRequest.mockImplementation(async(_project,path="",init)=>path === "settings"?JSON.parse(init.body):path.includes("events")?{events:[]}:path.startsWith("output/")?{content:"Report"}:state);
    await act(async()=>root.render(<ReportAgentPanel projectId="p1" />));
    const status=container.querySelector('[aria-label="Project data"]')!;expect(status.textContent).toContain("Connected");expect(status.textContent).toContain("SGT");expect(status.querySelector("button")).toBeNull();
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Remove attachment notes.txt"]')!.click());
    expect(status.textContent).toContain("Connected");expect(container.querySelector('[aria-label="Attachments"]')).toBeNull();
    await click("Save selection as project materials");
    const saved=JSON.parse(api.reportAgentRequest.mock.calls.find(call=>call[1] === "settings")![2].body);expect(saved.fileRefIds).toEqual([]);expect(saved.useProjectData).toBe(true);
  });
  it("clears the old project connection while the next project loads",async()=>{
    const state={...overview(),projectData:{status:"connected",actualLastIntervalEnd:"2026-09-10T15:45:00Z"}};
    api.reportAgentRequest.mockImplementation(async(_project,path="")=>path.includes("events")?{events:[]}:path.startsWith("output/")?{content:"Report"}:state);
    await act(async()=>root.render(<ReportAgentPanel projectId="p1" />));
    api.reportAgentRequest.mockReturnValue(new Promise(()=>{}));await act(async()=>root.render(<ReportAgentPanel projectId="p2" />));
    expect(container.querySelector('[aria-label="Project data"]')?.textContent).toContain("Checking connection");expect(container.querySelector('[aria-label="Project data"]')?.textContent).not.toContain("Connected");
  });
  it("prefills Configure project without sending or discarding the message, dates or report preview",async()=>{
    await act(async()=>root.render(<ReportAgentPanel projectId="p1" />));
    expect(api.getEnergyProjectSetup).not.toHaveBeenCalled();
    await act(async()=>[...container.querySelectorAll("button")].find(item=>item.textContent?.includes("Open preview"))!.click());
    const input=container.querySelector<HTMLTextAreaElement>('[aria-label="Report instructions"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Keep my current question");input.dispatchEvent(new Event("input",{bubbles:true}));});
    const from=container.querySelector<HTMLInputElement>('[aria-label="Start date"]')!.value;
    await click("Configure project");
    expect(input.value).toContain("Keep my current question");expect(input.value).toContain("Review this project's current configuration");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Start date"]')!.value).toBe(from);expect(container.querySelector("iframe")).not.toBeNull();
    expect(api.reportAgentRequest.mock.calls.some(call=>call[2]?.method === "POST" || call[2]?.method === "PUT")).toBe(false);
    expect(api.getEnergyProjectSetup).toHaveBeenCalledWith("p1");
    expect(container.querySelector('[aria-label="Facility status"]')?.textContent).toContain("Published version active · Draft changes not published");
  });
  it.each([
    ["published",true,"Published version active · Draft changes not published"],
    ["published",false,"Published · No pending changes"],
    ["draft",true,"Draft saved · Not published"],
  ])("shows authoritative %s configuration with pending changes=%s",async(status,pending,label)=>{
    api.getEnergyProjectSetup.mockResolvedValue({project:{status,has_unpublished_changes:pending},draft:{revision:9,updated_at:"2026-09-12T02:00:00Z"}});
    await act(async()=>root.render(<ReportAgentPanel projectId="p1" />));await click("Configure project");
    const panel=container.querySelector('[aria-label="Facility status"]')!;expect(panel.textContent).toContain(label);expect(panel.textContent).toContain("Draft revision 9");
  });
  it("refreshes configuration after the conversation run finishes",async()=>{
    vi.useFakeTimers();let state=overview("running");
    api.reportAgentRequest.mockImplementation(async(_project,path="")=>path.includes("events")?{events:[]}:path.startsWith("output/")?{content:"Report"}:state);
    await act(async()=>root.render(<ReportAgentPanel projectId="p1" />));await click("Configure project");expect(api.getEnergyProjectSetup).toHaveBeenCalledTimes(1);
    state=overview("succeeded");api.getEnergyProjectSetup.mockResolvedValue({project:{status:"published",has_unpublished_changes:false},draft:{revision:4,updated_at:"2026-09-12T03:00:00Z"}});
    await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});
    expect(api.getEnergyProjectSetup).toHaveBeenCalledTimes(2);expect(container.querySelector('[aria-label="Facility status"]')?.textContent).toContain("Published · No pending changes");
  });
  it("does not expose a late configuration response after changing projects",async()=>{
    let resolve:(value:unknown)=>void=()=>{};api.getEnergyProjectSetup.mockReturnValue(new Promise(r=>{resolve=r;}));
    await act(async()=>root.render(<ReportAgentPanel projectId="p1" />));await click("Configure project");
    await act(async()=>root.render(<ReportAgentPanel projectId="p2" />));
    await act(async()=>resolve({project:{status:"published",has_unpublished_changes:false},draft:{revision:99,updated_at:"2026-09-12"}}));
    expect(container.querySelector('[aria-label="Facility status"]')).toBeNull();expect(container.textContent).not.toContain("Draft revision 99");
  });
  it("adopts Agent-updated report preferences after completion before the next local save",async()=>{
    vi.useFakeTimers();let state=overview("running");
    api.reportAgentRequest.mockImplementation(async(_project,path="",init)=>path === "settings"?{...JSON.parse(init.body),revision:3}:path.includes("events")?{events:[]}:path.startsWith("output/")?{content:"Report"}:state);
    await act(async()=>root.render(<ReportAgentPanel projectId="p1" />));
    state={...overview("succeeded"),settings:{...overview().settings,revision:2,contextNotes:"Agent-updated occupancy"}};
    await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});await click("Report preferences");
    const context=container.querySelector<HTMLTextAreaElement>('section[aria-label="Report preferences"] textarea')!;
    expect(context.value).toBe("Agent-updated occupancy");
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(context,"Reviewed occupancy");context.dispatchEvent(new Event("input",{bubbles:true}));});await click("Save report preferences");
    expect(JSON.parse(api.reportAgentRequest.mock.calls.find(call=>call[1] === "settings")![2].body).revision).toBe(2);
  });
  it("preserves unsaved local preferences and blocks stale saves when the Agent updates them",async()=>{
    vi.useFakeTimers();let state=overview("running");
    api.reportAgentRequest.mockImplementation(async(_project,path="")=>path.includes("events")?{events:[]}:path.startsWith("output/")?{content:"Report"}:state);
    await act(async()=>root.render(<ReportAgentPanel projectId="p1" />));await click("Report preferences");
    const context=container.querySelector<HTMLTextAreaElement>('section[aria-label="Report preferences"] textarea')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(context,"My unsaved context");context.dispatchEvent(new Event("input",{bubbles:true}));});
    state={...overview("succeeded"),settings:{...overview().settings,revision:2,contextNotes:"Agent context"}};
    await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(context.value).toBe("My unsaved context");expect(container.textContent).toContain("Report preferences changed on the server");
    await click("Save report preferences");expect(api.reportAgentRequest.mock.calls.some(call=>call[1] === "settings")).toBe(false);
    await click("Discard local edits and load latest");expect(context.value).toBe("Agent context");
  });
  it("opens the requested Session instead of the latest conversation", async () => {
    const state = overview();
    state.sessions.unshift({ id: "session-2", createdAt: "2026-09-12" });
    state.runs.unshift({ ...state.runs[0]!, id: "run-2", sessionId: "session-2", prompt: "Other conversation" });
    api.reportAgentRequest.mockImplementation(async (_project, path = "") => path.includes("events") ? { events: [] } : path.startsWith("output/") ? { content: "<html>Report</html>" } : state);
    await act(async () => root.render(<ReportAgentPanel projectId="p1" initialSessionId="session-1" sidebarNavigation />));
    expect(container.textContent).toContain("Investigate night consumption"); expect(container.textContent).not.toContain("Other conversation");
    expect(container.querySelector('[aria-label="Conversation"]')).toBeNull();
    expect(api.reportAgentRequest).toHaveBeenCalledWith("p1", "output/run-1", expect.anything());
  });
  it("opens a fresh draft from the sidebar without loading the last report", async () => {
    await act(async () => root.render(<ReportAgentPanel projectId="p1" initialSessionId="new" sidebarNavigation />));
    expect(container.querySelector("iframe")).toBeNull(); expect(container.textContent).not.toContain("Investigate night consumption");
    expect(container.textContent).toContain("Create an energy report");
    const starter = [...container.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === "Create an energy report")!;
    await act(async () => starter.click());
    expect(container.querySelector("textarea")?.value).toBe("Create an energy report for the selected period.");
    expect(container.querySelector("iframe")).toBeNull();
  });
  it("restores the session history and renders the artifact in an opaque sandbox", async () => {
    await act(async () => root.render(<ReportAgentPanel projectId="p1" />));
    expect(container.querySelector('[aria-label="Conversation"]')?.textContent).toContain("SGT");
    expect(container.textContent).toContain("Investigate night consumption");
    expect(container.querySelector("iframe")).toBeNull();
    await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Open preview"))!.click());
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("srcdoc")).toContain("connect-src 'none'");
    expect(frame.getAttribute("srcdoc")).toContain("English report");
    expect(api.reportAgentRequest).toHaveBeenCalledWith("p1", "runs/run-1/events?after=0", expect.anything());
  });
  it("stops an active run and retains a recoverable history record", async () => {
    let state = overview("running");
    api.reportAgentRequest.mockImplementation(async (_project, path = "") => {
      if (path === "runs/run-1/stop") { state = overview("cancelled"); return state.runs[0]; }
      return path.includes("events") ? { events: [] } : state;
    });
    await act(async () => root.render(<ReportAgentPanel projectId="p1" />));
    await click("Stop task");
    expect(api.reportAgentRequest).toHaveBeenCalledWith("p1", "runs/run-1/stop", { method: "POST" });
    expect(container.textContent).toContain("Stopped");
    expect(container.textContent).toContain("Retry task");
    expect(container.textContent).toContain("Investigate night consumption");
  });
  it("clears previous project artifacts immediately when switching project", async () => {
    await act(async () => root.render(<ReportAgentPanel projectId="p1" />));
    await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Open preview"))!.click());
    expect(container.querySelector("iframe")).not.toBeNull();
    api.reportAgentRequest.mockImplementation(async () => { throw new Error("PROJECT_FORBIDDEN"); });
    await act(async () => root.render(<ReportAgentPanel projectId="p2" />));
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).not.toContain("Investigate night consumption");
    expect(container.textContent).toContain("PROJECT_FORBIDDEN");
  });
  it("allows a fresh session without discarding saved reports", async () => {
    await act(async () => root.render(<ReportAgentPanel projectId="p1" />));
    await click("New conversation");
    expect(container.querySelector('[aria-label="Conversation"]')?.textContent).toContain("New conversation");
    expect(container.querySelector("iframe")).toBeNull();
    await click("Report library");
    expect(container.textContent).toContain("2026-09-09");
  });
});
it("inherits the exact referenced report window after both overview and library load", async () => {
  const old = {id:"old-report",title:"August report",kind:"report",version:3,period:{from:"2026-08-01",toExclusive:"2026-09-01"},createdAt:"2026-09-02"};
  api.reportLibraryRequest.mockResolvedValue({reports:[old],canChat:true,artifacts:[]});
  api.reportAgentRequest.mockImplementation(async (_project,path="")=>path.startsWith("output/")?{content:"<html><body>Old report</body></html>"}:overview());
  await act(async()=>root.render(<ReportAgentPanel projectId="p1" initialSessionId="new" referenceReportId="old-report" />));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Start date"]')!.value).toBe("2026-08-01");
  expect(container.querySelector<HTMLInputElement>('[aria-label="End date"]')!.value).toBe("2026-08-31");
  expect(container.textContent).toContain("v3");
  expect(api.reportAgentRequest.mock.calls.some(call=>call[1]==="runs")).toBe(false);
});

it("shows accumulated progress only while running and uses final answer on completion",()=>{
 const events=[{type:"answer_progress",text:"First"},{type:"answer_progress",text:"First second"},{type:"tool_execution_end"}];
 expect(visibleAnswer({status:"running"},events)).toBe("First second");
 expect(visibleAnswer({status:"succeeded",answer:"Final"},events)).toBe("Final");
 expect(visibleAnswer({status:"failed"},events)).toBe("");
 expect(visibleAnswer({status:"running"},[])).toBe("");
});

it("renders answer progress without flooding activity entries",async()=>{
 api.reportAgentRequest.mockImplementation(async(_project,path="")=>path.includes("events")?{events:[{sequence:1,time:"2026-09-13T00:00:00Z",type:"answer_progress",text:"Live answer"}]}:overview("running"));
 await act(async()=>root.render(<ReportAgentPanel projectId="p1"/>));
 expect(container.querySelector('[aria-label="Advisor response"]')?.textContent).toBe("Live answer");
 expect(container.textContent).not.toContain("answer_progress");
});

it("follows streamed text until the reader scrolls away, then resumes on request",async()=>{
 vi.useFakeTimers();let sequence=0;
 api.reportAgentRequest.mockImplementation(async(_project,path="")=>path.includes("events")?{events:[{sequence:++sequence,time:"2026-09-13T00:00:00Z",type:"answer_progress",text:`Paragraph ${sequence}`}]}:overview("running"));
 await act(async()=>root.render(<ReportAgentPanel projectId="p1"/>));
 const history=container.querySelector<HTMLElement>('[aria-label="Conversation history"]')!;
 let height=1000;Object.defineProperty(history,"scrollHeight",{configurable:true,get:()=>height});Object.defineProperty(history,"clientHeight",{configurable:true,value:400});
 await act(async()=>{await vi.advanceTimersByTimeAsync(400);});expect(history.scrollTop).toBe(1000);
 await act(async()=>{history.scrollTop=100;history.dispatchEvent(new Event("scroll",{bubbles:true}));});
 height=1200;await act(async()=>{await vi.advanceTimersByTimeAsync(400);});expect(history.scrollTop).toBe(100);
 await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Scroll to latest message"]')!.click());expect(history.scrollTop).toBe(1200);
 height=1400;await act(async()=>{await vi.advanceTimersByTimeAsync(400);});expect(history.scrollTop).toBe(1400);
});

it("keeps method audit inside closed activity details",async()=>{
 api.reportAgentRequest.mockImplementation(async(_project,path="")=>path.includes("events")?{events:[]}:{...overview(),runs:overview().runs.map(run=>({...run,skillUsage:[{id:"r",name:"Review",version:"1",source:"required",contentHash:"h"}]}))});
 await act(async()=>root.render(<ReportAgentPanel projectId="p1"/>));
 const methodSummary=[...container.querySelectorAll('summary')].find(item=>item.textContent?.includes('Methods for this answer'))!;
 const audit=methodSummary.closest('details')!;const activity=audit.parentElement?.closest('details');
 expect(activity).not.toBeNull();expect(activity?.open).toBe(false);expect(audit.open).toBe(false);
 expect(container.textContent).not.toContain('Draft saved in this browser tab');
});

 it("restores a running task by session and explains background work without fake progress", async () => {
  api.reportAgentRequest.mockImplementation(async (_project, path = "") => path.includes("events") ? {events: []} : overview("running"));
  await act(async () => root.render(<ReportAgentPanel projectId="p1" initialSessionId="session-1" />));
  expect(container.querySelector('[aria-label="Task status"]')?.textContent).toContain("Work continues in the background");
  expect(container.querySelector('[aria-label="Task status"]')?.textContent).not.toContain("%");
  await act(async () => root.unmount()); root = createRoot(container);
  await act(async () => root.render(<ReportAgentPanel projectId="p1" initialSessionId="session-1" />));
  expect(container.textContent).toContain("Investigate night consumption");
  expect(container.querySelector('[aria-label="Task status"]')).not.toBeNull();
 });
 it("retries activity refresh after a network failure without declaring the task failed", async () => {
  vi.useFakeTimers(); let attempts = 0;
  api.reportAgentRequest.mockImplementation(async (_project, path = "") => {
   if(path.includes("events")) { if(++attempts === 1) throw new Error("offline"); return {events: []}; }
   return overview("running");
  });
  await act(async () => root.render(<ReportAgentPanel projectId="p1" initialSessionId="session-1" />));
  expect(container.textContent).toContain("Reconnecting to task");
  await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
  expect(attempts).toBeGreaterThan(1);
  expect(container.textContent).not.toContain("Reconnecting to task");
 });

it("offers only one save action for a Skill run that also exposes a draft artifact",async()=>{
 const state=overview();state.runs[0]!.kind="skill";Object.assign(state.runs[0]!,{hasSkillDraft:true});
 api.reportAgentRequest.mockImplementation(async(_project,path="")=>path.includes("events")?{events:[]}:path.startsWith("output/")||path.startsWith("draft-skill/")?{content:"# Draft method"}:state);
 await act(async()=>root.render(<ReportAgentPanel projectId="p1"/>));
 expect([...container.querySelectorAll('button')].filter(b=>b.textContent==="Review and save version")).toHaveLength(1);
 await click("Review and save version");
 expect(api.reportAgentRequest).toHaveBeenCalledWith("p1","draft-skill/run-1",undefined);
 expect(container.querySelector('[aria-label="Save Skill version"]')).not.toBeNull();
});
