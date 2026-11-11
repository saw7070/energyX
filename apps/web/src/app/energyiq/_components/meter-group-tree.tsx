"use client";
/**
 * The nested "energy by group" breakdown: every group with its total and its share of the group above it, down to
 * the meters inside. Shared by the Devices tab and Analysis so both read the same way.
 */
import type { MeterGroupNode } from "@datafoundry/site-report";
import { useMessages } from "./energyiq-locale";
import { meterGroupTreeMessages } from "./meter-group-tree-messages";
import styles from "./meter-group-tree.module.css";

type Props = {
  tree: MeterGroupNode;
  kwh: (value: number) => string;
  /** A share 0–1 as the page words percentages. */
  pct: (share: number) => string;
  /** Opens one meter (Devices); without it meter names are plain text. */
  onOpenMeter?: ((id: string) => void) | undefined;
  /** Groups this deep or shallower start open; deeper ones start folded. */
  openDepth?: number | undefined;
};

export function MeterGroupTree({ tree, kwh, pct, onOpenMeter, openDepth = 1 }: Props) {
  const t = useMessages(meterGroupTreeMessages);
  const largest = (node: MeterGroupNode) => Math.max(0.001, ...node.children.map(child => child.kwh), ...node.meters.map(meter => meter.kwh));
  const bar = (share: number, scale: number) => <span className={styles.bar} aria-hidden="true"><span style={{ width: `${Math.max(1, Math.min(100, share * scale * 100))}%` }} /></span>;
  const level = (node: MeterGroupNode): React.ReactNode => {
    const scale = node.kwh > 0 ? node.kwh / largest(node) : 1;
    return <ul className={styles.level}>
      {node.children.map(group => <li key={group.id} aria-label={t("tree.row", { name: group.name, kwh: kwh(group.kwh), pct: pct(group.share), parent: node.name })}>
        <details open={group.depth <= openDepth}>
          <summary className={styles.row}>
            <span className={styles.name}><strong>{group.name}</strong><small>{group.singleMeter ? t("tree.single") : t("tree.meters", { count: group.meterCount })}</small></span>
            {bar(group.share, scale)}
            <span className={styles.number}>{kwh(group.kwh)}</span>
            <span className={styles.number} title={t("tree.share", { pct: pct(group.share), parent: node.name })}>{pct(group.share)}</span>
          </summary>
          {level(group)}
        </details>
      </li>)}
      {node.meters.map(meter => <li key={meter.id} className={meter.unmetered ? styles.unmetered : styles.meter} aria-label={t("tree.row", { name: meter.unmetered ? meter.name || t("tree.unmetered") : meter.name, kwh: kwh(meter.kwh), pct: pct(meter.share), parent: node.name })}>
        <div className={styles.row}>
          <span className={styles.name} title={meter.fullName ?? meter.name}>
            {onOpenMeter && !meter.unmetered ? <button type="button" className={styles.link} onClick={() => onOpenMeter(meter.id)}>{meter.name}</button> : <span>{meter.unmetered ? meter.name || t("tree.unmetered") : meter.name}</span>}
            {meter.fullName && <small>{meter.fullName}</small>}
          </span>
          {bar(meter.share, scale)}
          <span className={styles.number}>{kwh(meter.kwh)}</span>
          <span className={styles.number}>{pct(meter.share)}</span>
        </div>
      </li>)}
    </ul>;
  };
  return <div className={styles.tree} role="group" aria-label={t("tree.aria")}>{level(tree)}</div>;
}
