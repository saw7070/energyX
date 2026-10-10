/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnergyAccessContextDto, EnergyProjectDto } from "../../../lib/config-api";
import { EnergySelect } from "./energy-select";
import { EnergyIqShell } from "./energyiq-shell";

const navigation = vi.hoisted(() => ({
  pathname: "/energyiq/overview",
  replace: vi.fn<(href: string, options?: { scroll?: boolean }) => void>(),
  search: "",
}));

const mockedAccess = vi.hoisted(() => ({
  access: null as EnergyAccessContextDto | null,
  activeProject: null as EnergyProjectDto | null,
  beginNavigationTransition: vi.fn(),
  finishNavigationTransition: vi.fn(),
  navigationTransitionPending: false,
  selectOrganisation: vi.fn<(workspaceId: string) => Promise<EnergyProjectDto | null>>(),
  selectProject: vi.fn<(projectId: string) => void>(),
}));

vi.mock("../../../lib/config-api", () => ({ configApi: { reportLibraryRequest: vi.fn(async () => ({reports:[],canChat:true})), reportAgentRequest: vi.fn(async () => ({ sessions: [], runs: [] })) } }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("./energyiq-access", () => ({
  useEnergyIqAccess: () => mockedAccess,
}));

// Keep route-transition tests independent of the project picker presentation.
// The real single-entry picker has its own permission, search and keyboard tests.
vi.mock("./project-switcher",()=>({ProjectSwitcher: ({access,projects,activeProject,busy,canCreate,onSelect,onCreate}: any)=><><EnergySelect ariaLabel="Customer workspace" value={busy ? "workspace-2" : access.activeWorkspaceId} disabled={busy} options={access.workspaces.map((w:any)=>({value:w.id,label:busy && w.id === "workspace-2" ? `Switching to ${w.name}…` : `${w.name}${w.disabled ? " (disabled)" : ""}`,disabled:w.disabled}))} onValueChange={id=>{void Promise.resolve(onSelect(id,"")).catch(()=>{});}} /><EnergySelect ariaLabel="Energy project" value={activeProject?.id ?? ""} options={[...projects.map((p:any)=>({value:p.id,label:`Project · ${p.name}`})),...(canCreate?[{value:"create",label:"+ Create project"}]:[])]} onValueChange={id=>id==="create"?onCreate():onSelect(access.activeWorkspaceId,id)} /></>}));
vi.mock("./energyiq-account-menu", () => ({ EnergyIqAccountMenu: () => null }));

describe("EnergyX Shell Project navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    const projectA = project("project-a", "Project A");
    const projectB = project("project-b", "Project B");
    mockedAccess.access = accessContext([projectA, projectB]);
    mockedAccess.activeProject = projectA;
    mockedAccess.selectOrganisation.mockReset();
    mockedAccess.selectOrganisation.mockResolvedValue(projectA);
    mockedAccess.selectProject.mockReset();
    mockedAccess.beginNavigationTransition.mockReset();
    mockedAccess.finishNavigationTransition.mockReset();
    mockedAccess.navigationTransitionPending = false;
    navigation.pathname = "/energyiq/overview";
    navigation.search = "projectId=project-a&scopeId=level-6&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&currentFrom=2026-06-10&currentTo=2026-06-16&currentDataSnapshotId=snapshot-v1&currentProjectReleaseId=release-v1";
    window.history.replaceState({}, "", `/energyiq/overview?${navigation.search}`);
    navigation.replace.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll("[role='listbox']").forEach((element) => element.remove());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("restores a collapsed sidebar across a route-driven remount", async () => {
    await act(async () => root.render(<EnergyIqShell><div>Chat</div></EnergyIqShell>));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Collapse sidebar"]')?.click());
    expect(window.localStorage.getItem("energyiq:sidebar-collapsed:v1")).toBe("true");
    await act(async () => root.unmount());
    root = createRoot(container); navigation.pathname = "/energyiq/library";
    await act(async () => root.render(<EnergyIqShell><div>Knowledge</div></EnergyIqShell>));
    expect(container.querySelector('[aria-label="Expand sidebar"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Collapse sidebar"]')).toBeNull();
  });
  it("uses the mobile default and stays usable when preference storage fails", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    await act(async () => root.render(<EnergyIqShell><div>Page</div></EnergyIqShell>));
    expect(container.querySelector('[aria-label="Expand sidebar"]')).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Expand sidebar"]')?.click());
    expect(container.querySelector('[aria-label="Collapse sidebar"]')).not.toBeNull();
  });
  it("honours an explicitly expanded preference on mobile", async () => {
    window.localStorage.setItem("energyiq:sidebar-collapsed:v1", "false");
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    await act(async () => root.render(<EnergyIqShell><div>Page</div></EnergyIqShell>));
    expect(container.querySelector('[aria-label="Collapse sidebar"]')).not.toBeNull();
  });
  it("retains member history while hiding new conversations and Skills", async () => {
    await act(async () => root.render(<EnergyIqShell><div>Page</div></EnergyIqShell>));
    expect(container.querySelector('aside[aria-label="EnergyX sidebar"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Ask the advisor — administrator access required"]')).toBeNull();
    expect(container.querySelector('a[href^="/energyiq/reports"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Advisor guidelines"); expect(container.textContent).toContain("Conversation history"); expect(container.textContent).not.toContain("New conversation"); expect(container.textContent).toContain("Facility"); expect(container.textContent).not.toContain("Legacy");
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Collapse sidebar"]');
    await act(async () => toggle?.click()); expect(container.querySelector('[aria-label="Expand sidebar"]')?.getAttribute("aria-expanded")).toBe("false");
  });

  it("retains the current-page indication and keyboard navigation when the sidebar collapses", async () => {
    navigation.pathname = "/energyiq/library";
    await act(async () => root.render(<EnergyIqShell><div>Page</div></EnergyIqShell>));
    const current = container.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
    expect(current?.textContent).toContain("Reports");
    current?.focus();
    expect(document.activeElement).toBe(current);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Collapse sidebar"]')?.click());
    const collapsedCurrent = container.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
    expect(collapsedCurrent?.getAttribute("aria-label")).toBe("Reports");
    collapsedCurrent?.focus();
    expect(document.activeElement).toBe(collapsedCurrent);
  });

  it("keeps the sidebar to page links; reports and conversations live on their own pages",async()=>{
    navigation.pathname="/energyiq/reports";navigation.search="projectId=project-a&sessionId=old-session";
    mockedAccess.access={...mockedAccess.access!,role:"admin"};
    await act(async()=>root.render(<EnergyIqShell><div>Chat</div></EnergyIqShell>));
    expect(container.querySelector('a[aria-label="New conversation"]')).toBeNull();
    expect(container.querySelector('section[aria-label="Conversations"]')).toBeNull();
    expect(container.querySelector('a[aria-label="Reports"]')?.getAttribute("href")).toBe("/energyiq/library?projectId=project-a");
  });
  it("resumes the current analysis and never carries a session into another project",async()=>{
    navigation.pathname="/energyiq/reports";navigation.search="projectId=project-a&sessionId=s1";mockedAccess.access={...accessContext([project("project-a","Project A"),project("project-b","Project B")]),role:"admin"};
    await act(async()=>root.render(<EnergyIqShell><div>Analysis</div></EnergyIqShell>));
    expect(container.querySelector('a[aria-label="Ask the advisor"]')?.getAttribute("href")).toContain("sessionId=s1");
    mockedAccess.activeProject=project("project-b","Project B");
    await act(async()=>root.render(<EnergyIqShell><div>Switching</div></EnergyIqShell>));
    expect(container.querySelector('a[aria-label="Ask the advisor"]')?.getAttribute("href")).toBe("/energyiq/reports?projectId=project-b&sessionId=new");
  });

  it("clears the previous report Session when selecting another Project", async () => {
    navigation.pathname = "/energyiq/reports"; navigation.search = "projectId=project-a&sessionId=old-session";
    window.history.replaceState({}, "", `/energyiq/reports?${navigation.search}`);
    mockedAccess.access = { ...mockedAccess.access!, role: "admin" };
    await act(async () => root.render(<EnergyIqShell><div>Chat</div></EnergyIqShell>));
    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Energy project']");
    await act(async () => trigger?.click());
    const option = [...document.querySelectorAll<HTMLButtonElement>("[role='option']")].find((item) => item.textContent?.includes("Project B"));
    await act(async () => option?.click());
    expect(navigation.replace).toHaveBeenCalledWith("/energyiq/reports?projectId=project-b", { scroll: false });
  });
  it("offers draft projects for administrator report routes but not for ordinary readers", async () => {
    navigation.pathname = "/energyiq/reports";
    mockedAccess.access!.projects.push({ ...project("draft-project", "First report"), status: "draft" });
    mockedAccess.access = { ...mockedAccess.access!, role: "admin" };
    await act(async () => root.render(<EnergyIqShell><div>Chat</div></EnergyIqShell>));
    let trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Energy project']");
    await act(async () => trigger?.click());
    expect(document.querySelector("[role='listbox']")?.textContent).toContain("First report");
    const draft = [...document.querySelectorAll<HTMLButtonElement>("[role='option']")].find((item) => item.textContent?.includes("First report"));
    await act(async () => draft?.click());
    expect(navigation.replace).toHaveBeenCalledWith("/energyiq/reports?projectId=draft-project", { scroll: false });
    mockedAccess.access = { ...mockedAccess.access!, role: "user" };
    navigation.pathname = "/energyiq/library";
    await act(async () => root.render(<EnergyIqShell><div>Knowledge</div></EnergyIqShell>));
    trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Energy project']");
    await act(async () => trigger?.click());
    expect(document.querySelector("[role='listbox']")?.textContent).not.toContain("First report");
  });
  it("shows a viewer every Facility tab, but no Team link", async () => {
    navigation.pathname = "/energyiq/project-configuration"; navigation.search = "projectId=project-a";
    mockedAccess.access = { ...mockedAccess.access!, role: "user" };
    mockedAccess.activeProject = { ...project("project-a", "Project A"), capabilities: { readReports: true, readExplorer: true, readProjectInformation: true, readOwnHistory: true, createReport: true, manageSkills: false, manageAutomation: false, editConfiguration: false, publishConfiguration: false } };
    await act(async () => root.render(<EnergyIqShell><div>Page</div></EnergyIqShell>));
    expect(Array.from(container.querySelectorAll("#nav-group-site-profile a")).map(link => link.getAttribute("aria-label"))).toEqual(["Floor layout", "Devices", "Data availability", "Project notes", "Operating hours", "Holidays", "Electricity rate", "Budget & carbon"]);
    expect(container.querySelector('a[href^="/energyiq/team"]')).toBeNull();
  });
  it("shows the Team link only to an Organisation admin who may manage people", async () => {
    mockedAccess.access = { ...mockedAccess.access!, role: "user", team: { canManagePeople: true } };
    await act(async () => root.render(<EnergyIqShell><div>Page</div></EnergyIqShell>));
    expect(container.querySelector('a[aria-label="Team"]')?.getAttribute("href")).toContain("/energyiq/team");
    mockedAccess.access = { ...mockedAccess.access!, role: "admin", team: { canManagePeople: true } };
    await act(async () => root.render(<EnergyIqShell><div>Page</div></EnergyIqShell>));
    expect(container.querySelector('a[aria-label="Team"]')).toBeNull();
  });
  it("switches the Overview Project in access state and the URL together", async () => {
    await act(async () => {
      root.render(<EnergyIqShell><div>Overview</div></EnergyIqShell>);
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Energy project']");
    await act(async () => trigger?.click());
    const projectBOption = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.includes("Project B"));
    await act(async () => projectBOption?.click());

    expect(mockedAccess.selectProject).toHaveBeenCalledOnce();
    expect(mockedAccess.selectProject).toHaveBeenCalledWith("project-b");
    expect(mockedAccess.beginNavigationTransition).toHaveBeenCalledOnce();
    expect(mockedAccess.beginNavigationTransition.mock.invocationCallOrder[0])
      .toBeLessThan(mockedAccess.selectProject.mock.invocationCallOrder[0]!);
    expect(navigation.replace).toHaveBeenCalledOnce();
    expect(navigation.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=project-b&scopeId=project&resource=electricity&grain=day",
      { scroll: false },
    );
  });

  it("clears the previous Explorer project, circuit and snapshot when switching projects", async () => {
    navigation.pathname = "/energyiq/explorer";
    await act(async () => {
      root.render(<EnergyIqShell><div>Explorer</div></EnergyIqShell>);
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Energy project']");
    await act(async () => trigger?.click());
    const projectBOption = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.includes("Project B"));
    await act(async () => projectBOption?.click());

    expect(mockedAccess.selectProject).toHaveBeenCalledOnce();
    expect(mockedAccess.selectProject).toHaveBeenCalledWith("project-b");
    expect(navigation.replace).toHaveBeenCalledWith("/energyiq/explorer?projectId=project-b", { scroll: false });
  });

  it("groups Facility tabs and AI pages into expandable sections and opens the section of the current page", async () => {
    navigation.pathname = "/energyiq/project-configuration"; navigation.search = "projectId=project-a&tab=holidays";
    mockedAccess.access = { ...mockedAccess.access!, role: "admin" };
    await act(async () => root.render(<EnergyIqShell><div>Page</div></EnergyIqShell>));
    expect(container.querySelector('button[aria-controls="nav-group-site-profile"]')?.getAttribute("aria-expanded")).toBe("true");
    const current = container.querySelector('a[aria-current="page"]');
    expect(current?.getAttribute("aria-label")).toBe("Holidays");
    expect(current?.getAttribute("href")).toBe("/energyiq/project-configuration?projectId=project-a&tab=holidays");
    expect(Array.from(container.querySelectorAll("#nav-group-site-profile a")).map(link => link.getAttribute("aria-label"))).toEqual(["Floor layout", "Devices", "Data availability", "Project notes", "Operating hours", "Holidays", "Electricity rate", "Budget & carbon"]);
    const ai = container.querySelector<HTMLButtonElement>('button[aria-controls="nav-group-ai"]');
    expect(ai?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => ai?.click());
    expect(Array.from(container.querySelectorAll("#nav-group-ai a")).map(link => link.getAttribute("aria-label"))).toEqual(["Ask the advisor", "Advisor guidelines"]);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Collapse sidebar"]')?.click());
    expect(container.querySelector('a[aria-current="page"]')?.getAttribute("aria-label")).toBe("Holidays");
  });

  it("keeps paused legacy pages out of primary navigation", async () => {
    await act(async () => {
      root.render(<EnergyIqShell><div>Overview</div></EnergyIqShell>);
    });

    const mainNavigation = container.querySelector("nav[aria-label='Main navigation']");
    expect(mainNavigation?.querySelector("a[href^='/energyiq/overview']")).toBeNull();
    expect(mainNavigation?.textContent).toContain("Conversation history");
    expect(mainNavigation?.textContent).not.toContain("Energy consumption");
    expect(mainNavigation?.textContent).not.toContain("Action plan");
    expect(mainNavigation?.textContent).not.toContain("Saved analyses");
  });

  it("keeps Workspace and Project context visible in Admin", async () => {
    navigation.pathname = "/energyiq/admin";
    mockedAccess.access = {
      ...accessContext([project("project-a", "Project A"), project("project-b", "Project B")]),
      role: "admin",
      workspaces: [
        { id: "workspace-1", name: "Workspace 1", kind: "customer", disabled: false },
        { id: "workspace-2", name: "Workspace 2", kind: "customer", disabled: false },
      ],
    };

    await act(async () => {
      root.render(<EnergyIqShell><div>Admin</div></EnergyIqShell>);
    });

    expect(container.querySelector("[role='combobox'][aria-label='Customer workspace']")).not.toBeNull();
    expect(container.querySelector("[role='combobox'][aria-label='Energy project']")).not.toBeNull();
  });

  it("shows customer names without repeating the internal Workspace prefix", async () => {
    mockedAccess.access = {
      ...accessContext([project("preschool-demo", "Preschool Demo")]),
      workspaces: [
        { id: "workspace-1", name: "Preschool Demo", kind: "customer", disabled: false },
        { id: "workspace-2", name: "Ngee Ann FM", kind: "customer", disabled: false },
        { id: "workspace-3", name: "Tuya Office", kind: "customer", disabled: true },
      ],
    };
    mockedAccess.activeProject = project("preschool-demo", "Preschool Demo");

    await act(async () => {
      root.render(<EnergyIqShell><div>Overview</div></EnergyIqShell>);
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Customer workspace']");
    expect(trigger?.textContent).toContain("Preschool Demo");
    expect(trigger?.textContent).not.toContain("Workspace ·");

    await act(async () => trigger?.click());
    const optionLabels = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .map((option) => option.textContent?.trim());
    expect(optionLabels).toEqual([
      "Preschool Demo",
      "Ngee Ann FM",
      "Tuya Office (disabled)",
    ]);
    expect(optionLabels.some((label) => label?.startsWith("Workspace"))).toBe(false);
  });

  it("switches the AI Analysis Project and removes the previous handoff context", async () => {
    navigation.pathname = "/energyiq/ai";
    navigation.search = "projectId=project-a&scopeId=level-6&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&finding=old-finding&evidence=old-evidence";
    window.history.replaceState({}, "", `/energyiq/ai?${navigation.search}`);
    await act(async () => {
      root.render(<EnergyIqShell><div>AI Analysis</div></EnergyIqShell>);
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Energy project']");
    await act(async () => trigger?.click());
    const projectBOption = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.includes("Project B"));
    await act(async () => projectBOption?.click());

    expect(mockedAccess.selectProject).toHaveBeenCalledOnce();
    expect(mockedAccess.selectProject).toHaveBeenCalledWith("project-b");
    expect(navigation.replace).toHaveBeenCalledWith(
      "/energyiq/ai?projectId=project-b&scopeId=project&resource=electricity",
      { scroll: false },
    );
  });

  it("makes a mounted historical AI Session inert before same-page top-nav commits", async () => {
    navigation.pathname = "/energyiq/ai";
    navigation.search = "projectId=project-a&scopeId=project&resource=electricity&period=Custom&from=2026-06-01&to=2026-06-16&dataSnapshotId=snapshot-june&projectReleaseId=release-june";
    window.history.replaceState({}, "", `/energyiq/ai?${navigation.search}`);
    await act(async () => {
      root.render(<EnergyIqShell><div>Historical AI Session</div></EnergyIqShell>);
    });

    const analystLink = Array.from(
      container.querySelectorAll<HTMLAnchorElement>("nav[aria-label='Main navigation'] a"),
    ).find((link) => link.textContent?.includes("Reports"));
    await act(async () => analystLink?.click());

    expect(mockedAccess.beginNavigationTransition).toHaveBeenCalledOnce();
  });

  it("opens the selected Workspace's published Overview after switching Workspace", async () => {
    const workspaceTwoProject = project("project-c", "Project C", "workspace-2");
    mockedAccess.access = {
      ...accessContext([project("project-a", "Project A")]),
      workspaces: [
        { id: "workspace-1", name: "Workspace 1", kind: "customer", disabled: false },
        { id: "workspace-2", name: "Workspace 2", kind: "customer", disabled: false },
      ],
    };
    mockedAccess.selectOrganisation.mockResolvedValueOnce(workspaceTwoProject);
    await act(async () => {
      root.render(<EnergyIqShell><div>Overview</div></EnergyIqShell>);
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Customer workspace']");
    await act(async () => trigger?.click());
    const workspaceTwoOption = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.includes("Workspace 2"));
    await act(async () => workspaceTwoOption?.click());

    expect(mockedAccess.selectOrganisation).toHaveBeenCalledOnce();
    expect(mockedAccess.selectOrganisation).toHaveBeenCalledWith("workspace-2");
    expect(navigation.replace).toHaveBeenCalledOnce();
    expect(navigation.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=project-c&scopeId=project&resource=electricity&grain=day",
      { scroll: false },
    );
  });

  it("shows the target Workspace immediately while a slow switch is pending", async () => {
    const workspaceTwoProject = project("project-c", "Project C", "workspace-2");
    mockedAccess.access = {
      ...accessContext([project("project-a", "Project A")]),
      workspaces: [
        { id: "workspace-1", name: "Workspace 1", kind: "customer", disabled: false },
        { id: "workspace-2", name: "Workspace 2", kind: "customer", disabled: false },
      ],
    };
    let finishWorkspaceSwitch!: (project: EnergyProjectDto | null) => void;
    mockedAccess.selectOrganisation.mockReturnValueOnce(new Promise((resolve) => {
      finishWorkspaceSwitch = resolve;
    }));
    await act(async () => {
      root.render(<EnergyIqShell><div>Overview stays visible</div></EnergyIqShell>);
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Customer workspace']");
    await act(async () => trigger?.click());
    const workspaceTwoOption = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.includes("Workspace 2"));
    await act(async () => workspaceTwoOption?.click());

    expect(mockedAccess.beginNavigationTransition).toHaveBeenCalledOnce();
    expect(trigger?.disabled).toBe(true);
    expect(trigger?.textContent).toContain("Switching to Workspace 2");
    expect(container.textContent).toContain("Overview stays visible");
    expect(navigation.replace).not.toHaveBeenCalled();

    await act(async () => {
      finishWorkspaceSwitch(workspaceTwoProject);
      await Promise.resolve();
    });
    expect(navigation.replace).toHaveBeenCalledOnce();
  });

  it("preserves the current pinned Overview when the target Workspace has no published Project", async () => {
    mockedAccess.access = {
      ...accessContext([project("project-a", "Project A")]),
      workspaces: [
        { id: "workspace-1", name: "Workspace 1", kind: "customer", disabled: false },
        { id: "workspace-2", name: "Workspace 2", kind: "customer", disabled: false },
      ],
    };
    mockedAccess.selectOrganisation.mockResolvedValueOnce(null);
    await act(async () => {
      root.render(<EnergyIqShell><div>Overview</div></EnergyIqShell>);
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Customer workspace']");
    await act(async () => trigger?.click());
    const workspaceTwoOption = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.includes("Workspace 2"));
    await act(async () => workspaceTwoOption?.click());

    expect(mockedAccess.selectOrganisation).toHaveBeenCalledWith("workspace-2");
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(window.location.search).toContain("currentDataSnapshotId=snapshot-v1");
    expect(trigger?.disabled).toBe(false);
  });

  it("resets the internal page scroll before a Workspace switch and contains scroll chaining", async () => {
    const workspaceTwoProject = project("project-c", "Project C", "workspace-2");
    mockedAccess.access = {
      ...accessContext([project("project-a", "Project A")]),
      workspaces: [
        { id: "workspace-1", name: "Workspace 1", kind: "customer", disabled: false },
        { id: "workspace-2", name: "Workspace 2", kind: "customer", disabled: false },
      ],
    };
    let finishWorkspaceSwitch!: (project: EnergyProjectDto | null) => void;
    mockedAccess.selectOrganisation.mockReturnValueOnce(new Promise((resolve) => {
      finishWorkspaceSwitch = resolve;
    }));

    await act(async () => {
      root.render(<EnergyIqShell><div>Overview</div></EnergyIqShell>);
    });

    const pageScroller = container.querySelector<HTMLElement>("main");
    expect(pageScroller).not.toBeNull();
    pageScroller!.scrollTop = 640;
    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Customer workspace']");
    await act(async () => trigger?.click());
    const workspaceTwoOption = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.includes("Workspace 2"));
    await act(async () => workspaceTwoOption?.click());

    expect(pageScroller!.scrollTop).toBe(0);
    expect(pageScroller!.className).toContain("overscroll-y-contain");

    await act(async () => {
      finishWorkspaceSwitch(workspaceTwoProject);
      await Promise.resolve();
    });
  });

  it("pins the application shell to the viewport so long Overviews cannot create an outer document scroller", async () => {
    await act(async () => {
      root.render(<EnergyIqShell><div style={{ height: "20000px" }}>Long Overview</div></EnergyIqShell>);
    });

    const shell = container.querySelector<HTMLElement>("[data-energyiq-shell='true']");
    const pageScroller = shell?.querySelector<HTMLElement>("main");
    expect(shell?.className).toContain("fixed");
    expect(shell?.className).toContain("inset-0");
    expect(shell?.className).toContain("overflow-hidden");
    expect(pageScroller?.className).toContain("overflow-auto");
  });

  it("offers Create project to admins even when the workspace has no projects", async () => {
    mockedAccess.access={...accessContext([]),role:"admin"};mockedAccess.activeProject=null;
    await act(async()=>root.render(<EnergyIqShell><div>Empty workspace</div></EnergyIqShell>));
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Energy project"]')?.click());
    expect([...document.querySelectorAll('[role="option"]')].some(option=>option.textContent?.includes("Create project"))).toBe(true);
  });
  it("does not offer project creation to a customer member", async () => {
    await act(async()=>root.render(<EnergyIqShell><div>Customer workspace</div></EnergyIqShell>));
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Energy project"]')?.click());
    expect([...document.querySelectorAll('[role="option"]')].some(option=>option.textContent?.includes("Create project"))).toBe(false);
  });

  it("clears stale AI Analysis Snapshot and Release pins after switching Workspace", async () => {
    const workspaceTwoProject = project("project-c", "Project C", "workspace-2");
    navigation.pathname = "/energyiq/ai";
    navigation.search = "projectId=project-a&scopeId=project&resource=electricity&period=Custom&from=2026-05-20&to=2026-06-16&dataSnapshotId=snapshot-ngee&projectReleaseId=release-ngee&finding=old-finding&evidence=old-evidence";
    window.history.replaceState({}, "", `/energyiq/ai?${navigation.search}`);
    mockedAccess.access = {
      ...accessContext([project("project-a", "Project A")]),
      workspaces: [
        { id: "workspace-1", name: "Workspace 1", kind: "customer", disabled: false },
        { id: "workspace-2", name: "Workspace 2", kind: "customer", disabled: false },
      ],
    };
    mockedAccess.selectOrganisation.mockResolvedValueOnce(workspaceTwoProject);
    await act(async () => {
      root.render(<EnergyIqShell><div>AI Analysis</div></EnergyIqShell>);
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Customer workspace']");
    await act(async () => trigger?.click());
    const workspaceTwoOption = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.includes("Workspace 2"));
    await act(async () => workspaceTwoOption?.click());

    expect(mockedAccess.selectOrganisation).toHaveBeenCalledWith("workspace-2");
    expect(navigation.replace).toHaveBeenCalledWith(
      "/energyiq/ai?projectId=project-c&scopeId=project&resource=electricity",
      { scroll: false },
    );
  });
});

function project(id: string, name: string, workspaceId = "workspace-1"): EnergyProjectDto {
  return { id, name, workspaceId, status: "published", timezone: "Asia/Singapore" };
}

function accessContext(projects: EnergyProjectDto[]): EnergyAccessContextDto {
  return {
    role: "user",
    user: { id: "user-1" },
    activeWorkspaceId: "workspace-1",
    workspaces: [{ id: "workspace-1", name: "Workspace 1", kind: "customer", disabled: false }],
    projects,
  };
}
