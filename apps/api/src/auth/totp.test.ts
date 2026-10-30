import { describe, expect, it } from "vitest";

import { base32Decode, base32Encode, createTotpSecret, matchTotpStep, totpCode, totpStep, totpUri } from "./totp.js";

// RFC 6238 appendix B uses the ASCII secret "12345678901234567890" with SHA-1; authenticator apps show the last 6 digits.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("Authenticator codes (RFC 6238)", () => {
  it("produces the reference codes", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    const at = (seconds: number) => totpCode(RFC_SECRET, totpStep(seconds * 1000));
    expect(at(59)).toBe("287082");
    expect(at(1111111109)).toBe("081804");
    expect(at(1111111111)).toBe("050471");
    expect(at(1234567890)).toBe("005924");
    expect(at(2000000000)).toBe("279037");
    expect(at(20000000000)).toBe("353130");
  });

  it("accepts the code from one step either side of now, and nothing further out", () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(matchTotpStep(RFC_SECRET, totpCode(RFC_SECRET, step), { atMs: now })).toBe(step);
    expect(matchTotpStep(RFC_SECRET, totpCode(RFC_SECRET, step - 1), { atMs: now })).toBe(step - 1);
    expect(matchTotpStep(RFC_SECRET, totpCode(RFC_SECRET, step + 1), { atMs: now })).toBe(step + 1);
    expect(matchTotpStep(RFC_SECRET, totpCode(RFC_SECRET, step - 2), { atMs: now })).toBeUndefined();
    expect(matchTotpStep(RFC_SECRET, totpCode(RFC_SECRET, step + 2), { atMs: now })).toBeUndefined();
    // Spaces typed between digit groups are fine; anything that is not six digits is not a code.
    const code = totpCode(RFC_SECRET, step);
    expect(matchTotpStep(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, { atMs: now })).toBe(step);
    expect(matchTotpStep(RFC_SECRET, "12345", { atMs: now })).toBeUndefined();
    expect(matchTotpStep(RFC_SECRET, "abcdef", { atMs: now })).toBeUndefined();
  });

  it("creates 160-bit base32 secrets and an otpauth link authenticator apps read", () => {
    const secret = createTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/u);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(createTotpSecret()).not.toBe(secret);

    const link = totpUri({ secret, accountName: "ada@example.com", issuer: "EnergyX" });
    expect(link.startsWith("otpauth://totp/EnergyX:ada%40example.com?")).toBe(true);
    const uri = new URL(link);
    expect(Object.fromEntries(uri.searchParams)).toEqual({
      secret, issuer: "EnergyX", algorithm: "SHA1", digits: "6", period: "30"
    });
  });
});
