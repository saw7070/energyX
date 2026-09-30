import { describe, expect, it } from "vitest";

import type { EnergyOperationalPolicyConfigurationDto } from "../../../lib/config-api";
import {
  calendarDraftFromConfiguration,
  calendarPublishEntries,
  hasPendingPolicyRelease,
  tariffDraftFromConfiguration,
  tariffPublishEntries,
} from "./operational-policy-model";

describe("operational policy Admin model", () => {
  it("loads the pending revisions instead of the newest unrelated revision", () => {
    const configuration = fixture();

    expect(tariffDraftFromConfiguration(configuration)).toMatchObject([{
      owner: { kind: "project" },
      currency: "SGD",
      ratePerKwh: "0.28",
      rateBasis: "tax_inclusive",
      taxName: "GST",
      taxRatePct: "9",
    }]);
    expect(calendarDraftFromConfiguration(configuration)[0]).toMatchObject({
      owner: { kind: "scope", scopeId: "level-6" },
      weekly: { monday: [{ from: "08:00", to: "18:00" }] },
      exceptions: [{
        date: "2026-08-10",
        label: "National Day observed",
        classification: "public_holiday",
        operating: [],
      }],
    });
    expect(hasPendingPolicyRelease(configuration)).toBe(true);
  });

  it("projects validated immutable publish inputs without persisted revision IDs", () => {
    const configuration = fixture();
    expect(tariffPublishEntries(tariffDraftFromConfiguration(configuration))).toEqual([{
      owner: { kind: "project" },
      effectiveFrom: "2026-07-01T00:00:00+08:00",
      currency: "SGD",
      ratePerKwh: 0.28,
      rateBasis: "tax_inclusive",
      tax: { name: "GST", ratePct: 9 },
    }]);
    expect(calendarPublishEntries(calendarDraftFromConfiguration(configuration))).toMatchObject([{
      owner: { kind: "scope", scopeId: "level-6" },
      effectiveFrom: "2026-07-01",
      weekly: { monday: [{ from: "08:00", to: "18:00" }] },
      exceptions: [{
        date: "2026-08-10",
        label: "National Day observed",
        classification: "public_holiday",
      }],
    }]);
  });
});

describe("operational policy checks in other languages", () => {
  it("keeps English wording as before and explains problems in Chinese and Malay", () => {
    const [entry] = calendarDraftFromConfiguration(fixture());
    const broken = [{ ...entry!, weekly: { ...entry!.weekly, monday: [{ key: "r", from: "08:00", to: "" }] } }];
    expect(() => calendarPublishEntries(broken)).toThrow("Calendar window 1, monday range 1 is incomplete.");
    expect(() => calendarPublishEntries(broken, "zh-Hans")).toThrow("日历时段 1：星期一的第 1 个时间段尚未填写完整。");
    expect(() => calendarPublishEntries(broken, "ms")).toThrow("Tempoh kalendar 1: julat 1 pada hari Isnin belum lengkap.");
    const [tariff] = tariffDraftFromConfiguration(fixture());
    expect(() => tariffPublishEntries([{ ...tariff!, owner: { kind: "scope", scopeId: "" } }])).toThrow("Tariff window 1 needs a Scope.");
    expect(() => tariffPublishEntries([{ ...tariff!, ratePerKwh: "0" }], "zh-Hans")).toThrow("电价时段 1 需要填写大于 0 的电价。");
  });
});

const fixture = (): EnergyOperationalPolicyConfigurationDto => ({
  projectId: "ngee-ann-polytechnic",
  timezone: "Asia/Singapore",
  published: {
    tariff_schedule_version: "tariff-v1",
    business_calendar_version: "calendar-v1",
  },
  pending: {
    tariff_schedule_version: "tariff-v2",
    business_calendar_version: "calendar-v2",
  },
  tariffRevisions: [
    {
      version_id: "tariff-v3-unrelated",
      project_id: "ngee-ann-polytechnic",
      published_by: "admin",
      published_at: "2026-08-04T02:00:00.000Z",
      entries: [{
        id: "tariff-v3-rate",
        owner: { kind: "project" },
        effective_from: "2026-09-01T00:00:00+08:00",
        currency: "SGD",
        rate_per_kwh: 0.3,
      }],
    },
    {
      version_id: "tariff-v2",
      project_id: "ngee-ann-polytechnic",
      published_by: "admin",
      published_at: "2026-08-04T01:00:00.000Z",
      entries: [{
        id: "tariff-v2-rate",
        owner: { kind: "project" },
        effective_from: "2026-07-01T00:00:00+08:00",
        currency: "SGD",
        rate_per_kwh: 0.28,
        rate_basis: "tax_inclusive",
        tax: { name: "GST", rate_pct: 9 },
      }],
    },
  ],
  operatingCalendarRevisions: [{
    version_id: "calendar-v2",
    project_id: "ngee-ann-polytechnic",
    timezone: "Asia/Singapore",
    published_by: "admin",
    published_at: "2026-08-04T01:00:00.000Z",
    entries: [{
      id: "calendar-v2-hours",
      owner: { kind: "scope", scope_id: "level-6" },
      effective_from: "2026-07-01",
      weekly: {
        monday: [{ from: "08:00", to: "18:00" }],
        tuesday: [{ from: "08:00", to: "18:00" }],
        wednesday: [{ from: "08:00", to: "18:00" }],
        thursday: [{ from: "08:00", to: "18:00" }],
        friday: [{ from: "08:00", to: "18:00" }],
        saturday: [],
        sunday: [],
      },
      exceptions: [{
        date: "2026-08-10",
        label: "National Day observed",
        classification: "public_holiday",
        operating: [],
      }],
    }],
  }],
  hasUnpublishedChanges: true,
});
