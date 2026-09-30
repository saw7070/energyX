"use client";

import Link from "next/link";
import { EnergyIcon, type EnergyIconName } from "../_components/icons";
import { EnergySelect } from "../_components/energy-select";

export type AdminSection =
  | "overview"
  | "organisations"
  | "users"
  | "project-overview"
  | "basics"
  | "structure"
  | "data-sources"
  | "meter-mapping"
  | "operational-policies"
  | "data-map"
  | "templates"
  | "ai-analysis"
  | "report-agent"
  | "knowledge"
  | "methods"
  | "assets"
  | "task-history"
  | "runs"
  | "conversations"
  | "usage"
  | "traces"
  | "harness"
  | "models"
  | "skills"
  | "tools"
  | "mcp";

type AdminProjectSummary = {
  id: string;
  name: string;
  status: string;
  workspaceId?: string;
  workspaceName?: string;
};

type AdminSidebarProps = {
  projects: AdminProjectSummary[];
  selectedProjectId: string;
  activeSection: AdminSection;
  desktopCollapsed: boolean;
  onProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  onDesktopCollapsedChange: (collapsed: boolean) => void;
  onSectionChange: (section: AdminSection) => void;
};

type NavigationItem = {
  id: AdminSection;
  label: string;
  icon: EnergyIconName;
  available: boolean;
};

const accessItems: NavigationItem[] = [
  { id: "organisations", label: "Organisations", icon: "building", available: true },
  { id: "users", label: "Users", icon: "user", available: true },
];

const projectItems: NavigationItem[] = [
  { id: "project-overview", label: "Project status & publishing", icon: "analysis", available: true },
  { id: "structure", label: "Structure", icon: "floor", available: true },
  { id: "data-sources", label: "Data Sources", icon: "settings", available: true },
  { id: "meter-mapping", label: "Meter Mapping", icon: "meter", available: true },
  { id: "operational-policies", label: "Tariff & Hours", icon: "settings", available: true },

];

const legacyItems: NavigationItem[] = [
  { id: "templates", label: "Legacy Overview Design", icon: "explorer", available: true },
  { id: "ai-analysis", label: "Legacy AI Insights", icon: "analysis", available: true },
  { id: "methods", label: "Legacy Methods & SOP", icon: "settings", available: true },
];

const operationItems: NavigationItem[] = [
  { id: "task-history", label: "Task history", icon: "analysis", available: true },
  { id: "runs", label: "Runs & Traces", icon: "analysis", available: true },
];

const configurationItems: NavigationItem[] = [
  { id: "models", label: "Models", icon: "settings", available: true },
  { id: "harness", label: "Configuration overview", icon: "settings", available: true },
];

export function EnergyIqAdminSidebar(props: AdminSidebarProps) {
  const selectedProject = props.projects.find((project) => project.id === props.selectedProjectId);
  const activeLabel = labelForSection(props.activeSection);

  return (
    <>
      <aside
        aria-label={props.desktopCollapsed ? "Admin navigation rail" : "Admin navigation sidebar"}
        className={props.desktopCollapsed
          ? "energyiq-collapsed-rail hidden shrink-0 flex-col items-center border-r border-border bg-surface-subtle lg:flex"
          : "hidden w-[276px] shrink-0 border-r border-border bg-surface lg:flex lg:flex-col"}
      >
        {props.desktopCollapsed ? (
          <div className="energyiq-sidebar-header flex w-full items-center justify-center">
            <button
              type="button"
              aria-label="Show admin navigation"
              title="Show admin navigation"
              onClick={() => props.onDesktopCollapsedChange(false)}
              className="energyiq-collapse-control flex items-center justify-center rounded-lg border border-border bg-surface text-foreground shadow-[var(--shadow-card)] transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              <EnergyIcon name="sidebar" className="h-[18px] w-[18px]" />
            </button>
          </div>
        ) : (
          <SidebarContent {...props} selectedProject={selectedProject} />
        )}
      </aside>

      <details className="group border-b border-border bg-surface lg:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/25">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
            <EnergyIcon name="settings" className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui-support font-semibold">Admin</span>
            <span className="block truncate text-ui-label text-muted">{activeLabel}</span>
          </span>
          <EnergyIcon name="chevron" className="h-4 w-4 rotate-90 text-muted transition-transform group-open:-rotate-90" />
        </summary>
        <div className="max-h-[72vh] overflow-auto border-t border-border">
          <SidebarContent {...props} selectedProject={selectedProject} compact />
        </div>
      </details>
    </>
  );
}

function SidebarContent({
  projects,
  selectedProjectId,
  selectedProject,
  activeSection,
  onProjectChange,
  onCreateProject,
  onDesktopCollapsedChange,
  onSectionChange,
  compact = false,
}: AdminSidebarProps & { selectedProject?: AdminProjectSummary; compact?: boolean }) {
  return (
    <div className={compact ? "p-3" : "flex min-h-0 flex-1 flex-col"}>
      {!compact ? (
        <div className="border-b border-border">
          <div className="energyiq-sidebar-header flex items-center justify-between gap-3">
            <h1 className="min-w-0 truncate text-base font-semibold">Admin console</h1>
            <button
              type="button"
              aria-label="Collapse admin navigation"
              title="Collapse admin navigation"
              onClick={() => onDesktopCollapsedChange(true)}
              className="energyiq-collapse-control flex shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              <EnergyIcon name="sidebar" className="h-[18px] w-[18px]" />
            </button>
          </div>
          <div className="px-3 py-2">
            <button
              type="button"
              onClick={onCreateProject}
              className="w-full rounded-lg border border-border px-2.5 py-1.5 text-ui-label font-semibold transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              New project
            </button>
          </div>
        </div>
      ) : null}

      <nav className={compact ? "space-y-2" : "min-h-0 flex-1 space-y-2 overflow-auto p-3"} aria-label="Admin navigation">
        <NavigationButton
          item={{ id: "overview", label: "Overview", icon: "analysis", available: true }}
          active={activeSection === "overview"}
          onSelect={onSectionChange}
          prominent
        />

        <NavigationGroup title="Accounts & access" items={accessItems} activeSection={activeSection} onSelect={onSectionChange} />

        <details className="group/projects" open>
          <NavigationGroupSummary label="Project configuration" active={isProjectSection(activeSection)} />
          <div className="mt-1 space-y-1 pl-2">
            <div className="mb-2 px-1">
              <EnergySelect
                ariaLabel="Admin project"
                value={selectedProjectId}
                options={projects.map((project) => ({
                  value: project.id,
                  label: project.workspaceName ? `${project.workspaceName} · ${project.name}` : project.name,
                }))}
                onValueChange={onProjectChange}
                leadingIcon={<EnergyIcon name="building" className="h-3.5 w-3.5" />}
                placeholder="Select project"
                className="w-full"
                triggerClassName="bg-surface-subtle text-ui-label font-semibold hover:border-muted-light"
              />
              <span className="mt-1.5 flex items-center justify-between px-1 text-ui-meta text-muted-light">
                <span>Selected project</span>
                <span className="capitalize">{selectedProject?.status ?? "Draft"}</span>
              </span>
            </div>
            {projectItems.map((item) => (
              <NavigationButton
                key={item.id}
                item={item}
                active={activeProjectSection(activeSection) === item.id}
                onSelect={onSectionChange}
                nested
              />
            ))}
          </div>
        </details>

        <NavigationButton item={{ id: "models", label: "Models", icon: "settings", available: true }} active={activeSection === "models"} onSelect={onSectionChange} />
        <NavigationButton item={operationItems[0]!} active={activeSection === "task-history"} onSelect={onSectionChange} />
        <NavigationGroup title="Legacy / Developer diagnostics" items={[...operationItems.filter(item => item.id !== "task-history"), ...configurationItems.filter(item => item.id !== "models")]} activeSection={activeSection} onSelect={onSectionChange} />
        <NavigationGroup title="Legacy features" items={legacyItems} activeSection={activeSection} onSelect={onSectionChange} />
        {selectedProjectId && <Link className="flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-ui-support text-muted hover:bg-surface-subtle" href={`/energyiq/reports?${new URLSearchParams({projectId:selectedProjectId})}`}><EnergyIcon name="ask" className="h-4 w-4" />Open energy advisor</Link>}
      </nav>
    </div>
  );
}

function NavigationGroup({
  title,
  items,
  activeSection,
  onSelect,
}: {
  title: string;
  items: NavigationItem[];
  activeSection: AdminSection;
  onSelect: (section: AdminSection) => void;
}) {
  const active = items.some((item) => item.id === activeSection);
  return (
    <details className="group/nav" open={active || title === "Accounts & access"}>
      <NavigationGroupSummary label={title} active={active} />
      <div className="mt-1 space-y-1 pl-2">
        {title === "Legacy features" && <p className="px-2.5 py-1 text-xs leading-5 text-muted">For maintaining the previous Overview and insights workflow. New reports use the energy advisor.</p>}
        {items.map((item) => (
          <NavigationButton key={item.id} item={item} active={item.id === activeSection} onSelect={onSelect} nested />
        ))}
      </div>
    </details>
  );
}

function NavigationGroupSummary({ label, active }: { label: string; active: boolean }) {
  return (
    <summary className={[
      "flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 text-ui-support font-semibold transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
      active ? "text-foreground" : "text-muted",
    ].join(" ")}>
      <EnergyIcon name="chevron" className="h-3 w-3 rotate-90 transition-transform group-open/nav:-rotate-90 group-open/projects:-rotate-90" />
      <span className="flex-1">{label}</span>
    </summary>
  );
}

function NavigationButton({
  item,
  active,
  onSelect,
  nested = false,
  prominent = false,
}: {
  item: NavigationItem;
  active: boolean;
  onSelect: (section: AdminSection) => void;
  nested?: boolean;
  prominent?: boolean;
}) {
  if (!item.available) {
    return (
      <div className={[
        "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-muted",
        nested ? "ml-2" : "",
      ].join(" ")} aria-disabled="true">
        <EnergyIcon name={item.icon} className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-ui-support">{item.label}</span>
        <span className="text-ui-meta font-medium uppercase tracking-wide text-muted-light">Later</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={active ? "page" : undefined}
      className={[
        "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-ui-support font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
        nested ? "ml-2 w-[calc(100%-0.5rem)]" : "",
        active
          ? "bg-primary text-white"
          : prominent
            ? "text-foreground hover:bg-surface-subtle"
            : "text-muted hover:bg-surface-subtle hover:text-foreground",
      ].join(" ")}
    >
      <EnergyIcon name={item.icon} className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </button>
  );
}

function activeProjectSection(section: AdminSection): AdminSection {
  return section === "basics" ? "project-overview" : section;
}

function isProjectSection(section: AdminSection): boolean {
  return projectItems.some((item) => item.id === activeProjectSection(section)) || section === "runs";
}

function labelForSection(section: AdminSection): string {
  const allItems = [
    { id: "overview" as AdminSection, label: "Overview" },
    ...accessItems,
    ...projectItems,
    ...operationItems,
    ...configurationItems,
    ...legacyItems,
  ];
  if (section === "basics") return "Project basics";
  return allItems.find((item) => item.id === section)?.label ?? "Admin";
}

export function isAdminSection(value: string | null): value is AdminSection {
  if (!value) return false;
  return [
    "overview", "organisations", "users", "project-overview", "basics", "structure",
    "data-sources", "meter-mapping", "operational-policies", "data-map", "templates", "ai-analysis", "knowledge", "methods", "assets",
    "task-history", "runs", "conversations", "usage", "traces", "harness", "models", "skills", "tools", "mcp", "report-agent",
  ].includes(value);
}
