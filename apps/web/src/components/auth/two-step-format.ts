/** The setup key in groups of four, as authenticator apps show it and people type it. */
export function formatSetupKey(secret: string): string {
  return secret.replace(/(.{4})/gu, "$1 ").trim();
}
