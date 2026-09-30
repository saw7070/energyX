"use client";
import { useEffect, useRef, useState } from "react";
import { configApi } from "../../../lib/config-api";
import { useMessages } from "./energyiq-locale";
import { skillControlsMessages } from "./report-skill-controls-messages";
import { preferredSkillVersion, skillVersionGroups } from "./report-skill-versions";
import styles from "./report-workbench.module.css";

export type ReportSkillOption = { id: string; name: string; version: string; content: string; category?: "analysis" | "presentation" | "other"; scope: "personal" | "project" | "general"; required?: boolean; readOnly?: boolean; isDefault?: boolean; revision: number };
export type SkillSelection = { mode: "default" | "selected"; refs: Array<{ id: string; version: string }> };
/** "tuya-interactive-report" reads as "Tuya interactive report"; names that are already words are kept. */
export function methodTitle(name: string): string {
  if (!/[-_]/.test(name) || /\s/.test(name)) return name;
  const words = name.split(/[-_]+/).filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
/** The description from a method's front matter, unless it is the generic placeholder. */
export function methodDescription(content: string): string | null {
  const front = content.startsWith("---") ? content.split("---")[1] ?? "" : "";
  const text = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  return text && !/^reusable report analysis method\.?$/i.test(text) ? text : null;
}
const SCOPE_TEXT = { personal: "scopePersonal", project: "scopeProject", general: "scopeGeneral" } as const satisfies Record<ReportSkillOption["scope"], string>;

export function ReportSkillSelector({ skills, value, onChange }: { skills: ReportSkillOption[]; value: SkillSelection; onChange: (value: SkillSelection) => void }) {
  const t = useMessages(skillControlsMessages);
  const optional = skills.filter(skill => !skill.required && skill.category !== "presentation");
  const methods = skillVersionGroups(optional);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); root.current?.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const titles = methods.map(items => methodTitle(preferredSkillVersion(items)!.name));
  return <details ref={root} className={styles.methodPicker} open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>{value.mode === "default" ? t("summaryAutomatic") : t("summarySelected", { count: value.refs.length })}</summary>
    <div className={styles.methodOptions} role="dialog" aria-label={t("analysisMethod")}>
      <div className={styles.methodHead}>
        <div><strong>{t("analysisMethod")}</strong><p>{t("pickerIntro")}</p></div>
        <button type="button" className={styles.methodClose} aria-label={t("closePicker")} onClick={() => setOpen(false)}>×</button>
      </div>
      <div className={styles.methodModes} role="group" aria-label={t("methodSelection")}>
        <button type="button" aria-pressed={value.mode === "default"} onClick={() => onChange({mode:"default",refs:[]})}>{t("automatic")}</button>
        <button type="button" aria-pressed={value.mode === "selected"} onClick={() => onChange({mode:"selected",refs:[]})}>{t("chooseMethod")}</button>
      </div>
      {value.mode === "default" && <p className={styles.methodHint}>{t("automaticHint")}</p>}
      {value.mode === "selected" && <p className={styles.methodHint}>{t("chooseHint")}</p>}
      {value.mode === "selected" && methods.map((items, index) => {
        const first = preferredSkillVersion(items)!;
        const pinned = value.refs.find(ref => ref.id === first.id);
        const selectedVersion = pinned?.version ?? versions[first.id] ?? first.version;
        const current = items.find(item => item.version === selectedVersion) ?? first;
        const checked = !!pinned;
        const title = titles[index]!;
        const sameName = titles.filter(other => other === title).length > 1;
        const about = methodDescription(current.content);
        return <div key={first.id} className={styles.methodRow}>
          <label><input type="checkbox" aria-label={first.name} disabled={!checked && value.refs.length >= 5} checked={checked} onChange={event => onChange({mode:"selected",refs:event.target.checked ? [...value.refs.filter(ref => ref.id !== first.id), {id:first.id,version:current.version}] : value.refs.filter(ref => ref.id !== first.id)})} />
            <span><strong title={first.name}>{sameName ? t("titleWithVersion", { title, version: current.version }) : title}</strong>{about && <small className={styles.methodAbout}>{about}</small>}<small className={styles.methodMeta}>{t("versionScope", { version: current.version, scope: t(SCOPE_TEXT[current.scope]) })}</small></span>
          </label>
          <details><summary>{t("advancedDetails")}</summary>
            <label>{t("version")} <select aria-label={t("versionFor", { name: first.name })} value={current.version} onChange={event => { const version=event.target.value;setVersions(previous=>({...previous,[first.id]:version}));if(pinned)onChange({mode:"selected",refs:value.refs.map(ref=>ref.id===first.id?{id:first.id,version}:ref)}); }}>{items.map(item=><option key={item.version} value={item.version}>{item.version}</option>)}</select></label>
            <p className={styles.muted}>{t("savedName", { name: first.name })}</p><pre>{current.content}</pre>
          </details>
        </div>;
      })}
      {value.mode === "selected" && !methods.length && <p>{t("noOptionalMethods")}</p>}
      {value.mode === "selected" && value.refs.length >= 5 && <p role="status">{t("fiveSelected")}</p>}
      <div className={styles.methodFooter}><button type="button" onClick={() => setOpen(false)}>{t("done")}</button></div>
    </div>
  </details>;
}

export function ReportSkillVersionDialog({ projectId, skills, content, sourceRunId, initial, canManageProject, onClose, onSaved }: { projectId: string; canManageProject: boolean; skills: ReportSkillOption[]; content: string; sourceRunId?: string; initial?: ReportSkillOption; onClose: () => void; onSaved: () => void }) {
  const t = useMessages(skillControlsMessages);
  const draftCategory = initial?.category === "presentation" || /^category:\s*["']?presentation["']?\s*$/m.test(content.split("---")[1] ?? "") ? "presentation" : "analysis";
  const editable = skills.filter(skill => !skill.readOnly && !skill.required && (skill.category === "presentation" ? "presentation" : "analysis") === draftCategory);
  const preferred = initial ?? preferredSkillVersion(editable);
  const [target, setTarget] = useState(preferred?.id ?? "");
  const selected = preferredSkillVersion(editable.filter(skill => skill.id === target));
  // Default names pre-fill the saved Skill name, so they stay in English in every language.
  const [name, setName] = useState(preferred?.name ?? (draftCategory === "presentation" ? "Project report style" : "Project analysis"));
  const [version, setVersion] = useState("");
  const [scope, setScope] = useState<"personal" | "project">(!canManageProject || preferred?.scope === "personal" ? "personal" : "project");
  const [instructions, setInstructions] = useState(content);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [saved, setSaved] = useState<ReportSkillOption | null>(null);
  const [activated, setActivated] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const opener = document.activeElement as HTMLElement; dialog.current?.showModal(); return () => { if (opener?.isConnected) opener.focus(); }; }, []);
  async function save() {
    setBusy(true); setError("");
    try {
      const result = await configApi.reportAgentRequest<ReportSkillOption>(projectId, "skills", { method: "POST", body: JSON.stringify({ ...(selected ? { id: selected.id, revision: selected.revision } : {}), name, version, scope, category: draftCategory, content: instructions, sourceRunId }) });
      setSaved(result); onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("saveFailed")); } finally { setBusy(false); }
  }
  async function activate() {
    if (!saved) return;
    setBusy(true); setError("");
    try {
      const data = await configApi.reportAgentRequest<{ settings: { revision: number } }>(projectId);
      await configApi.reportAgentRequest(projectId, "skills/default", { method: "POST", body: JSON.stringify({ id: saved.id, version: saved.version, revision: data.settings.revision }) });
      setActivated(true); onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("defaultsFailed")); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className={styles.skillDialog} aria-label={t("saveDialog")} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><header><h2>{t("reviewHeading")}</h2><button disabled={busy} onClick={onClose}>{t("close")}</button></header><div className={`${styles.skillDialogBody} space-y-4`}>
    {error && <p role="alert">{error}</p>}
    {saved ? <><p role="status">{activated ? (saved.category === "presentation" ? t("styleActivated") : t("methodActivated")) : t("savedVersion", { name: saved.name, version: saved.version })}</p>{canManageProject && saved.scope === "project" && !activated && <button disabled={busy} onClick={() => void activate()}>{saved.category === "presentation" ? t("useReportStyle") : t("setProjectDefault")}</button>}{saved.scope === "personal" && <p>{t("personalNote")}</p>}</> : <>
      <p>{draftCategory === "presentation" ? t("styleIntro") : t("methodIntro")}</p>
      <label className="block">{t("updateSkill")}<select className={styles.search} value={target} onChange={event => { const next = preferredSkillVersion(editable.filter(skill => skill.id === event.target.value)); setTarget(event.target.value); setName(next?.name ?? "Project analysis"); setScope(!canManageProject || next?.scope === "personal" ? "personal" : "project"); }}><option value="">{t("createSkill")}</option>{editable.filter((skill,index) => editable.findIndex(item => item.id === skill.id) === index).map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
      <label className="block">{t("name")}<input className={styles.search} value={name} disabled={!!selected} onChange={event => setName(event.target.value)} /></label>
      <label className="block">{t("newVersion")}<input aria-label={t("newVersionLabel")} className={styles.search} placeholder={t("versionPlaceholder")} value={version} onChange={event => setVersion(event.target.value)} /></label>
      <label className="block">{t("visibility")}<select className={styles.search} disabled={!!selected} value={scope} onChange={event => setScope(event.target.value as "personal" | "project")}><option value="personal">{t("visibilityPersonal")}</option>{canManageProject && <option value="project">{t("visibilityShared")}</option>}</select></label>
      {selected && <details><summary>{t("compareWith", { version: selected.version })}</summary><pre className="whitespace-pre-wrap break-words text-sm">{selected.content}</pre></details>}
      <label className="block">{t("proposedInstructions")}<textarea aria-label={t("proposedInstructionsLabel")} className="w-full rounded border border-border bg-surface p-3 font-mono text-sm" rows={12} value={instructions} onChange={event => setInstructions(event.target.value)} /></label>
      <p>{t("savingNote")}</p>
      <button disabled={busy || !name.trim() || !version.trim() || !instructions.trim()} onClick={() => void save()}>{t("saveNewVersion")}</button>
    </>}
  </div></dialog>;
}

export function ReportSkillUsage({skills, prepared}: {skills: Array<{id:string;name:string;version:string;source:string}>;prepared:boolean}) {
  const t = useMessages(skillControlsMessages);
  return <details className={styles.answerMethods}><summary>{t("methodsForAnswer")} <span>{skills.length}</span></summary><div className={styles.answerMethodGroups}>
    {([['explicit',t('sourceExplicit')],['project',t('sourceProject')],['required',t('sourceRequired')]] as const).map(([source,label])=>{
      const items=skills.filter(skill=>source==='project' ? skill.source!=='explicit' && skill.source!=='required' : skill.source===source);
      if(!items.length)return null;
      return <section key={source}><h4>{label}</h4><ul>{items.map(skill=><li key={skill.id}><strong>{skill.name}</strong><span>v{skill.version}</span></li>)}</ul></section>;
    })}
    <details className={styles.methodEvidence}><summary>{t("deliveryStatus")}</summary><p>{prepared ? t("deliveryPrepared") : t("deliveryUnconfirmed")}</p></details>
  </div></details>;
}
