"use client";
import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useEnergyIqAccess } from "./energyiq-access";
import { useMessages } from "./energyiq-locale";
import { defineMessages } from "./energyiq-messages";

const messages = defineMessages({
  loading: "Loading project access…",
  unavailable: "Project access is unavailable. {error}",
  adminTitle: "Administrator access required",
  adminBody: "Project configuration is managed by administrators. You can ask the energy advisor or read shared reports in Reports.",
  noProject: "This project is unavailable or you do not have access.",
  editorTitle: "Project editor access required",
  editorBody: "You can read reports and project information. Ask a project administrator if you need to make changes.",
}, {
  "zh-Hans": {
    loading: "正在加载项目权限…",
    unavailable: "暂时无法获取项目权限。{error}",
    adminTitle: "需要管理员权限",
    adminBody: "项目配置由管理员管理。您可以咨询能源顾问，或在“报告”中阅读已共享的报告。",
    noProject: "此项目不可用，或您没有访问权限。",
    editorTitle: "需要项目编辑权限",
    editorBody: "您可以阅读报告和项目信息。如需修改，请联系项目管理员。",
  },
  ms: {
    loading: "Memuatkan akses projek…",
    unavailable: "Akses projek tidak tersedia. {error}",
    adminTitle: "Akses pentadbir diperlukan",
    adminBody: "Konfigurasi projek diurus oleh pentadbir. Anda boleh bertanya kepada penasihat tenaga atau membaca laporan yang dikongsi dalam Laporan.",
    noProject: "Projek ini tidak tersedia atau anda tiada akses.",
    editorTitle: "Akses penyunting projek diperlukan",
    editorBody: "Anda boleh membaca laporan dan maklumat projek. Minta pentadbir projek jika anda perlu membuat perubahan.",
  },
});
/** `workbench` fills the page with no padding; `fullWidth` keeps the page padding but drops the centred max width. */
export function ReportProjectGate({ adminOnly = false, workbench = false, fullWidth = false, capability, children }: { adminOnly?: boolean; workbench?: boolean; fullWidth?: boolean; capability?: "manageSkills" | "editConfiguration"; children: (projectId: string) => ReactNode }) {
  const { access, activeProject, loading, error, selectProject } = useEnergyIqAccess();
  const t = useMessages(messages);
  const requested = useSearchParams().get("projectId");
  const projectId = requested || activeProject?.id;
  const project = access?.projects.find((item) => item.id === projectId && item.workspaceId === access.activeWorkspaceId && (item.status === "published" || (access.role === "admin" && item.status === "draft")) );
  useEffect(() => { if (project && project.id !== activeProject?.id) selectProject(project.id); }, [project?.id, activeProject?.id, selectProject]);
  if (loading) return <p className="p-6 text-sm text-muted">{t("loading")}</p>;
  if (error) return <p role="alert" className="p-6">{t("unavailable", { error: error ?? "" })}</p>;
  if (!access || (adminOnly && access.role !== "admin")) return <section className="p-6"><h1 className="text-lg font-semibold">{t("adminTitle")}</h1><p className="mt-2 text-sm text-muted">{t("adminBody")}</p></section>;
  if (!project) return <p role="alert" className="p-6">{t("noProject")}</p>;
  if (capability && !(project.capabilities?.[capability] ?? access.role === "admin")) return <section className="p-6"><h1 className="text-lg font-semibold">{t("editorTitle")}</h1><p className="mt-2 text-sm text-muted">{t("editorBody")}</p></section>;
  return <div key={`${access.activeWorkspaceId}:${project.id}`} className={workbench ? "h-full min-h-0" : fullWidth ? "p-4 sm:p-6" : "mx-auto max-w-7xl p-4 sm:p-6"}>{children(project.id)}</div>;
}