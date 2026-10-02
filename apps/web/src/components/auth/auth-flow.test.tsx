/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigApiError } from "../../lib/config-api/types";
import { AuthFlow, authErrorMessage, missingAuthFields } from "./auth-flow";

const api = vi.hoisted(() => ({ login: vi.fn(), forgotPassword: vi.fn() }));
vi.mock("../../lib/config-api/client", () => ({ configApi: api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

describe("sign-in wording", () => {
  it("asks for blank fields before anything is sent", () => {
    expect(missingAuthFields("login", { email: "", password: "", token: "" })).toBe("Enter your email and password.");
    expect(missingAuthFields("login", { email: "ada@example.com", password: " ", token: "" })).toBe("Enter your email and password.");
    expect(missingAuthFields("login", { email: "ada@example.com", password: "secret", token: "" })).toBeNull();
    expect(missingAuthFields("forgot", { email: "", password: "", token: "" })).toBe("Enter your email address.");
    expect(missingAuthFields("verify", { email: "", password: "", token: "" })).toBe("Enter the verification code from your email.");
    expect(missingAuthFields("reset", { email: "", password: "", token: "" })).toBe("Enter the reset code from your email.");
  });

  it("keeps the server's own sentences and replaces codes, CSRF, token and network text", () => {
    const error = (code: string, message: string, status: number) => new ConfigApiError(code as ConstructorParameters<typeof ConfigApiError>[0], message, status);
    expect(authErrorMessage(error("UNAUTHORIZED", "Invalid email or password.", 401), "login")).toBe("Invalid email or password.");
    expect(authErrorMessage(error("EMAIL_NOT_VERIFIED", "Email verification is required before login.", 403), "login")).toBe("Email verification is required before login.");
    expect(authErrorMessage(error("BAD_REQUEST", "email is required.", 400), "login")).toBe("Enter your email and password.");
    expect(authErrorMessage(error("FORBIDDEN", "CSRF token is invalid.", 403), "login")).toBe("This sign-in page has expired. Refresh the page and try again.");
    expect(authErrorMessage(new TypeError("Failed to fetch"), "login")).toBe("We couldn't reach EnergyX. Check your connection and try again.");
    expect(authErrorMessage(error("INTERNAL_ERROR", "Invalid JSON response (502)", 502), "login")).toBe("We couldn't reach EnergyX. Check your connection and try again.");
    expect(authErrorMessage(error("BAD_REQUEST", "Token is invalid or expired.", 400), "invite")).toContain("invitation link has expired");
    expect(authErrorMessage(error("BAD_REQUEST", "Token is invalid or expired.", 400), "reset")).toContain("reset link has expired");
    expect(authErrorMessage(error("INTERNAL_ERROR", "SQLITE_BUSY", 500), "login")).toBe("We couldn't sign you in. Please try again.");
    expect(authErrorMessage("boom", "forgot")).toBe("We couldn't send the reset link. Please try again.");
  });
});

describe("AuthFlow", () => {
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
    api.login.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("catches blank fields in the browser and shows plain sign-in failures", async () => {
    const onAuthenticated = vi.fn();
    await act(async () => root.render(<AuthFlow initialMode="login" onAuthenticated={onAuthenticated} />));
    expect(container.querySelector("#auth-email")?.getAttribute("aria-required")).toBe("true");

    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Enter your email and password.");
    expect(api.login).not.toHaveBeenCalled();

    await type("#auth-email", "ada@example.com");
    await type("#auth-password", "correct horse");
    api.login.mockRejectedValueOnce(new ConfigApiError("FORBIDDEN", "CSRF token is invalid.", 403));
    await submit();
    expect(api.login).toHaveBeenCalledWith({ email: "ada@example.com", password: "correct horse", rememberMe: true });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("This sign-in page has expired. Refresh the page and try again.");
    expect(container.textContent).not.toContain("CSRF");

    api.login.mockRejectedValueOnce(new ConfigApiError("UNAUTHORIZED", "Invalid email or password.", 401));
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Invalid email or password.");
    expect(onAuthenticated).not.toHaveBeenCalled();
  });
});
