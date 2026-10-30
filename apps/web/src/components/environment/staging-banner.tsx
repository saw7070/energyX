"use client";

import { useEffect, useState } from "react";

/** A strip across the top of every page on a staging server, so nobody mistakes it for the real service. */
export function StagingBanner() {
  const [staging, setStaging] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/environment", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((body: { environment?: string } | undefined) => {
        if (!cancelled) setStaging(body?.environment === "staging");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!staging) return null;
  return (
    <div
      role="status"
      style={{
        background: "#b45309",
        color: "#fff",
        font: "600 12px/1.6 system-ui, sans-serif",
        letterSpacing: "0.02em",
        padding: "2px 16px",
        textAlign: "center",
      }}
    >
      Staging: a test copy of EnergyX. Changes here do not affect the real service.
    </div>
  );
}
