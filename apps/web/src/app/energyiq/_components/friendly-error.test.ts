/** @vitest-environment happy-dom */
import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigApiError } from "../../../lib/config-api/types";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY } from "./energyiq-messages";
import { friendlyErrorKey, friendlyErrorMessage, isTechnicalMessage, useFriendlyError } from "./friendly-error";
import { activityMessages, friendlyErrorMessages } from "./friendly-error-messages";

const apiError = (code: string, message: string, status: number) => new ConfigApiError(code as ConstructorParameters<typeof ConfigApiError>[0], message, status);

describe("isTechnicalMessage", () => {
  it.each([
    "ENERGYIQ_PROJECT_MOVE_STALE",
    "REPORT_MODEL_NOT_CONFIGURED",
    "ENERGYIQ_PROJECT_DATA_NOT_READY:no-meters,no-readings",
    "SECRET_MASTER_KEY_REQUIRED",
    "Invalid JSON response (502)",
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
    "500",
    "HTTP 502",
    "404 Not Found",
    "Request failed (500)",
    "CSRF token is invalid.",
    "Token is invalid or expired.",
    "Saved, but not applied yet: TIER_ORDINAL_GAP, NODE_SKIPS_TIER",
  ])("flags %s", text => expect(isTechnicalMessage(text)).toBe(true));

  it.each([
    "Email verification is required before login.",
    "Invalid email or password.",
    "Move, or delete, this Organisation's projects first.",
    "Password must be at least 8 characters.",
    "",
  ])("leaves %s for readers", text => expect(isTechnicalMessage(text)).toBe(false));
});

describe("friendlyErrorKey", () => {
  it.each([
    [new TypeError("Failed to fetch"), "network"],
    [apiError("INTERNAL_ERROR", "Invalid JSON response (502)", 502), "network"],
    [apiError("INTERNAL_ERROR", "Empty response body", 500), "network"],
    [apiError("INTERNAL_ERROR", "Request failed (503)", 503), "network"],
    [new Error("NETWORK_TIMEOUT"), "network"],
    [apiError("FORBIDDEN", "CSRF token is invalid.", 403), "sessionEnded"],
    [apiError("UNAUTHORIZED", "Authentication required.", 401), "sessionEnded"],
    [apiError("UNAUTHORIZED", "UNAUTHORIZED", 401), "sessionEnded"],
    [apiError("FORBIDDEN", "ENERGYIQ_PROJECT_FORBIDDEN", 403), "forbidden"],
    [new Error("ENERGYIQ_ADMIN_REQUIRED"), "forbidden"],
    [apiError("BAD_REQUEST", "REPORT_SKILL_EDIT_FORBIDDEN", 400), "forbidden"],
    [apiError("RESOURCE_NOT_FOUND", "RESOURCE_NOT_FOUND", 404), "notFound"],
    [apiError("RESOURCE_NOT_FOUND", "REPORT_ARTIFACT_NOT_FOUND", 404), "notFound"],
    [apiError("CONFLICT", "ENERGYIQ_PROJECT_MOVE_STALE", 409), "conflict"],
    [new Error("ENERGYIQ_SETUP_REVISION_CONFLICT"), "conflict"],
    [new Error("REPORT_SETTINGS_CHANGED"), "conflict"],
    [apiError("BAD_REQUEST", "REPORT_ALREADY_RUNNING", 409), "reportAlreadyRunning"],
    [apiError("BAD_REQUEST", "REPORT_MODEL_NOT_CONFIGURED", 400), "advisorNotSetUp"],
    [apiError("BAD_REQUEST", "REPORT_FILE_TYPE_INVALID", 400), "fileTypeUnsupported"],
    [apiError("BAD_REQUEST", "ENERGYIQ_PROJECT_DATA_NOT_READY:no-readings", 409), "dataNotReady"],
    [new Error("ENERGYIQ_SETUP_INVALID:TIER_ORDINAL_GAP,NODE_SKIPS_TIER"), "setupIncomplete"],
    [new Error("ENERGYIQ_PROJECT_SETUP_INVALID:LOCATION_WITHOUT_METER,DUPLICATE_ROUTE"), "setupIncomplete"],
    [new Error("LOCATION_WITHOUT_METER"), "setupIncomplete"],
    [apiError("BAD_REQUEST", "Token is invalid or expired.", 400), "linkExpired"],
    [apiError("RATE_LIMITED", "RATE_LIMITED", 429), "busy"],
  ] as const)("maps %s to %s", (reason, key) => expect(friendlyErrorKey(reason)).toBe(key));

  it("leaves human server sentences alone, whatever their status", () => {
    expect(friendlyErrorKey(apiError("UNAUTHORIZED", "Invalid email or password.", 401))).toBeNull();
    expect(friendlyErrorKey(apiError("EMAIL_NOT_VERIFIED", "Email verification is required before login.", 403))).toBeNull();
    expect(friendlyErrorKey(apiError("CONFLICT", "Move, or delete, this Organisation's projects first.", 409))).toBeNull();
  });

  it("does not call a specific server failure a lost connection or a missing page", () => {
    expect(friendlyErrorKey(apiError("INTERNAL_ERROR", "ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE", 500))).toBeNull();
    expect(friendlyErrorKey(apiError("RESOURCE_NOT_FOUND", "ENERGYIQ_LATEST_COMPLETE_DAY_NOT_FOUND", 404))).toBeNull();
    expect(friendlyErrorKey(apiError("INTERNAL_ERROR", "INTERNAL_ERROR", 500))).toBe("network");
  });

  it("returns null for unknown codes and empty reasons", () => {
    expect(friendlyErrorKey(new Error("ENERGYIQ_SOMETHING_ODD"))).toBeNull();
    expect(friendlyErrorKey(undefined)).toBeNull();
    expect(friendlyErrorKey(new Error(""))).toBeNull();
  });
});

describe("friendlyErrorMessage", () => {
  it("uses the mapped sentence, then the screen's fallback, then the server's own sentence", () => {
    expect(friendlyErrorMessage(apiError("CONFLICT", "ENERGYIQ_PROJECT_MOVE_STALE", 409))).toBe("Someone else changed this at the same time. Refresh and try again.");
    expect(friendlyErrorMessage(new Error("ENERGYIQ_SOMETHING_ODD"), { fallback: "Could not save the meter." })).toBe("Could not save the meter.");
    expect(friendlyErrorMessage(new Error("ENERGYIQ_SOMETHING_ODD"))).toBe("Something went wrong. Please try again.");
    expect(friendlyErrorMessage(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe("Something went wrong. Please try again.");
    expect(friendlyErrorMessage("boom", { fallback: "Fallback" })).toBe("boom");
    expect(friendlyErrorMessage(null, { fallback: "Fallback" })).toBe("Fallback");
    expect(friendlyErrorMessage(apiError("FORBIDDEN", "Public registration is closed. Ask an administrator for an invitation.", 403)))
      .toBe("Public registration is closed. Ask an administrator for an invitation.");
  });

  it("speaks the reader's language", () => {
    expect(friendlyErrorMessage(new TypeError("Failed to fetch"), { locale: "zh-Hans" })).toBe(friendlyErrorMessages["zh-Hans"].network);
    expect(friendlyErrorMessage(new Error("REPORT_MODEL_NOT_CONFIGURED"), { locale: "ms" })).toBe(friendlyErrorMessages.ms.advisorNotSetUp);
  });

  it("treats a browser that reports itself offline as a connection problem", () => {
    const onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    try {
      expect(friendlyErrorKey(new Error("ENERGYIQ_SOMETHING_ODD"))).toBe("network");
      expect(friendlyErrorKey(new Error("Invalid email or password."))).toBeNull();
    } finally {
      onLine.mockRestore();
    }
  });
});

describe("message catalogue", () => {
  it("words every key in every language, without codes", () => {
    for (const book of [friendlyErrorMessages, activityMessages]) {
      const keys = Object.keys(book.en).sort();
      for (const locale of ["zh-Hans", "ms"] as const) {
        expect(Object.keys(book[locale]).sort()).toEqual(keys);
        for (const key of keys) {
          const text = (book[locale] as Record<string, string>)[key]!;
          expect(text.trim().length).toBeGreaterThan(0);
          expect(text).not.toBe((book.en as Record<string, string>)[key]);
        }
      }
      for (const text of Object.values(book.en)) expect(isTechnicalMessage(text)).toBe(false);
    }
  });
});

describe("useFriendlyError", () => {
  afterEach(() => { window.localStorage.clear(); vi.unstubAllGlobals(); });

  it("follows the reader's chosen language", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("React", React);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "zh-Hans");
    const container = document.createElement("div");
    const root = createRoot(container);
    function Probe() {
      const friendly = useFriendlyError();
      return createElement("p", null, `${friendly(new Error("ENERGYIQ_PROJECT_MOVE_STALE"))}|${friendly(new Error("ENERGYIQ_ODD"), "fallback")}|${friendly(new Error("Invalid email or password."))}`);
    }
    await act(async () => root.render(createElement(EnergyIqLocaleProvider, null, createElement(Probe))));
    expect(container.textContent).toBe(`${friendlyErrorMessages["zh-Hans"].conflict}|fallback|Invalid email or password.`);
    await act(async () => root.unmount());
  });
});
