"use client";
import { useState } from "react";
import type { EnergyMeterCategoryDto, EnergyMeterMappingRowDto, EnergyProjectSetupDocumentDto, EnergyProjectSetupNodeDto } from "../../../lib/config-api";
import { addNode, applyMeterMappingRowEdit, buildAggregationReview, hasSiblingNameConflict, nodePathLabel, removeNodeAndDescendants } from "../admin/project-setup-model";
import { projectMeterName } from "./project-meter-name";
import styles from "./project-configuration-view.module.css";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { measurementMessages, structureMessages } from "./facility-messages";

/** English names, also used as values in logic (e.g. `type === "Lighting"`); show measurementLabel() to readers. */
export const MEASUREMENT_LABELS: Record<EnergyMeterCategoryDto, string> = {
  load: "Power", light: "Lighting", aircon: "Air conditioning", it: "IT & network", kitchen: "Kitchen & food", plug: "Plugs & sockets", overall: "Total", other: "Other",
};
/** What a meter measures, in the reader's language; unknown categories read as "Other", like MEASUREMENT_LABELS[category] ?? "Other". */
export function measurementLabel(category: EnergyMeterCategoryDto | string, locale: EnergyIqLocale = "en"): string {
  return translatorFor(measurementMessages, locale)(category in MEASUREMENT_LABELS ? category as EnergyMeterCategoryDto : "other");
}

type LocationDraft = { name: string; area: string; occupants: string };
type LocationTarget = { node: EnergyProjectSetupNodeDto } | { tierId: string; parentId?: string };

/** Apply a location create/update to the draft; returns an error message (in `locale`) instead of a document when invalid. */
export function applyLocationEdit(document: EnergyProjectSetupDocumentDto, projectId: string, target: LocationTarget, draft: LocationDraft, locale: EnergyIqLocale = "en"): { document: EnergyProjectSetupDocumentDto; nodeId: string } | { error: string } {
  const t = translatorFor(structureMessages, locale);
  const name = draft.name.trim().replace(/\s+/g, " ");
  if (!name) return { error: t("error.name") };
  const area = parseOptionalNumber(draft.area), occupants = parseOptionalNumber(draft.occupants);
  if (area === null) return { error: t("error.area") };
  if (occupants === null || (occupants !== undefined && !Number.isInteger(occupants))) return { error: t("error.occupants") };
  const tierId = "node" in target ? target.node.tier_definition_id : target.tierId;
  const parentId = "node" in target ? target.node.parent_id : target.parentId;
  if (hasSiblingNameConflict(document, { tierId, ...(parentId ? { parentId } : {}), name, ...("node" in target ? { excludeNodeId: target.node.id } : {}) })) return { error: t("error.duplicate", { name }) };
  const created = "node" in target ? { document, nodeId: target.node.id } : addNode(document, { projectId, tierId, ...(parentId ? { parentId } : {}) });
  if (!created.nodeId) return { error: t("error.level") };
  return { nodeId: created.nodeId, document: { ...created.document, nodes: created.document.nodes.map(node => node.id !== created.nodeId ? node : withOptional({ ...node, name }, area, occupants)) } };
}

/** Rename-only edits keep the confirmed totals; moving or re-counting a meter must be checked again. */
export function applyMeterEdit(document: EnergyProjectSetupDocumentDto, meter: EnergyMeterMappingRowDto, draft: { name: string; scopeId: string; category: EnergyMeterCategoryDto; counted: boolean }, locale: EnergyIqLocale = "en"): EnergyProjectSetupDocumentDto | { error: string } {
  const t = translatorFor(structureMessages, locale);
  const mapping = document.meter_mapping;
  if (!mapping) return { error: t("error.noMeterList") };
  const name = draft.name.trim().replace(/\s+/g, " ");
  if (!name) return { error: t("error.meterName") };
  if (!document.nodes.some(node => node.id === draft.scopeId)) return { error: t("error.meterLocation") };
  const renamed = { ...meter, presentation: { ...meter.presentation, device_name: name } };
  const aggregation = draft.counted ? "official" as const : "excluded" as const;
  const changesTotals = draft.scopeId !== meter.scope_id || draft.category !== meter.category || aggregation !== meter.aggregation_usage;
  return { ...document, meter_mapping: changesTotals
    ? applyMeterMappingRowEdit(document, mapping, { ...renamed, scope_id: draft.scopeId, category: draft.category, aggregation_usage: aggregation })
    : { ...mapping, rows: mapping.rows.map(row => row.id === meter.id ? renamed : row) } };
}

/** Moves several meters into one location: the same edit as changing each meter's location by hand. */
export function applyMeterMoves(document: EnergyProjectSetupDocumentDto, meterIds: string[], scopeId: string, locale: EnergyIqLocale = "en"): EnergyProjectSetupDocumentDto | { error: string } {
  const t = translatorFor(structureMessages, locale);
  if (!meterIds.length) return { error: t("move.errorNone") };
  let next = document;
  for (const id of meterIds) {
    const meter = next.meter_mapping?.rows.find(row => row.id === id);
    if (!meter) return { error: t("move.errorGone") };
    const moved = applyMeterEdit(next, meter, { name: projectMeterName(meter), scopeId, category: meter.category, counted: meter.aggregation_usage === "official" }, locale);
    if ("error" in moved) return moved;
    next = moved;
  }
  return next;
}

/** Pick meters from other locations and move them here, without the advisor. */
export function MoveMetersForm({ document, targetId, busy, error, onSave, onCancel }: { document: EnergyProjectSetupDocumentDto; targetId: string; busy: boolean; error: string; onSave: (meterIds: string[]) => void; onCancel: () => void }) {
  const t = useMessages(structureMessages);
  const { locale } = useEnergyIqLocale();
  const [chosen, setChosen] = useState<string[]>([]);
  const target = nodePathLabel(document, targetId);
  const others = (document.meter_mapping?.rows ?? []).filter(row => row.scope_id !== targetId);
  const where = (scopeId: string) => document.nodes.some(node => node.id === scopeId) ? nodePathLabel(document, scopeId) : t("move.noLocation");
  const groups = [...new Set(others.map(row => where(row.scope_id)))].sort((a, b) => a.localeCompare(b)).map(label => ({ label, rows: others.filter(row => where(row.scope_id) === label) }));
  const toggle = (id: string) => setChosen(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  return <form className={styles.inlineForm} aria-label={t("move.title", { target })} onSubmit={event => { event.preventDefault(); onSave(chosen); }}>
    <h4>{t("move.title", { target })}</h4>
    <p className={styles.formHint}>{t("move.hint", { target })}</p>
    {groups.length ? groups.map(group => <fieldset key={group.label} className={styles.moveGroup}><legend>{t("move.nowIn", { location: group.label })}</legend>
      {group.rows.map(row => <label key={row.id} className={styles.checkboxField}><input type="checkbox" checked={chosen.includes(row.id)} onChange={() => toggle(row.id)} />{projectMeterName(row)}<small>{MEASUREMENT_LABELS[row.category] ? measurementLabel(row.category, locale) : row.category}</small></label>)}
    </fieldset>) : <p className={styles.formHint}>{t("move.allHere")}</p>}
    <FormActions busy={busy} error={error} onCancel={onCancel} />
  </form>;
}

/** A location can only be removed once nothing in its branch still measures energy there. */
export function locationRemoval(document: EnergyProjectSetupDocumentDto, nodeId: string, locale: EnergyIqLocale = "en"): { document: EnergyProjectSetupDocumentDto } | { error: string } {
  const next = removeNodeAndDescendants(document, nodeId);
  const removed = new Set(document.nodes.filter(node => !next.nodes.some(kept => kept.id === node.id)).map(node => node.id));
  const attached = [...(document.meter_mapping?.rows ?? []), ...(document.meter_mapping?.virtual_meters ?? [])].filter(meter => removed.has(meter.scope_id)).length;
  return attached ? { error: translatorFor(structureMessages, locale)(attached === 1 ? "error.moveMeterOne" : "error.moveMeterMany", { count: attached }) } : { document: next };
}

export function LocationForm({ initial, title, busy, error, onSave, onCancel }: { initial: LocationDraft; title: string; busy: boolean; error: string; onSave: (draft: LocationDraft) => void; onCancel: () => void }) {
  const t = useMessages(structureMessages);
  const [draft, setDraft] = useState(initial);
  return <form className={styles.inlineForm} aria-label={title} onSubmit={event => { event.preventDefault(); onSave(draft); }}>
    <h4>{title}</h4>
    <div className={styles.formGrid}>
      <label>{t("location.name")}<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} autoFocus /></label>
      <label>{t("location.area")}<input inputMode="decimal" value={draft.area} placeholder={t("optional")} onChange={event => setDraft({ ...draft, area: event.target.value })} /></label>
      <label>{t("location.occupants")}<input inputMode="numeric" value={draft.occupants} placeholder={t("optional")} onChange={event => setDraft({ ...draft, occupants: event.target.value })} /></label>
    </div>
    <FormActions busy={busy} error={error} onCancel={onCancel} />
  </form>;
}

export function MeterForm({ meter, document, busy, error, onSave, onCancel }: { meter: EnergyMeterMappingRowDto; document: EnergyProjectSetupDocumentDto; busy: boolean; error: string; onSave: (draft: { name: string; scopeId: string; category: EnergyMeterCategoryDto; counted: boolean }) => void; onCancel: () => void }) {
  const t = useMessages(structureMessages);
  const { locale } = useEnergyIqLocale();
  const [draft, setDraft] = useState({ name: meter.presentation?.device_name?.trim() || meter.presentation?.circuit_name?.trim() || meter.display_name, scopeId: meter.scope_id, category: meter.category, counted: meter.aggregation_usage === "official" });
  const locations = document.nodes.map(node => ({ id: node.id, label: nodePathLabel(document, node.id) })).sort((a, b) => a.label.localeCompare(b.label));
  return <form className={styles.inlineForm} aria-label={draft.name ? t("meter.editNamed", { name: draft.name }) : t("meter.edit")} onSubmit={event => { event.preventDefault(); onSave(draft); }}>
    <div className={styles.formGrid}>
      <label>{t("meter.name")}<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} autoFocus /></label>
      <label>{t("meter.location")}<select value={document.nodes.some(node => node.id === draft.scopeId) ? draft.scopeId : ""} onChange={event => setDraft({ ...draft, scopeId: event.target.value })}>
        {!document.nodes.some(node => node.id === draft.scopeId) && <option value="">{t("meter.chooseLocation")}</option>}
        {locations.map(location => <option key={location.id} value={location.id}>{location.label}</option>)}
      </select></label>
      <label>{t("meter.measures")}<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as EnergyMeterCategoryDto })}>
        {Object.keys(MEASUREMENT_LABELS).map(value => <option key={value} value={value}>{measurementLabel(value, locale)}</option>)}
      </select></label>
    </div>
    <label className={styles.checkboxField}><input type="checkbox" checked={draft.counted} onChange={event => setDraft({ ...draft, counted: event.target.checked })} />{t("meter.counted")}</label>
    {meter.source_label && <p className={styles.formHint}>{t("meter.sourceHint", { source: meter.source_label })}</p>}
    <FormActions busy={busy} error={error} onCancel={onCancel} />
  </form>;
}

/** Same gate as the admin checkpoint: no location with two totals and no meter outside a location. */
/** Problems that stop a saved setup going live: an area counted twice, or a meter with no location. */
export function meterTotalProblems(document: EnergyProjectSetupDocumentDto, locale: EnergyIqLocale = "en"): string[] {
  const t = translatorFor(structureMessages, locale);
  const mapping = document.meter_mapping;
  if (!mapping) return [];
  const conflicts = buildAggregationReview(document, mapping).filter(group => group.conflict);
  const unplaced = mapping.rows.filter(row => !document.nodes.some(node => node.id === row.scope_id)).length;
  return [...conflicts.map(group => t("check.twoTotals", { location: group.scopeName, type: measurementLabel(group.category, locale).toLowerCase() })), ...(unplaced ? [t(unplaced === 1 ? "check.unplacedOne" : "check.unplacedMany", { count: unplaced })] : [])];
}
/**
 * An edit that leaves every area counted once needs no separate confirmation: saving is enough.
 * Where a real conflict remains, the totals stay unconfirmed so the change cannot go live by accident.
 */
export function withConfirmedTotals(document: EnergyProjectSetupDocumentDto): EnergyProjectSetupDocumentDto {
  const mapping = document.meter_mapping;
  if (!mapping || mapping.confirmed || !mapping.rows.length || meterTotalProblems(document).length) return document;
  return { ...document, meter_mapping: { ...mapping, confirmed: true } };
}

export function MeterTotalsCheck({ document, busy, onConfirm }: { document: EnergyProjectSetupDocumentDto; busy: boolean; onConfirm: () => void }) {
  const t = useMessages(structureMessages);
  const { locale } = useEnergyIqLocale();
  const mapping = document.meter_mapping;
  if (!mapping || mapping.confirmed || !mapping.rows.length) return null;
  const problems = meterTotalProblems(document, locale);
  return <section className={styles.totalsCheck} aria-label={t("check.aria")}>
    <div><strong>{t("check.title")}</strong><p>{problems.length ? t("check.fixFirst") : t("check.changed")}</p>{problems.length > 0 && <ul>{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}</div>
    <button type="button" className={styles.primaryAction} disabled={busy || problems.length > 0} onClick={onConfirm}>{t("check.confirm")}</button>
  </section>;
}

function FormActions({ busy, error, onCancel }: { busy: boolean; error: string; onCancel: () => void }) {
  const t = useMessages(structureMessages);
  return <>
    {error && <p role="alert" className={styles.editorError}>{error}</p>}
    <div className={styles.editorActions}>
      <button type="button" className={styles.secondaryAction} disabled={busy} onClick={onCancel}>{t("cancel")}</button>
      <button type="submit" className={styles.primaryAction} disabled={busy}>{busy ? t("saving") : t("save")}</button>
    </div>
  </>;
}

const parseOptionalNumber = (value: string): number | undefined | null => {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const withOptional = (node: EnergyProjectSetupNodeDto, area: number | undefined, occupants: number | undefined): EnergyProjectSetupNodeDto => {
  const { area_sqm: _area, occupant_count: _occupants, ...rest } = node;
  return { ...rest, ...(area !== undefined ? { area_sqm: area } : {}), ...(occupants !== undefined ? { occupant_count: occupants } : {}) };
};
