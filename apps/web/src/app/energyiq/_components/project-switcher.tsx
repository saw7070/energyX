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
  const [moving, setMoving] = useState(false);
  // Admins reorganise customers by dragging a project onto another customer's section.
  const canMove = access.role === "admin";
  const [dragging, setDragging] = useState<{ projectId: string; projectName: string; fromId: string; fromName: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
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
  const [proposal, setProposal] = useState<MoveProposal | null>(null);
  const [action, setAction] = useState<AdminAction | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const customers = access.workspaces.filter(item => item.kind === "customer" && !item.disabled);
  const moveTo = (targetId: string | null, targetName: string) => {
    const source = dragging;
    setDragging(null); setDropTarget(null);
    if (!source || pending || targetId === source.fromId) return;
    setError("");
    setProposal({ projectId: source.projectId, projectName: source.projectName, fromId: source.fromId, fromName: source.fromName, targetId, targetName: targetId ? targetName : source.projectName, choose: false });
  };
  const confirmMove = async (targetId: string | null, name: string, projectId: string) => {
    setPending(true); setMoving(true);
    try {
      const destination = targetId ?? (await configApi.createEnergyAdminOrganisation({ name })).id;
      await configApi.moveEnergyAdminProject(projectId, { organisationId: destination });
      try { await onSelect(destination, projectId); close(); }
      catch { window.location.reload(); }
    } catch (reason) {
      setPending(false); setMoving(false);
      throw reason;
    }
  };
  // Archive, delete and customer changes alter the access context itself, so reload it wholesale.
  const confirmAction = async (current: AdminAction, typed: string) => {
    if (current.kind === "archive" || current.kind === "restore") await configApi.setEnergyAdminProjectArchived(current.projectId, current.kind === "archive");
    else if (current.kind === "deleteProject") await configApi.deleteEnergyAdminProject(current.projectId, typed);
    else if (current.kind === "deleteCustomer") await configApi.deleteEnergyAdminOrganisation(current.id);
    else await configApi.createEnergyAdminOrganisation({ name: typed });
    window.location.reload();
  };
  const dropProps = (targetId: string | null, targetName: string) => canMove && dragging && targetId !== dragging.fromId ? {
    onDragOver: (event: React.DragEvent) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (dropTarget !== (targetId ?? "")) setDropTarget(targetId ?? ""); },
    onDragLeave: (event: React.DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); },
    onDrop: (event: React.DragEvent) => { event.preventDefault(); moveTo(targetId, targetName); },
  } : {};
  const modalOpen = proposal !== null || action !== null;
  return <dialog ref={dialog} aria-label={t("project.choose")} className={styles.menu} style={anchor ? {left:Math.max(16,Math.min(anchor.left,window.innerWidth-456)),top:Math.min(anchor.bottom+8,Math.max(16,window.innerHeight-440))} : undefined} onCancel={event => { event.preventDefault(); if (modalOpen) return; if (menuFor) { setMenuFor(null); return; } if (!pending) close(); }} onClick={event => {
    // A click on the dimmed backdrop targets the dialog itself, outside its box: treat it as dismiss.
    if (event.target === dialog.current) {
      const box = dialog.current.getBoundingClientRect();
      const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
      if (outside) { if (!modalOpen && !pending) close(); return; }
    }
    if (menuFor && !(event.target as Element).closest("[data-row-menu]")) setMenuFor(null);
  }} onKeyDown={event => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key) || menuFor) return;
    const options = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button[data-project]:not(:disabled)") ?? []);
    if (!options.length) return;
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault(); options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
  }}><header><strong>{t("project.choose")}</strong><button aria-label={t("project.closePicker")} disabled={pending} onClick={close}><EnergyIcon name="close" /></button></header><p className={styles.pickerHelp}>{t("project.pickerHelp")}</p><label className={styles.search}><EnergyIcon name="search" /><input autoFocus aria-label={t("project.search")} placeholder={t("project.searchPlaceholder")} value={search} onChange={event => setSearch(event.target.value)} /></label><div className={styles.groups} aria-busy={pending}>
    {access.workspaces.map(workspace => {
      if (workspace.disabled) return null;
      const visible = groups[workspace.id]?.filter(project => matches(project.name) || matches(workspace.name));
      if (visible?.length === 0 && search.trim()) return null;
      const isDropTarget = dragging !== null && dropTarget === workspace.id;
      const customerMenu = `w:${workspace.id}`;
      const count = groups[workspace.id]?.length;
      return <section key={workspace.id} aria-label={workspace.name} className={`${styles.client} ${isDropTarget ? styles.dropTarget : ""}`} {...dropProps(workspace.id, workspace.name)}><h3 className={styles.clientHeader}><span className={styles.clientIcon} aria-hidden="true"><EnergyIcon name="building" /></span><span className={styles.clientText}><span className={styles.groupName}>{workspace.name}</span><small><span className={styles.clientTag}>{t("project.clientTag")}</span>{count !== undefined && <> · {count === 1 ? t("project.countOne") : t("project.countMany", { count })}</>}</small></span>{isDropTarget && <span className={styles.dropLabel}>{t("project.dropHere")}</span>}{canMove && workspace.kind === "customer" && !isDropTarget && <RowMenu open={menuFor === customerMenu} label={t("project.actions", { name: workspace.name })} disabled={pending} onToggle={() => setMenuFor(menuFor === customerMenu ? null : customerMenu)} items={[{ label: t("project.customerDeleteMenu"), danger: true, onSelect: () => { setMenuFor(null); setAction({ kind: "deleteCustomer", id: workspace.id, name: workspace.name }); } }]} />}</h3><div className={styles.clientProjects}>{failures.includes(workspace.id) ? <button onClick={() => { setFailures([]); setRevision(value => value + 1); }}>{t("project.loadFailed")}</button> : !visible ? <p>{t("project.loading")}</p> : !visible.length ? <p>{t("project.none")}</p> : visible.map(project => {
        const projectMenu = `p:${project.id}`;
        const archived = project.status === "archived";
        return <div key={project.id} className={styles.projectRow}><button data-project disabled={pending} draggable={canMove && !pending} onDragStart={canMove ? event => { setMenuFor(null); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", project.name); setDragging({ projectId: project.id, projectName: project.name, fromId: workspace.id, fromName: workspace.name }); } : undefined} onDragEnd={canMove ? () => { setDragging(null); setDropTarget(null); } : undefined} className={dragging?.projectId === project.id ? styles.dragSource : undefined} aria-current={project.id === activeProject?.id && workspace.id === access.activeWorkspaceId ? "true" : undefined} onClick={() => void choose(workspace.id, project.id)}><EnergyIcon name="explorer" /><span>{project.name}<small>{[t("project.kindProject"), project.status === "draft" ? t("project.setupInProgress") : archived ? t("project.archived") : ""].filter(Boolean).join(" · ")}</small></span>{project.id === activeProject?.id && workspace.id === access.activeWorkspaceId && <EnergyIcon name="check" />}</button>{canMove && <RowMenu open={menuFor === projectMenu} label={t("project.actions", { name: project.name })} disabled={pending} onToggle={() => setMenuFor(menuFor === projectMenu ? null : projectMenu)} items={[
          { label: t("project.menuMove"), onSelect: () => { setMenuFor(null); setProposal({ projectId: project.id, projectName: project.name, fromId: workspace.id, fromName: workspace.name, targetId: null, targetName: project.name, choose: true }); } },
          { label: t(archived ? "project.menuRestore" : "project.menuArchive"), onSelect: () => { setMenuFor(null); setAction({ kind: archived ? "restore" : "archive", projectId: project.id, name: project.name }); } },
          { label: t("project.menuDelete"), danger: true, onSelect: () => { setMenuFor(null); setAction({ kind: "deleteProject", projectId: project.id, name: project.name }); } },
        ]} />}</div>;
      })}</div></section>;
    })}
    {canMove && dragging && <div className={`${styles.dropZone} ${dropTarget === "" ? styles.dropZoneActive : ""}`} {...dropProps(null, "")}><EnergyIcon name="plus" />{t("project.dropNewCustomer")}</div>}
    {search.trim() && Object.entries(groups).every(([id, list]) => !list.some(project => matches(project.name) || matches(access.workspaces.find(item => item.id === id)?.name ?? ""))) && <p>{t("project.noMatch")}</p>}
  </div>{canMove && !pending && !error && <p className={styles.hint}>{t("project.dragHint")}</p>}{error && <p role="alert" className={styles.error}>{error}</p>}{pending && <p role="status" className={styles.error}>{t(moving ? "project.moving" : "project.switching")}</p>}{(canCreate || canMove) && <footer className={styles.footerActions}>{canCreate && <button disabled={pending} onClick={() => { close(); onCreate(); }}><EnergyIcon name="plus" /><span className={styles.footerLabel}>{t("project.create")}<small>{t("project.createIn", { client: access.workspaces.find(item => item.id === access.activeWorkspaceId)?.name ?? "" })}</small></span></button>}{canMove && <button disabled={pending} onClick={() => setAction({ kind: "createCustomer" })}><EnergyIcon name="building" />{t("project.customerNew")}</button>}</footer>}{proposal && <MoveProjectModal proposal={proposal} customers={customers} onCancel={() => setProposal(null)} onConfirm={(targetId, name) => confirmMove(targetId, name, proposal.projectId)} />}{action && <AdminActionModal action={action} onCancel={() => setAction(null)} onConfirm={typed => confirmAction(action, typed)} />}</dialog>;
}

type MoveProposal = { projectId: string; projectName: string; fromId: string; fromName: string; targetId: string | null; targetName: string; choose: boolean };
type AdminAction =
  | { kind: "archive" | "restore" | "deleteProject"; projectId: string; name: string }
  | { kind: "deleteCustomer"; id: string; name: string }
  | { kind: "createCustomer" };

function RowMenu({ open, label, disabled, onToggle, items }: {
  open: boolean;
  label: string;
  disabled: boolean;
  onToggle: () => void;
  items: Array<{ label: string; danger?: boolean; onSelect: () => void }>;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) menu.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [open]);
  return <div className={styles.rowMenu} data-row-menu>
    <button type="button" className={styles.kebab} aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} draggable={false} onClick={event => { event.stopPropagation(); onToggle(); }}><EnergyIcon name="more" /></button>
    {open && <div ref={menu} role="menu" className={styles.rowMenuList} onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const options = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      const index = options.indexOf(document.activeElement as HTMLButtonElement);
      options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
    }}>{items.map(item => <button key={item.label} type="button" role="menuitem" className={item.danger ? styles.rowMenuDanger : undefined} onClick={event => { event.stopPropagation(); item.onSelect(); }}>{item.label}</button>)}</div>}
  </div>;
}

function MoveProjectModal({ proposal, customers, onCancel, onConfirm }: {
  proposal: MoveProposal;
  customers: Array<{ id: string; name: string }>;
  onCancel: () => void;
  onConfirm: (targetId: string | null, name: string) => Promise<void>;
}) {
  const { t } = useEnergyIqLocale();
  const modal = useRef<HTMLDialogElement>(null);
  const destinations = customers.filter(item => item.id !== proposal.fromId);
  const [targetId, setTargetId] = useState<string | null>(proposal.choose ? destinations[0]?.id ?? null : proposal.targetId);
  const creating = targetId === null;
  const [name, setName] = useState(proposal.targetName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const targetName = destinations.find(item => item.id === targetId)?.name ?? proposal.targetName;
  useEffect(() => {
    modal.current?.showModal();
    const field = modal.current?.querySelector<HTMLInputElement | HTMLSelectElement>("select, input");
    if (field) { field.focus(); if (field instanceof HTMLInputElement) field.select(); } else modal.current?.querySelector<HTMLButtonElement>("button[type=submit]")?.focus();
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (creating && !trimmed) { setError(t("project.moveNameRequired")); return; }
    setSaving(true); setError("");
    try { await onConfirm(targetId, trimmed); }
    catch (reason) { setError(t("project.moveFailed", { reason: reason instanceof Error ? reason.message : String(reason) })); setSaving(false); }
  };
  return <dialog ref={modal} aria-labelledby="move-project-title" className={styles.moveModal} onCancel={event => { event.preventDefault(); if (!saving) onCancel(); }}>
    <form onSubmit={event => void submit(event)}>
      <header><h2 id="move-project-title">{t("project.moveTitle", { project: proposal.projectName })}</h2><button type="button" aria-label={t("project.moveCancel")} disabled={saving} onClick={onCancel}><EnergyIcon name="close" /></button></header>
      <div className={styles.moveRoute}>
        <div><small>{t("project.moveFrom")}</small><strong>{proposal.fromName}</strong></div>
        <EnergyIcon name="chevron" className={styles.moveArrow} />
        <div className={styles.moveDestination}><small>{t("project.moveTo")}</small><strong>{creating ? (name.trim() || t("project.moveNewCustomer")) : targetName}</strong></div>
      </div>
      {proposal.choose && <label className={styles.moveField}><span>{t("project.moveChoose")}</span><select value={targetId ?? ""} disabled={saving} onChange={event => setTargetId(event.target.value || null)}>{destinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="">{t("project.moveNewCustomer")}…</option></select></label>}
      {creating && <label className={styles.moveField}><span>{t("project.newCustomerName")}</span><input value={name} disabled={saving} maxLength={120} onChange={event => setName(event.target.value)} /></label>}
      <p className={styles.moveBody}>{t("project.moveBody")}</p>
      {error && <p role="alert" className={styles.moveError}>{error}</p>}
      <footer><button type="button" className={styles.moveSecondary} disabled={saving} onClick={onCancel}>{t("project.moveCancel")}</button><button type="submit" className={styles.movePrimary} disabled={saving}>{saving ? t("project.moving") : t(creating ? "project.moveCreateSubmit" : "project.moveSubmit")}</button></footer>
    </form>
  </dialog>;
}

function AdminActionModal({ action, onCancel, onConfirm }: {
  action: AdminAction;
  onCancel: () => void;
  onConfirm: (typed: string) => Promise<void>;
}) {
  const { t } = useEnergyIqLocale();
  const modal = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const name = "name" in action ? action.name : "";
  const copy = {
    archive: { title: t("project.archiveTitle", { project: name }), body: t("project.archiveBody"), submit: t("project.archiveSubmit"), danger: false },
    restore: { title: t("project.restoreTitle", { project: name }), body: t("project.restoreBody"), submit: t("project.restoreSubmit"), danger: false },
    deleteProject: { title: t("project.deleteTitle", { project: name }), body: t("project.deleteBody"), submit: t("project.deleteSubmit"), danger: true },
    deleteCustomer: { title: t("project.customerDeleteTitle", { customer: name }), body: t("project.customerDeleteBody"), submit: t("project.customerDeleteSubmit"), danger: true },
    createCustomer: { title: t("project.customerCreateTitle"), body: "", submit: t("project.customerCreateSubmit"), danger: false },
  }[action.kind];
  const needsText = action.kind === "deleteProject" || action.kind === "createCustomer";
  const ready = action.kind === "deleteProject" ? typed.trim() === name.trim() : action.kind === "createCustomer" ? typed.trim().length > 0 : true;
  useEffect(() => {
    modal.current?.showModal();
    (modal.current?.querySelector<HTMLInputElement>("input") ?? modal.current?.querySelector<HTMLButtonElement>("button[type=submit]"))?.focus();
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setSaving(true); setError("");
    try { await onConfirm(typed.trim()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setSaving(false); }
  };
  return <dialog ref={modal} aria-labelledby="admin-action-title" className={styles.moveModal} onCancel={event => { event.preventDefault(); if (!saving) onCancel(); }}>
    <form onSubmit={event => void submit(event)}>
      <header><h2 id="admin-action-title">{copy.title}</h2><button type="button" aria-label={t("project.moveCancel")} disabled={saving} onClick={onCancel}><EnergyIcon name="close" /></button></header>
      {copy.body && <p className={copy.danger ? styles.dangerNote : styles.moveBody}>{copy.body}</p>}
      {needsText && <label className={styles.moveField}><span>{action.kind === "deleteProject" ? t("project.deleteConfirmLabel", { project: name }) : t("project.customerNameLabel")}</span><input value={typed} disabled={saving} maxLength={120} autoComplete="off" onChange={event => setTyped(event.target.value)} /></label>}
      {error && <p role="alert" className={styles.moveError}>{error}</p>}
      <footer><button type="button" className={styles.moveSecondary} disabled={saving} onClick={onCancel}>{t("project.moveCancel")}</button><button type="submit" className={copy.danger ? styles.moveDanger : styles.movePrimary} disabled={saving || !ready}>{saving ? t("project.working") : copy.submit}</button></footer>
    </form>
  </dialog>;
}
