"use client";
import {
  useEffect,
  useRef,
  useState,
  useId,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { EnergyIcon } from "./icons";
export { ReportMarkdown } from "./report-markdown";
import { ReportMarkdown } from "./report-markdown";
import { reportPreviewHtml } from "./report-preview";
import { useMessages } from "./energyiq-locale";
import { previewMessages } from "./report-library-messages";
import styles from "./report-workbench.module.css";
export type FileContent = {
  content: string;
  encoding?: "utf8" | "base64";
  mimeType?: string;
};
export type PreviewFile = {
  id: string;
  title: string;
  filename?: string;
  mimeType: string;
  load: (signal: AbortSignal) => Promise<FileContent>;
};
export function ReportFilePreview({
  file,
  onClose,
  onDiscuss,
  notice,
  actions,
}: {
  file: PreviewFile;
  onClose: () => void;
  onDiscuss?: () => void;
  notice?: string;
  actions?: ReactNode;
}) {
  const t = useMessages(previewMessages);
  const paneId = useId();
  const [wide, setWide] = useState(false);
  const [showActions, setShowActions] = useState(false);
  useEffect(() => setShowActions(false), [file.id]);
  const [data, setData] = useState<FileContent | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mobile, setMobile] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const expand = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement;
  }, [file.id]);
  useEffect(
    () => () => {
      if (opener.current?.isConnected) opener.current.focus();
    },
    [],
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    setSource(false);
    file
      .load(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : t("openFailed"),
          );
      });
    return () => controller.abort();
  }, [file]);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1100px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const modal = mobile || expanded;
  const split = expanded && wide && !!actions;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const focused = element.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;
    if (element.open) element.close();
    if (modal) element.showModal();
    else element.show();
    focused?.focus({ preventScroll: true });
  }, [modal]);
  function navigatePane(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home" ? false : event.key === "End" ? true : !showActions;
    setShowActions(next);
    document
      .getElementById(`${paneId}-${next ? "actions" : "report"}-tab`)
      ?.focus();
  }
  function leaveExpanded() {
    setExpanded(false);
    requestAnimationFrame(() => expand.current?.focus());
  }
  function download() {
    if (!data) return;
    const body =
      data.encoding === "base64"
        ? Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0))
        : file.mimeType === "text/html"
          ? reportPreviewHtml(data.content)
          : data.content;
    const url = URL.createObjectURL(
      new Blob([body], { type: data.mimeType ?? file.mimeType }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename ?? file.title;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const mime = data?.mimeType ?? file.mimeType;
  const image = mime.startsWith("image/");
  const content = (
    <>
      <header className={styles.previewHeader}>
        <div className={styles.previewTabRow}>
          <div className={styles.previewTab}>
            <EnergyIcon name={image ? "analysis" : "document"} />
            <strong title={file.title}>{file.title}</strong>
          </div>
          <div className={styles.previewActions}>
            <button
              disabled={!data}
              title={t("downloadFile")}
              aria-label={t("download")}
              onClick={download}
            >
              <EnergyIcon name="download" />
              <span>{t("download")}</span>
            </button>
            {!mobile && (
              <button
                ref={expand}
                title={expanded ? t("exitFullscreen") : t("expandPreview")}
                aria-label={expanded ? t("exitFullscreen") : t("expand")}
                onClick={() => (expanded ? leaveExpanded() : setExpanded(true))}
              >
                <EnergyIcon name="expand" />
                <span>{expanded ? t("exitFullscreen") : t("expand")}</span>
              </button>
            )}
            <button
              title={t("closePreview")}
              aria-label={t("closePreview")}
              onClick={onClose}
            >
              <EnergyIcon name="close" />
              <span className="sr-only">{t("close")}</span>
            </button>
          </div>
        </div>
        <div className={styles.previewNavigation}>
          {!image && (!actions || split || !showActions) && (
            <div className={styles.previewModes}>
              <button aria-pressed={!source} onClick={() => setSource(false)}>
                {t("preview")}
              </button>
              <button aria-pressed={source} onClick={() => setSource(true)}>
                {t("source")}
              </button>
            </div>
          )}
          {actions && !split && (
            <div
              className={styles.previewWorkspaceTabs}
              role="tablist"
              aria-label={t("reportWorkspace")}
            >
              <button
                id={`${paneId}-report-tab`}
                role="tab"
                aria-selected={!showActions}
                aria-controls={`${paneId}-report`}
                tabIndex={!showActions ? 0 : -1}
                onClick={() => setShowActions(false)}
                onKeyDown={navigatePane}
              >
                {t("report")}
              </button>
              <button
                id={`${paneId}-actions-tab`}
                role="tab"
                aria-selected={showActions}
                aria-controls={`${paneId}-actions`}
                tabIndex={showActions ? 0 : -1}
                onClick={() => setShowActions(true)}
                onKeyDown={navigatePane}
              >
                {t("actions")}
              </button>
            </div>
          )}
          {onDiscuss && (
            <button
              onClick={() => {
                onDiscuss();
                if (modal) onClose();
              }}
            >
              {t("discuss")}
            </button>
          )}
          <span className={styles.previewFormat}>
            {mime === "text/html"
              ? t("formatHtml")
              : mime === "text/markdown"
                ? t("formatMarkdown")
                : image
                  ? t("formatImage")
                  : t("formatFile")}
          </span>
        </div>
        {notice && (
          <p role="status" className={styles.previewNotice}>
            {notice}
          </p>
        )}
      </header>
      <div
        className={`${styles.previewWorkspace} ${split ? styles.previewSplit : ""}`}
        data-layout={split ? "split" : "tabs"}
      >
        <section
          id={`${paneId}-report`}
          className={styles.previewReportPane}
          role={actions && !split ? "tabpanel" : "region"}
          aria-label={t("report")}
          onFocusCapture={() => {
            if (split) setShowActions(false);
          }}
          hidden={!!actions && !split && showActions}
        >
          <div className={styles.previewBody}>
            {error ? (
              <p role="alert">{error}</p>
            ) : !data ? (
              <p role="status">{t("loadingFile")}</p>
            ) : source ? (
              <pre>{data.content}</pre>
            ) : mime === "text/html" ? (
              <iframe
                title={t("htmlPreview")}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                srcDoc={reportPreviewHtml(data.content)}
              />
            ) : image ? (
              <img
                alt={file.title}
                src={
                  data.encoding === "base64"
                    ? `data:${mime};base64,${data.content}`
                    : `data:${mime},${encodeURIComponent(data.content)}`
                }
              />
            ) : mime === "text/markdown" ? (
              <ReportMarkdown>
                {data.content.replace(
                  /^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/,
                  "",
                )}
              </ReportMarkdown>
            ) : (
              <pre>{data.content}</pre>
            )}
          </div>
        </section>
        {actions && (
          <section
            id={`${paneId}-actions`}
            className={styles.previewActionPane}
            role={!split ? "tabpanel" : "region"}
            aria-label={t("actions")}
            onFocusCapture={() => {
              if (split) setShowActions(true);
            }}
            hidden={!split && !showActions}
          >
            {actions}
          </section>
        )}
      </div>
    </>
  );
  return (
    <aside aria-label={t("reportWorkspace")} className={styles.preview}>
      <dialog
        ref={dialog}
        aria-label={t("filePreview")}
        aria-modal={modal || undefined}
        className={modal ? styles.dialog : styles.inlinePreview}
        onCancel={(e) => {
          e.preventDefault();
          if (expanded && !mobile) leaveExpanded();
          else onClose();
        }}
      >
        {content}
      </dialog>
    </aside>
  );
}
