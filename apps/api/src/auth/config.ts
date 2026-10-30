export type AuthMode = "dev" | "password";

export type PasswordAuthConfig = {
  mode: AuthMode;
  publicBaseUrl: string;
  sessionSecret: string;
  emailDelivery: "smtp" | "test";
  smtp?: {
    from: string;
    host: string;
    password?: string | undefined;
    port: number;
    secure: boolean;
    user?: string | undefined;
  };
};

export function loadPasswordAuthConfig(env: Record<string, string | undefined>): PasswordAuthConfig {
  const mode = parseAuthMode(env.DATAFOUNDRY_AUTH_MODE, env.NODE_ENV);
  const config: PasswordAuthConfig = {
    mode,
    publicBaseUrl: env.AUTH_PUBLIC_BASE_URL ?? "",
    sessionSecret: env.AUTH_SESSION_SECRET ?? "",
    emailDelivery: env.AUTH_EMAIL_DELIVERY === "test" ? "test" : "smtp"
  };
  if (env.SMTP_HOST || env.AUTH_SMTP_HOST) {
    config.smtp = {
      host: env.AUTH_SMTP_HOST ?? env.SMTP_HOST ?? "",
      port: Number.parseInt(env.AUTH_SMTP_PORT ?? env.SMTP_PORT ?? "587", 10),
      secure: (env.AUTH_SMTP_SECURE ?? env.SMTP_SECURE) === "true",
      from: env.AUTH_EMAIL_FROM ?? env.SMTP_FROM ?? "",
      ...(env.AUTH_SMTP_USER ?? env.SMTP_USER ? { user: env.AUTH_SMTP_USER ?? env.SMTP_USER } : {}),
      ...(env.AUTH_SMTP_PASSWORD ?? env.SMTP_PASSWORD
        ? { password: env.AUTH_SMTP_PASSWORD ?? env.SMTP_PASSWORD }
        : {})
    };
  }
  if (mode === "password") {
    validatePasswordAuthConfig(config);
  } else if (isDeployedEnvironment(env)) {
    // Dev sign-in treats every request without a token as the built-in super admin; it must never face real users.
    throw new Error(
      "AUTH_CONFIG_INVALID:DATAFOUNDRY_AUTH_MODE=dev is not allowed in production or staging. Set DATAFOUNDRY_AUTH_MODE=password."
    );
  }
  return config;
}

/** Production or staging: NODE_ENV, ENERGYX_ENVIRONMENT, or a public non-loopback sign-in address says so. */
export function isDeployedEnvironment(env: Record<string, string | undefined>): boolean {
  if (env.NODE_ENV === "production") return true;
  const environment = env.ENERGYX_ENVIRONMENT?.trim().toLowerCase();
  if (environment === "production" || environment === "staging") return true;
  return isPublicBaseUrl(env.AUTH_PUBLIC_BASE_URL);
}

function isPublicBaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  let hostname: string;
  try {
    hostname = new URL(value).hostname.toLowerCase();
  } catch {
    return false;
  }
  return !(hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost"));
}

function parseAuthMode(value: string | undefined, nodeEnv: string | undefined): AuthMode {
  if (value === "password" || value === "dev") {
    return value;
  }
  return nodeEnv === "production" ? "password" : "dev";
}

function validatePasswordAuthConfig(config: PasswordAuthConfig): void {
  if (config.sessionSecret.length < 32) {
    throw new Error("AUTH_CONFIG_MISSING:AUTH_SESSION_SECRET must be at least 32 characters.");
  }
  if (!config.publicBaseUrl) {
    throw new Error("AUTH_CONFIG_MISSING:AUTH_PUBLIC_BASE_URL is required.");
  }
  if (config.emailDelivery === "smtp") {
    if (!config.smtp?.host || !config.smtp.from) {
      throw new Error("AUTH_CONFIG_MISSING:SMTP host and from address are required.");
    }
  }
}
