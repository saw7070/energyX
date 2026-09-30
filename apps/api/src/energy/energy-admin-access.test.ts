import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AuthService } from "../auth/service.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { EnergyAdminAccessService } from "./energy-admin-access.js";
import { resolveEnergyAccessContext } from "./energy-query-context.js";

const authConfig = {
  mode: "password" as const,
  publicBaseUrl: "http://127.0.0.1:3001",
  sessionSecret: "test-secret-that-is-longer-than-thirty-two-characters",
  emailDelivery: "test" as const
};

describe("EnergyAdminAccessService", () => {
  it("creates an Organisation, invites a member, activates the account and revokes it when disabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-admin-access-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const auth = new AuthService(metadata, authConfig);
      const service = new EnergyAdminAccessService(metadata, auth);
      const organisation = service.createOrganisation({
        actorUserId: "dev-user",
        name: "Preschool Demo"
      });
      expect(organisation).toMatchObject({ name: "Preschool Demo", status: "active" });

      const invited = await service.inviteUser({
        actorUserId: "dev-user",
        displayName: "Preschool Manager",
        email: "manager@preschool.demo",
        organisationIds: [organisation.id],
        role: "user"
      });
      expect(invited.user).toMatchObject({
        email: "manager@preschool.demo",
        status: "pending",
        organisationIds: [organisation.id]
      });
      expect(invited.invitationUrl).toContain("/login?invite=");

      const invitationToken = new URL(invited.invitationUrl ?? "").searchParams.get("invite") ?? "";
      const activated = await auth.acceptInvitation({
        token: invitationToken,
        password: "welcome1"
      });
      expect(activated.sessionToken).toBeTruthy();
      expect(service.listUsers().find((user) => user.id === invited.user.id)?.status).toBe("active");

      metadata.energyIq.upsertProject({
        id: "preschool-project",
        workspace_id: organisation.id,
        name: "Preschool Project",
        status: "published"
      });
      const access = resolveEnergyAccessContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: invited.user.id }),
        requestedWorkspaceId: organisation.id,
        env: {}
      });
      expect(access.projects.map((project) => project.id)).toEqual(["preschool-project"]);

      const disabled = service.updateUser({
        actorUserId: "dev-user",
        userId: invited.user.id,
        displayName: "Preschool Manager",
        organisationIds: [organisation.id],
        role: "user",
        disabled: true
      });
      expect(disabled.status).toBe("disabled");
      expect(() => auth.authenticateSession(activated.sessionToken)).toThrow("Authentication required");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("invalidates the previous link when a pending invitation is resent", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-admin-invite-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const auth = new AuthService(metadata, authConfig);
      const service = new EnergyAdminAccessService(metadata, auth);
      const first = await service.inviteUser({
        actorUserId: "dev-user",
        email: "fm@example.com",
        organisationIds: ["default"],
        role: "user"
      });
      const second = await service.resendInvitation({
        actorUserId: "dev-user",
        userId: first.user.id
      });
      const firstToken = new URL(first.invitationUrl ?? "").searchParams.get("invite") ?? "";
      const secondToken = new URL(second.invitationUrl ?? "").searchParams.get("invite") ?? "";
      await expect(auth.acceptInvitation({ token: firstToken, password: "welcome1" }))
        .rejects.toThrow("Token is invalid or expired");
      await expect(auth.acceptInvitation({ token: secondToken, password: "welcome1" }))
        .resolves.toMatchObject({ user: { email: "fm@example.com" } });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("does not leave an orphaned pending user when email delivery is unavailable", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-admin-mail-config-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const auth = new AuthService(metadata, { ...authConfig, emailDelivery: "smtp" });
      const service = new EnergyAdminAccessService(metadata, auth);

      await expect(service.inviteUser({
        actorUserId: "dev-user",
        email: "no-mail@example.com",
        organisationIds: ["default"],
        role: "user"
      })).rejects.toThrow("AUTH_CONFIG_MISSING:SMTP is required.");

      expect(metadata.users.findByEmail({ email: "no-mail@example.com" })).toBeUndefined();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
