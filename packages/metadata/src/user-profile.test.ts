import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("UserRepository profile", () => {
  it("persists display name and avatar updates", () => {
    const root = mkdtempSync(join(tmpdir(), "user-profile-"));
    const databasePath = join(root, "metadata.sqlite");
    try {
      const metadata = createMetadataStore({ database_path: databasePath });
      metadata.users.upsertDevUser({
        id: "profile-user",
        email: "profile@example.com",
        display_name: "Original name",
        dev_token: "profile-token",
      });

      const updated = metadata.users.updateProfile({
        user_id: "profile-user",
        display_name: "Updated name",
        avatar_url: "data:image/webp;base64,YXZhdGFy",
      });

      expect(updated).toMatchObject({
        display_name: "Updated name",
        avatar_url: "data:image/webp;base64,YXZhdGFy",
      });
      metadata.close();

      const reopened = createMetadataStore({ database_path: databasePath });
      expect(reopened.users.getById({ user_id: "profile-user" })).toMatchObject({
        display_name: "Updated name",
        avatar_url: "data:image/webp;base64,YXZhdGFy",
      });
      reopened.close();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
