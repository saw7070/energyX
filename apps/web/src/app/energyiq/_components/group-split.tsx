"use client";
/**
 * Where the energy goes, by group: the site report's breakdown (top-level groups in their saved order, each with its
 * kWh on an average day and its share of the whole site, adding up to 100%). Each group opens, from the arrow at the
 * start of its row, onto the groups inside it: a ring of their shares beside them, largest first, each with its own kWh
 * and share of the whole site, so they add up to the group's share. Pointing at a slice lights up its row and the other
 * way round. A group inside that is itself made of several circuits (a pavilion's three circuits) opens once more.
 *
 * Each group is a button that says whether it is open; the bars and the ring are decoration only, so a screen reader
 * hears the name, the kWh and the share.
 *
 * Shared by the Overview's first view and the Analysis page, so both show the same breakdown with the same numbers.
 * The Overview styles it with its own stylesheet (the default look); Analysis passes a look that matches its cards.
 */
// React itself, not only its hooks: tests compile JSX with the classic runtime, so the module needs it in scope.
import React from "react";
import { kwhText, type BreakdownRow } from "@datafoundry/site-report";
import { useMessages } from "./energyiq-locale";
import { keyPointsMessages } from "./key-points-messages";
import styles from "./key-points.module.css";

/** Class names for each part. Parts left out are styled by the look's own stylesheet, as the Overview's are. */
export type GroupSplitLook = {
  section: string | undefined; heading?: string | undefined; note?: string | undefined; list?: string | undefined;
  row: string | undefined; button?: string | undefined; innerRow?: string | undefined;
  name: string | undefined; innerName?: string | undefined;
  bar: string | undefined; fill?: string | undefined; innerFill?: string | undefined;
  value: string | undefined; chevron: string | undefined; inner: string | undefined; hint: string | undefined;
};

/** The Overview's look, from its stylesheet. */
const OVERVIEW_LOOK: GroupSplitLook = {
  section: styles.split, row: styles.splitRow, name: styles.splitName, bar: styles.splitBar, value: styles.splitValue,
  chevron: styles.splitChevron, inner: styles.splitInner, hint: styles.splitHint,
};

/** Slice colours that read on the light card and on the dark one alike. */
const SLICE_COLOURS = ["#2f8a66", "#d19a45", "#7d8f9b", "#5fb38a", "#a8d5bd", "#c4643f", "#9aa9a2", "#9b7cc0"];

/** The groups inside a group, largest first (the top-level groups keep their saved order). */
const largestFirst = (rows: BreakdownRow[]) => [...rows].sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));

/** A ring of the inside groups' shares; `active` is the slice pointed at, if any. */
function Ring({ rows, active, onActive, label }: { rows: BreakdownRow[]; active: number | null; onActive: (index: number | null) => void; label: string }) {
  const size = 132, r = size / 2 - 4, inner = r * 0.6, c = size / 2;
  const total = rows.reduce((sum, row) => sum + row.share, 0) || 1;
  let angle = -Math.PI / 2;
  const p = (radius: number, a: number) => `${(c + radius * Math.cos(a)).toFixed(2)},${(c + radius * Math.sin(a)).toFixed(2)}`;
  const picked = active == null ? null : rows[active] ?? null;
  return <svg className={styles.splitRing} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" onPointerLeave={() => onActive(null)}>
    {rows.map((row, index) => {
      const sweep = row.share / total * Math.PI * 2;
      const start = angle, end = angle + sweep;
      angle = end;
      const d = sweep >= Math.PI * 2 - 1e-6
        ? `M${c},${c - r} A${r},${r} 0 1 1 ${c - 0.01},${c - r} L${c - 0.01},${c - inner} A${inner},${inner} 0 1 0 ${c},${c - inner} Z`
        : `M${p(r, start)} A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${p(r, end)} L${p(inner, end)} A${inner},${inner} 0 ${sweep > Math.PI ? 1 : 0} 0 ${p(inner, start)} Z`;
      return <path key={row.key} d={d} fill={SLICE_COLOURS[index % SLICE_COLOURS.length]} opacity={active != null && active !== index ? 0.3 : 1}
        onPointerEnter={() => onActive(index)} onPointerDown={() => onActive(index)} />;
    })}
    <text x={c} y={c - 2} textAnchor="middle" className={styles.splitRingValue}>{picked ? `${picked.pct}%` : label}</text>
    <text x={c} y={c + 15} textAnchor="middle" className={styles.splitRingName}>{picked ? (picked.name.length > 16 ? `${picked.name.slice(0, 15)}…` : picked.name) : ""}</text>
  </svg>;
}

/** `title` replaces "Where it goes"; `note` is an optional line under it saying what the numbers are. */
export function GroupSplit({ rows, title, note, look = OVERVIEW_LOOK }: { rows: BreakdownRow[]; title?: string | undefined; note?: string | undefined; look?: GroupSplitLook }) {
  const t = useMessages(keyPointsMessages);
  const id = React.useId();
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = React.useState<{ group: string; index: number } | null>(null);
  const toggle = (key: string) => setOpen(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  // One scale for every bar, so the groups inside a group visibly add up to it.
  const scale = Math.max(0.001, ...rows.map(row => row.share));
  // Whole percentages that add up: the top-level groups to 100%, the groups inside one to its own share.
  const value = (row: BreakdownRow) => row.perDay == null ? `${row.pct}%` : t("splitValue", { kwh: kwhText(row.perDay), pct: `${row.pct}%` });
  const parts = (row: BreakdownRow, inner: boolean, opens: boolean, swatch?: string) => <>
    <span className={opens ? look.chevron : styles.splitNoChevron} aria-hidden="true" />
    <span className={(inner ? look.innerName : undefined) ?? look.name}>{swatch && <i className={styles.splitSwatch} style={{ background: swatch }} />}{row.name}</span>
    <span className={look.bar} aria-hidden="true"><i className={(inner ? look.innerFill : undefined) ?? look.fill} style={{ width: `${Math.min(1, row.share / scale) * 100}%` }} /></span>
    <span className={look.value}>{value(row)}</span>
  </>;
  // A row inside a group: lit up with its slice, and opening onto its own circuits when it has several.
  const innerRow = (group: BreakdownRow, child: BreakdownRow, index: number) => {
    const listId = `${id}-${group.key}-${index}`;
    const opens = child.rows.length > 1;
    const expanded = open.has(child.key);
    const lit = active?.group === group.key && active.index === index;
    const hover = { onPointerEnter: () => setActive({ group: group.key, index }), onPointerLeave: () => setActive(null), onFocus: () => setActive({ group: group.key, index }), onBlur: () => setActive(null) };
    const className = `${look.innerRow ?? look.row ?? ""}${lit ? ` ${styles.splitLit}` : ""}`;
    return <li key={child.key}>
      {opens ? <button type="button" className={className} aria-expanded={expanded} aria-controls={listId} onClick={() => toggle(child.key)} {...hover}>{parts(child, true, true, SLICE_COLOURS[index % SLICE_COLOURS.length])}</button>
        : <div className={className} {...hover}>{parts(child, true, false, SLICE_COLOURS[index % SLICE_COLOURS.length])}</div>}
      {opens && <ul id={listId} className={look.inner} hidden={!expanded} aria-label={t("splitInside", { name: child.name })}>
        {largestFirst(child.rows).map(grand => <li key={grand.key}><div className={look.innerRow ?? look.row}>{parts(grand, true, false)}</div></li>)}
      </ul>}
    </li>;
  };
  return <section className={look.section} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className={look.heading}>{title ?? t("splitTitle")}</h3>
    {note && <p className={look.note}>{note}</p>}
    <ul className={look.list}>{rows.map((row, index) => {
      const listId = `${id}-group-${index}`;
      const expanded = open.has(row.key);
      const inside = largestFirst(row.rows);
      return <li key={row.key}>
        {row.rows.length ? <button type="button" className={look.button ?? look.row} aria-expanded={expanded} aria-controls={listId} onClick={() => toggle(row.key)}>
          {parts(row, false, true)}
        </button> : <div className={look.row}>{parts(row, false, false)}</div>}
        {row.rows.length > 0 && <div id={listId} className={styles.splitOpen} hidden={!expanded} role="group" aria-label={t("splitInside", { name: row.name })}>
          {inside.length > 1 && <Ring rows={inside} active={active?.group === row.key ? active.index : null} onActive={index => setActive(index == null ? null : { group: row.key, index })} label={`${row.pct}%`} />}
          <ul className={look.inner}>{inside.map((child, childIndex) => innerRow(row, child, childIndex))}</ul>
        </div>}
      </li>;
    })}</ul>
    {rows.some(row => row.rows.length > 0) && <p className={look.hint}>{t("splitHint")}</p>}
  </section>;
}
