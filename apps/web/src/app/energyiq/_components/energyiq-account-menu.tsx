"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { DataTaskAvatar, useDataTaskIdentity } from "../../data-tasks/data-task-identity";
import { useEnergyIqAccess } from "./energyiq-access";
import { EnergyIcon } from "./icons";
import { useEnergyIqLocale } from "./energyiq-locale";
import styles from "./energyiq-account-menu.module.css";

const AdminConsole = dynamic(() => import("../admin/project-setup-workbench").then(module => module.EnergyIqAdminWorkbench), { loading: () => <AdminConsoleLoading /> });

export function EnergyIqAccountMenu({ collapsed, placement = "up" }: { collapsed: boolean; placement?: "up" | "down" }) {
  const { currentUser, signOut, error } = useDataTaskIdentity();
  const { t } = useEnergyIqLocale();
  const accessState = useEnergyIqAccess();
  const router = useRouter();
  const isAdmin = accessState.access?.role === "admin";
  const workspace = accessState.access?.workspaces.find(item => item.id === accessState.access?.activeWorkspaceId);
  const [menu, setMenu] = useState<{ left: number; bottom?: number; top?: number } | null>(null);
  const [panel, setPanel] = useState<"profile" | "admin" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  function closeMenu() { setMenu(null); trigger.current?.focus(); }
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setMenu(null); };
    const dismiss = () => setMenu(null);
    document.addEventListener("mousedown", outside); window.addEventListener("resize", dismiss);
    return () => { document.removeEventListener("mousedown", outside); window.removeEventListener("resize", dismiss); };
  }, [menu]);
  useEffect(() => { if (panel === "admin" && !isAdmin) setPanel(null); }, [isAdmin, panel]);
  const show = (next: "profile" | "admin") => { setMenu(null); setPanel(next); };
  return <>
    <button ref={trigger} className={`${styles.account} ${collapsed ? styles.collapsed : ""}`} aria-label={t("account.open")} aria-haspopup="menu" aria-expanded={!!menu} onClick={() => { if (menu) { closeMenu(); return; } const rect = trigger.current!.getBoundingClientRect(); const left = Math.min(placement === "down" ? rect.right - 280 : rect.left, Math.max(8, window.innerWidth - 288)); setMenu(placement === "down" ? { left: Math.max(8, left), top: rect.bottom + 8 } : { left, bottom: window.innerHeight - rect.top + 8 }); }}>
      <DataTaskAvatar identity={currentUser} className="h-8 w-8 shrink-0" />
      {!collapsed && <><span className={styles.identity}><strong>{currentUser.displayName || currentUser.userId}</strong><small>{t(isAdmin ? "account.administrator" : "account.personalAccount")}</small></span><EnergyIcon name="settings" className={styles.settings} /></>}
    </button>
    {menu && createPortal(<div ref={menuRef} role="menu" aria-label={t("account.options")} className={styles.menu} style={menu} onKeyDown={event => {
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
      if (event.key === "Tab") { closeMenu(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? items.length-1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items[next]?.focus(); }
    }}>
      <div className={styles.menuIdentity}><strong>{currentUser.displayName || currentUser.userId}</strong><span>{currentUser.email || currentUser.userId}</span></div>
      <button role="menuitem" onClick={() => show("profile")}><EnergyIcon name="user" />{t("account.profile")}</button>
      {isAdmin && <button role="menuitem" onClick={() => show("admin")}><EnergyIcon name="settings" />{t("account.adminConsole")}</button>}
      <button role="menuitem" onClick={() => { setMenu(null); router.push("/energyiq/guide"); }}><EnergyIcon name="document" />{t("account.userGuide")}</button>
      <button role="menuitem" className={styles.signOut} onClick={() => { setMenu(null); signOut(); }}><EnergyIcon name="arrow" />{t("account.signOut")}</button>
      {error && <p role="alert">{error}</p>}
    </div>, document.body)}
    {panel && createPortal(<AccountDialog title={t(panel === "admin" ? "account.adminConsole" : "account.profile")} wide={panel === "admin"} onClose={() => { setPanel(null); requestAnimationFrame(() => trigger.current?.focus()); }}>
      {panel === "admin" ? isAdmin ? <AdminConsole accessState={accessState} embedded /> : <p>{t("account.adminRequired")}</p> : <div className={styles.profile}>
        <div className={styles.profileHeading}><DataTaskAvatar identity={currentUser} className="h-12 w-12" /><div><h3>{currentUser.displayName || currentUser.userId}</h3><p>{currentUser.email || t("account.noEmail")}</p></div></div>
        <dl>{[{label:t("account.accountId"),value:currentUser.userId},{label:t("account.email"),value:currentUser.email || t("account.notProvided")},{label:t("account.role"),value:t(isAdmin ? "account.administrator" : "account.user")},{label:t("account.workspace"),value:workspace?.name || t("account.notAssigned")}].map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
      </div>}
    </AccountDialog>, document.body)}
  </>;
}

function AdminConsoleLoading() {
  const { t } = useEnergyIqLocale();
  return <p role="status" className="p-6">{t("account.adminLoading")}</p>;
}

function AccountDialog({ title, wide, onClose, children }: { title: string; wide: boolean; onClose: () => void; children: ReactNode }) {
  const { t } = useEnergyIqLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} data-energyiq-shell="true" aria-label={title} className={`${styles.dialog} ${wide ? styles.wide : ""}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === dialog.current) { const box=dialog.current.getBoundingClientRect(); if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom) onClose(); } }}><header><h2>{title}</h2><button autoFocus aria-label={t("account.close", { title })} onClick={onClose}><EnergyIcon name="close" /></button></header><div className={styles.body}>{children}</div></dialog>;
}
