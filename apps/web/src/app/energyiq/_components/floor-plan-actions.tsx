"use client";
import { useMessages } from "./energyiq-locale";
import { floorPlanMessages } from "./floor-plan-messages";
import styles from "./floor-plan-editor.module.css";

/**
 * The shared actions for what is selected: Duplicate, Lock, Bring to front and Send to back. An action that does not
 * apply (nothing to copy, already in front) is left out or greyed out.
 */
export function ArrangeActions({ onDuplicate, duplicateKey, locked, many, onLock, order, onFront, onBack }: { onDuplicate?: () => void; duplicateKey: string; locked: boolean; many: boolean; onLock?: () => void; order: boolean; onFront?: () => void; onBack?: () => void }) {
  const t = useMessages(floorPlanMessages);
  const lockLabel = locked ? (many ? t("panel.unlockAll") : t("panel.unlock")) : (many ? t("panel.lockAll") : t("panel.lock"));
  return <div className={styles.arrange} role="group" aria-label={t("panel.arrange")}>
    <div className={styles.arrangeRow}>
      {onDuplicate && <button type="button" className={styles.tool} title={t("panel.duplicateHint", { duplicateKey })} onClick={onDuplicate}>{t("panel.duplicate")}</button>}
      {onLock && <button type="button" className={styles.tool} aria-pressed={locked} onClick={onLock}>{lockLabel}</button>}
    </div>
    {order && <div className={styles.arrangeRow} title={t("panel.orderHint")}>
      <button type="button" className={styles.tool} disabled={!onFront} onClick={onFront}>{t("panel.front")}</button>
      <button type="button" className={styles.tool} disabled={!onBack} onClick={onBack}>{t("panel.back")}</button>
    </div>}
    {locked && <p className={styles.hint}>{t("panel.lockedNote")}</p>}
  </div>;
}
