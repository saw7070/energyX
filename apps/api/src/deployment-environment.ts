/**
 * Which kind of deployment this server is. Set ENERGYX_ENVIRONMENT to "production" or "staging" on deployed hosts;
 * without it, NODE_ENV=production counts as production and anything else is local development.
 */
export type DeploymentEnvironment = "production" | "staging" | "development";

export const deploymentEnvironment = (env: Record<string, string | undefined> = process.env): DeploymentEnvironment => {
  const declared = env.ENERGYX_ENVIRONMENT?.trim().toLowerCase();
  if (declared === "production" || declared === "staging" || declared === "development") return declared;
  return env.NODE_ENV === "production" ? "production" : "development";
};

/**
 * A staging server runs real code against test data, so its email must never reach customers. Only addresses on
 * ENERGYX_STAGING_EMAIL_ALLOWLIST (full addresses, or "@domain" for a whole domain) may receive mail from staging.
 * Everywhere else every recipient is allowed.
 */
export const stagingEmailAllowed = (address: string, env: Record<string, string | undefined> = process.env): boolean => {
  if (deploymentEnvironment(env) !== "staging") return true;
  const normalized = address.trim().toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf("@"));
  return (env.ENERGYX_STAGING_EMAIL_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => (entry.startsWith("@") ? entry === domain : entry === normalized));
};

/** Subjects from staging say so, so a tester never mistakes them for the real service. */
export const environmentSubject = (subject: string, env: Record<string, string | undefined> = process.env): string =>
  deploymentEnvironment(env) === "staging" ? `[Staging] ${subject}` : subject;
