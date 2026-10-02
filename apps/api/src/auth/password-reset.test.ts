import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { AuthService } from "./service.js";

const authConfig = {
  mode: "password" as const,
  publicBaseUrl: "http://127.0.0.1:3001",
  sessionSecret: "test-secret-that-is-longer-than-thirty-two-characters",
  emailDelivery: "test" as const
};

describe("Password reset", () => {
  it("never hands the reset link to whoever asked, even with email in test mode", async () => {
    const root = mkdtempSync(join(tmpdir(), "auth-reset-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const auth = new AuthService(metadata, authConfig);
      const invitation = await auth.inviteUser({ email: "member@example.test", inviterUserId: "dev-user" });
      const token = new URL(invitation.invitationUrl ?? "").searchParams.get("invite") ?? "";
      await auth.acceptInvitation({ token, password: "welcome12" });

      const result = await auth.forgotPassword({ email: "member@example.test" });

      expect(result).toEqual({ ok: true });
      // The link goes to the server log for whoever runs the server, and it works there.
      const line = log.mock.calls.map((call) => String(call[0])).find((text) => text.includes("password-reset link"));
      const resetToken = new URL(line?.split(": ").at(-1) ?? "http://x").searchParams.get("reset") ?? "";
      expect(resetToken).not.toBe("");
      await auth.resetPassword({ token: resetToken, password: "changed12" });
      await expect(auth.login({ email: "member@example.test", password: "changed12" })).resolves.toMatchObject({ persistent: true });
    } finally {
      log.mockRestore();
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
