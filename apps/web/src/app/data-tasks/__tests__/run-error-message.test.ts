import { describe, expect, it } from "vitest";

import { formatRunErrorMessage, resolveChatComposerError } from "../run-error-message";

describe("formatRunErrorMessage", () => {
  it("explains RUN_TIMEOUT with seconds and guidance", () => {
    expect(formatRunErrorMessage("RUN_TIMEOUT:60000")).toContain("60s");
    expect(formatRunErrorMessage("RUN_TIMEOUT:60000")).toContain("Timeout (ms)");
  });

  it("explains missing model provider configuration", () => {
    expect(formatRunErrorMessage("PROVIDER_CONFIG_MISSING:bad-model")).toBe(
      'Model provider configuration is missing for "bad-model". Check the model profile API key, base URL, and model name.',
    );
  });

  it("passes through unknown messages", () => {
    expect(formatRunErrorMessage("Something broke")).toBe("Something broke");
  });

  it("explains missing crypto.randomUUID on insecure HTTP", () => {
    expect(
      formatRunErrorMessage("crypto.randomUUID is not a function"),
    ).toContain("secure context");
    expect(
      formatRunErrorMessage("Secure context required"),
    ).toContain("HTTPS");
  });

  it("falls back when message is empty", () => {
    expect(formatRunErrorMessage()).toBe("Agent run failed");
  });

  it("explains RUN_ALREADY_ACTIVE session locks", () => {
    expect(formatRunErrorMessage("RUN_ALREADY_ACTIVE:run-1")).toContain("active run");
  });
});

describe("resolveChatComposerError", () => {
  it("surfaces a live Run failure when the client submit path has no error", () => {
    expect(resolveChatComposerError(null, "Model provider returned 503")).toBe(
      "Model provider returned 503",
    );
  });

  it("keeps the immediate client submit failure as the more local error", () => {
    expect(resolveChatComposerError("Upload failed", "Model provider returned 503")).toBe(
      "Upload failed",
    );
  });
});
