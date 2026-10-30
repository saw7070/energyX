/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrganisationSignInSettingsDto } from "../../../lib/config-api/organisation-sign-in";
import { ProvisioningCard, SingleSignOnCard } from "./organisation-sign-in-card";

const api = vi.hoisted(() => ({
  saveSso: vi.fn(),
  testSso: vi.fn(),
  removeSso: vi.fn(),
  createProvisioningKey: vi.fn(),
  revokeProvisioningKey: vi.fn(),
}));
vi.mock("../../../lib/config-api/organisation-sign-in", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config-api/organisation-sign-in")>()),
  organisationSignInApi: api,
}));
vi.mock("../../../lib/config-api/client", () => ({ configApi: {}, isPasswordAuthMode: () => true }));

const settings = (overrides: Partial<OrganisationSignInSettingsDto["sso"]> = {}): OrganisationSignInSettingsDto => ({
  organisation: { id: "org-1", name: "Acme" },
  sso: {
    configured: false, enabled: false, issuer: "", clientId: "", hasClientSecret: false, domains: [],
    requireSso: false, autoCreateAccounts: false, keepPasswordCount: 0, ...overrides,
  },
  redirectUri: "https://energyx.example.test/api/v1/auth/sso/callback",
  scim: { baseUrl: "https://energyx.example.test/api/v1/scim/v2", keys: [] },
});

describe("Team page: sign-in and provisioning", () => {
  let container: HTMLDivElement;
  let root: Root;
  const type = async (selector: string, value: string) => {
    const input = container.querySelector<HTMLInputElement>(selector)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const click = async (element: Element | null | undefined) => act(async () => { (element as HTMLElement).click(); });
  const button = (text: string) => [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === text);
  const checkbox = (label: string) => [...container.querySelectorAll("label")]
    .find((candidate) => candidate.textContent?.startsWith(label))?.querySelector("input");

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("React", React);
    Object.values(api).forEach((mock) => mock.mockReset());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows the redirect address and saves the connection with its domains", async () => {
    const onChange = vi.fn();
    api.saveSso.mockResolvedValue(settings({ configured: true, enabled: true, domains: ["acme.test", "acme.co.uk"] }));
    await act(async () => root.render(<SingleSignOnCard settings={settings()} onChange={onChange} />));
    expect(container.textContent).toContain("https://energyx.example.test/api/v1/auth/sso/callback");
    // Requiring single sign-on waits until it is switched on.
    expect(checkbox("Require single sign-on")?.disabled).toBe(true);

    const inputs = container.querySelectorAll<HTMLInputElement>("input:not([type=checkbox])");
    await type("input[placeholder^='https://login']", "https://login.microsoftonline.com/tenant/v2.0");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(inputs[1]!, "client-1");
      inputs[1]!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await type("input[type=password]", "secret-1");
    await type("input[placeholder^='company.com']", "acme.test,  acme.co.uk");
    await click(checkbox("Turn on single sign-on"));
    await click(checkbox("Require single sign-on"));
    await click(button("Save"));

    expect(api.saveSso).toHaveBeenCalledWith({
      enabled: true,
      issuer: "https://login.microsoftonline.com/tenant/v2.0",
      clientId: "client-1",
      clientSecret: "secret-1",
      domains: ["acme.test", "acme.co.uk"],
      requireSso: true,
      autoCreateAccounts: false,
    });
    expect(onChange).toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Single sign-on is on");
  });

  it("shows the server's own sentence when saving is refused", async () => {
    const { ConfigApiError } = await import("../../../lib/config-api/types");
    api.saveSso.mockRejectedValue(new ConfigApiError("CONFLICT", "acme.test is already used by another Organisation.", 409));
    await act(async () => root.render(<SingleSignOnCard settings={settings({ configured: true, issuer: "https://idp.example.test", clientId: "c", domains: ["acme.test"] })} onChange={vi.fn()} />));
    await click(button("Save"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("acme.test is already used by another Organisation.");
  });

  it("shows a new provisioning key once, and lists keys only by name and last four characters", async () => {
    const onChange = vi.fn();
    const withKey = settings();
    withKey.scim.keys = [{ id: "k-1", name: "Microsoft Entra ID", hint: "a1b2", createdAt: "2026-10-01T00:00:00.000Z" }];
    api.createProvisioningKey.mockResolvedValue({ key: "exs_the-whole-secret-key-a1b2", settings: withKey });
    await act(async () => root.render(<ProvisioningCard settings={settings()} onChange={onChange} />));
    expect(container.textContent).toContain("https://energyx.example.test/api/v1/scim/v2");
    await type("#provisioning-key-name", "Microsoft Entra ID");
    await click(button("Create key"));
    expect(api.createProvisioningKey).toHaveBeenCalledWith("Microsoft Entra ID");
    expect(container.textContent).toContain("exs_the-whole-secret-key-a1b2");
    expect(container.textContent).toContain("You won’t see it again");
    await click(button("Done"));
    expect(container.textContent).not.toContain("exs_the-whole-secret-key-a1b2");

    await act(async () => root.render(<ProvisioningCard settings={withKey} onChange={onChange} />));
    expect(container.textContent).toContain("ends in a1b2");
    expect(container.textContent).toContain("not used yet");
  });
});
