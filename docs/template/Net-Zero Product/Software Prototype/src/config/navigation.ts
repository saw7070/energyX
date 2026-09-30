import {
  BarChart3,
  Database,
  FileText,
  Globe,
  Gauge,
  Receipt,
  Settings,
  LucideIcon
} from "lucide-react";

export interface SidebarItem {
  key: string;
  label: string;
  path: string;
}

export interface SidebarSection {
  key: string;
  label: string;
  icon: LucideIcon;
  path?: string;
  children?: SidebarItem[];
}

export const sidebarSections: SidebarSection[] = [
  {
    key: "overview",
    label: "Overview",
    icon: Globe,
    children: [
      { key: "portfolio", label: "Portfolio", path: "/portfolio" },
      { key: "dashboard", label: "Dashboard", path: "/dashboard" }
    ]
  },
  {
    key: "utilities",
    label: "Utilities",
    icon: Gauge,
    children: [
      { key: "utilities-electricity", label: "Electricity", path: "/utilities/electricity" },
      { key: "utilities-water", label: "Water", path: "/utilities/water" },
      { key: "utilities-gas", label: "Gas", path: "/utilities/gas" }
    ]
  },
  {
    key: "analysis",
    label: "Analysis",
    icon: BarChart3,
    path: "/analysis"
  },
  {
    key: "billing",
    label: "Billing",
    icon: Receipt,
    children: [
      { key: "billing-tenants", label: "Tenants", path: "/billing/tenants" },
      { key: "billing-contracts", label: "Contracts", path: "/billing/contracts" },
      { key: "billing-bills", label: "Bills", path: "/billing/bills" }
    ]
  },
  {
    key: "data",
    label: "Data",
    icon: Database,
    children: [
      { key: "data-devices", label: "Devices", path: "/data/devices" },
      { key: "data-gateways", label: "Edge Gateway", path: "/data/gateways" },
      { key: "data-messages", label: "Messages", path: "/data/messages" },
      { key: "data-logs", label: "Logs", path: "/data/logs" },
      { key: "data-alarms", label: "Alarms", path: "/data/alarms" }
    ]
  },
  {
    key: "project",
    label: "Project",
    icon: Settings,
    children: [
      { key: "project-roles", label: "Roles", path: "/project/roles" },
      { key: "project-users", label: "Users", path: "/project/users" },
      { key: "project-spaces", label: "Spaces", path: "/project/spaces" },
      { key: "project-alarm-rules", label: "Alarm Rules", path: "/project/alarm-rules" },
      { key: "project-configuration", label: "Configuration", path: "/project/configuration" }
    ]
  },
  {
    key: "reports",
    label: "Reports",
    icon: FileText,
    path: "/reports"
  }
];

export const sidebarItems = sidebarSections.flatMap((section) =>
  section.children ? section.children : section.path ? [{ key: section.key, label: section.label, path: section.path }] : []
);
