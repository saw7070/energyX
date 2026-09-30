"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./report-workbench.module.css";
import { useMessages } from "./energyiq-locale";
import { previewMessages } from "./report-library-messages";

// Only labelled machine identifiers are omitted; measurement values and filenames stay intact.
export function readableReportText(value: string) {
  return value.replace(/\b(run[_ -]?id|file[_ -]?hash|sha-?256)(?:\*\*|`)?\s*[:=]\s*`?([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{32,64})`?/gi, "$1: internal reference");
}
export function ReportMarkdown({ children }: { children: string }) {
  const t = useMessages(previewMessages);
  return <div data-safe-ai-markdown="true" className={styles.markdown}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml allowedElements={["p","br","strong","em","h1","h2","h3","h4","ul","ol","li","blockquote","code","pre","hr","table","thead","tbody","tr","th","td","del"]} unwrapDisallowed components={{table: ({children}) => <div className={styles.markdownTable} role="region" aria-label={t("analysisTable")} tabIndex={0}><table>{children}</table></div>}}>{readableReportText(children)}</ReactMarkdown></div>;
}
