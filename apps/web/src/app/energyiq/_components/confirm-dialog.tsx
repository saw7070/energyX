"use client";
import { useEffect, useRef } from "react";
import styles from "./confirm-dialog.module.css";

/**
 * Asks before something that cannot be undone. Replaces the browser's own confirm box, which
 * shows the page's address instead of the app and cannot say what will happen in plain words.
 */
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel, destructive = false, busy = false, onConfirm, onCancel }: {
  title: string; body?: string; confirmLabel: string; cancelLabel: string;
  destructive?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2>{title}</h2>
    {body && <p>{body}</p>}
    <div className={styles.actions}>
      <button type="button" className={styles.cancel} disabled={busy} onClick={onCancel}>{cancelLabel}</button>
      <button type="button" autoFocus className={destructive ? styles.destructive : styles.confirm} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </dialog>;
}
