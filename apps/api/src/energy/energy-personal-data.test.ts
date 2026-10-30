import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { erasePersonalData, exportPersonalData } from "./energy-personal-data.js";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "personal-data-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  cleanup.push(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });
  metadata.users.createPasswordUser({ id: "admin", email: "admin@platform.test" });
  const person = metadata.users.createPasswordUser({ id: "person", email: "Person@client.test", display_name: "Pat Person" });
  metadata.authSessions.create({
    id: "s-1", user_id: "person", token_hash: "secret-hash", csrf_token_hash: "csrf-hash",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(), ip_address: "203.0.113.9", user_agent: "Browser"
  });
  metadata.authAuditEvents.append({ id: "a-1", event_type: "auth.login_succeeded", user_id: "person", email: "Person@client.test", ip_address: "203.0.113.9" });
  metadata.sessions.create({ user_id: "person", id: "chat-1", title: "Why is Level 6 high?" });
  return { metadata, person };
};

describe("personal data requests", () => {
  it("exports what is held about a person without secrets", () => {
    const { metadata } = fixture();
    const exported = exportPersonalData(metadata, "person");
    expect(exported.records.users?.[0]).toMatchObject({ id: "person", email: "person@client.test", display_name: "Pat Person" });
    expect(exported.records.auth_sessions?.[0]).toMatchObject({ id: "s-1", ip_address: "203.0.113.9" });
    expect(JSON.stringify(exported)).not.toContain("secret-hash");
    expect(exported.records.sessions?.map((row) => row.title)).toEqual(["Why is Level 6 high?"]);
    expect(exported.records.auth_audit_events).toHaveLength(1);
  });

  it("erases a person's sign-in, conversations and identifying details but keeps an anonymous audit trail", () => {
    const { metadata } = fixture();
    const result = erasePersonalData({ metadataStore: metadata, actorUserId: "admin", userId: "person", confirmEmail: "person@client.test", env: {} });
    expect(result.conversationsDeleted).toBe(1);
    const user = metadata.users.getById({ user_id: "person" });
    expect(user).toMatchObject({ email: "erased-person@erased.invalid", display_name: "Erased user" });
    expect(user.disabled_at).toBeTruthy();
    expect(metadata.authSessions.listByUser({ user_id: "person" })).toEqual([]);
    expect(metadata.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get("person")).toEqual({ n: 0 });
    const audit = metadata.db.prepare("SELECT email, ip_address, user_agent, event_type FROM auth_audit_events WHERE id = 'a-1'").get();
    expect(audit).toEqual({ email: null, ip_address: null, user_agent: null, event_type: "auth.login_succeeded" });
    const erasure = metadata.db.prepare("SELECT user_id, metadata_json FROM auth_audit_events WHERE event_type = 'energyiq.user_erased'").get() as { user_id: string; metadata_json: string };
    expect(erasure.user_id).toBe("admin");
    expect(JSON.parse(erasure.metadata_json)).toMatchObject({ targetUserId: "person" });
    // The tamper-evident chain hashes none of the blanked fields, so it still verifies after erasure.
    expect(metadata.authAuditEvents.verify()).toMatchObject({ ok: true });
  });

  it("needs the exact email, and refuses self-erasure and allowlisted platform administrators", () => {
    const { metadata } = fixture();
    expect(() => erasePersonalData({ metadataStore: metadata, actorUserId: "admin", userId: "person", confirmEmail: "someone@else.test", env: {} })).toThrow(/Type the person's email/);
    expect(() => erasePersonalData({ metadataStore: metadata, actorUserId: "person", userId: "person", confirmEmail: "person@client.test", env: {} })).toThrow(/your own account/);
    expect(() => erasePersonalData({ metadataStore: metadata, actorUserId: "admin", userId: "person", confirmEmail: "person@client.test", env: { ENERGYIQ_ADMIN_EMAILS: "person@client.test" } })).toThrow(/ENERGYIQ_ADMIN_EMAILS/);
    expect(metadata.users.getById({ user_id: "person" }).email).toBe("person@client.test");
  });
});
