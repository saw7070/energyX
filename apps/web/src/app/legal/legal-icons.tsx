import type { SVGProps } from "react";

/** Small line icons for the public trust pages, kept apart from the app's icon set so these pages stay standalone. */
export type LegalIconName = "shield" | "document" | "handshake" | "gauge" | "lock" | "spark" | "server" | "backup" | "key" | "users" | "mail" | "arrow" | "check" | "globe";

export function LegalIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: LegalIconName }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, width: 20, height: 20, ...props };
  switch (name) {
    case "shield": return <svg {...common}><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3z" /><path d="m9 12 2 2 4-4" /></svg>;
    case "document": return <svg {...common}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
    case "handshake": return <svg {...common}><path d="m11 17 2 2a1.4 1.4 0 0 0 2-2" /><path d="m14 14 2.5 2.5a1.4 1.4 0 0 0 2-2L15 11l-1.5 1.5a2 2 0 0 1-2.8-2.8L13 7.5h-2L6.5 12" /><path d="M3 11.5 6.5 8 10 7.5M21 11.5 17.5 8" /></svg>;
    case "gauge": return <svg {...common}><path d="M4.5 18a9 9 0 1 1 15 0" /><path d="m12 13 4-4" /><circle cx="12" cy="13" r="1.2" /></svg>;
    case "lock": return <svg {...common}><rect x="5" y="10.5" width="14" height="10" rx="2.2" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3M12 15v2" /></svg>;
    case "spark": return <svg {...common}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>;
    case "server": return <svg {...common}><rect x="4" y="4" width="16" height="7" rx="1.8" /><rect x="4" y="13" width="16" height="7" rx="1.8" /><path d="M8 7.5h.01M8 16.5h.01" /></svg>;
    case "backup": return <svg {...common}><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 4v4h4M12 8v4l3 2" /></svg>;
    case "key": return <svg {...common}><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2M14 9l2 2" /></svg>;
    case "users": return <svg {...common}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6" /></svg>;
    case "mail": return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2.2" /><path d="m4 7 8 6 8-6" /></svg>;
    case "arrow": return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "check": return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
    case "globe": return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.8 3.5 5.8 3.5 9s-1 6.2-3.5 9c-2.5-2.8-3.5-5.8-3.5-9s1-6.2 3.5-9z" /></svg>;
  }
}

/** Which icon and group each document belongs to on the trust pages. */
export const DOCUMENT_META: Record<string, { icon: LegalIconName; group: "policies" | "assurance"; tone: "green" | "teal" | "blue" | "violet" | "amber" }> = {
  "privacy": { icon: "shield", group: "policies", tone: "green" },
  "terms": { icon: "document", group: "policies", tone: "blue" },
  "data-processing": { icon: "handshake", group: "policies", tone: "teal" },
  "ai-use": { icon: "spark", group: "policies", tone: "violet" },
  "security": { icon: "lock", group: "assurance", tone: "green" },
  "service-levels": { icon: "gauge", group: "assurance", tone: "amber" },
};
