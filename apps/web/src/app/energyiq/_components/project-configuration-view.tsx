"use client";
import { EnergyIcon } from "./icons";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { configApi, type EnergyProjectSetupDocumentDto, type EnergyProjectSetupDto, type EnergyOperationalPolicyConfigurationDto } from "../../../lib/config-api";
import { projectMeterName } from "./project-meter-name";
import { ReportMarkdown } from "./report-file-preview";
import { ProjectSpatialPreview } from "./project-spatial-preview";
import { OperatingCalendarEditor } from "./operating-calendar-editor";
import { HolidayCalendar } from "./holiday-calendar";
import { SiteDevices } from "./site-devices";
import { FloorPlanEditor, FloorPlanView } from "./floor-plan-editor";
import { AdvisorFacts } from "./advisor-facts";
import { readFacts, withoutFacts } from "./advisor-facts-model";
import type { StoredSpatialReference } from "./floor-plan-model";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { OperatingHoursView } from "./operating-hours-view";
import { ElectricityRateView } from "./electricity-rate-view";
import { ElectricityRateEditor } from "./electricity-rate-editor";
import { LocationForm, MeterForm, MeterTotalsCheck, MoveMetersForm, applyLocationEdit, applyMeterEdit, applyMeterMoves, locationRemoval, measurementLabel, withConfirmedTotals } from "./site-structure-editing";
import styles from "./project-configuration-view.module.css";
import { ConfirmDialog } from "./confirm-dialog";
import { MeterTypeBanner, MeterTypeReview } from "./meter-type-review";
import { applyMeterTypes } from "./meter-type-review-model";
import { meterTypeReviewMessages } from "./meter-type-review-messages";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { projectConfigurationMessages } from "./project-configuration-messages";
const label = (value: string) => value.replace(/_/g, " ").replace(/^./, char => char.toUpperCase());
/** A stored instant as the site-local calendar date, e.g. "1 May 2026". */
const siteDate = (value: string, timezone?: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { timeZone: timezone || "Asia/Singapore", day: "numeric", month: "short", year: "numeric" }).format(date).replace("Sept", "Sep");
};

export function ProjectConfigurationView({ setup, notes, policies, projectId, onPolicyChange, canEditPolicies = false, canEditSetup = false, initialTab, onTabChange }: { initialTab?: string; onTabChange?: (tab: string, extra?: Record<string, string>) => void; onPolicyChange?: () => void; projectId?: string; setup: EnergyProjectSetupDto; notes: string; policies: EnergyOperationalPolicyConfigurationDto | null; canEditPolicies?: boolean; canEditSetup?: boolean }) {
  const t = useMessages(projectConfigurationMessages);
  const typeText = useMessages(meterTypeReviewMessages);
  const { locale } = useEnergyIqLocale();
  const [setupEdit, setSetupEdit] = useState<null | { kind: "location"; nodeId: string } | { kind: "new"; tierId: string; parentId?: string } | { kind: "meter"; meterId: string } | { kind: "move"; nodeId: string } | { kind: "types" }>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [editingCalendar, setEditingCalendar] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);
  // Saved changes go live on their own, including ones left behind by an earlier failure or by another tool.
  const liveAttempt = useRef("");
  const [focusMeter, setFocusMeter] = useState<string | null>(null);
  const [editingRate, setEditingRate] = useState<null | "edit" | "next">(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyMessage, setPolicyMessage] = useState("");
  const [tab, setTabState] = useState(initialTab ?? "structure");
  useEffect(() => { if (initialTab) setTabState(initialTab); }, [initialTab]);
  const setTab = (next: string) => { setTabState(next); onTabChange?.(next); };
  const openDevice = (id: string) => { setTabState("devices"); onTabChange?.("devices", { view: `device:${id}` }); };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { if (focusMeter) document.getElementById(`meter-row-${focusMeter}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [focusMeter, selectedId]);
  const pendingKey = `${projectId ?? ""}:${setup.draft.revision}`;
  useEffect(() => {
    // One attempt per saved revision: a change that cannot go live (a totals conflict, for example) says why
    // instead of retrying in a loop, and the button stays as the retry.
    if (!projectId || !canEditPolicies || !setup.project.has_unpublished_changes || liveBusy || liveAttempt.current === pendingKey) return;
    liveAttempt.current = pendingKey;
    void makeLive("");
  }, [pendingKey, canEditPolicies, projectId, setup.project.has_unpublished_changes, liveBusy]);
  const doc = setup.draft.document;
  const nodes = doc.nodes ?? [], meters = doc.meter_mapping?.rows ?? [], virtual = doc.meter_mapping?.virtual_meters ?? [];
  const names = new Map(nodes.map(node => [node.id, node.name]));
  const parents = new Map(nodes.flatMap(node => node.parent_id ? [[node.id, node.parent_id] as const] : []));
  const meterNames = new Map(meters.map(meter => [meter.id, projectMeterName(meter)]));
  const tiers = new Map(doc.tiers.map(tier => [tier.id, tier.alias]));
  const selected = nodes.find(node => node.id === selectedId) ?? nodes.find(node => meters.some(meter => meter.scope_id === node.id)) ?? nodes[0];
  const assigned = meters.filter(meter => selectedId === "unassigned" ? !names.has(meter.scope_id) : meter.scope_id === selected?.id);
  const pid = projectId ?? setup.project.id;
  // The tab counts the facts the advisor reads, like the other tabs count what they hold.
  const factCount = readFacts(notes).length;
  const spatial = readProjectSpatialReference(notes, pid);
  const planMeters = meters.map(meter => ({ id: meter.id, name: meterNames.get(meter.id) ?? meter.id, board: names.get(meter.scope_id) ?? t("unassigned"), type: measurementLabel(meter.category, locale) }));
  const planBoards = [...new Set(meters.map(meter => names.get(meter.scope_id)).filter((name): name is string => !!name))];
  const descendantsOf = (id: string) => { const found: string[] = []; const queue = [id]; while (queue.length) { const current = queue.shift()!; for (const node of nodes) if (node.parent_id === current && !found.includes(node.id)) { found.push(node.id); queue.push(node.id); } } return found; };
  // A space with no meters of its own shows the boards inside it instead of "0 meters".
  const childBoards = selected && selectedId !== "unassigned" && !assigned.length ? descendantsOf(selected.id).map(id => nodes.find(node => node.id === id)!).filter(node => meters.some(meter => meter.scope_id === node.id)) : [];
  const highlight = selectedId === "unassigned" || !selected ? null : assigned.length ? [selected.name] : childBoards.length ? childBoards.map(node => node.name) : null;
  const selectBoard = (board: string) => { const node = nodes.find(item => item.name === board && meters.some(meter => meter.scope_id === item.id)) ?? nodes.find(item => item.name === board); if (node) { setSelectedId(node.id); setFocusMeter(null); } };
  const selectDevice = (id: string) => { const meter = meters.find(item => item.id === id); if (!meter) return; setSelectedId(names.has(meter.scope_id) ? meter.scope_id : "unassigned"); setFocusMeter(id); };
  const calculated = virtual.filter(meter => selectedId === "unassigned" ? !names.has(meter.scope_id) : meter.scope_id === selected?.id);
  const selectedName = selectedId === "unassigned" ? t("unassignedMeters") : selected?.name ?? t("projectStructure");
  const editable = canEditSetup && !!projectId;
  const tiersTopDown = [...doc.tiers].sort((a, b) => b.ordinal - a.ordinal);
  const childTierOf = (node?: { tier_definition_id: string }) => { const tier = doc.tiers.find(item => item.id === node?.tier_definition_id); return tier ? doc.tiers.find(item => item.ordinal === tier.ordinal - 1) : undefined; };
  const [confirmRemove, setConfirmRemove] = useState<{ name: string; document: EnergyProjectSetupDocumentDto } | null>(null);
  const startSetupEdit = (next: NonNullable<typeof setupEdit>) => { setSetupError(""); setPolicyMessage(""); setSetupEdit(next); };
  const applyReason = (reason: unknown) => {
    const text = reason instanceof Error ? reason.message : "";
    const invalid = /SETUP_INVALID:([\w,]+)/.exec(text);
    return /ADMIN|FORBIDDEN/.test(text) ? t("applyAdmin") : invalid ? t("applyInvalid", { reasons: setupProblems(invalid[1]!).map(key => t(key)).join("; ") }) : /DATA_NOT_READY/.test(text) ? t("applyNoData") : /REVISION|CONFLICT/.test(text) ? t("applyConflict") : t("applyFailed");
  };
  // Saving makes a change live straight away: the saved setup, rate and hours are published without a separate review.
  const makeLive = async (saved: string) => {
    const say = (next: string) => setPolicyMessage([saved, next].filter(Boolean).join(" "));
    if (!projectId) { say(""); onPolicyChange?.(); return; }
    setLiveBusy(true); say(t("applying"));
    try { await configApi.applyEnergyProjectChanges(projectId); say(t("liveNow")); }
    catch (reason) { say(t("notLive", { reason: applyReason(reason) })); }
    finally { setLiveBusy(false); onPolicyChange?.(); }
  };
  // Each in-page edit saves the shared draft and then makes it live.
  const saveDraft = async (next: EnergyProjectSetupDocumentDto, message: string, select?: string | null) => {
    if (!projectId || setupBusy) return;
    setSetupBusy(true); setSetupError("");
    try {
      // A change that leaves every area counted once needs no separate confirmation; a real conflict still stops below.
      await configApi.saveEnergyProjectSetupDraft(projectId, { expectedRevision: setup.draft.revision, document: withConfirmedTotals(next) });
      setSetupEdit(null); if (select !== undefined) setSelectedId(select); void makeLive(message);
    } catch (reason) { setSetupError(reason instanceof Error && /REVISION/.test(reason.message) ? t("changedSinceLoad") : t("saveFailed")); }
    finally { setSetupBusy(false); }
  };
  const saveLocation = (target: Parameters<typeof applyLocationEdit>[2], draft: Parameters<typeof applyLocationEdit>[3]) => {
    const result = applyLocationEdit(doc, projectId ?? setup.project.id, target, draft, locale);
    if ("error" in result) setSetupError(result.error); else void saveDraft(result.document, t("locationSaved"), result.nodeId);
  };
  const removeLocation = (node: { id: string; name: string }) => {
    const result = locationRemoval(doc, node.id, locale);
    if ("error" in result) { setPolicyMessage(""); setSetupError(result.error); return; }
    // Asked in the app's own words rather than the browser's confirm box, which shows the site address instead.
    setConfirmRemove({ name: node.name, document: result.document });
  };
  const edit = (focus: string, title = t("askAdvisorEdit")) => projectId ? <Link className={styles.edit} href={`/energyiq/reports?${new URLSearchParams({projectId,sessionId:"new",configure:"1",focus})}`}>{title}<EnergyIcon name="arrow" className="h-4 w-4" /></Link> : null;
  const seen = new Set<string>();
  const structure = (parent?: string, depth = 0): React.ReactNode => nodes.filter(node => (node.parent_id || undefined) === parent).sort((a,b)=>a.sort_order-b.sort_order).map(node => {
    if (seen.has(node.id)) return null; seen.add(node.id);
    const count = meters.filter(meter => meter.scope_id === node.id).length;
    const open = selected?.id === node.id && selectedId !== "unassigned";
    const child = childTierOf(node);
    return <li key={node.id}><button className={open ? styles.selectedNode : ""} aria-pressed={open} onClick={()=>{ setSelectedId(node.id); setFocusMeter(null); }}><span className={styles.nodeIcon} aria-hidden="true"><EnergyIcon name={count ? "building" : "floor"} className="h-5 w-5" /></span><span><strong>{node.name}</strong><small>{tiers.get(node.tier_definition_id)}</small></span>{count > 0 && <b>{count}</b>}</button>
    {open && editable && <div className={styles.nodeActions}>
      <button type="button" className={styles.edit} onClick={() => startSetupEdit({ kind: "location", nodeId: node.id })}>{t("edit")}</button>
      {child && <button type="button" className={styles.edit} onClick={() => startSetupEdit({ kind: "new", tierId: child.id, parentId: node.id })}>{t("addTier", { tier: child.alias })}</button>}
      <button type="button" className={styles.edit} onClick={() => startSetupEdit({ kind: "move", nodeId: node.id })}>{t("moveMetersHere")}</button>
      <button type="button" className={`${styles.edit} ${styles.removeAction}`} disabled={setupBusy} onClick={() => removeLocation(node)}>{t("remove")}</button>
    </div>}{depth < 12 && <ul>{structure(node.id,depth+1)}</ul>}</li>;
  });
  const tree = structure();
  const owner = (value: {kind: string; scope_id?: string}) => value.kind === "project" ? t("wholeProject") : names.get(value.scope_id ?? "") ?? t("outsideDraft");
  const calendar = policies?.operatingCalendarRevisions[0];
  const tariff = policies?.tariffRevisions[0];
  const holidayCount = new Set(calendar?.entries.flatMap(entry => entry.exceptions?.map(item => item.date) ?? [])).size;
  const status = (id: string, published: string, pending: string) => id === published ? "Published project version" : id === pending ? "Selected for next publication" : "Saved for review · not selected";
  const selectPolicy = async (kind: "tariff" | "calendar", version: string) => {
    if (!projectId || !policies || policyBusy) return;
    setPolicyBusy(true); setPolicyMessage("");
    try {
      await configApi.selectEnergyOperationalPolicy(projectId, { kind, version, expectedVersion: (kind === "tariff" ? policies.pending.tariff_schedule_version : policies.pending.business_calendar_version) ?? null });
      void makeLive(t("policySelected"));
    } catch { setPolicyMessage(t("policySelectFailed")); }
    finally { setPolicyBusy(false); }
  };
  const scopeOptions = [{ value: "project", label: t("wholeProject") }, ...(setup.published?.nodes ?? []).filter(node => node.id !== setup.project.root_scope_id).map(node => ({ value: node.id, label: node.name }))];
  const rateSaved = () => { setEditingRate(null); void makeLive(t("rateSaved")); };
  const startRateEdit = (mode: "edit" | "next") => { setPolicyMessage(""); setEditingRate(mode); };
  const calendarSaved = () => { setEditingCalendar(false); void makeLive(t("hoursSaved")); };
  const selectButton = (kind: "tariff" | "calendar", version: string) => projectId && policies && version !== (kind === "tariff" ? policies.pending.tariff_schedule_version : policies.pending.business_calendar_version) ? <button className={styles.edit} disabled={policyBusy} onClick={()=>void selectPolicy(kind,version)}>{t("useForNext")}</button> : null;
  return <div className={styles.view}>
    {confirmRemove && <ConfirmDialog destructive busy={setupBusy} title={t("removeTitle", { name: confirmRemove.name })} body={t("removeBody")} confirmLabel={t("remove")} cancelLabel={t("keepIt")}
      onCancel={() => setConfirmRemove(null)}
      onConfirm={() => { const pending = confirmRemove; setConfirmRemove(null); void saveDraft(pending.document, t("removed", { name: pending.name }), null); }} />}
    <section className={styles.overview}>
      <div className={styles.projectMark} aria-hidden="true"><EnergyIcon name="building" className="h-7 w-7" /></div>
      <div className={styles.projectIdentity}><h2>{doc.project.name}</h2><p><EnergyIcon name="globe" aria-hidden="true" />{doc.project.timezone.replace(/_/g," ")}</p></div>
      <dl className={styles.projectStats}><div><dt>{t("locations")}</dt><dd>{nodes.length}</dd></div><div><dt>{t("statMeters")}</dt><dd>{meters.length}</dd></div></dl>
      <div className={styles.projectState}>
        <div className={styles.stateRow}><span className={setup.project.has_unpublished_changes ? undefined : styles.live}>{t(liveBusy ? "applying" : setup.project.has_unpublished_changes ? "unpublished" : "savedDraft")}</span>{setup.project.has_unpublished_changes && canEditPolicies && projectId && !liveBusy && <button type="button" className={styles.edit} onClick={() => void makeLive("")}>{t("reviewPublish")}</button>}</div>
        <details><summary>{t("whatMeans")}</summary><p>{t("draftExplain")}</p></details>
      </div>
    </section>
    {policyMessage && <p role="status" className={styles.statusMessage}>{policyMessage}</p>}
    <nav className={styles.tabs} aria-label={t("sections")}>{[["structure",t("tabFloor"),String(meters.length)],["devices",t("tabDevices"),""],["context",t("tabNotes"),notes ? (factCount ? String(factCount) : "") : t("stateAddNotes")],["policies",t("tabHours"),policies ? "" : t("stateUnavailable")],["holidays",t("tabHolidays"),!policies ? t("stateUnavailable") : holidayCount ? String(holidayCount) : ""],["tariff",t("tabRate"),!policies ? t("stateUnavailable") : tariff ? "" : t("stateAddRate")]].map(([id,title,state]) => <button key={id} aria-label={title} aria-pressed={tab === id} onClick={()=>setTab(id!)}><span>{title}</span>{state && <small>{state}</small>}</button>)}</nav>
    {tab === "structure" && editable && <MeterTotalsCheck document={doc} busy={setupBusy} onConfirm={() => doc.meter_mapping && void saveDraft({ ...doc, meter_mapping: { ...doc.meter_mapping, confirmed: true } }, t("totalsConfirmed"))} />}
    {tab === "structure" && editable && !editingPlan && (setupEdit?.kind === "types"
      ? <MeterTypeReview document={doc} busy={setupBusy} error={setupError} onCancel={() => setSetupEdit(null)} onSave={choices => { const next = applyMeterTypes(doc, choices, locale); if ("error" in next) setSetupError(next.error); else void saveDraft(next, typeText("saved")); }} />
      : <MeterTypeBanner document={doc} onOpen={() => startSetupEdit({ kind: "types" })} />)}
    {tab === "structure" && editingPlan && projectId && <FloorPlanEditor projectId={projectId} notes={notes} block={spatial?.block ?? null} previous={(spatial?.reference as StoredSpatialReference | undefined) ?? null} meters={planMeters} boards={planBoards} onCancel={() => setEditingPlan(false)} onSaved={message => { setEditingPlan(false); setPolicyMessage(message); onPolicyChange?.(); }} />}
    {tab === "structure" && !editingPlan && <div className={styles.workspace}>
      <section className={styles.locations}><header><h3>{t("locations")}</h3>{!editable && edit("structure",t("editStructure"))}</header><ul className={styles.tree}>{tree}</ul>{editable && tiersTopDown[0] && <button type="button" className={styles.addLocation} onClick={() => startSetupEdit({ kind: "new", tierId: tiersTopDown[0]!.id })}>{t("addTier", { tier: tiersTopDown[0].alias })}</button>}{nodes.filter(node=>!seen.has(node.id)).map(node=><button className={styles.unassigned} key={node.id} onClick={()=>setSelectedId(node.id)}>{t("unresolved", { name: node.name })}</button>)}{meters.some(meter=>!names.has(meter.scope_id)) && <button className={styles.unassigned} onClick={()=>setSelectedId("unassigned")}>{t("unassignedMeters")}</button>}{!nodes.length && <div className={styles.empty}><h3>{t("firstLocation")}</h3>{edit("structure",t("organiseAdvisor"))}</div>}</section>
      <section className={styles.inspector}><FloorPlanView reference={(spatial?.reference as StoredSpatialReference | undefined) ?? null} meters={planMeters} highlight={highlight} focusDevice={focusMeter} canEdit={canEditPolicies && !!projectId} onEdit={() => setEditingPlan(true)} onSelectBoard={selectBoard} onSelectDevice={selectDevice} />
      {setupEdit?.kind === "new" ? <LocationForm key={`new-${setupEdit.tierId}-${setupEdit.parentId ?? ""}`} title={setupEdit.parentId ? t("newTierIn", { tier: doc.tiers.find(tier => tier.id === setupEdit.tierId)?.alias ?? t("locationWord"), parent: names.get(setupEdit.parentId) ?? t("thisLocation") }) : t("newTier", { tier: doc.tiers.find(tier => tier.id === setupEdit.tierId)?.alias ?? t("locationWord") })} initial={{ name: "", area: "", occupants: "" }} busy={setupBusy} error={setupError} onCancel={() => setSetupEdit(null)} onSave={draft => saveLocation({ tierId: setupEdit.tierId, ...(setupEdit.parentId ? { parentId: setupEdit.parentId } : {}) }, draft)} />
      : setupEdit?.kind === "location" && selected && setupEdit.nodeId === selected.id ? <LocationForm key={selected.id} title={t("editName", { name: selected.name })} initial={{ name: selected.name, area: selected.area_sqm == null ? "" : String(selected.area_sqm), occupants: selected.occupant_count == null ? "" : String(selected.occupant_count) }} busy={setupBusy} error={setupError} onCancel={() => setSetupEdit(null)} onSave={draft => saveLocation({ node: selected }, draft)} />
      : <><header><div><span className={styles.breadcrumb}>{selected?.parent_id ? names.get(selected.parent_id) : doc.project.name}</span><h3>{selectedName}</h3></div><div className={styles.headerActions}>{editable && selected && selectedId !== "unassigned" && <><button type="button" className={styles.edit} onClick={() => startSetupEdit({ kind: "location", nodeId: selected.id })}>{t("edit")}</button>{childTierOf(selected) && <button type="button" className={styles.edit} onClick={() => startSetupEdit({ kind: "new", tierId: childTierOf(selected)!.id, parentId: selected.id })}>{t("addTier", { tier: childTierOf(selected)!.alias })}</button>}<button type="button" className={styles.edit} disabled={setupBusy} onClick={() => removeLocation(selected)}>{t("remove")}</button>{assigned.length > 0 && <button type="button" className={styles.edit} onClick={() => startSetupEdit({ kind: "move", nodeId: selected.id })}>{t("moveMetersHere")}</button>}</>}{!editable && edit("meters")}</div></header>
      {setupError && !setupEdit && <p role="alert" className={styles.editorError}>{setupError}</p>}</>}
      <div className={styles.locationFacts}><span><b>{assigned.length || childBoards.reduce((sum, node) => sum + meters.filter(meter => meter.scope_id === node.id).length, 0)}</b> {t("factMeters")}{!assigned.length && childBoards.length ? t(childBoards.length === 1 ? "onBoard" : "onBoards", { count: childBoards.length }) : ""}</span>{selectedId !== "unassigned" && selected?.area_sqm != null && <span><b>{selected.area_sqm}</b> m²</span>}{selectedId !== "unassigned" && selected?.occupant_count != null && <span><b>{selected.occupant_count}</b> {t("occupants")}</span>}</div>
      {setupEdit?.kind === "move" && selected && setupEdit.nodeId === selected.id ? <MoveMetersForm document={doc} targetId={selected.id} busy={setupBusy} error={setupError} onCancel={() => setSetupEdit(null)} onSave={ids => { const next = applyMeterMoves(doc, ids, selected.id, locale); if ("error" in next) setSetupError(next.error); else void saveDraft(next, t("metersMoved", { count: t("metersCount", { count: ids.length }), name: selected.name })); }} />
      : assigned.length ? <div className={styles.meters}><div className={styles.tableHeading}><span>{t("meterColumn")}</span><span>{t("measurementColumn")}</span></div>{assigned.map(meter=>setupEdit?.kind === "meter" && setupEdit.meterId === meter.id ? <div className={styles.meterEditing} key={meter.id}><MeterForm meter={meter} document={doc} busy={setupBusy} error={setupError} onCancel={() => setSetupEdit(null)} onSave={draft => { const next = applyMeterEdit(doc, meter, draft, locale); if ("error" in next) setSetupError(next.error); else void saveDraft(next, t("meterSaved", { name: draft.name.trim() })); }} /></div> : <div id={`meter-row-${meter.id}`} className={`${styles.meter} ${editable ? styles.meterEditable : ""} ${focusMeter === meter.id ? styles.meterFocus : ""}`} key={meter.id}><div><span className={styles.meterIcon} aria-hidden="true"><EnergyIcon name="bolt" className="h-4 w-4" /></span><strong>{projectMeterName(meter)}</strong><button type="button" className={styles.rowOpen} aria-label={t("viewUsageFor", { name: projectMeterName(meter) })} onClick={() => openDevice(meter.id)}>{t("viewUsage")}</button></div><span className={styles.measurement}>{measurementLabel(meter.category, locale)}</span>{editable && <button type="button" className={styles.rowEdit} aria-label={t("editName", { name: projectMeterName(meter) })} onClick={() => startSetupEdit({ kind: "meter", meterId: meter.id })}>{t("edit")}</button>}<details><summary>{t("details")}</summary><dl>{meter.presentation?.circuit_name && <div><dt>{t("circuit")}</dt><dd>{meter.presentation.circuit_name}</dd></div>}<div><dt>{t("sourceName")}</dt><dd>{meter.source_label || meter.display_name}</dd></div><div><dt>{t("resource")}</dt><dd>{t(`resource.${meter.resource}`)}</dd></div><div><dt>{t("role")}</dt><dd>{t(`role.${meter.meter_role}`)}</dd></div><div><dt>{t("aggregation")}</dt><dd>{t(meter.aggregation_usage === "official" ? "inTotals" : "notInTotals")}</dd></div></dl></details></div>)}</div> : childBoards.length ? <div className={styles.boardCards}>{childBoards.map(node => { const list = meters.filter(meter => meter.scope_id === node.id); const types = [...new Set(list.map(meter => measurementLabel(meter.category, locale)))].map(type => t("typeCount", { count: list.filter(meter => (measurementLabel(meter.category, locale)) === type).length, type: type.toLowerCase() })).join(" · "); return <button type="button" key={node.id} className={styles.boardCard} onClick={() => { setSelectedId(node.id); setFocusMeter(null); }}><span className={styles.nodeIcon} aria-hidden="true"><EnergyIcon name="building" className="h-5 w-5" /></span><span><strong>{node.name}</strong><small>{tiers.get(node.tier_definition_id)} · {t("metersCount", { count: list.length })}{types ? ` (${types})` : ""}</small></span><b>{t("showMeters")}</b></button>; })}</div>
      : <div className={styles.empty}><h3>{t("noMetersHere")}</h3><div className={styles.emptyActions}>{editable && selected && selectedId !== "unassigned" && <button type="button" className={styles.primaryAction} onClick={() => startSetupEdit({ kind: "move", nodeId: selected.id })}>{t("moveMetersHere")}</button>}{edit("meters",t(editable ? "orAdvisor" : "assignAdvisor"))}</div></div>}
      {calculated.length > 0 && <section className={styles.calculations}><h4>{t("calculatedMeters")} <span>{calculated.length}</span></h4>{calculated.map(meter=><div key={meter.id}><strong>{projectMeterName(meter)}</strong><p>{meter.terms.map((term,i)=>`${term.coefficient === -1 ? "− " : i ? "+ " : ""}${meterNames.get(term.mapping_row_id) ?? t("unknownMeter")}`).join(" ")}</p></div>)}</section>}
      {selectedId !== "unassigned" && selected?.metadata && Object.keys(selected.metadata).length > 0 && <details className={styles.extra}><summary>{t("additionalInfo")}</summary><Reference value={selected.metadata}/></details>}
      </section>
    </div>}
    {tab === "context" && <section className={styles.notes}><header className={styles.sectionHeader}><h3>{t("tabNotes")}</h3>{edit("context",t("updateNotesAdvisor"))}</header><AdvisorFacts projectId={projectId ?? setup.project.id} notes={notes} timezone={doc.project.timezone} canEdit={canEditPolicies && !!projectId} onSaved={() => onPolicyChange?.()} />{withoutFacts(notes).trim() ? <ProjectSpatialPreview notes={notes} projectId={projectId ?? setup.project.id} meters={meters.map(meter => ({ id: meter.id, name: meterNames.get(meter.id) ?? meter.id, board: names.get(meter.scope_id) ?? t("unassigned") }))} /> : <div className={styles.empty}><strong>{t("noNotes")}</strong><p>{t("noNotesBody")}</p>{edit("context",t("addProjectInfo"))}</div>}</section>}
    {tab === "devices" && <SiteDevices projectId={projectId ?? setup.project.id} boardNames={names} boardParents={parents} />}
    {tab === "holidays" && (!policies ? <p role="status">{t("holidaysFailed")}</p> : <HolidayCalendar key={calendar?.version_id ?? "none"} projectId={projectId} timezone={doc.project.timezone} revision={calendar} scopeNames={names} canEdit={canEditPolicies} onSaved={message => void makeLive(message)} />)}
    {tab === "policies" && <section className={`${styles.policies} ${styles.single}`}>{!policies ? <p role="status">{t("hoursFailed")}</p> : <>
      <section className={editingCalendar ? styles.editing : undefined}><header className={styles.sectionHeader}><h3>{t("tabHours")}</h3>{!editingCalendar && <div className={styles.headerActions}>{canEditPolicies && projectId ? <button type="button" className={styles.edit} onClick={()=>{ setPolicyMessage(""); setEditingCalendar(true); }}>{t("edit")}</button> : edit("calendar",t("editHoursAdvisor"))}</div>}</header>{editingCalendar && projectId ? <OperatingCalendarEditor projectId={projectId} revision={calendar} scopeOptions={scopeOptions} onSaved={calendarSaved} onCancel={()=>setEditingCalendar(false)} /> : calendar ? <OperatingHoursView revision={calendar} status={calendar.version_id === policies.published.business_calendar_version ? "published" : calendar.version_id === policies.pending.business_calendar_version ? "draft" : "saved"} action={selectButton("calendar", calendar.version_id)} ownerName={owner} onViewCalendar={() => setTab("holidays")} timezone={doc.project.timezone} /> : <div className={styles.empty}><h4>{t("whenOpen")}</h4>{canEditPolicies && projectId && <button type="button" className={styles.edit} onClick={()=>setEditingCalendar(true)}>{t("setHours")}</button>}{edit("calendar",t("addHoursAdvisor"))}</div>}</section>
    </>}</section>}
    {tab === "tariff" && <section className={`${styles.policies} ${styles.single}`}>{!policies ? <p role="status">{t("rateFailed")}</p> : <>
      <section className={editingRate ? styles.editing : undefined}><header className={styles.sectionHeader}><h3>{t("tabRate")}</h3>{!editingRate && <div className={styles.headerActions}>{canEditPolicies && projectId ? <button type="button" className={styles.edit} onClick={()=>startRateEdit("edit")}>{t("edit")}</button> : edit("tariff",t("editRateAdvisor"))}</div>}</header>{editingRate && projectId ? <ElectricityRateEditor projectId={projectId} revision={tariff} timezone={doc.project.timezone} scopeOptions={scopeOptions} addNext={editingRate === "next"} onSaved={rateSaved} onCancel={()=>setEditingRate(null)} /> : tariff ? <ElectricityRateView revision={tariff} status={tariff.version_id === policies.published.tariff_schedule_version ? "published" : tariff.version_id === policies.pending.tariff_schedule_version ? "draft" : "saved"} action={selectButton("tariff", tariff.version_id)} ownerName={owner} timezone={doc.project.timezone} {...(canEditPolicies && projectId ? { onAddNext: () => startRateEdit("next") } : {})} /> : <div className={styles.empty}><h4>{t("addRateTitle")}</h4>{canEditPolicies && projectId && <button type="button" className={styles.edit} onClick={()=>startRateEdit("edit")}>{t("stateAddRate")}</button>}{edit("tariff",t("addRateAdvisor"))}</div>}</section>
    </>}</section>}
  </div>;
}

function Reference({value,depth=0}:{value:unknown;depth?:number}) {
  const t = useMessages(projectConfigurationMessages);
  if(value == null) return <span>{t("notSpecified")}</span>;
  if(typeof value !== "object") return <span>{String(value)}</span>;
  if(depth > 5) return <span>{t("nested")}</span>;
  return <dl>{Object.entries(value).map(([key,item])=><div key={key}><dt>{label(key)}</dt><dd><Reference value={item} depth={depth+1}/></dd></div>)}</dl>;
}

/** What a setup check found, in words: the codes themselves never reach the page. */
export function setupProblems(codes: string): Array<"invalid.noMeter" | "invalid.totals" | "invalid.unplaced" | "invalid.levels" | "invalid.other"> {
  const found = new Set<"invalid.noMeter" | "invalid.totals" | "invalid.unplaced" | "invalid.levels" | "invalid.other">();
  for (const code of codes.split(",").map(item => item.trim()).filter(Boolean)) {
    if (code === "LOCATION_WITHOUT_METER") found.add("invalid.noMeter");
    else if (/ROUTE|TOTAL|AGGREGATION|MAPPING_NOT_CONFIRMED/.test(code)) found.add("invalid.totals");
    else if (/UNMAPPED|SOURCE_LABEL|SCOPE/.test(code)) found.add("invalid.unplaced");
    else if (/TIER|NODE/.test(code)) found.add("invalid.levels");
    else found.add("invalid.other");
  }
  return found.size ? [...found] : ["invalid.other"];
}
