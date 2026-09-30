import { describe, expect, it } from "vitest";

import {
  AI_SLOT_HTML_ARTIFACT_CONTRACT,
  PRESCHOOL_HTML_AI_SLOT_IDS,
  acceptAiSlotHtmlArtifact,
  type AiSlotHtmlArtifactIdentity,
} from "./energyiq-ai-slot-html.js";

const identity: AiSlotHtmlArtifactIdentity = {
  workspaceId: "preschool-workspace",
  projectId: "preschool-demo",
  scopeId: "preschool-project",
  dataSnapshotId: "snapshot-june",
  projectReleaseId: "preschool-release-v4",
  analysisPeriod: { from: "2026-05-31T16:00:00.000Z", to: "2026-06-30T16:00:00.000Z" },
  modelProfileId: "workspace-default",
  modelProfileRevision: 4,
  promptRevision: "preschool-html-slot-prompt@15",
  slotDefinitionRevision: "preschool-centre-benchmark-html@3",
};

const candidate = (overrides: Record<string, unknown> = {}) => ({
  contract: AI_SLOT_HTML_ARTIFACT_CONTRACT,
  slotId: "centre-benchmark",
  identity,
  evidenceRefs: ["evidence:centre:g", "evidence:centre:h"],
  preferredHeightPx: 420,
  html: "<section><h2>Centre comparison</h2><table><caption>Verified figures</caption><tbody><tr><th>Centre G</th><td>74 kWh</td></tr></tbody></table><details><summary>Why</summary><p>Verified comparison.</p></details></section>",
  ...overrides,
});

describe("AI Slot HTML Artifact", () => {
  it("publishes one canonical ordered ID set for the six Preschool HTML Slots", () => {
    expect(PRESCHOOL_HTML_AI_SLOT_IDS).toEqual([
      "executive-summary",
      "centre-benchmark",
      "standby-wastage",
      "operating-behaviour",
      "planning-outlook",
      "additional-insight",
    ]);
  });

  it("accepts static semantic HTML, tables and native details under an exact identity", () => {
    const result = acceptAiSlotHtmlArtifact({
      candidate: candidate(),
      expected: { slotId: "centre-benchmark", identity },
      allowedEvidenceRefs: ["evidence:centre:g", "evidence:centre:h"],
    });
    expect(result).toMatchObject({ accepted: true });
    if (result.accepted) {
      expect(result.artifact.accessibleText).toContain("Centre comparison");
      expect(result.artifact.accessibleText).toContain("Verified comparison.");
    }
  });

  it("accepts a semantic main wrapper with a visible table caption", () => {
    const result = acceptAiSlotHtmlArtifact({
      candidate: candidate({
        html: '<main><table><caption>Visible comparison</caption><tbody><tr><th>Centre G</th><td>74 kWh</td></tr></tbody></table></main>',
      }),
      expected: { slotId: "centre-benchmark", identity },
      allowedEvidenceRefs: ["evidence:centre:g", "evidence:centre:h"],
    });
    expect(result).toMatchObject({ accepted: true });
  });

  it("accepts a model H1 as the visible heading inside the isolated Slot document", () => {
    expect(acceptAiSlotHtmlArtifact({
      candidate: candidate({
        slotId: "executive-summary",
        html: '<section><h1>Executive summary</h1><p data-fact-ids="evidence:centre:g">Centre G: 74 kWh.</p></section>',
      }),
      expected: { slotId: "executive-summary", identity },
      allowedEvidenceRefs: ["evidence:centre:g", "evidence:centre:h"],
    })).toMatchObject({ accepted: true });
  });

  it.each([
    "<script>parent.document.body.remove()</script>",
    "<button onclick=\"fetch('/secret')\">Run</button>",
    "<a href=\"#other-slot\">Navigate</a>",
    "<img src=\"https://example.test/pixel\">",
    "<img srcset=\"https://example.test/pixel 1x\">",
    "<img imagesrcset=\"https://example.test/pixel 1x\">",
    "<img srcset=\"data:image/png;base64,AAAA 1x https://example.test/pixel 2x\">",
    "<img src=\"h&#x74;ttps://example.test/pixel\">",
    "<style>.x{background:url(https://example.test/x)}</style>",
    "<style>.x{background: u\\72l(https://example.test/x)}</style>",
    "<style>.x::before { content: \"999 kWh\"; }</style>",
    "<style>.x{\\63ontent: \"999 kWh\";}</style>",
    "<style>.x{\\63 ontent: \"999 kWh\";}</style>",
    "<style>/* comment */ .x{\\63 ontent: \"999 kWh\";}</style>",
    "<div style=\"content: '999 kWh'\"></div>",
    "<div style=\"\\63ontent: '999 kWh'\"></div>",
    "<div style=\"content&amp;colon; '999 kWh'\"></div>",
    "<div style=\"/* comment */ content&amp;colon; '999 kWh'\"></div>",
    "<div style=\"&amp;#92;63 ontent: '999 kWh'\"></div>",
    "<style>.x { &amp;#92;63 ontent: '999 kWh'; }</style>",
    "<div style=\"&amp;bsol;63 ontent: '999 kWh'\"></div>",
    "<style>.x { &amp;bsol;63 ontent: '999 kWh'; }</style>",
    "<img src=\"#\" alt=\"999 kWh\">",
    "<img src=\"data:image/png;base64,AAAA\" alt=\"999 kWh\">",
    "<svg role=\"img\"><text>999 kWh</text></svg>",
    "<svg viewBox=\"0 0 100 20\"><rect width=\"10\" height=\"8\" /></svg>",
    "<svg role=\"img\"><foreignObject><p>999 kWh</p></foreignObject></svg>",
    "<form action=\"/submit\"><input name=\"x\"></form>",
    "<article><template>Portfolio P75 EUI:</template><strong>138.8 kWh</strong></article>",
    "<article><dialog>Portfolio P75 EUI:</dialog><strong>138.8 kWh</strong></article>",
    "<article><canvas>Portfolio P75 EUI:</canvas><strong>138.8 kWh</strong></article>",
    "<article><font color=\"#fff\">Portfolio P75 EUI:</font><strong>138.8 kWh</strong></article>",
    "<table bgcolor=\"#fff\"><tr><td>138.8 kWh</td></tr></table>",
    '<svg role="img" aria-label="999 kWh"><rect width="10" height="10" /></svg>',
    '<svg role="img" aria-labelledby="missing"><rect width="10" height="10" /></svg>',
    '<svg role="img" aria-describedby="closed"><rect width="10" height="10" /></svg><details><span id="closed">Hidden description</span></details>',
    '<p title="999 kWh">Visible fact</p>',
    '<table role="button"><tr><td>138.8 kWh</td></tr></table>',
    '<table role="none"><tr><td>138.8 kWh</td></tr></table>',
    '<p role="button">View details</p>',
  ])("rejects unsafe HTML: %s", (html) => {
    expect(acceptAiSlotHtmlArtifact({
      candidate: candidate({ html }),
      expected: { slotId: "centre-benchmark", identity },
      allowedEvidenceRefs: ["evidence:centre:g", "evidence:centre:h"],
    })).toEqual({ accepted: false, reason: "AI_SLOT_HTML_UNSAFE" });
  });

  it.each([
    '<article style="display:none"><strong>999 kWh</strong></article>',
    '<article style="visibility:hidden"><strong>999 kWh</strong></article>',
    '<article style="opacity:0"><strong>999 kWh</strong></article>',
    '<article style="opacity:0 !important"><strong>999 kWh</strong></article>',
    '<article style="font-size:0"><strong>999 kWh</strong></article>',
    '<article style="font-size:0px !important"><strong>999 kWh</strong></article>',
    '<article hidden><strong>999 kWh</strong></article>',
    '<article aria-hidden="true"><strong>999 kWh</strong></article>',
    '<style>.hidden { display: none; }</style><article class="hidden"><strong>999 kWh</strong></article>',
    '<style>.hidden { font-size: 0em !important; }</style><article class="hidden"><strong>999 kWh</strong></article>',
    '<article style="display:none !important"><strong>999 kWh</strong></article>',
    '<article style="display:var(--slot-display)"><strong>999 kWh</strong></article>',
    '<article style="visibility:var(--slot-visibility)"><strong>999 kWh</strong></article>',
    '<article style="transform:scale(0e0)"><strong>999 kWh</strong></article>',
    '<article style="filter:opacity(0%)"><strong>999 kWh</strong></article>',
    '<article style="font:0/0 serif"><strong>999 kWh</strong></article>',
    '<article style="clip-path:inset(100%)"><strong>999 kWh</strong></article>',
    '<article style="overflow:hidden;height:0"><strong>999 kWh</strong></article>',
    '<article style="scale:0"><strong>999 kWh</strong></article>',
    '<article style="zoom:0"><strong>999 kWh</strong></article>',
    '<article style="content-visibility:hidden"><strong>999 kWh</strong></article>',
    '<article style="-webkit-transform:scale(0)"><strong>999 kWh</strong></article>',
    '<article style="position:absolute;left:-9999px"><strong>999 kWh</strong></article>',
    '<article style="color:#fff;background:#fff"><strong>999 kWh</strong></article>',
    '<article style="opacity:0.0001"><strong>999 kWh</strong></article>',
    '<article style="font-size:0.01px"><strong>999 kWh</strong></article>',
    '<article style="letter-spacing:-100px"><strong>999 kWh</strong></article>',
    '<article style="line-height:0.001"><strong>999 kWh</strong></article>',
    '<article style="max-height:0.0001px"><strong>999 kWh</strong></article>',
  ])("rejects hidden claim surfaces: %s", (html) => {
    expect(acceptAiSlotHtmlArtifact({
      candidate: candidate({ html }),
      expected: { slotId: "centre-benchmark", identity },
      allowedEvidenceRefs: ["evidence:centre:g", "evidence:centre:h"],
    })).toEqual({ accepted: false, reason: "AI_SLOT_HTML_UNSAFE" });
  });

  it("rejects model-controlled CSS even when individual values look visible", () => {
    expect(acceptAiSlotHtmlArtifact({
      candidate: candidate({
        html: '<article style="display:grid;visibility:visible;content-visibility:visible;opacity:1;font-size:14px;line-height:1.4;transform:none;-webkit-transform:none;scale:1;zoom:1;filter:none;clip-path:none;overflow:visible;height:auto;left:auto"><strong>Verified comparison.</strong></article>',
      }),
      expected: { slotId: "centre-benchmark", identity },
      allowedEvidenceRefs: ["evidence:centre:g", "evidence:centre:h"],
    })).toEqual({ accepted: false, reason: "AI_SLOT_HTML_UNSAFE" });
  });

  it("fails closed on unknown evidence and stale identity", () => {
    expect(acceptAiSlotHtmlArtifact({
      candidate: candidate({ evidenceRefs: ["evidence:unknown"] }),
      expected: { slotId: "centre-benchmark", identity },
      allowedEvidenceRefs: ["evidence:centre:g", "evidence:centre:h"],
    })).toEqual({ accepted: false, reason: "AI_SLOT_HTML_EVIDENCE_INVALID" });
    expect(acceptAiSlotHtmlArtifact({
      candidate: candidate(),
      expected: { slotId: "centre-benchmark", identity: { ...identity, dataSnapshotId: "snapshot-new" } },
      allowedEvidenceRefs: ["evidence:centre:g", "evidence:centre:h"],
    })).toEqual({ accepted: false, reason: "AI_SLOT_HTML_IDENTITY_MISMATCH" });
  });

  it("fails closed when the current report-time context changes", () => {
    const currentIdentity = {
      ...identity,
      reportTimePolicyId: "preschool-overview-time",
      reportTimePolicyRevision: "v1",
      reportTimeContextFingerprint: "fingerprint-a",
    };
    expect(acceptAiSlotHtmlArtifact({
      candidate: candidate({ identity: currentIdentity }),
      expected: {
        slotId: "centre-benchmark",
        identity: { ...currentIdentity, reportTimeContextFingerprint: "fingerprint-b" },
      },
      allowedEvidenceRefs: ["evidence:centre:g", "evidence:centre:h"],
    })).toEqual({ accepted: false, reason: "AI_SLOT_HTML_IDENTITY_MISMATCH" });
  });
});
