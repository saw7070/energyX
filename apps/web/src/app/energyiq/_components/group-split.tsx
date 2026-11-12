"use client";
/**
 * Where the energy goes, by group: the site report's breakdown (top-level groups in their saved order, each with its
 * kWh on an average day and its share of the whole site, adding up to 100%). A group opens onto the groups inside it,
 * each with its own kWh and share of the whole site, so they add up to the group's share. Each group is a button that
 * says whether it is open; the bars are decoration only, so a screen reader hears the name, the kWh and the share.
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

/** `title` replaces "Where it goes"; `note` is an optional line under it saying what the numbers are. */
export function GroupSplit({ rows, title, note, look = OVERVIEW_LOOK }: { rows: BreakdownRow[]; title?: string | undefined; note?: string | undefined; look?: GroupSplitLook }) {
  const t = useMessages(keyPointsMessages);
  const id = React.useId();
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string) => setOpen(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  // One scale for every bar, so the groups inside a group visibly add up to it.
  const scale = Math.max(0.001, ...rows.map(row => row.share));
  // Whole percentages that add up: the top-level groups to 100%, the groups inside one to its own share.
  const value = (row: BreakdownRow) => row.perDay == null ? `${row.pct}%` : t("splitValue", { kwh: kwhText(row.perDay), pct: `${row.pct}%` });
  const parts = (row: BreakdownRow, inner: boolean) => <>
    <span className={(inner ? look.innerName : undefined) ?? look.name}>{row.name}</span>
    <span className={look.bar} aria-hidden="true"><i className={(inner ? look.innerFill : undefined) ?? look.fill} style={{ width: `${Math.min(1, row.share / scale) * 100}%` }} /></span>
    <span className={look.value}>{value(row)}</span>
  </>;
  return <section className={look.section} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className={look.heading}>{title ?? t("splitTitle")}</h3>
    {note && <p className={look.note}>{note}</p>}
    <ul className={look.list}>{rows.map((row, index) => {
      const listId = `${id}-group-${index}`;
      const expanded = open.has(row.key);
      return <li key={row.key}>
        {row.rows.length ? <button type="button" className={look.button ?? look.row} aria-expanded={expanded} aria-controls={listId} onClick={() => toggle(row.key)}>
          {parts(row, false)}<span className={look.chevron} aria-hidden="true" />
        </button> : <div className={look.row}>{parts(row, false)}<span aria-hidden="true" /></div>}
        {row.rows.length > 0 && <ul id={listId} className={look.inner} hidden={!expanded} aria-label={t("splitInside", { name: row.name })}>
          {row.rows.map(child => <li key={child.key}><div className={look.innerRow ?? look.row}>{parts(child, true)}<span aria-hidden="true" /></div></li>)}
        </ul>}
      </li>;
    })}</ul>
    {rows.some(row => row.rows.length > 0) && <p className={look.hint}>{t("splitHint")}</p>}
  </section>;
}
