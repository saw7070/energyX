"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";

import { SavedAnalysisDetail } from "./saved-analysis-detail";
import { SavedAnalysisHistory } from "./saved-analysis-history";

export function OverviewHistoryDialog({
  projectName,
  selectedAnalysisId,
  onSelect,
  onBackToHistory,
  onClose,
  returnFocusRef,
}: {
  projectName: string;
  selectedAnalysisId: string | null;
  onSelect: (analysisId: string) => void;
  onBackToHistory: () => void;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        if (event.shiftKey) last.focus();
        else first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef?.current?.focus();
    };
  }, [returnFocusRef]);

  return createPortal(
    <div
      data-energyiq-history-overlay="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 print:static print:block print:bg-white print:p-0 sm:p-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        data-energyiq-history-dialog="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby="overview-history-title"
        tabIndex={-1}
        className="flex h-[94vh] w-[96vw] max-w-[1680px] flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl print:h-auto print:w-full print:max-w-none print:overflow-visible print:rounded-none print:shadow-none"
      >
        <header data-print-exclude="true" className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4 lg:px-7">
          <div className="min-w-0">
            <h2 id="overview-history-title" className="text-lg font-semibold tracking-[-0.02em] text-foreground">Analysis history</h2>
            <p className="mt-0.5 truncate text-xs text-muted">{projectName} · saved Overview versions</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-border bg-surface px-3.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          >
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain print:overflow-visible">
          {selectedAnalysisId ? (
            <SavedAnalysisDetail
              analysisId={selectedAnalysisId}
              presentation="dialog"
              onBack={onBackToHistory}
              onAnalysisChange={onSelect}
            />
          ) : (
            <SavedAnalysisHistory presentation="dialog" onSelect={onSelect} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
