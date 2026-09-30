import type { EnergyIqRole, MetadataStore, UserRecord } from "@datafoundry/metadata";

export const ensureEnergyIqUserRole = (
  metadataStore: MetadataStore,
  user: UserRecord,
  env: Record<string, string | undefined> = process.env
): EnergyIqRole => {
  const resolved = resolveEnergyIqUserRole(metadataStore, user, env);
  const existing = metadataStore.energyIq.findUserRole(user.id);
  if (existing?.role === resolved) return resolved;
  return metadataStore.energyIq.upsertUserRole({ user_id: user.id, role: resolved }).role;
};

export const resolveEnergyIqUserRole = (
  metadataStore: MetadataStore,
  user: UserRecord,
  env: Record<string, string | undefined> = process.env,
): EnergyIqRole => {
  const adminEmails = new Set(
    (env.ENERGYIQ_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
  const allowlisted = user.id === "dev-user"
    || (user.email ? adminEmails.has(user.email.toLowerCase()) : false);
  const existing = metadataStore.energyIq.findUserRole(user.id);
  if (allowlisted) return "admin";
  return existing?.role ?? "user";
};

