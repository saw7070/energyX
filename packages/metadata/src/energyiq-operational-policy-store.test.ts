import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("EnergyIqOperationalPolicyStore", () => {
  it("prices each interval with the effective immutable Tariff rate and reports currency/version", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-operational-policy-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-1",
        owner_user_id: "dev-user",
        name: "Workspace 1",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Project 1",
        status: "published",
        timezone: "Asia/Singapore",
        root_scope_id: "project-1-root",
      });
      metadata.energyIq.upsertProjectNode({
        id: "project-1-root",
        project_id: "project-1",
        name: "Project 1",
        node_type: "project",
      });
      metadata.energyIq.upsertProjectNode({
        id: "level-1",
        project_id: "project-1",
        parent_id: "project-1-root",
        name: "Level 1",
        node_type: "level",
      });
      metadata.energyIq.upsertProjectNode({
        id: "circuit-a",
        project_id: "project-1",
        parent_id: "level-1",
        name: "Circuit A",
        node_type: "circuit",
      });

      const revision = metadata.energyIq.operationalPolicy.publishTariffSchedule({
        version_id: "tariff-v1",
        project_id: "project-1",
        published_by: "dev-user",
        activate: true,
        entries: [
          {
            id: "project-rate",
            owner: { kind: "project" },
            effective_from: "2026-07-01T00:00:00+08:00",
            effective_to: "2026-07-03T00:00:00+08:00",
            currency: "SGD",
            rate_per_kwh: 0.2972,
            rate_basis: "tax_inclusive",
            tax: { name: "GST", rate_pct: 9 },
          },
          {
            id: "level-override",
            owner: { kind: "scope", scope_id: "level-1" },
            effective_from: "2026-07-02T00:00:00+08:00",
            effective_to: "2026-07-03T00:00:00+08:00",
            currency: "SGD",
            rate_per_kwh: 0.3,
          },
        ],
      });

      const result = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-1",
        scope_id: "circuit-a",
        period: {
          from: "2026-07-01T00:00:00+08:00",
          to: "2026-07-03T00:00:00+08:00",
        },
        intervals: [
          {
            start: "2026-07-01T00:00:00+08:00",
            end_exclusive: "2026-07-02T00:00:00+08:00",
            usage_kwh: 10,
          },
          {
            start: "2026-07-02T00:00:00+08:00",
            end_exclusive: "2026-07-03T00:00:00+08:00",
            usage_kwh: 10,
          },
        ],
        policy_source: { mode: "active" },
      });

      expect(revision.version_id).toBe("tariff-v1");
      expect(result.tariff).toEqual({
        status: "available",
        currency: "SGD",
        tariff_schedule_version: "tariff-v1",
        total_cost: 5.972,
        allocations: [
          {
            from: "2026-06-30T16:00:00.000Z",
            to: "2026-07-01T16:00:00.000Z",
            rate_per_kwh: 0.2972,
            rate_basis: "tax_inclusive",
            tax: { name: "GST", rate_pct: 9 },
            tax_inclusive_rate_per_kwh: 0.2972,
            tax_exclusive_rate_per_kwh: 0.272661,
            usage_kwh: 10,
            cost: 2.972,
          },
          {
            from: "2026-07-01T16:00:00.000Z",
            to: "2026-07-02T16:00:00.000Z",
            rate_per_kwh: 0.3,
            usage_kwh: 10,
            cost: 3,
          },
        ],
      });
      expect(result.operating).toMatchObject({
        status: "unavailable",
        reason: { code: "OPERATING_CALENDAR_VERSION_MISSING" },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("classifies Operating and Standby usage in the Project timezone with Scope inheritance and calendar exceptions", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-operating-calendar-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-2",
        owner_user_id: "dev-user",
        name: "Workspace 2",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-2",
        workspace_id: "workspace-2",
        name: "Project 2",
        status: "published",
        timezone: "Asia/Singapore",
        root_scope_id: "project-2-root",
      });
      metadata.energyIq.upsertProjectNode({
        id: "project-2-root",
        project_id: "project-2",
        name: "Project 2",
        node_type: "project",
      });
      metadata.energyIq.upsertProjectNode({
        id: "level-6",
        project_id: "project-2",
        parent_id: "project-2-root",
        name: "Level 6",
        node_type: "level",
      });
      metadata.energyIq.upsertProjectNode({
        id: "circuit-1",
        project_id: "project-2",
        parent_id: "level-6",
        name: "Circuit 1",
        node_type: "circuit",
      });

      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "calendar-v1",
        project_id: "project-2",
        published_by: "dev-user",
        activate: true,
        entries: [
          {
            id: "project-hours",
            owner: { kind: "project" },
            effective_from: "2026-07-01",
            effective_to: "2026-07-04",
            weekly: operatingWeek("08:00", "18:00"),
          },
          {
            id: "level-6-hours",
            owner: { kind: "scope", scope_id: "level-6" },
            effective_from: "2026-07-01",
            effective_to: "2026-07-04",
            weekly: operatingWeek("09:00", "17:00"),
            exceptions: [{ date: "2026-07-02", operating: [], label: "Project holiday" }],
          },
        ],
      });

      const result = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-2",
        scope_id: "circuit-1",
        period: {
          from: "2026-07-01T00:00:00Z",
          to: "2026-07-03T10:00:00Z",
        },
        intervals: [
          { start: "2026-07-01T00:00:00Z", end_exclusive: "2026-07-01T02:00:00Z", usage_kwh: 2 },
          { start: "2026-07-02T02:00:00Z", end_exclusive: "2026-07-02T04:00:00Z", usage_kwh: 2 },
          { start: "2026-07-03T08:00:00Z", end_exclusive: "2026-07-03T10:00:00Z", usage_kwh: 2 },
        ],
        policy_source: { mode: "active" },
      });

      expect(result.operating).toEqual({
        status: "available",
        timezone: "Asia/Singapore",
        business_calendar_version: "calendar-v1",
        operating_kwh: 2,
        standby_kwh: 4,
      });
      expect(metadata.energyIq.operationalPolicy.getActivePolicyVersions("project-2"))
        .toMatchObject({ business_calendar_version: "calendar-v1" });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves release-pinned Academic Phase independently from Week Part and Public Holiday", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-academic-calendar-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "ngee-workspace",
        owner_user_id: "dev-user",
        name: "Ngee Ann Workspace",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "ngee-ann-polytechnic",
        workspace_id: "ngee-workspace",
        name: "Ngee Ann Polytechnic",
        status: "published",
        timezone: "Asia/Singapore",
        root_scope_id: "ngee-ann-root",
      });
      metadata.energyIq.upsertProjectNode({
        id: "ngee-ann-root",
        project_id: "ngee-ann-polytechnic",
        name: "Ngee Ann Polytechnic",
        node_type: "project",
      });
      const revision = metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "ngee-academic-calendar-v1",
        project_id: "ngee-ann-polytechnic",
        published_by: "dev-user",
        entries: [{
          id: "ngee-project-hours",
          owner: { kind: "project" },
          effective_from: "2026-04-20",
          effective_to: "2026-10-19",
          weekly: operatingWeek("08:00", "18:00"),
          exceptions: [{
            date: "2026-06-01",
            operating: [],
            label: "Vesak Day observed",
            classification: "public_holiday",
          }],
        }],
        academic_periods: [{
          id: "semester-1-teaching-a",
          from: "2026-04-20",
          to: "2026-06-15",
          phase: "teaching",
          label: "Semester 1 Teaching",
          source: { label: "Ngee Ann Polytechnic AY2026/27 Academic Calendar" },
        }, {
          id: "semester-1-term-break",
          from: "2026-06-15",
          to: "2026-06-29",
          phase: "term_break",
          label: "Term Break",
          source: { label: "Ngee Ann Polytechnic AY2026/27 Academic Calendar" },
        }],
      });

      expect(metadata.energyIq.operationalPolicy.resolveCalendarDateContexts({
        project_id: "ngee-ann-polytechnic",
        scope_id: "ngee-ann-root",
        version_id: revision.version_id,
        period: { from: "2026-06-01T00:00:00+08:00", to: "2026-06-02T00:00:00+08:00" },
      })).toMatchObject({
        status: "available",
        business_calendar_version: "ngee-academic-calendar-v1",
        dates: [{
          local_date: "2026-06-01",
          week_part: "weekday",
          is_public_holiday: true,
          academic_phase: "teaching",
          school_holiday_state: "non_school_holiday",
        }],
      });
      expect(metadata.energyIq.operationalPolicy.resolveCalendarDateContexts({
        project_id: "ngee-ann-polytechnic",
        scope_id: "ngee-ann-root",
        version_id: revision.version_id,
        period: { from: "2026-06-16T00:00:00+08:00", to: "2026-06-17T00:00:00+08:00" },
      })).toMatchObject({
        status: "available",
        dates: [{
          local_date: "2026-06-16",
          week_part: "weekday",
          is_public_holiday: false,
          academic_phase: "term_break",
          school_holiday_state: "school_holiday",
        }],
      });
      expect(metadata.energyIq.operationalPolicy.resolveCalendarDateContexts({
        project_id: "ngee-ann-polytechnic",
        scope_id: "ngee-ann-root",
        version_id: revision.version_id,
        period: { from: "2026-06-28T00:00:00+08:00", to: "2026-06-29T00:00:00+08:00" },
      })).toMatchObject({
        status: "available",
        dates: [{
          local_date: "2026-06-28",
          week_part: "weekend",
          is_public_holiday: false,
          academic_phase: "term_break",
          school_holiday_state: "school_holiday",
        }],
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns stable Unavailable reason codes and never falls back from strict release versions", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-policy-unavailable-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-3",
        owner_user_id: "dev-user",
        name: "Workspace 3",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-3",
        workspace_id: "workspace-3",
        name: "Project 3",
        status: "published",
        timezone: "Asia/Singapore",
        root_scope_id: "project-3-root",
      });

      const period = { from: "2026-07-01T00:00:00+08:00", to: "2026-07-02T00:00:00+08:00" };
      const interval = [{
        start: "2026-07-01T00:00:00+08:00",
        end_exclusive: "2026-07-02T00:00:00+08:00",
        usage_kwh: 10,
      }];
      const missing = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-3",
        scope_id: "project-3-root",
        period,
        intervals: interval,
        policy_source: { mode: "active" },
      });

      metadata.energyIq.operationalPolicy.publishTariffSchedule({
        version_id: "tariff-gap",
        project_id: "project-3",
        published_by: "dev-user",
        activate: true,
        entries: [{
          id: "future-rate",
          owner: { kind: "project" },
          effective_from: "2026-07-02T00:00:00+08:00",
          currency: "SGD",
          rate_per_kwh: 0.2,
        }],
      });
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "calendar-gap",
        project_id: "project-3",
        published_by: "dev-user",
        activate: true,
        entries: [{
          id: "future-hours",
          owner: { kind: "project" },
          effective_from: "2026-07-02",
          weekly: operatingWeek("08:00", "18:00"),
        }],
      });
      const gap = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-3",
        scope_id: "project-3-root",
        period,
        intervals: interval,
        policy_source: { mode: "active" },
      });
      const strict = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-3",
        scope_id: "project-3-root",
        period,
        intervals: interval,
        policy_source: {
          mode: "release-pinned",
          tariff_schedule_version: "release-missing-tariff",
          business_calendar_version: "release-missing-calendar",
        },
      });

      metadata.energyIq.operationalPolicy.publishTariffSchedule({
        version_id: "tariff-currency-conflict",
        project_id: "project-3",
        published_by: "dev-user",
        entries: [
          {
            id: "sgd-rate",
            owner: { kind: "project" },
            effective_from: "2026-07-01T00:00:00+08:00",
            effective_to: "2026-07-01T12:00:00+08:00",
            currency: "SGD",
            rate_per_kwh: 0.2,
          },
          {
            id: "usd-rate",
            owner: { kind: "project" },
            effective_from: "2026-07-01T12:00:00+08:00",
            effective_to: "2026-07-02T00:00:00+08:00",
            currency: "USD",
            rate_per_kwh: 0.2,
          },
        ],
      });
      const currencyConflict = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-3",
        scope_id: "project-3-root",
        period,
        intervals: interval,
        policy_source: {
          mode: "release-pinned",
          tariff_schedule_version: "tariff-currency-conflict",
          business_calendar_version: "calendar-gap",
        },
      });
      const noFacts = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-3",
        scope_id: "project-3-root",
        period: { from: "2026-07-02T00:00:00+08:00", to: "2026-07-03T00:00:00+08:00" },
        intervals: [],
        policy_source: { mode: "active" },
      });

      expect([
        unavailableCode(missing.tariff),
        unavailableCode(missing.operating),
        unavailableCode(gap.tariff),
        unavailableCode(gap.operating),
        unavailableCode(strict.tariff),
        unavailableCode(strict.operating),
        unavailableCode(currencyConflict.tariff),
        unavailableCode(noFacts.operating),
      ]).toEqual([
        "TARIFF_VERSION_MISSING",
        "OPERATING_CALENDAR_VERSION_MISSING",
        "TARIFF_NOT_EFFECTIVE_FOR_PERIOD",
        "OPERATING_CALENDAR_NOT_EFFECTIVE_FOR_PERIOD",
        "TARIFF_VERSION_NOT_FOUND",
        "OPERATING_CALENDAR_VERSION_NOT_FOUND",
        "TARIFF_CURRENCY_CONFLICT",
        "OPERATING_FACTS_UNAVAILABLE",
      ]);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses newly activated Admin versions for new analysis while release-pinned and Saved Analysis results remain unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-policy-history-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-4",
        owner_user_id: "dev-user",
        name: "Workspace 4",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-4",
        workspace_id: "workspace-4",
        name: "Project 4",
        status: "published",
        timezone: "Asia/Singapore",
        root_scope_id: "project-4-root",
      });
      const period = { from: "2026-07-01T00:00:00+08:00", to: "2026-07-02T00:00:00+08:00" };
      const intervals = [{
        start: "2026-07-01T00:00:00+08:00",
        end_exclusive: "2026-07-02T00:00:00+08:00",
        usage_kwh: 10,
      }];
      publishTariff(metadata, "project-4", "tariff-v1", 0.2, true);
      publishCalendar(metadata, "project-4", "calendar-v1", closedWeek(), true);
      const historical = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-4",
        scope_id: "project-4-root",
        period,
        intervals,
        policy_source: { mode: "active" },
      });
      metadata.energyIq.savedAnalyses.create({
        id: "saved-v1",
        series_id: "saved-series",
        project_id: "project-4",
        workspace_id: "workspace-4",
        scope_id: "project-4-root",
        scope_name: "Project 4",
        resource: "electricity",
        title: "Historical policy",
        query_json: JSON.stringify({ period, tariff: "tariff-v1", calendar: "calendar-v1" }),
        analysis_json: JSON.stringify(historical),
        template_revision_id: "template-v1",
        data_snapshot_id: "snapshot-v1",
        created_by: "dev-user",
      });

      publishTariff(metadata, "project-4", "tariff-v2", 0.4, true);
      publishCalendar(metadata, "project-4", "calendar-v2", operatingWeek("00:00", "24:00"), true);
      const latest = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-4",
        scope_id: "project-4-root",
        period,
        intervals,
        policy_source: { mode: "active" },
      });
      const pinned = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-4",
        scope_id: "project-4-root",
        period,
        intervals,
        policy_source: {
          mode: "release-pinned",
          tariff_schedule_version: "tariff-v1",
          business_calendar_version: "calendar-v1",
        },
      });
      const saved = JSON.parse(metadata.energyIq.savedAnalyses.get("saved-v1").analysis_json) as unknown;

      expect({ latest, pinned, saved }).toMatchObject({
        latest: {
          tariff: { status: "available", tariff_schedule_version: "tariff-v2", total_cost: 4 },
          operating: { status: "available", business_calendar_version: "calendar-v2", operating_kwh: 10, standby_kwh: 0 },
        },
        pinned: {
          tariff: { status: "available", tariff_schedule_version: "tariff-v1", total_cost: 2 },
          operating: { status: "available", business_calendar_version: "calendar-v1", operating_kwh: 0, standby_kwh: 10 },
        },
        saved: {
          tariff: { status: "available", tariff_schedule_version: "tariff-v1", total_cost: 2 },
          operating: { status: "available", business_calendar_version: "calendar-v1", operating_kwh: 0, standby_kwh: 10 },
        },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps activated policy revisions pending until Project Setup publishes a new release", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-policy-pending-release-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-pending-release",
        owner_user_id: "dev-user",
        name: "Pending Release Workspace",
        kind: "customer",
      });
      metadata.energyIq.projectSetup.bootstrapPublished({
        project: {
          id: "project-pending-release",
          workspace_id: "workspace-pending-release",
          name: "Pending Release Project",
          timezone: "Asia/Singapore",
          hierarchy_revision_id: "project-pending-release-hierarchy-v1",
          meter_formula_revision_id: "project-pending-release-meter-v1",
          business_calendar_version: "calendar-v1",
          tariff_schedule_version: "tariff-v1",
          root_scope_id: "project-pending-release-root",
        },
        document: {
          project: { name: "Pending Release Project", timezone: "Asia/Singapore" },
          tier_structure_locked: true,
          tiers: [{ id: "tier-level", ordinal: 1, alias: "Level" }],
          nodes: [{
            id: "level-1",
            tier_definition_id: "tier-level",
            name: "Level 1",
            sort_order: 1,
            metadata_status: "confirmed",
          }],
        },
        published_by: "dev-user",
      });

      publishTariff(metadata, "project-pending-release", "tariff-v2", 0.4, true);
      publishCalendar(
        metadata,
        "project-pending-release",
        "calendar-v2",
        operatingWeek("08:00", "18:00"),
        true,
      );

      expect(metadata.energyIq.operationalPolicy.getActivePolicyVersions("project-pending-release"))
        .toEqual({
          tariff_schedule_version: "tariff-v2",
          business_calendar_version: "calendar-v2",
        });
      expect(metadata.energyIq.getProject("project-pending-release")).toMatchObject({
        tariff_schedule_version: "tariff-v1",
        business_calendar_version: "calendar-v1",
        has_unpublished_changes: true,
      });

      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: "project-pending-release",
        user_id: "dev-user",
      });
      metadata.energyIq.projectSetup.publishDraft({
        project_id: "project-pending-release",
        expected_revision: draft.revision,
        user_id: "dev-user",
      });

      expect(metadata.energyIq.templates.getLatestProjectRevision("project-pending-release"))
        .toMatchObject({
          tariff_schedule_version: "tariff-v2",
          business_calendar_version: "calendar-v2",
        });
      expect(metadata.energyIq.getProject("project-pending-release")).toMatchObject({
        tariff_schedule_version: "tariff-v2",
        business_calendar_version: "calendar-v2",
        has_unpublished_changes: false,
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate Tariff entry IDs even when adjacent entries carry different rates", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-tariff-entry-id-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-duplicate",
        owner_user_id: "dev-user",
        name: "Duplicate Entry Workspace",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-duplicate",
        workspace_id: "workspace-duplicate",
        name: "Duplicate Entry Project",
        status: "published",
        root_scope_id: "project-duplicate-root",
      });

      expect(() => metadata.energyIq.operationalPolicy.publishTariffSchedule({
        version_id: "tariff-duplicate-id",
        project_id: "project-duplicate",
        published_by: "dev-user",
        entries: [
          {
            id: "duplicate-rate",
            owner: { kind: "project" },
            effective_from: "2026-07-01T00:00:00+08:00",
            effective_to: "2026-07-01T12:00:00+08:00",
            currency: "SGD",
            rate_per_kwh: 0.2,
          },
          {
            id: "duplicate-rate",
            owner: { kind: "project" },
            effective_from: "2026-07-01T12:00:00+08:00",
            effective_to: "2026-07-02T00:00:00+08:00",
            currency: "SGD",
            rate_per_kwh: 0.4,
          },
        ],
      })).toThrowError("ENERGYIQ_TARIFF_ENTRY_ID_DUPLICATE:duplicate-rate");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a Scope lineage whose parent belongs to another Project", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-policy-lineage-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-lineage",
        owner_user_id: "dev-user",
        name: "Lineage Workspace",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-lineage-a",
        workspace_id: "workspace-lineage",
        name: "Project A",
        status: "published",
        root_scope_id: "project-a-root",
      });
      metadata.energyIq.upsertProject({
        id: "project-lineage-b",
        workspace_id: "workspace-lineage",
        name: "Project B",
        status: "published",
        root_scope_id: "project-b-root",
      });
      metadata.energyIq.upsertProjectNode({
        id: "project-b-root",
        project_id: "project-lineage-b",
        name: "Project B",
        node_type: "project",
      });
      metadata.energyIq.upsertProjectNode({
        id: "project-a-circuit",
        project_id: "project-lineage-a",
        parent_id: "project-b-root",
        name: "Circuit",
        node_type: "circuit",
      });

      expect(() => metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-lineage-a",
        scope_id: "project-a-circuit",
        period: { from: "2026-07-01T00:00:00+08:00", to: "2026-07-02T00:00:00+08:00" },
        intervals: [],
        policy_source: { mode: "active" },
      })).toThrowError("ENERGYIQ_POLICY_SCOPE_LINEAGE_INVALID:project-a-circuit:project-b-root");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("enforces Project ownership on active policy bindings in SQLite", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-policy-binding-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-binding",
        owner_user_id: "dev-user",
        name: "Binding Workspace",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-binding-a",
        workspace_id: "workspace-binding",
        name: "Project A",
        status: "published",
      });
      metadata.energyIq.upsertProject({
        id: "project-binding-b",
        workspace_id: "workspace-binding",
        name: "Project B",
        status: "published",
      });
      metadata.energyIq.operationalPolicy.publishTariffSchedule({
        version_id: "project-b-tariff",
        project_id: "project-binding-b",
        published_by: "dev-user",
        entries: [{
          id: "project-b-rate",
          owner: { kind: "project" },
          effective_from: "2026-07-01T00:00:00+08:00",
          currency: "SGD",
          rate_per_kwh: 0.2,
        }],
      });

      expect(() => metadata.db.prepare(`
        INSERT INTO energyiq_operational_policy_bindings (
          project_id, tariff_schedule_version, business_calendar_version, updated_by, updated_at
        ) VALUES (?, ?, NULL, ?, ?)
      `).run(
        "project-binding-a",
        "project-b-tariff",
        "dev-user",
        "2026-08-04T00:00:00.000Z",
      )).toThrowError(/FOREIGN KEY constraint failed/);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when an untyped caller supplies only one Release-pinned operational-policy version", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-policy-source-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-5",
        owner_user_id: "dev-user",
        name: "Workspace 5",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-5",
        workspace_id: "workspace-5",
        name: "Project 5",
        status: "published",
        timezone: "Asia/Singapore",
        root_scope_id: "project-5-root",
      });
      const evaluateUntyped = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy.bind(
        metadata.energyIq.operationalPolicy,
      ) as (input: unknown) => unknown;

      expect(() => evaluateUntyped({
        project_id: "project-5",
        scope_id: "project-5-root",
        period: { from: "2026-07-01T00:00:00+08:00", to: "2026-07-02T00:00:00+08:00" },
        intervals: [],
        policy_source: {
          mode: "release-pinned",
          tariff_schedule_version: "tariff-v1",
        },
      })).toThrowError("ENERGYIQ_OPERATIONAL_POLICY_SOURCE_INVALID");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const operatingWeek = (from: string, to: string) => ({
  monday: [{ from, to }],
  tuesday: [{ from, to }],
  wednesday: [{ from, to }],
  thursday: [{ from, to }],
  friday: [{ from, to }],
  saturday: [],
  sunday: [],
});

const closedWeek = () => ({
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
});

const publishTariff = (
  metadata: ReturnType<typeof createMetadataStore>,
  projectId: string,
  versionId: string,
  rate: number,
  activate: boolean,
) => metadata.energyIq.operationalPolicy.publishTariffSchedule({
  version_id: versionId,
  project_id: projectId,
  published_by: "dev-user",
  activate,
  entries: [{
    id: `${versionId}-rate`,
    owner: { kind: "project" },
    effective_from: "2026-07-01T00:00:00+08:00",
    effective_to: "2026-07-02T00:00:00+08:00",
    currency: "SGD",
    rate_per_kwh: rate,
  }],
});

const publishCalendar = (
  metadata: ReturnType<typeof createMetadataStore>,
  projectId: string,
  versionId: string,
  weekly: ReturnType<typeof operatingWeek>,
  activate: boolean,
) => metadata.energyIq.operationalPolicy.publishOperatingCalendar({
  version_id: versionId,
  project_id: projectId,
  published_by: "dev-user",
  activate,
  entries: [{
    id: `${versionId}-hours`,
    owner: { kind: "project" },
    effective_from: "2026-07-01",
    effective_to: "2026-07-02",
    weekly,
  }],
});

const unavailableCode = (value: {
  status: "available" | "unavailable";
  reason?: { code: string };
}): string => value.status === "unavailable" ? value.reason?.code ?? "MISSING_REASON" : "AVAILABLE";

type PolicySource = Parameters<
  ReturnType<typeof createMetadataStore>["energyIq"]["operationalPolicy"]["evaluateAnalysisPolicy"]
>[0]["policy_source"];

// @ts-expect-error A Release source is invalid unless both versions are pinned.
const partialReleasePolicySource: PolicySource = {
  mode: "release-pinned",
  tariff_schedule_version: "tariff-v1",
};
void partialReleasePolicySource;
