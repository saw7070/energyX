"use client";
import { useEffect, useRef, useState } from "react";
import type { PreviewFile, FileContent } from "./report-file-preview";
import { useMessages } from "./energyiq-locale";
import { previewMessages } from "./report-library-messages";
import styles from "./report-workbench.module.css";
export function ReportThumbnail({ file }: { file: PreviewFile }) {
  const t = useMessages(previewMessages);
  const root = useRef<HTMLDivElement>(null); const [visible, setVisible] = useState(false); const [width, setWidth] = useState(211); const [data, setData] = useState<FileContent | null>(null); const [error, setError] = useState(false);
  useEffect(() => { if (!root.current || typeof ResizeObserver === "undefined") return; const observer = new ResizeObserver(entries => { const size = entries[0]?.contentRect.width; if (size) setWidth(size); }); observer.observe(root.current); return () => observer.disconnect(); }, []);
  useEffect(() => { if (!root.current || typeof IntersectionObserver === "undefined") return; const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "100px" }); observer.observe(root.current); return () => observer.disconnect(); }, []);
  useEffect(() => { if (!visible) return; const controller = new AbortController(); file.load(controller.signal).then(value => { if (!controller.signal.aborted) setData(value); }).catch(() => { if (!controller.signal.aborted) setError(true); }); return () => controller.abort(); }, [visible, file.id]);
  const mime = data?.mimeType ?? file.mimeType;
  return <div ref={root} className={styles.thumbnail} aria-hidden="true">{data ? mime === "text/html" ? <iframe style={{ transform: `scale(${width / 880})` }} title={t("thumbnail", { title: file.title })} loading="lazy" tabIndex={-1} sandbox="" referrerPolicy="no-referrer" srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"><meta charset="utf-8">${data.content}`} /> : mime.startsWith("image/") ? <img alt="" loading="lazy" src={data.encoding === "base64" ? `data:${mime};base64,${data.content}` : `data:${mime},${encodeURIComponent(data.content)}`} /> : <pre>{data.content.slice(0,1400)}</pre> : <span>{error ? t("thumbnailUnavailable") : t("loadingThumbnail")}</span>}</div>;
}
