"use client";

import React from "react";
import {
  acceptAiSlotHtmlArtifact,
  type AiSlotHtmlArtifactIdentity,
} from "@datafoundry/contracts";

const AI_SLOT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; media-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
const AI_SLOT_HTML_FRAME_CLASS = "ai-slot-html-frame block h-[min(70vh,560px)] min-h-[320px] max-h-[720px] w-full overflow-auto sm:h-[min(65vh,640px)] lg:h-[min(55vh,720px)]";

export function SandboxedAiSlotHtml({
  candidate,
  expected,
  allowedEvidenceRefs,
  fallback,
  title,
}: {
  candidate: unknown;
  expected: { slotId: string; identity: AiSlotHtmlArtifactIdentity };
  allowedEvidenceRefs: readonly string[];
  fallback: React.ReactNode;
  title: string;
}) {
  const acceptance = acceptAiSlotHtmlArtifact({ candidate, expected, allowedEvidenceRefs });
  if (!acceptance.accepted) return <div data-ai-slot-html-rejection={acceptance.reason}>{fallback}</div>;
  return (
    <iframe
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      loading="lazy"
      srcDoc={buildAiSlotSandboxDocument(acceptance.artifact.html, title)}
      className={AI_SLOT_HTML_FRAME_CLASS}
      style={{ width: "100%", border: 0, display: "block", background: "transparent" }}
      data-ai-slot-html={acceptance.artifact.slotId}
      data-ai-slot-height-contract="bounded-scroll-width-bucket"
    />
  );
}

export const buildAiSlotSandboxDocument = (html: string, title: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${AI_SLOT_CSP}">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #283548;
      background: transparent;
      --slot-ink-strong: #101828;
      --slot-ink-muted: #5d6b7d;
      --slot-accent: #0f766e;
      --slot-accent-soft: #e8f5f2;
      --slot-rule: #dce3ea;
      --slot-surface: #f7f9fb;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-width: 0; min-height: 100%; background: transparent; }
    body { padding: 12px 14px 18px; font-size: 15px; line-height: 1.62; overflow: auto; overflow-wrap: anywhere; }
    .ai-slot-html-content { width: 100%; max-width: none; margin-inline: 0; overflow-x: auto; overflow-y: hidden; }
    article, section { display: flow-root; min-width: 0; }
    article > :first-child, section > :first-child { margin-top: 0; }
    article > :last-child, section > :last-child { margin-bottom: 0; }
    section + section { margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--slot-rule); }
    h2, h3 { color: var(--slot-ink-strong); line-height: 1.2; text-wrap: balance; }
    h2 { font-size: clamp(1.25rem, 3vw, 1.75rem); letter-spacing: -0.025em; margin: 0 0 12px; }
    h3 { font-size: clamp(1rem, 2vw, 1.15rem); letter-spacing: -0.012em; margin: 24px 0 8px; }
    p { margin: 0 0 12px; max-width: 72ch; }
    strong { color: var(--slot-ink-strong); font-weight: 700; font-variant-numeric: tabular-nums; }
    ul, ol { margin: 10px 0 16px; padding-inline-start: 1.35rem; }
    li { padding-inline-start: 0.25rem; }
    li + li { margin-top: 8px; }
    li::marker { color: var(--slot-accent); font-weight: 700; }
    blockquote { margin: 18px 0; padding: 10px 0 10px 16px; border-left: 1px solid var(--slot-accent); color: var(--slot-ink-strong); font-weight: 600; }
    mark { border-radius: 4px; padding: 0.08em 0.28em; color: var(--slot-ink-strong); background: var(--slot-accent-soft); }
    figure { margin: 20px 0; padding-block: 16px; border-block: 1px solid var(--slot-rule); }
    figcaption { margin-top: 8px; color: var(--slot-ink-muted); font-size: 0.82rem; line-height: 1.45; }
    table { width: max-content !important; min-width: 100% !important; max-width: none !important; margin: 18px 0; border-collapse: collapse; font-size: 0.88rem; font-variant-numeric: tabular-nums; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--slot-rule); text-align: left; vertical-align: top; }
    th { color: var(--slot-ink-strong); background: var(--slot-surface); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.02em; }
    tbody tr:last-child td { border-bottom-color: transparent; }
    details { margin: 18px 0 0; border-top: 1px solid var(--slot-rule); }
    summary { padding: 12px 2px; color: var(--slot-ink-strong); cursor: pointer; font-weight: 650; }
    summary::marker { color: var(--slot-accent); }
    summary:focus-visible { border-radius: 4px; outline: 3px solid #99f6e4; outline-offset: 2px; }
    details[open] > summary { margin-bottom: 8px; }
    @media (max-width: 480px) {
      body { padding: 10px 12px 16px; font-size: 14px; }
      h2 { font-size: 1.25rem; }
      h3 { margin-top: 20px; }
      th, td { padding: 9px 10px; }
    }
    @media (forced-colors: active) {
      blockquote, figure, details, th, td { border-color: CanvasText; }
      summary:focus-visible { outline-color: Highlight; }
    }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
  </style>
</head>
<body><div class="ai-slot-html-content">${html}</div></body>
</html>`;

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
