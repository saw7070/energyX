import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Resolved from this file, so the test passes whether vitest runs from apps/web or from the repository root.
const source = () => readFileSync(new URL("./settings-client.tsx", import.meta.url), "utf8");

describe("EnergyX settings", () => {
  it("separates editable profile data from read-only access assignments", () => {
    const file = source();

    expect(file).toContain('title="Profile"');
    expect(file).toContain('title="Company & projects"');
    expect(file).toContain('title="Security"');
    expect(file).toContain("Your access is assigned by an EnergyX administrator");
    expect(file).toContain("updateProfile({ displayName: nextName, avatarUrl })");
  });

  it("resizes supported avatar images before saving them", () => {
    const file = source();

    expect(file).toContain("createImageBitmap(file)");
    expect(file).toContain('canvas.toDataURL("image/webp", 0.82)');
    expect(file).toContain("MAX_AVATAR_INPUT_BYTES");
  });
});
