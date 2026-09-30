import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useAppContext } from "@/context/AppContext";
import { sidebarItems, sidebarSections } from "@/config/navigation";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();
  const { shareExport } = useAppContext();
  const navigationLocked = shareExport?.lockNavigation === true;
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set(["overview", "utilities", "data"]));

  const activeSectionKeys = useMemo(() => {
    return sidebarSections
      .filter((section) => section.children?.some((item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)))
      .map((section) => section.key);
  }, [location.pathname]);

  useEffect(() => {
    if (activeSectionKeys.length === 0) {
      return;
    }
    setExpandedSections((previous) => {
      const next = new Set(previous);
      activeSectionKeys.forEach((key) => next.add(key));
      return next;
    });
  }, [activeSectionKeys]);

  function toggleSection(key: string) {
    setExpandedSections((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function isSectionActive(sectionKey: string) {
    return activeSectionKeys.includes(sectionKey);
  }

  function getSectionPath(sectionKey: string) {
    const section = sidebarSections.find((item) => item.key === sectionKey);
    if (!section) {
      return "/dashboard";
    }
    if (section.path) {
      return section.path;
    }
    if (section.children && section.children.length > 0) {
      return section.children[0].path;
    }
    return "/dashboard";
  }

  function isPathActive(path: string) {
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  }

  function navItemClass(active: boolean) {
    return `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
      active ? "bg-blue-600 text-white" : "text-slate-300"
    } ${navigationLocked ? "cursor-default" : "hover:bg-shell-700 hover:text-white"}`;
  }

  function childNavItemClass(active: boolean) {
    return `ml-8 block rounded-lg px-3 py-2 text-sm transition ${
      active ? "bg-emerald-500 text-white" : "text-slate-300"
    } ${navigationLocked ? "cursor-default" : "hover:bg-shell-700 hover:text-white"}`;
  }

  return (
    <aside
      className={`${collapsed ? "w-20" : "w-64"} border-r border-shell-600 bg-shell-900 p-3 transition-all ${
        navigationLocked ? "select-none" : ""
      }`}
    >
      <div className="mb-6 flex items-center justify-between rounded-lg bg-shell-800 px-3 py-2">
        {!collapsed ? (
          <div>
            <p className="text-sm font-semibold text-white">NetZero Platform</p>
            <p className="text-[11px] text-slate-400">Utility Management Suite</p>
          </div>
        ) : (
          <p className="mx-auto text-xs font-bold text-white">NZ</p>
        )}
        <button
          type="button"
          className={`rounded p-1 text-slate-400 ${navigationLocked ? "cursor-default opacity-40" : "hover:bg-shell-700 hover:text-white"}`}
          onClick={navigationLocked ? undefined : onToggle}
          disabled={navigationLocked}
          aria-disabled={navigationLocked}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {collapsed ? (
        <nav className={`space-y-1 ${navigationLocked ? "pointer-events-none" : ""}`}>
          {sidebarSections.map((section) => {
            const Icon = section.icon;
            const active = isSectionActive(section.key) || isPathActive(getSectionPath(section.key));
            if (navigationLocked) {
              return (
                <div key={section.key} className={`flex items-center justify-center rounded-lg px-3 py-2 text-sm ${navItemClass(active)}`}>
                  <Icon className="h-4 w-4" />
                </div>
              );
            }
            return (
              <NavLink
                key={section.key}
                to={getSectionPath(section.key)}
                className={({ isActive }) =>
                  `flex items-center justify-center rounded-lg px-3 py-2 text-sm transition ${
                    isActive || isSectionActive(section.key) ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-shell-700 hover:text-white"
                  }`
                }
              >
                <Icon className="h-4 w-4" />
              </NavLink>
            );
          })}
        </nav>
      ) : (
        <nav className={`space-y-1 ${navigationLocked ? "pointer-events-none" : ""}`}>
          {sidebarSections.map((section) => {
            const Icon = section.icon;
            const hasChildren = Boolean(section.children && section.children.length > 0);
            const expanded = expandedSections.has(section.key);
            const sectionActive = isSectionActive(section.key);

            if (!hasChildren) {
              const active = isPathActive(section.path ?? "/dashboard");
              if (navigationLocked) {
                return (
                  <div key={section.key} className={navItemClass(active)}>
                    <Icon className="h-4 w-4" />
                    <span>{section.label}</span>
                  </div>
                );
              }
              return (
                <NavLink
                  key={section.key}
                  to={section.path ?? "/dashboard"}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                      isActive ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-shell-700 hover:text-white"
                    }`
                  }
                >
                  <Icon className="h-4 w-4" />
                  <span>{section.label}</span>
                </NavLink>
              );
            }

            return (
              <div key={section.key} className="space-y-1">
                <button
                  type="button"
                  onClick={navigationLocked ? undefined : () => toggleSection(section.key)}
                  disabled={navigationLocked}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                    sectionActive ? "bg-shell-700 text-white" : "text-slate-300"
                  } ${navigationLocked ? "cursor-default" : "hover:bg-shell-700 hover:text-white"}`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-4 w-4" />
                    <span>{section.label}</span>
                  </span>
                  {expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                </button>

                {expanded
                  ? section.children?.map((item) => {
                      const active = isPathActive(item.path);
                      if (navigationLocked) {
                        return (
                          <div key={item.key} className={childNavItemClass(active)}>
                            {item.label}
                          </div>
                        );
                      }
                      return (
                        <NavLink
                          key={item.key}
                          to={item.path}
                          className={({ isActive }) =>
                            `ml-8 block rounded-lg px-3 py-2 text-sm transition ${
                              isActive ? "bg-emerald-500 text-white" : "text-slate-300 hover:bg-shell-700 hover:text-white"
                            }`
                          }
                        >
                          {item.label}
                        </NavLink>
                      );
                    })
                  : null}
              </div>
            );
          })}
          {!collapsed && sidebarItems.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">No navigation items</p>
          ) : null}
        </nav>
      )}
    </aside>
  );
}
