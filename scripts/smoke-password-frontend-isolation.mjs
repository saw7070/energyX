#!/usr/bin/env node
/**
 * Password-mode user isolation smoke via the Next.js same-origin proxy.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const password = "correct horse battery staple";

const cookieJar = [];
const rememberCookies = (response) => {
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookie) {
    const pair = cookie.split(";", 1)[0];
    const name = pair.split("=", 1)[0];
    const index = cookieJar.findIndex((item) => item.startsWith(`${name}=`));
    if (index >= 0) cookieJar.splice(index, 1, pair);
    else cookieJar.push(pair);
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
    ...init.headers,
  };
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  rememberCookies(response);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON ${response.status} for ${path}: ${text.slice(0, 200)}`);
  }
  return { body, response };
};

const registerVerifyLogin = async (email, displayName) => {
  cookieJar.splice(0, cookieJar.length);
  const registered = await requestJson("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName }),
  });
  assert.equal(registered.response.status, 201, JSON.stringify(registered.body));
  const token = registered.body.data.verificationToken;
  assert.equal(typeof token, "string");
  const verified = await requestJson("/api/v1/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.body));
  const loggedIn = await requestJson("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(loggedIn.response.status, 200, JSON.stringify(loggedIn.body));
  return { ...loggedIn.body.data, email };
};

const createDatasource = async (id, name, filePath) => {
  const csrf = csrfCookie();
  assert(csrf, "Expected CSRF cookie after login");
  return requestJson("/api/v1/datasources", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({
      id,
      name,
      type: "sqlite",
      settings: { filePath },
    }),
  });
};

const patchSessionTitle = async (sessionId, title) => {
  const csrf = csrfCookie();
  return requestJson(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({ title }),
  });
};

const stamp = Date.now();
const aliceEmail = `alice-front-${stamp}@example.com`;
const bobEmail = `bob-front-${stamp}@example.com`;
const root = mkdtempSync(join(tmpdir(), "df-password-front-"));
const aliceDb = join(root, "alice.sqlite");
const bobDb = join(root, "bob.sqlite");

try {
  const alice = await registerVerifyLogin(aliceEmail, "Alice Front");
  const aliceDs = await createDatasource("alice-front-db", "Alice Front DB", aliceDb);
  assert.equal(aliceDs.response.status, 201, JSON.stringify(aliceDs.body));

  const aliceSessionId = crypto.randomUUID();
  const aliceTitle = await patchSessionTitle(aliceSessionId, "Alice isolated session");
  assert.equal(aliceTitle.response.status, 200, JSON.stringify(aliceTitle.body));

  const aliceList = await requestJson("/api/v1/datasources");
  assert.equal(aliceList.response.status, 200);
  assert.equal(aliceList.body.data.some((item) => item.id === "alice-front-db"), true);
  const aliceSessions = await requestJson("/api/v1/sessions?limit=20");
  assert.equal(aliceSessions.response.status, 200);
  assert.equal(
    aliceSessions.body.data.sessions.some((item) => item.title === "Alice isolated session"),
    true,
  );

  const bob = await registerVerifyLogin(bobEmail, "Bob Front");
  const bobDs = await createDatasource("bob-front-db", "Bob Front DB", bobDb);
  assert.equal(bobDs.response.status, 201, JSON.stringify(bobDs.body));

  const bobList = await requestJson("/api/v1/datasources");
  assert.equal(bobList.response.status, 200);
  assert.equal(bobList.body.data.some((item) => item.id === "bob-front-db"), true);
  assert.equal(bobList.body.data.some((item) => item.id === "alice-front-db"), false);

  const bobSessions = await requestJson("/api/v1/sessions?limit=20");
  assert.equal(bobSessions.response.status, 200);
  assert.equal(
    bobSessions.body.data.sessions.some((item) => item.title === "Alice isolated session"),
    false,
  );

  const missingCsrf = await requestJson("/api/v1/datasources/bob-front-db", {
    method: "DELETE",
  });
  assert.equal(missingCsrf.response.status, 403);
  assert.equal(missingCsrf.body.error.code, "FORBIDDEN");

  const me = await requestJson("/api/v1/me");
  assert.equal(me.response.status, 200);
  assert.equal(me.body.data.user.email, bobEmail);
  assert.notEqual(me.body.data.user.id, alice.user.id);

  console.log(
    `Password frontend isolation smoke OK via ${baseUrl}: alice=${alice.user.id.slice(0, 8)} bob=${bob.user.id.slice(0, 8)}`,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
