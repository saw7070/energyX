import { describe, expect, it } from "vitest";

import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";
import {
  PRESCHOOL_HTML_AI_SLOT_PREVIEW_PROFILE_ID,
  buildPreschoolHtmlAiSlotPreview,
} from "./preschool-html-ai-slot-preview";

describe("Preschool HTML AI Slot preview fixtures", () => {
  it("builds six visibly non-model preview artifacts with the current Snapshot identity", () => {
    const snapshot = preschoolGoldenSnapshot();
    const slots = buildPreschoolHtmlAiSlotPreview(snapshot);
    const slotIds = [
      "executive-summary",
      "centre-benchmark",
      "standby-wastage",
      "operating-behaviour",
      "planning-outlook",
      "additional-insight",
    ] as const;

    expect(Object.keys(slots)).toEqual([...slotIds]);
    for (const slotId of slotIds) {
      const slot = slots[slotId];
      expect(slot?.expectedIdentity.modelProfileId).toBe(PRESCHOOL_HTML_AI_SLOT_PREVIEW_PROFILE_ID);
      expect(slot?.expectedIdentity.dataSnapshotId).toBe(snapshot.dataSnapshot.id);
      expect(slot?.candidate).toMatchObject({
        contract: "energyiq-ai-slot-html-artifact@1",
        slotId,
      });
      expect(String(slot?.candidate && typeof slot.candidate === "object" && "html" in slot.candidate
        ? slot.candidate.html
        : "")).toContain("Preview fixture · not model output");
      expect(String(slot?.candidate && typeof slot.candidate === "object" && "html" in slot.candidate
        ? slot.candidate.html
        : "")).not.toMatch(/<style\b|\sstyle\s*=/iu);
    }
  });
});
