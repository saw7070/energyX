import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer as createApiServer } from "../apps/api/dist/server.js";
import { AuthService } from "../apps/api/dist/auth/service.js";
import { MIN_PASSWORD_LENGTH } from "../apps/api/dist/auth/password-policy.js";
import { createMetadataStore } from "../packages/metadata/dist/index.js";

const root = mkdtempSync(join(tmpdir(), "datafoundry-auth-smoke-"));
process.env.DATAFOUNDRY_AUTH_MODE = "password";
process.env.AUTH_SESSION_SECRET = "smoke-session-secret-with-at-least-32-bytes";
process.env.AUTH_PUBLIC_BASE_URL = "http://127.0.0.1";
process.env.AUTH_EMAIL_DELIVERY = "test";
process.env.EMBEDDING_API_KEY = "";
process.env.MASTRA_STORAGE_PATH = join(root, "mastra.sqlite");
process.env.STORAGE_ROOT_DIR = root;

const metadataStore = createMetadataStore({
  database_path: join(root, "metadata.sqlite"),
  secret_master_key: "auth-smoke-secret-master-key"
});
const authConfig = {
  mode: "password",
  publicBaseUrl: process.env.AUTH_PUBLIC_BASE_URL,
  sessionSecret: process.env.AUTH_SESSION_SECRET,
  emailDelivery: "test"
};
const server = await createApiServer({ metadataStore });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;

const closeServer = async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    setImmediate(() => server.closeAllConnections?.());
  });
};

const cookieJar = [];
const rememberCookies = (response) => {
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookie) {
    const pair = cookie.split(";", 1)[0];
    const name = pair.split("=", 1)[0];
    const index = cookieJar.findIndex((item) => item.startsWith(`${name}=`));
    if (index >= 0) {
      cookieJar.splice(index, 1, pair);
    } else {
      cookieJar.push(pair);
    }
  }
};
const cookieHeader = () => cookieJar.join("; ");
const csrfCookie = () => {
  const entry = cookieJar.find((item) => item.startsWith("df_csrf="));
  return entry ? decodeURIComponent(entry.slice("df_csrf=".length)) : undefined;
};

const requestJson = async (path, init = {}) => {
  const headers = {
    ...(cookieJar.length > 0 ? { Cookie: cookieHeader() } : {}),
    ...init.headers
  };
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  rememberCookies(response);
  const body = await response.json();
  return { body, response };
};

try {
  const anonymousMe = await requestJson("/api/v1/me");
  assert.equal(anonymousMe.response.status, 401);
  assert.equal(anonymousMe.body.error.code, "UNAUTHORIZED");

  const publicRegistration = await requestJson("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "alice@example.com",
      password: "correct horse battery staple",
      displayName: "Alice Analyst"
    })
  });
  assert.equal(publicRegistration.response.status, 403, JSON.stringify(publicRegistration.body));
  assert.equal(publicRegistration.body.error.code, "FORBIDDEN");
  assert.match(publicRegistration.body.error.message, /public registration is closed/i);

  const invitation = await new AuthService(metadataStore, authConfig).inviteUser({
    displayName: "Alice Analyst",
    email: "alice@example.com",
    inviterUserId: "dev-user"
  });
  const invitationToken = new URL(invitation.invitationUrl).searchParams.get("invite");
  assert(invitationToken, "Expected test email delivery to return an invitation token");

  const tooShort = await requestJson("/api/v1/auth/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: invitationToken,
      password: "12345"
    })
  });
  assert.equal(tooShort.response.status, 400, JSON.stringify(tooShort.body));
  assert.equal(tooShort.body.error.code, "BAD_REQUEST");
  assert.match(tooShort.body.error.message, new RegExp(`at least ${MIN_PASSWORD_LENGTH} characters`, "i"));

  const activated = await requestJson("/api/v1/auth/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: invitationToken,
      password: "correct horse battery staple",
      displayName: "Alice Analyst"
    })
  });
  assert.equal(activated.response.status, 200, JSON.stringify(activated.body));
  assert(activated.response.headers.getSetCookie().some((cookie) => /df_session=.*HttpOnly/i.test(cookie)));
  assert(activated.response.headers.getSetCookie().some((cookie) => /^df_csrf=/i.test(cookie)));
  assert.equal(activated.body.data.user.email, "alice@example.com");
  assert.equal("devToken" in activated.body.data.user, false);
  assert.match(activated.body.data.workspace.id, /^personal-/);

  const me = await requestJson("/api/v1/me");
  assert.equal(me.response.status, 200);
  assert.equal(me.body.data.user.email, "alice@example.com");
  assert.equal(me.body.data.workspace.id, activated.body.data.workspace.id);

  const missingCsrf = await requestJson("/api/v1/datasources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "alice-sqlite",
      name: "Alice SQLite",
      type: "sqlite",
      settings: { filePath: join(root, "alice.sqlite") }
    })
  });
  assert.equal(missingCsrf.response.status, 403);
  assert.equal(missingCsrf.body.error.code, "FORBIDDEN");
  assert.match(missingCsrf.body.error.message, /CSRF token is required/i);

  const csrf = csrfCookie();
  assert(csrf, "Expected login to set a readable CSRF cookie");
  const aliceDatasource = await requestJson("/api/v1/datasources", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({
      id: "alice-sqlite",
      name: "Alice SQLite",
      type: "sqlite",
      settings: { filePath: join(root, "alice.sqlite") }
    })
  });
  // With the token the request passes the CSRF check and reaches authorization: data sources can point the server
  // at local files, so only a platform super admin may create one.
  assert.equal(aliceDatasource.response.status, 403, JSON.stringify(aliceDatasource.body));
  assert.match(aliceDatasource.body.error.message, /only a platform administrator/i);

  // The reset link is never handed back to whoever asked (anyone can type someone else's address). In email test
  // mode it goes to the server log, so read it from there.
  const logged = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logged.push(args.join(" "));
    originalLog(...args);
  };
  let forgot;
  try {
    forgot = await requestJson("/api/v1/auth/password/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com" })
    });
  } finally {
    console.log = originalLog;
  }
  assert.equal(forgot.response.status, 200);
  assert.equal("resetToken" in forgot.body.data, false);
  const resetLine = logged.find((line) => line.includes("password-reset link (email test mode)"));
  assert(resetLine, "Expected email test mode to log the password-reset link");
  const resetToken = new URL(resetLine.slice(resetLine.lastIndexOf(" ") + 1)).searchParams.get("reset");
  assert(resetToken, "Expected the logged password-reset link to carry a token");

  const reset = await requestJson("/api/v1/auth/password/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: resetToken,
      password: "new correct horse battery staple"
    })
  });
  assert.equal(reset.response.status, 200);

  const revokedMe = await requestJson("/api/v1/me");
  assert.equal(revokedMe.response.status, 401);

  cookieJar.splice(0, cookieJar.length);
  const relogged = await requestJson("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "alice@example.com", password: "new correct horse battery staple" })
  });
  assert.equal(relogged.response.status, 200);

  const logout = await requestJson("/api/v1/auth/logout", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfCookie() }
  });
  assert.equal(logout.response.status, 200);

  const afterLogout = await requestJson("/api/v1/me");
  assert.equal(afterLogout.response.status, 401);

  console.log(`Auth smoke OK: workspace=${activated.body.data.workspace.id}`);
} finally {
  await closeServer();
}
