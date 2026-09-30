import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import { organizations, projects } from "@/mock/mockData";
import { NP_PROJECT_ID, NP_PROJECT_NAME } from "@/mock/napEnergyAnalysisData";
import { NP_V2_PROJECT_ID, NP_V2_PROJECT_NAME } from "@/mock/napEnergyAnalysisDataV2";
import { ELITE_PROJECT_ID, ELITE_PROJECT_NAME } from "@/mock/eliteiotEnergyAnalysisData";
import { portfolioProjectRecords } from "@/mock/portfolioProjects";
import { Organization, Project } from "@/mock/types";

interface AppContextValue {
  organizations: Organization[];
  projects: Project[];
  selectedOrganizationId: string;
  selectedProjectId: string;
  selectedDateRange: string;
  searchTerm: string;
  setSelectedOrganizationId: (value: string) => void;
  setSelectedProjectId: (value: string) => void;
  setSelectedDateRange: (value: string) => void;
  setSearchTerm: (value: string) => void;
  availableProjects: Project[];
  shareExport: ShareExportConfig | null;
}

export interface ShareExportConfig {
  /** Disable sidebar navigation and collapse control in standalone HTML shares. */
  lockNavigation?: boolean;
  /** Limit project picker to these project ids (e.g. EliteIOT-only export). */
  restrictProjectIds?: string[];
}

const AppContext = createContext<AppContextValue | null>(null);

function mapPortfolioTypeToProjectType(type: (typeof portfolioProjectRecords)[number]["type"]): Project["type"] {
  if (type === "Commercial") {
    return "commercial";
  }
  if (type === "Residential") {
    return "dormitory";
  }
  return "portfolio";
}

export function AppProvider({
  children,
  initialProjectId,
  shareExport = null
}: {
  children: ReactNode;
  initialProjectId?: string;
  shareExport?: ShareExportConfig | null;
}) {
  const allDashboardProjects = useMemo<Project[]>(
    () => [
      ...portfolioProjectRecords.map((project) => ({
        id: project.id,
        organizationId: "org-vector-green",
        name: project.name,
        location: project.address,
        type: mapPortfolioTypeToProjectType(project.type)
      })),
      {
        id: NP_PROJECT_ID,
        organizationId: "org-vector-green",
        name: NP_PROJECT_NAME,
        location: "Ngee Ann Polytechnic, Singapore",
        type: "school"
      },
      {
        id: NP_V2_PROJECT_ID,
        organizationId: "org-vector-green",
        name: NP_V2_PROJECT_NAME,
        location: "Ngee Ann Polytechnic, Singapore",
        type: "school"
      },
      {
        id: ELITE_PROJECT_ID,
        organizationId: "org-vector-green",
        name: ELITE_PROJECT_NAME,
        location: "EliteIOT Office, Singapore",
        type: "commercial"
      }
    ],
    []
  );

  const dashboardProjects = useMemo(() => {
    const restrictIds = shareExport?.restrictProjectIds;
    if (!restrictIds || restrictIds.length === 0) {
      return allDashboardProjects;
    }
    return allDashboardProjects.filter((project) => restrictIds.includes(project.id));
  }, [allDashboardProjects, shareExport?.restrictProjectIds]);

  const defaultProjectId =
    initialProjectId && dashboardProjects.some((project) => project.id === initialProjectId)
      ? initialProjectId
      : (dashboardProjects[0]?.id ?? projects[0].id);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(organizations[0].id);
  const [selectedProjectId, setSelectedProjectId] = useState(defaultProjectId);
  const [selectedDateRange, setSelectedDateRange] = useState("Last 30 days");
  const [searchTerm, setSearchTerm] = useState("");

  const availableProjects = dashboardProjects;

  const value: AppContextValue = {
    organizations,
    projects: dashboardProjects,
    selectedOrganizationId,
    selectedProjectId,
    selectedDateRange,
    searchTerm,
    setSelectedOrganizationId: (value) => {
      setSelectedOrganizationId(value);
      const firstProject = dashboardProjects.find((project) => project.organizationId === value) ?? dashboardProjects[0];
      if (firstProject) {
        setSelectedProjectId(firstProject.id);
      }
    },
    setSelectedProjectId,
    setSelectedDateRange,
    setSearchTerm,
    availableProjects,
    shareExport
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppProvider");
  }
  return context;
}
