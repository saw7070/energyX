"use client";
import { useEffect, useRef, useState } from "react";
import { configApi, type EnergyAccessContextDto, type EnergyProjectDto } from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import styles from "./project-switcher.module.css";
import { useEnergyIqLocale } from "./energyiq-locale";

type Props = {
  access: EnergyAccessContextDto;
  activeProject: EnergyProjectDto | null;
  projects: EnergyProjectDto[];
  allowDrafts: boolean;
  allowArchived: boolean;
  busy: boolean;
  canCreate: boolean;
  onSelect: (workspaceId: string, projectId: string) => Promise<void> | void;
  onCreate: () => void;
  variant?: "sidebar" | "topbar";
};
export function ProjectSwitcher(props: Props) {
  const { t } = useEnergyIqLocale();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const workspace = props.access.workspaces.find(item => item.id === props.access.activeWorkspaceId);
  const name = props.busy ? t("project.switching") : props.activeProject?.name ?? t("project.choosePrompt");
  // The top bar shows one line; the workspace is only worth repeating when it differs from the project name.
  const showWorkspace = !!workspace?.name && workspace.name.trim().toLocaleLowerCase() !== props.activeProject?.name.trim().toLocaleLowerCase();
  const status = props.activeProject?.status;
  const trigger_ = props.variant === "topbar"
    ? <button ref={trigger} aria-label={t("project.choose")} aria-haspopup="dialog" aria-expanded={open} disabled={props.busy} className={styles.topTrigger} title={[showWorkspace ? workspace?.name : "", props.activeProject?.name].filter(Boolean).join(" / ")} onClick={() => setOpen(true)}>
      <span className={styles.topIcon} aria-hidden="true"><EnergyIcon name="building" /></span>
      <span className={styles.topText}>{showWorkspace && <><span className={styles.topWorkspace}>{workspace!.name}</span><span className={styles.topSlash} aria-hidden="true">/</span></>}<strong>{name}</strong></span>
      {status && status !== "published" && !props.busy && <span className={styles.topBadge}>{t(status === "draft" ? "project.draft" : "project.archived")}</span>}
      <EnergyIcon name="chevron" className={styles.topChevron} />
    </button>
    : <button ref={trigger} aria-label={t("project.choose")} aria-haspopup="dialog" aria-expanded={open} disabled={props.busy} className={styles.trigger} onClick={() => setOpen(true)}><EnergyIcon name="explorer" /><span><strong>{name}</strong><small>{workspace?.name ?? t("project.yourProjects")}</small></span><EnergyIcon name="chevron" /></button>;
  return <>{trigger_}{open && <ProjectMenu {...props} anchor={trigger.current?.getBoundingClientRect()} close={() => { setOpen(false); trigger.current?.focus(); }} />}</>;
}
function ProjectMenu({ access, activeProject, projects, allowDrafts, allowArchived, canCreate, onSelect, onCreate, close, anchor }: Props & { close: () => void; anchor?: DOMRect }) {
  const { t } = useEnergyIqLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [groups, setGroups] = useState<Record<string, EnergyProjectDto[]>>({ [access.activeWorkspaceId]: projects });
  const [failures, setFailures] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); dialog.current?.querySelector("input")?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    for (const workspace of access.workspaces) {
      if (workspace.disabled || workspace.id === access.activeWorkspaceId) continue;
      // Inspect authorised groups without changing the active API workspace.
      configApi.getEnergyAccessContext({ workspaceId: workspace.id, signal: controller.signal }).then(result => {
        if (controller.signal.aborted) return;
        setGroups(current => ({ ...current, [workspace.id]: result.projects.filter(project => project.workspaceId === workspace.id && (project.status === "published" || (result.role === "admin" && ((allowDrafts && project.status === "draft") || allowArchived)))) }));
      }).catch(() => { if (!controller.signal.aborted) setFailures(current => [...current, workspace.id]); });
    }
    return () => controller.abort();
  }, [access, allowDrafts, allowArchived, revision]);
  const matches = (name: string) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const choose = async (workspaceId: string, projectId: string) => {
    if (pending) return;
    if (workspaceId === access.activeWorkspaceId && projectId === activeProject?.id) { close(); return; }
    setPending(true); setError("");
    try { await onSelect(workspaceId, projectId); close(); }
    catch { setError(t("project.switchFailed")); setPending(false); }
  };
  return <dialog ref={dialog} aria-label={t("project.choose")} className={styles.menu} style={anchor ? {left:Math.max(16,Math.min(anchor.left,window.innerWidth-456)),top:Math.min(anchor.bottom+8,Math.max(16,window.innerHeight-440))} : undefined} onCancel={event => { event.preventDefault(); if (!pending) close(); }} onKeyDown={event => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const options = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button[data-project]:not(:disabled)") ?? []);
    if (!options.length) return;
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault(); options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
  }}><header><strong>{t("project.choose")}</strong><button aria-label={t("project.closePicker")} disabled={pending} onClick={close}><EnergyIcon name="close" /></button></header><label className={styles.search}><EnergyIcon name="search" /><input autoFocus aria-label={t("project.search")} placeholder={t("project.searchPlaceholder")} value={search} onChange={event => setSearch(event.target.value)} /></label><div className={styles.groups} aria-busy={pending}>
    {access.workspaces.map(workspace => {
      if (workspace.disabled) return null;
      const visible = groups[workspace.id]?.filter(project => matches(project.name) || matches(workspace.name));
      if (visible?.length === 0 && search.trim()) return null;
      return <section key={workspace.id} aria-label={workspace.name}><h3>{workspace.name}</h3>{failures.includes(workspace.id) ? <button onClick={() => { setFailures([]); setRevision(value => value + 1); }}>{t("project.loadFailed")}</button> : !visible ? <p>{t("project.loading")}</p> : !visible.length ? <p>{t("project.none")}</p> : visible.map(project => <button data-project key={project.id} disabled={pending} aria-current={project.id === activeProject?.id && workspace.id === access.activeWorkspaceId ? "true" : undefined} onClick={() => void choose(workspace.id, project.id)}><EnergyIcon name="explorer" /><span>{project.name}<small>{project.status === "draft" ? t("project.setupInProgress") : project.status === "archived" ? t("project.archived") : ""}</small></span>{project.id === activeProject?.id && workspace.id === access.activeWorkspaceId && <EnergyIcon name="check" />}</button>)}</section>;
    })}
    {search.trim() && Object.entries(groups).every(([id, list]) => !list.some(project => matches(project.name) || matches(access.workspaces.find(item => item.id === id)?.name ?? ""))) && <p>{t("project.noMatch")}</p>}
  </div>{error && <p role="alert" className={styles.error}>{error}</p>}{pending && <p role="status" className={styles.error}>{t("project.switching")}</p>}{canCreate && <footer><button disabled={pending} onClick={() => { close(); onCreate(); }}><EnergyIcon name="plus" />{t("project.create")}<small>{access.workspaces.find(item => item.id === access.activeWorkspaceId)?.name}</small></button></footer>}</dialog>;
}
