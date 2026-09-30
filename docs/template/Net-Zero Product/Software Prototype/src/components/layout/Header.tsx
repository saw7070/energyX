import { Search, UserCircle2 } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAppContext } from "@/context/AppContext";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { portfolioProjectRecords } from "@/mock/portfolioProjects";

export function Header() {
  const location = useLocation();
  const isPortfolioPage = location.pathname === "/portfolio";
  const isDashboardPage = location.pathname === "/dashboard" || location.pathname === "/overview";
  const {
    selectedProjectId,
    searchTerm,
    setSelectedProjectId,
    availableProjects,
    setSearchTerm,
    shareExport
  } = useAppContext();
  const projectOptions = isDashboardPage ? portfolioProjectRecords : availableProjects;
  const projectPickerLocked = (shareExport?.restrictProjectIds?.length ?? 0) === 1;

  useEffect(() => {
    if (projectOptions.length === 0) {
      return;
    }

    const hasCurrentProject = projectOptions.some((project) => project.id === selectedProjectId);
    if (!hasCurrentProject) {
      // Dashboard uses portfolio sites only; clamp invalid selection there.
      // Other pages (e.g. Analysis) use availableProjects and may include NP Energy Analysis.
      if (isDashboardPage) {
        setSelectedProjectId(projectOptions[0].id);
      }
    }
  }, [isDashboardPage, projectOptions, selectedProjectId, setSelectedProjectId]);

  const selectedProjectName =
    projectOptions.find((project) => project.id === selectedProjectId)?.name ?? "Project";

  return (
    <header className="flex h-16 items-center gap-3 border-b border-shell-600 bg-shell-900 px-4">
      {!isPortfolioPage ? (
        projectPickerLocked ? (
          <span
            className="cursor-default select-none rounded-md border border-shell-600 bg-shell-800 px-3 py-1.5 text-sm text-slate-200"
            aria-label={`Project: ${selectedProjectName}`}
          >
            {selectedProjectName}
          </span>
        ) : (
          <select
            className="rounded-md border border-shell-600 bg-shell-800 px-3 py-1.5 text-sm text-slate-200"
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
          >
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        )
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <label className="flex items-center gap-2 rounded-md border border-shell-600 bg-shell-800 px-3 py-1.5">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            className="w-56 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
            placeholder="Search site, meter, ticket..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </label>
        <NotificationBell />
        <button className="rounded-md p-1 text-slate-300 hover:bg-shell-700 hover:text-white">
          <UserCircle2 className="h-7 w-7" />
        </button>
      </div>
    </header>
  );
}
