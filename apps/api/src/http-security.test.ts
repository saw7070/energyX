import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { allowedCorsOrigin, applyApiSecurityHeaders } from "./http-security.js";

describe("API cross-origin access", () => {
  it("never allows an arbitrary site in production, only the listed origins", () => {
    const production = { NODE_ENV: "production", API_ALLOWED_ORIGINS: "https://energyiq.hima.sg, https://partner.example.com/" };
    expect(allowedCorsOrigin("https://evil.example", production)).toBeNull();
    expect(allowedCorsOrigin("http://localhost:3000", production)).toBeNull();
    expect(allowedCorsOrigin("https://partner.example.com", production)).toBe("https://partner.example.com");
    expect(allowedCorsOrigin(undefined, production)).toBeNull();
  });

  it("lets a local web app reach the API during development", () => {
    expect(allowedCorsOrigin("http://localhost:3000", { NODE_ENV: "development" })).toBe("http://localhost:3000");
    expect(allowedCorsOrigin("http://127.0.0.1:3100", {})).toBe("http://127.0.0.1:3100");
    expect(allowedCorsOrigin("https://evil.example", {})).toBeNull();
  });

  it("labels every response and echoes only an allowed origin", () => {
    const headers: Record<string, string> = {};
    const response = { setHeader: (name: string, value: string) => { headers[name] = value; } } as unknown as ServerResponse;
    applyApiSecurityHeaders({ headers: { origin: "https://evil.example" } } as IncomingMessage, response, { NODE_ENV: "production" });
    expect(headers).toEqual({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY" });
    applyApiSecurityHeaders({ headers: { origin: "https://energyiq.hima.sg" } } as IncomingMessage, response, { NODE_ENV: "production", API_ALLOWED_ORIGINS: "https://energyiq.hima.sg" });
    expect(headers).toMatchObject({ "Access-Control-Allow-Origin": "https://energyiq.hima.sg", "Access-Control-Allow-Credentials": "true", Vary: "Origin" });
  });
});
