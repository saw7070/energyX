import { expect, it } from "vitest";
import { replayTuyaAuthHeaders } from "./replay-tuya-auth.js";
it("sends the decoded CSRF cookie and configured frontend origin for cookie publication", () => {
  expect(replayTuyaAuthHeaders({ ENERGYIQ_REPLAY_COOKIE: "df_session=dummy; df_csrf=a%2Bb%3D%3D", ENERGYIQ_REPLAY_ORIGIN: "http://localhost:3000/" })).toEqual({ Cookie: "df_session=dummy; df_csrf=a%2Bb%3D%3D", "X-CSRF-Token": "a+b==", Origin: "http://localhost:3000" });
});
it("rejects missing CSRF and origin before registration", () => {
  expect(() => replayTuyaAuthHeaders({ ENERGYIQ_REPLAY_COOKIE: "df_session=dummy" })).toThrow("REPLAY_CSRF_COOKIE_REQUIRED");
  expect(() => replayTuyaAuthHeaders({ ENERGYIQ_REPLAY_COOKIE: "df_csrf=dummy" })).toThrow("REPLAY_FRONTEND_ORIGIN_REQUIRED");
  expect(() => replayTuyaAuthHeaders({ ENERGYIQ_REPLAY_COOKIE: "df_csrf=%invalid", ENERGYIQ_REPLAY_ORIGIN: "http://localhost:3000" })).toThrow("REPLAY_CSRF_COOKIE_INVALID");
});
it("preserves non-cookie authorization without requiring cookie headers", () => {
  expect(replayTuyaAuthHeaders({ ENERGYIQ_REPLAY_AUTHORIZATION: "Bearer dummy" })).toEqual({ Authorization: "Bearer dummy" });
});

