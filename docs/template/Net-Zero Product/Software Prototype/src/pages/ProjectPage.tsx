import { useMemo, useState } from "react";
import { BellRing, Filter, ShieldCheck, SlidersHorizontal, Users, Wrench } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { DataTable, DataTableColumn } from "@/components/ui/DataTable";
import { HierarchyTree } from "@/components/ui/HierarchyTree";
import { EmptyState } from "@/components/ui/EmptyState";
import { hierarchyTree, projects, tenants } from "@/mock/mockData";

type ProjectSection = "roles" | "users" | "spaces" | "alarm-rules" | "configuration";

interface ProjectPageProps {
  section?: ProjectSection;
}

const sectionMeta: Record<ProjectSection, { title: string; subtitle: string; breadcrumbs: string[] }> = {
  roles: {
    title: "Project / Roles",
    subtitle: "Role matrix and permission templates for project operations.",
    breadcrumbs: ["Dashboard", "Project", "Roles"]
  },
  users: {
    title: "Project / Users",
    subtitle: "Project user assignments, ownership, and access controls.",
    breadcrumbs: ["Dashboard", "Project", "Users"]
  },
  spaces: {
    title: "Project / Spaces",
    subtitle: "Space hierarchy, zones, and logical grouping management.",
    breadcrumbs: ["Dashboard", "Project", "Spaces"]
  },
  "alarm-rules": {
    title: "Project / Alarm Rules",
    subtitle: "Threshold strategy, escalation chain, and notification policies.",
    breadcrumbs: ["Dashboard", "Project", "Alarm Rules"]
  },
  configuration: {
    title: "Project / Configuration",
    subtitle: "Data model mapping and dashboard configuration templates.",
    breadcrumbs: ["Dashboard", "Project", "Configuration"]
  }
};

export function ProjectPage({ section = "configuration" }: ProjectPageProps) {
  const currentMeta = sectionMeta[section];
  const [projectFilter, setProjectFilter] = useState("all");

  interface RoleRow extends Record<string, unknown> {
    role: string;
    scope: string;
    userCount: number;
    updatedAt: string;
  }

  const roleRows: RoleRow[] = [
    { role: "Portfolio Admin", scope: "Cross Project", userCount: 4, updatedAt: "2026-05-09" },
    { role: "Site Operator", scope: "Project", userCount: 12, updatedAt: "2026-05-08" },
    { role: "Billing Manager", scope: "Billing", userCount: 6, updatedAt: "2026-05-06" }
  ];

  interface UserRow extends Record<string, unknown> {
    name: string;
    role: string;
    project: string;
    status: "active" | "pending";
  }

  const userRows: UserRow[] = [
    { name: "Alex Tan", role: "Portfolio Admin", project: "ST Lodge Site A", status: "active" },
    { name: "Priya Das", role: "Site Operator", project: "ST Lodge Site B", status: "active" },
    { name: "Hao Ming", role: "Billing Manager", project: "HDB Utility Pilot", status: "pending" }
  ];

  interface RuleRow extends Record<string, unknown> {
    ruleName: string;
    trigger: string;
    severity: "critical" | "warning" | "info";
    enabled: "enabled" | "disabled";
  }

  const ruleRows: RuleRow[] = [
    { ruleName: "Main Meter Dropout", trigger: "No data > 15 min", severity: "critical", enabled: "enabled" },
    { ruleName: "Water Spike", trigger: "Flow > baseline + 35%", severity: "warning", enabled: "enabled" },
    { ruleName: "Gas Drift", trigger: "Unusual drift > 3h", severity: "info", enabled: "disabled" }
  ];

  const roleColumns: DataTableColumn<RoleRow>[] = [
    { key: "role", header: "Role" },
    { key: "scope", header: "Scope" },
    { key: "userCount", header: "Users" },
    { key: "updatedAt", header: "Updated At" }
  ];

  const userColumns: DataTableColumn<UserRow>[] = [
    { key: "name", header: "User" },
    { key: "role", header: "Role" },
    { key: "project", header: "Project" },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span
          className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${
            row.status === "active" ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300" : "border-amber-500/40 bg-amber-500/20 text-amber-300"
          }`}
        >
          {row.status}
        </span>
      )
    }
  ];

  const ruleColumns: DataTableColumn<RuleRow>[] = [
    { key: "ruleName", header: "Rule Name" },
    { key: "trigger", header: "Trigger" },
    {
      key: "severity",
      header: "Severity",
      render: (row) => {
        const style =
          row.severity === "critical"
            ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
            : row.severity === "warning"
              ? "border-amber-500/40 bg-amber-500/20 text-amber-300"
              : "border-blue-500/40 bg-blue-500/20 text-blue-300";
        return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${style}`}>{row.severity}</span>;
      }
    },
    { key: "enabled", header: "Enabled" }
  ];

  const tenantCount = tenants.length;
  const projectCount = useMemo(() => {
    if (projectFilter === "all") {
      return projects.length;
    }
    return projects.filter((project) => project.id === projectFilter).length;
  }, [projectFilter]);

  const primaryTable = section === "roles" ? <DataTable columns={roleColumns} rows={roleRows} /> : section === "users" ? <DataTable columns={userColumns} rows={userRows} /> : <DataTable columns={ruleColumns} rows={ruleRows} />;

  return (
    <PageContainer
      title={currentMeta.title}
      subtitle={currentMeta.subtitle}
      breadcrumbs={currentMeta.breadcrumbs}
    >
      <section className="panel p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs text-slate-400">Project Scope</span>
            <select className="w-full rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-200" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
              <option value="all">All Projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-400">Review Period</span>
            <select className="w-full rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-200">
              <option>Today</option>
              <option>Last 7 days</option>
              <option>Last 30 days</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button className="inline-flex items-center gap-2 rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-200 hover:bg-shell-700">
              <Filter className="h-4 w-4" />
              Apply
            </button>
          </div>
          <div className="panel flex items-center justify-center bg-shell-900 px-3 py-2 text-sm text-slate-300">Projects in scope: {projectCount}</div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="panel p-4">
          <p className="text-xs text-slate-400">Total Roles</p>
          <p className="mt-2 text-2xl font-semibold text-white">{roleRows.length}</p>
        </article>
        <article className="panel p-4">
          <p className="text-xs text-slate-400">Active Users</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-300">{userRows.filter((row) => row.status === "active").length}</p>
        </article>
        <article className="panel p-4">
          <p className="text-xs text-slate-400">Enabled Rules</p>
          <p className="mt-2 text-2xl font-semibold text-blue-300">{ruleRows.filter((row) => row.enabled === "enabled").length}</p>
        </article>
        <article className="panel p-4">
          <p className="text-xs text-slate-400">Tenant Coverage</p>
          <p className="mt-2 text-2xl font-semibold text-white">{tenantCount}</p>
        </article>
      </section>

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <HierarchyTree nodes={hierarchyTree} />
        <div className="space-y-4">
          <section className="space-y-3">
            <h2 className="section-title">Access and Rules Registry</h2>
            {primaryTable}
          </section>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <EmptyState title="Roles" description="Role matrix and permission policy placeholder." icon={<ShieldCheck className="h-5 w-5" />} />
            <EmptyState title="Users" description="Project users and assignment view placeholder." icon={<Users className="h-5 w-5" />} />
            <EmptyState title="Alarm Rules" description="Threshold and escalation policy builder placeholder." icon={<BellRing className="h-5 w-5" />} />
            <EmptyState title="Data Configuration" description="Tag binding and model mapping placeholder." icon={<Wrench className="h-5 w-5" />} />
            <EmptyState title="Dashboard Configuration" description="Widget layout and saved templates placeholder." icon={<SlidersHorizontal className="h-5 w-5" />} />
            <EmptyState title="Space Hierarchy" description="Detailed space model editor placeholder." />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
