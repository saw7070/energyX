/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigApiError } from "../../lib/config-api/types";
import { SsoSignInForm } from "./sso-sign-in";

const api = vi.hoisted(() => ({ startSingleSignOn: vi.fn() }));
vi.mock("../../lib/config-api/organisation-sign-in", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config-api/organisation-sign-in")>()),
  organisationSignInApi: api,
}));
vi.mock("../../lib/config-api/client", () => ({ configApi: {} }));

describe("Signing in with the organisation's account", () => {
  let container: HTMLDivElement;
  let root: Root;
  const type = async (selector: string, value: string) => {
    const input = container.querySelector<HTMLInputElement>(selector)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const submit = async () => act(async () => { container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); });

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("React", React);
    api.startSingleSignOn.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("sends the person to their organisation's sign-in page, keeping where they were going", async () => {
    api.startSingleSignOn.mockResolvedValue({ redirectUrl: "https://login.example.test/authorize?state=abc" });
    const redirect = vi.fn();
    await act(async () => root.render(<SsoSignInForm returnTo="/energyiq/team" onBack={vi.fn()} redirect={redirect} />));
    await type("#sso-email", " sam@acme.test ");
    await submit();
    expect(api.startSingleSignOn).toHaveBeenCalledWith({ email: "sam@acme.test", rememberMe: true, returnTo: "/energyiq/team" });
    expect(redirect).toHaveBeenCalledWith("https://login.example.test/authorize?state=abc");
  });

  it("asks for an email first and shows the server's plain answer when single sign-on is not set up", async () => {
    api.startSingleSignOn.mockRejectedValue(new ConfigApiError(
      "RESOURCE_NOT_FOUND",
      "Single sign-on is not set up for this email address. Sign in with your email and password instead.",
      404,
    ));
    await act(async () => root.render(<SsoSignInForm onBack={vi.fn()} redirect={vi.fn()} />));
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Enter your work email address.");
    expect(api.startSingleSignOn).not.toHaveBeenCalled();
    await type("#sso-email", "sam@unknown.test");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Single sign-on is not set up for this email address");
  });

  it("explains why the organisation's sign-in sent the person back", async () => {
    const { ssoErrorMessage } = await import("../../lib/config-api/organisation-sign-in");
    await act(async () => root.render(<SsoSignInForm onBack={vi.fn()} error={ssoErrorMessage("not_member")} />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("hasn’t given you access to EnergyX yet");
    expect(ssoErrorMessage("something-new")).toBe(ssoErrorMessage("failed"));
    expect(ssoErrorMessage(null)).toBeNull();
  });
});
