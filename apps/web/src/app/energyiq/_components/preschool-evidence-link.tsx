"use client";

import React from "react";

const EVIDENCE_ID = "preschool-evidence";

export function PreschoolEvidenceLink({ label }: { label: string }) {
  return (
    <a
      href={`#${EVIDENCE_ID}`}
      className="mt-4 inline-flex text-[10px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      onClick={() => {
        const evidence = document.getElementById(EVIDENCE_ID);
        if (!(evidence instanceof HTMLDetailsElement)) return;
        evidence.open = true;
        evidence.focus();
      }}
    >
      Evidence · {label}
    </a>
  );
}
