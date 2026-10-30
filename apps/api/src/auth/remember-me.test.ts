import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { appendAuthCookies } from "./cookies.js";
import { AuthService } from "./service.js";

const authConfig = {
  mode: "password" as const,
  publicBaseUrl: "http://127.0.0.1:3001",
  sessionSecret: "test-secret-that-is-longer-than-thirty-two-characters",
  emailDelivery: "test" as const
};

const cookiesFor = (input: Parameters<typeof appendAuthCookies>[1]): string[] => {
  const headers = new Map<string, unknown>();
  const response = {
    getHeader: (name: string) => headers.get(name),
    setHeader: (name: string, value: unknown) => headers.set(name, value)
  } as unknown as ServerResponse;
  appendAuthCookies(response, input);
  return headers.get("Set-Cookie") as string[];
};

describe("Remember me", () => {
  it("keeps a remembered sign-in for 30 days and limits any other to 12 hours", async () => {
    const root = mkdtempSync(join(tmpdir(), "auth-remember-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      const auth = new AuthService(metadata, authConfig);
      const invitation = await auth.inviteUser({ email: "member@example.test", inviterUserId: "dev-user" });
      const token = new URL(invitation.invitationUrl ?? "").searchParams.get("invite") ?? "";
      await auth.acceptInvitation({ token, password: "plant-room-meter-42" });

      const remembered = await auth.login({ email: "member@example.test", password: "plant-room-meter-42", rememberMe: true });
      expect(remembered).toMatchObject({ persistent: true, maxAgeSeconds: 60 * 60 * 24 * 30 });

      const shortLived = await auth.login({ email: "member@example.test", password: "plant-room-meter-42", rememberMe: false });
      expect(shortLived).toMatchObject({ persistent: false, maxAgeSeconds: 60 * 60 * 12 });

      // "Remember me" is opt-in: a client that does not send the flag gets a sign-in that ends with the browser.
      const unflagged = await auth.login({ email: "member@example.test", password: "plant-room-meter-42" });
      expect(unflagged).toMatchObject({ persistent: false });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("issues browser-session cookies when the sign-in is not remembered", () => {
    const persistent = cookiesFor({ csrfToken: "c", sessionToken: "s", maxAgeSeconds: 100, persistent: true });
    const session = cookiesFor({ csrfToken: "c", sessionToken: "s", maxAgeSeconds: 100, persistent: false });
    expect(persistent.every((cookie) => cookie.includes("Max-Age=100"))).toBe(true);
    expect(session.some((cookie) => cookie.includes("Max-Age"))).toBe(false);
    expect(session).toHaveLength(2);
  });
});
