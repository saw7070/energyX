import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { applyFailure } from "./project-setup-workbench";

const source = readFileSync(new URL("./project-setup-workbench.tsx", import.meta.url), "utf8");
const saveDraft = source.slice(source.indexOf("const saveDraft = useCallback"), source.indexOf("const validateDraft = useCallback"));

it("applies a saved setup change straight away, like the Facility page", () => {
  expect(saveDraft).toContain("configApi.applyEnergyProjectChanges(selectedProjectId)");
  expect(saveDraft).toContain("Saved. Live for everyone now.");
  // The old two-step wording promised the opposite of what the page now does.
  expect(source).not.toContain("Draft saved. Customer-facing pages are unchanged until Publish.");
  expect(source).not.toContain("Final customer publication still happens in Review & Publish.");
  expect(source).toContain("Save &amp; apply");
  expect(source).not.toContain('"Saved draft"');
});

it("keeps a saved change visible when it could not be applied, and says why", () => {
  expect(applyFailure(new Error("ENERGYIQ_PROJECT_SETUP_INVALID:LOCATION_WITHOUT_METER,DUPLICATE_ROUTE")))
    .toBe("Saved, but not applied yet: LOCATION_WITHOUT_METER, DUPLICATE_ROUTE. Fix that and save again.");
  expect(applyFailure(new Error("FORBIDDEN"))).toBe("Saved, but only a platform administrator can apply it.");
  expect(applyFailure(new Error("ENERGYIQ_DATA_NOT_READY"))).toBe("Saved, but not applied yet: this project has no readings to publish.");
  expect(applyFailure(new Error("REVISION_CONFLICT"))).toContain("someone else changed this project");
  expect(applyFailure("boom")).toBe("Saved, but could not be applied. Try saving again.");
});
