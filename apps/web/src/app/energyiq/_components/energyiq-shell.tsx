"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { EnergyIcon, type EnergyIconName } from "./icons";
import { ProjectSwitcher } from "./project-switcher";
import { useEnergyIqAccess } from "./energyiq-access";
import { ActionResultNotices } from "./action-result-notices";
import { EnergyIqAccountMenu } from "./energyiq-account-menu";
import { EnergyIqNotificationBell } from "./energyiq-notification-bell";
import { EnergyIqThemeSwitch } from "./energyiq-theme-switch";
import { EnergyIqLanguageSwitch } from "./energyiq-language-switch";
import { useEnergyIqLocale } from "./energyiq-locale";
import type { EnergyIqMessageKey } from "./energyiq-messages";
import topBar from "./energyiq-top-bar.module.css";
import { EnergyXMark } from "../../../components/brand/energyx-mark";

const CreateProjectDialog = dynamic(() => import("./create-project-dialog").then(module => module.CreateProjectDialog));

// Labels and descriptions are message keys, translated when rendered.
type NavigationItem = { href: string; label: EnergyIqMessageKey; icon: EnergyIconName; description?: EnergyIqMessageKey; adminOnly?: boolean; tab?: string };
type NavigationGroup = { id: string; label: EnergyIqMessageKey; icon: EnergyIconName; description: EnergyIqMessageKey; items: NavigationItem[] };
const SITE_PROFILE = "/energyiq/project-configuration";
const navigation: Array<NavigationItem | NavigationGroup> = [
  { href: "/energyiq/key-points", label: "nav.overview", icon: "spark", description: "nav.overview.hint" },
  { href: "/energyiq/analysis", label: "nav.analysis", icon: "analysis", description: "nav.analysis.hint" },
  { href: "/energyiq/library", label: "nav.reports", icon: "document", description: "nav.reports.hint" },
  { href: "/energyiq/team", label: "nav.team", icon: "user", description: "nav.team.hint" },
  { id: "site-profile", label: "nav.facility", icon: "building", description: "nav.facility.hint", items: [
    { href: SITE_PROFILE, tab: "structure", label: "nav.floorLayout", icon: "floor", description: "nav.floorLayout.hint" },
    { href: SITE_PROFILE, tab: "devices", label: "nav.devices", icon: "meter", description: "nav.devices.hint" },
    { href: SITE_PROFILE, tab: "availability", label: "nav.availability", icon: "check", description: "nav.availability.hint" },
    { href: SITE_PROFILE, tab: "context", label: "nav.projectNotes", icon: "info", description: "nav.projectNotes.hint" },
    { href: SITE_PROFILE, tab: "policies", label: "nav.operatingHours", icon: "clock", description: "nav.operatingHours.hint" },
    { href: SITE_PROFILE, tab: "holidays", label: "nav.holidays", icon: "calendar", description: "nav.holidays.hint" },
    { href: SITE_PROFILE, tab: "tariff", label: "nav.electricityRate", icon: "bolt", description: "nav.electricityRate.hint" },
  ] },
  { id: "ai", label: "nav.advisor", icon: "ask", description: "nav.advisor.hint", items: [
    { href: "/energyiq/reports", label: "nav.askAdvisor", icon: "ask", description: "nav.askAdvisor.hint" },
    { href: "/energyiq/skills", label: "nav.guidelines", icon: "spark", description: "nav.guidelines.hint" },
  ] },
];
const isGroup = (entry: NavigationItem | NavigationGroup): entry is NavigationGroup => "items" in entry;
const SIDEBAR_PREFERENCE_KEY = "energyiq:sidebar-collapsed:v1";
const isReportRoute = (path: string) => ["/energyiq/key-points", "/energyiq/analysis", "/energyiq/reports", "/energyiq/actions", "/energyiq/library", "/energyiq/skills", "/energyiq/project-configuration"].includes(path);
export function EnergyIqShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useEnergyIqLocale();
  const [creatingProject, setCreatingProject] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    let preference: string | null = null;
    try { preference = window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY); } catch { /* Storage is optional. */ }
    setCollapsed(preference === "true" ? true : preference === "false" ? false : window.matchMedia("(max-width: 767px)").matches);
  }, []);
  const updateCollapsed = (next: boolean) => {
    setCollapsed(next);
    try { window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(next)); } catch { /* Keep the in-memory preference. */ }
  };
  const router = useRouter();
  const searchParams = useSearchParams();
  const pageScrollerRef = useRef<HTMLElement>(null);
  const workspaceSwitchInFlightRef = useRef(false);
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null);
  const {
    access,
    activeProject,
    beginNavigationTransition,
    finishNavigationTransition,
    selectOrganisation,
    selectProject,
    selectProjectContext,
    refresh,
  } = useEnergyIqAccess();
  const recentSessions = useRef<Record<string,string>>({});
  const sessionProjectKey = `${access?.activeWorkspaceId}:${activeProject?.id}`;
  useEffect(()=>{const session=searchParams.get("sessionId");if(pathname === "/energyiq/reports" && searchParams.get("projectId") === activeProject?.id && session && session !== "new")recentSessions.current[sessionProjectKey]=session;},[pathname,searchParams,sessionProjectKey]);
  const committedRouteKey = `${pathname}?${searchParams.toString()}`;
  const committedRouteKeyRef = useRef(committedRouteKey);
  useEffect(() => {
    if (committedRouteKeyRef.current === committedRouteKey) return;
    committedRouteKeyRef.current = committedRouteKey;
    finishNavigationTransition();
  }, [committedRouteKey, finishNavigationTransition]);
  const handleNavigationStarted = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const currentHref = `${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;
    if (currentHref === href) return;
    beginNavigationTransition();
  };
  const activeWorkspace = access?.workspaces.find(
    (workspace) => workspace.id === access.activeWorkspaceId,
  );
  const publishedProjects = access?.projects.filter((project) => project.status === "published") ?? [];
  const isAdminPage = pathname.startsWith("/energyiq/admin");
  const contextProjects = isAdminPage && access?.role === "admin"
    ? access.projects
    : isReportRoute(pathname) && access?.role === "admin"
      ? access.projects.filter((project) => project.status !== "archived")
      : publishedProjects;
  const canCreateProject = access?.role === "admin" && !!access.activeWorkspaceId && !activeWorkspace?.disabled;
  const resetPageScroll = () => {
    const pageScroller = pageScrollerRef.current;
    if (!pageScroller) return;
    pageScroller.scrollTop = 0;
    pageScroller.scrollLeft = 0;
  };
  const selectWorkspaceFromShell = async (workspaceId: string, requestedProjectId?: string) => {
    if (workspaceSwitchInFlightRef.current) return;
    const transitionsEnergyContext = pathname === "/energyiq/overview" || pathname === "/energyiq/ai";
    let routeReplacementStarted = false;
    workspaceSwitchInFlightRef.current = true;
    setSwitchingWorkspaceId(workspaceId);
    resetPageScroll();
    if (transitionsEnergyContext) beginNavigationTransition();
    try {
      let nextProject = await selectOrganisation(workspaceId);
      if (!nextProject) throw new Error("No available project in this customer.");
      if (requestedProjectId && requestedProjectId !== nextProject.id) {
        await selectProjectContext(workspaceId, requestedProjectId);
        nextProject = { ...nextProject, id: requestedProjectId };
      }
      if (isReportRoute(pathname) || pathname === "/energyiq/explorer") {
        router.replace(`${pathname}?${new URLSearchParams({ projectId: nextProject.id })}`, { scroll: false });
        return;
      }
      if (!transitionsEnergyContext) return;

      const nextSearchParams = new URLSearchParams(window.location.search);
      nextSearchParams.set("projectId", nextProject.id);
      nextSearchParams.set("scopeId", "project");
      nextSearchParams.delete("period");
      nextSearchParams.delete("from");
      nextSearchParams.delete("to");
      nextSearchParams.delete("currentFrom");
      nextSearchParams.delete("currentTo");
      nextSearchParams.delete("currentDataSnapshotId");
      nextSearchParams.delete("currentProjectReleaseId");
      nextSearchParams.delete("dataSnapshotId");
      nextSearchParams.delete("projectReleaseId");
      nextSearchParams.delete("finding");
      nextSearchParams.delete("evidence");
      nextSearchParams.delete("history");
      nextSearchParams.delete("savedAnalysisId");
      if (pathname === "/energyiq/overview") {
        nextSearchParams.set("grain", "day");
      } else {
        nextSearchParams.delete("grain");
      }
      router.replace(`${pathname}?${nextSearchParams.toString()}`, { scroll: false });
      routeReplacementStarted = true;
    } finally {
      if (transitionsEnergyContext && !routeReplacementStarted) finishNavigationTransition();
      workspaceSwitchInFlightRef.current = false;
      setSwitchingWorkspaceId(null);
    }
  };
  const selectProjectFromShell = (projectId: string) => {
    const transitionsEnergyContext = pathname === "/energyiq/overview" || pathname === "/energyiq/ai";
    resetPageScroll();
    if (transitionsEnergyContext) beginNavigationTransition();
    selectProject(projectId);
    if (isReportRoute(pathname) || pathname === "/energyiq/explorer") {
      router.replace(`${pathname}?${new URLSearchParams({ projectId })}`, { scroll: false });
      return;
    }
    if (!transitionsEnergyContext) return;

    const nextSearchParams = new URLSearchParams(window.location.search);
    nextSearchParams.set("projectId", projectId);
    nextSearchParams.set("scopeId", "project");
    nextSearchParams.delete("period");
    nextSearchParams.delete("from");
    nextSearchParams.delete("to");
    nextSearchParams.delete("currentFrom");
    nextSearchParams.delete("currentTo");
    nextSearchParams.delete("currentDataSnapshotId");
    nextSearchParams.delete("currentProjectReleaseId");
    nextSearchParams.delete("dataSnapshotId");
    nextSearchParams.delete("projectReleaseId");
    nextSearchParams.delete("finding");
    nextSearchParams.delete("evidence");
    nextSearchParams.delete("history");
    nextSearchParams.delete("savedAnalysisId");
    if (pathname === "/energyiq/overview") {
      nextSearchParams.set("grain", "day");
    } else {
      nextSearchParams.delete("grain");
    }
    router.replace(`${pathname}?${nextSearchParams.toString()}`, { scroll: false });
  };

  const projectHref = (path: string, newConversation = false) => {
    if (activeProject && isReportRoute(path)) return `${path}?${new URLSearchParams({ projectId: activeProject.id, ...(path === "/energyiq/reports" ? { sessionId: newConversation ? "new" : (pathname === "/energyiq/reports" && searchParams.get("projectId") === activeProject.id && searchParams.get("sessionId") && searchParams.get("sessionId") !== "new" ? searchParams.get("sessionId")! : recentSessions.current[sessionProjectKey] ?? "new") } : {}) })}`;
    // A draft report project does not replace the published legacy Overview context.
    if (activeProject?.status === "draft" && ["/energyiq/overview", "/energyiq/ai"].includes(path) && publishedProjects[0]) return `${path}?${new URLSearchParams({ projectId: publishedProjects[0].id })}`;
    return path;
  };
  // Hide what this account cannot use and adapt labels before grouping, so a one-item group renders as a plain link.
  const visibleItem = (item: NavigationItem): NavigationItem | null => {
    // Platform admins manage people from the admin pages; only Organisation admins get this page in the portal.
    if (item.href === "/energyiq/team" && !(((access?.permissions?.people ?? "none") !== "none" || access?.team?.canManagePeople) && access?.role !== "admin")) return null;
    if (item.href === "/energyiq/skills" && !(activeProject?.capabilities?.manageSkills ?? access?.role === "admin")) return null;
    if (item.href === "/energyiq/reports" && !(activeProject?.capabilities?.createReport ?? access?.role === "admin")) return { ...item, label: "nav.history", description: "nav.history.hint" };
    return item;
  };
  const entries = navigation.flatMap((entry): Array<NavigationItem | NavigationGroup> => {
    if (!isGroup(entry)) return [visibleItem(entry)].filter((item): item is NavigationItem => !!item);
    const items = entry.items.map(visibleItem).filter((item): item is NavigationItem => !!item);
    return items.length > 1 ? [{ ...entry, items }] : items.map(item => ({ ...item, icon: entry.icon }));
  });
  const isActive = (item: NavigationItem) => item.tab ? pathname === item.href && (searchParams.get("tab") ?? "structure") === item.tab : pathname.startsWith(item.href);
  const activeGroupId = entries.find(entry => isGroup(entry) && entry.items.some(isActive)) as NavigationGroup | undefined;
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(activeGroupId ? [activeGroupId.id] : []));
  useEffect(() => { if (activeGroupId) setOpenGroups(current => current.has(activeGroupId.id) ? current : new Set([...current, activeGroupId.id])); }, [activeGroupId?.id]);
  const toggleGroup = (id: string) => setOpenGroups(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const hrefFor = (item: NavigationItem) => { const base = projectHref(item.href); return item.tab ? `${base}${base.includes("?") ? "&" : "?"}${new URLSearchParams({ tab: item.tab })}` : base; };
  const linkClass = (active: boolean, child = false) => `energyiq-nav-link flex items-center gap-3 rounded-lg text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${child ? "min-h-9 pl-11 pr-3" : "min-h-10 px-3"} ${active ? "" : "text-muted hover:bg-surface-subtle hover:text-foreground"}`;
  const renderLink = (item: NavigationItem, child = false) => {
    const label = t(item.label);
    const description = item.description && t(item.description);
    const hint = collapsed ? (description ? `${label} — ${description}` : label) : description;
    const disabled = item.adminOnly && access?.role !== "admin";
    const href = hrefFor(item);
    const active = isActive(item);
    const key = `${item.href}:${item.tab ?? ""}`;
    return disabled ? <div key={key}>
      <button disabled aria-label={t("shell.adminRequiredLabel", { label })} title={t("shell.adminRequiredFor", { label })} className={`${linkClass(false)} w-full cursor-not-allowed opacity-50`}><EnergyIcon name={item.icon} className="h-[18px] w-[18px] shrink-0" />{!collapsed ? label : null}</button>
      {!collapsed ? <p className="px-3 pb-2 text-xs text-muted">{t("shell.adminRequired")}</p> : null}
    </div> : <Link key={key} href={href} title={hint} aria-label={label} aria-current={active ? "page" : undefined} className={linkClass(active, child && !collapsed)} onClick={(event) => { handleNavigationStarted(event, href); if (window.matchMedia("(max-width: 767px)").matches) updateCollapsed(true); }}>{(!child || collapsed) && <EnergyIcon name={item.icon} className="h-[18px] w-[18px] shrink-0" />}{!collapsed ? <span className="truncate">{label}</span> : null}{item.href==="/energyiq/actions"&&activeProject&&<ActionResultNotices key={sessionProjectKey} projectId={activeProject.id} compact/>}</Link>;
  };
  const renderGroup = (group: NavigationGroup) => {
    // The collapsed rail keeps every page one click away, so groups flatten into their own icons there.
    if (collapsed) return <div key={group.id} className="space-y-1 border-t border-border pt-2">{group.items.map(item => renderLink(item))}</div>;
    const open = openGroups.has(group.id);
    const containsActive = group.items.some(isActive);
    return <div key={group.id}>
      <button type="button" aria-expanded={open} aria-controls={`nav-group-${group.id}`} title={t(group.description)} onClick={() => toggleGroup(group.id)}
        className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 hover:bg-surface-subtle ${containsActive ? "text-foreground" : "text-muted hover:text-foreground"}`}>
        <EnergyIcon name={group.icon} className="h-[18px] w-[18px] shrink-0" /><span className="flex-1 truncate">{t(group.label)}</span>
        <EnergyIcon name="chevron" className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <div id={`nav-group-${group.id}`} className="mt-0.5 space-y-0.5">{group.items.map(item => renderLink(item, true))}</div>}
    </div>;
  };
  return (
    <div data-energyiq-shell="true" className="fixed inset-0 flex h-dvh overflow-hidden bg-surface-subtle text-foreground print:static print:h-auto print:overflow-visible">
      {!collapsed ? <button aria-label={t("shell.closeOverlay")} className="absolute inset-0 z-30 bg-black/20 md:hidden print:hidden" onClick={() => updateCollapsed(true)} /> : null}
      <div className={`${collapsed ? "w-16" : "w-16 md:w-64"} shrink-0 print:hidden`}>
        <aside data-energyiq-sidebar aria-label={t("shell.sidebar")} className={`absolute inset-y-0 left-0 z-40 flex ${collapsed ? "w-16" : "w-64"} flex-col border-r border-border bg-surface md:relative md:h-full`}>
          <div className="flex h-16 shrink-0 items-center gap-2 px-3">
            {!collapsed ? <Link href={projectHref("/energyiq/key-points")} className="flex min-w-0 flex-1 items-center gap-2 font-semibold"><EnergyXMark className="h-5 w-5 shrink-0 text-primary" />EnergyX</Link> : null}
            <button aria-label={t(collapsed ? "shell.expandSidebar" : "shell.collapseSidebar")} aria-expanded={!collapsed} aria-controls="energyiq-sidebar-content" className="rounded-lg p-2 text-muted hover:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-primary/20" onClick={() => updateCollapsed(!collapsed)}><EnergyIcon name="sidebar" className="h-4 w-4" /></button>
          </div>
          <div id="energyiq-sidebar-content" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-3">
            <nav aria-label={t("shell.mainNavigation")} className="mt-3 space-y-1">
              {entries.map(entry => isGroup(entry) ? renderGroup(entry) : renderLink(entry))}
            </nav>
          </div>
        </aside>
      </div>
      {creatingProject && canCreateProject && <CreateProjectDialog workspaceName={activeWorkspace?.name ?? "this workspace"} onClose={() => setCreatingProject(false)} onCreated={async projectId => {
        await refresh();
        router.replace(`/energyiq/reports?${new URLSearchParams({ projectId, sessionId: "new", configure: "1", focus: "initialize" })}`, { scroll: false });
        setCreatingProject(false);
      }} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col print:block">
        <header data-energyiq-topbar aria-label={t("shell.topBar")} className={`${topBar.topBar} print:hidden`}>
          <div className={topBar.project}>{access && <ProjectSwitcher variant="topbar" access={access} activeProject={activeProject} projects={contextProjects} allowDrafts={access.role === "admin" && (isAdminPage || isReportRoute(pathname))} allowArchived={isAdminPage && access.role === "admin"} busy={switchingWorkspaceId !== null} canCreate={canCreateProject} onCreate={()=>setCreatingProject(true)} onSelect={async(workspaceId,projectId)=>{if(workspaceId === access.activeWorkspaceId)selectProjectFromShell(projectId);else await selectWorkspaceFromShell(workspaceId,projectId);}} />}</div>
          <div className={topBar.actions}>
            <EnergyIqLanguageSwitch /><EnergyIqThemeSwitch />{activeProject && !switchingWorkspaceId && <EnergyIqNotificationBell key={sessionProjectKey} projectId={activeProject.id} />}
            <div className={topBar.account}><EnergyIqAccountMenu collapsed placement="down" /></div>
          </div>
        </header>
        <main ref={pageScrollerRef} className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-y-contain print:overflow-visible">
          {access?.role === "user" && access.workspaces.length === 0 ? <section className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center"><h1 className="text-lg font-semibold">{t("shell.noOrganisation")}</h1><p className="mt-2 text-sm text-muted">{t("shell.noOrganisationBody")}</p></section> : children}
        </main>
      </div>
    </div>
  );
}
