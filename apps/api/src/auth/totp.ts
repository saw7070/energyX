import { createHmac, randomBytes } from "node:crypto";

import { constantTimeEqual } from "./crypto.js";

/**
 * Time-based one-time codes (RFC 6238) as authenticator apps produce them: HMAC-SHA-1, 6 digits, a new code every 30
 * seconds. Secrets are exchanged in base32 (RFC 4648, no padding), the form authenticator apps expect.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A new random 160-bit secret, base32 encoded. */
export function createTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/gu, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("TOTP_SECRET_INVALID");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The 30-second time step `atMs` falls in. */
export function totpStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The code for one time step. */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24)
    | (digest[offset + 1]! << 16)
    | (digest[offset + 2]! << 8)
    | digest[offset + 3]!;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * The time step a typed code belongs to, accepting the previous and next step as well so a phone clock a little out
 * of step still works. Undefined when the code matches none of them. Every candidate is compared, so the time taken
 * does not reveal which one matched.
 */
export function matchTotpStep(
  secret: string,
  code: string,
  options: { atMs?: number; window?: number } = {},
): number | undefined {
  const typed = code.replace(/\s+/gu, "");
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`, "u").test(typed)) return undefined;
  const current = totpStep(options.atMs ?? Date.now());
  const window = options.window ?? 1;
  let matched: number | undefined;
  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (constantTimeEqual(totpCode(secret, step), typed)) matched = step;
  }
  return matched;
}

/** The otpauth:// link an authenticator app reads (usually from a QR code) to add the account. */
export function totpUri(input: { secret: string; accountName: string; issuer: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountName)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
