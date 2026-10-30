/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigApiError } from "../../lib/config-api/types";
import { TwoStepSignIn } from "./two-step-sign-in";

const api = vi.hoisted(() => ({ startTwoStepSignInSetup: vi.fn(), completeTwoStepSignIn: vi.fn() }));
vi.mock("../../lib/config-api/client", () => ({ configApi: api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const verify = { mode: "verify" as const, challenge: "challenge-1", expiresAt: "2026-10-30T12:00:00.000Z" };
const enroll = { mode: "enroll" as const, challenge: "challenge-2", expiresAt: "2026-10-30T12:00:00.000Z", requiredBy: "organisation" as const };

describe("Two-step verification at sign-in", () => {
  let container: HTMLDivElement;
  let root: Root;
  const type = async (value: string) => {
    const input = container.querySelector<HTMLInputElement>("#two-step-code")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const button = (text: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === text)!;
  const submit = async () => act(async () => { container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); });

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("React", React);
    api.startTwoStepSignInSetup.mockReset();
    api.completeTwoStepSignIn.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("asks for the app's code, shows a wrong code plainly, and signs in with the right one", async () => {
    const onAuthenticated = vi.fn();
    await act(async () => root.render(<TwoStepSignIn prompt={verify} onAuthenticated={onAuthenticated} onCancel={vi.fn()} />));
    expect(container.querySelector("h1")?.textContent).toBe("Two-step verification");
    expect(container.querySelector("#two-step-code")?.getAttribute("autocomplete")).toBe("one-time-code");

    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Enter the 6-digit code from your authenticator app.");
    expect(api.completeTwoStepSignIn).not.toHaveBeenCalled();

    await type("123 456");
    api.completeTwoStepSignIn.mockRejectedValueOnce(new ConfigApiError("UNAUTHORIZED", "That code didn't work. Check your authenticator app and try again.", 401));
    await submit();
    expect(api.completeTwoStepSignIn).toHaveBeenCalledWith({ challenge: "challenge-1", code: "123 456" });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("That code didn't work. Check your authenticator app and try again.");

    api.completeTwoStepSignIn.mockResolvedValueOnce({ user: { id: "u" }, workspace: { id: "w" } });
    await submit();
    expect(onAuthenticated).toHaveBeenCalledOnce();
  });

  it("accepts a recovery code instead, and goes back to sign in on request", async () => {
    const onCancel = vi.fn();
    await act(async () => root.render(<TwoStepSignIn prompt={verify} onAuthenticated={vi.fn()} onCancel={onCancel} />));
    await act(async () => button("Use a recovery code").click());
    expect(container.querySelector("h1")?.textContent).toBe("Use a recovery code");
    await type("k7m2p-q9xtr");
    api.completeTwoStepSignIn.mockResolvedValueOnce({ user: { id: "u" }, workspace: { id: "w" } });
    await submit();
    expect(api.completeTwoStepSignIn).toHaveBeenCalledWith({ challenge: "challenge-1", recoveryCode: "k7m2p-q9xtr" });
    await act(async () => button("Back to sign in").click());
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("walks someone through required setup, then shows their recovery codes once before continuing", async () => {
    const onAuthenticated = vi.fn();
    api.startTwoStepSignInSetup.mockResolvedValueOnce({ secret: SECRET, otpauthUri: `otpauth://totp/EnergyX:ada%40example.com?secret=${SECRET}` });
    await act(async () => root.render(<TwoStepSignIn prompt={enroll} onAuthenticated={onAuthenticated} onCancel={vi.fn()} />));
    await act(async () => undefined);
    expect(api.startTwoStepSignInSetup).toHaveBeenCalledWith({ challenge: "challenge-2" });
    expect(container.querySelector("h1")?.textContent).toBe("Set up two-step verification");
    expect(container.textContent).toContain("Your organisation asks everyone to use it");
    expect(container.querySelector('[data-testid="two-step-secret"]')?.textContent).toBe("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");
    expect(container.querySelector<HTMLAnchorElement>('a[href^="otpauth://"]')?.href).toContain(SECRET);

    const codes = ["aaaaa-bbbbb", "ccccc-ddddd"];
    api.completeTwoStepSignIn.mockResolvedValueOnce({ user: { id: "u" }, workspace: { id: "w" }, recoveryCodes: codes });
    await type("654321");
    await submit();
    expect(api.completeTwoStepSignIn).toHaveBeenCalledWith({ challenge: "challenge-2", code: "654321" });
    expect(container.querySelector("h1")?.textContent).toBe("Save your recovery codes");
    expect(Array.from(container.querySelectorAll('[aria-label="Recovery codes"] li')).map((item) => item.textContent)).toEqual(codes);
    expect(onAuthenticated).not.toHaveBeenCalled();

    await submit();
    expect(onAuthenticated).toHaveBeenCalledOnce();
  });

  it("says plainly when the sign-in has run out of time", async () => {
    api.startTwoStepSignInSetup.mockRejectedValueOnce(new ConfigApiError("UNAUTHORIZED", "This sign-in has expired. Sign in again.", 401));
    await act(async () => root.render(<TwoStepSignIn prompt={enroll} onAuthenticated={vi.fn()} onCancel={vi.fn()} />));
    await act(async () => undefined);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("This sign-in has expired. Sign in again.");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });
});
