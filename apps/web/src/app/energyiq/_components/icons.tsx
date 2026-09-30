import React, { type SVGProps } from "react";

export type EnergyIconName =
  | "analysis"
  | "document"
  | "attach"
  | "download"
  | "expand"
  | "close"
  | "bell"
  | "code"
  | "explorer"
  | "ask"
  | "map"
  | "bolt"
  | "water"
  | "building"
  | "floor"
  | "meter"
  | "chevron"
  | "calendar"
  | "clock"
  | "sun"
  | "moon"
  | "globe"
  | "monitor"
  | "search"
  | "alert"
  | "check"
  | "spark"
  | "arrow"
  | "info"
  | "send"
  | "plus"
  | "settings"
  | "sidebar"
  | "user";

export function EnergyIcon({
  name,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { name: EnergyIconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
    ...props,
  };

  switch (name) {
    case "document":
      return <svg {...common}><path d="M14 3H5v18h14V8zM14 3v5h5M9 12h6M9 16h6" /></svg>;
    case "attach":
      return <svg {...common}><path d="m9 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8M7 15l8-8" /></svg>;
    case "download":
      return <svg {...common}><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>;
    case "expand":
      return <svg {...common}><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" /></svg>;
    case "close":
      return <svg {...common}><path d="m6 6 12 12M6 18 18 6" /></svg>;
    case "bell":
      return <svg {...common}><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" /></svg>;
    case "code":
      return <svg {...common}><path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18" /></svg>;
    case "analysis":
      return (
        <svg {...common}>
          <path d="M4 19V9" />
          <path d="M10 19V5" />
          <path d="M16 19v-7" />
          <path d="M22 19V3" />
        </svg>
      );
    case "explorer":
      return (
        <svg {...common}>
          <path d="M4 5h6l2 2h8v12H4z" />
          <path d="M8 11h8M8 15h5" />
        </svg>
      );
    case "ask":
      return (
        <svg {...common}>
          <path d="M4 5h16v12H9l-5 4z" />
          <path d="M8 9h8M8 13h5" />
        </svg>
      );
    case "map":
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="5" r="2" />
          <circle cx="19" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
          <path d="m6.5 10.5 4-4M13.5 6.5l4 4M17.5 13.5l-4 4M10.5 17.5l-4-4" />
        </svg>
      );
    case "bolt":
      return (
        <svg {...common}>
          <path d="m13 2-8 12h7l-1 8 8-12h-7z" />
        </svg>
      );
    case "water":
      return (
        <svg {...common}>
          <path d="M12 2s6 6.3 6 12a6 6 0 0 1-12 0c0-5.7 6-12 6-12Z" />
        </svg>
      );
    case "building":
      return (
        <svg {...common}>
          <path d="M4 21V4h11v17M15 9h5v12M8 8h3M8 12h3M8 16h3M18 13h.01M18 17h.01" />
        </svg>
      );
    case "floor":
      return (
        <svg {...common}>
          <path d="m4 8 8-4 8 4-8 4z" />
          <path d="m4 12 8 4 8-4M4 16l8 4 8-4" />
        </svg>
      );
    case "meter":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="m12 12 3-3M8 16h8" />
        </svg>
      );
    case "chevron":
      return (
        <svg {...common}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
      );
    case "sun":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case "moon":
      return (
        <svg {...common}>
          <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
        </svg>
      );
    case "globe":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      );
    case "monitor":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M12 3 2.8 20h18.4z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4z" />
          <path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common}>
          <path d="M5 12h14M14 7l5 5-5 5" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="m22 2-7 20-4-9-9-4zM11 13 22 2" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z" />
        </svg>
      );
    case "sidebar":
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
          <path d="M9.5 4.5v15" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
  }
}
