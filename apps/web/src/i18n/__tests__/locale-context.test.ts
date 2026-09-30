import { describe, expect, it } from "vitest";
import {
  createTranslator,
  toggleLocaleValue,
} from "../translate";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY } from "../types";

describe("locale translate", () => {
  it("defaults to zh-CN copy for sidebar shell keys", () => {
    const t = createTranslator("zh-CN");
    expect(t("sidebar.analysisTitle")).toBe("AI 分析");
    expect(t("sidebar.newTask")).toBe("新建数据任务");
    expect(t("sidebar.workspaceResources")).toBe("工作区资源");
    expect(t("sidebar.sessionCount", { count: 3 })).toBe("3 个会话");
  });

  it("falls back to English when a key is missing in zh-CN", () => {
    const t = createTranslator("zh-CN");
    expect(t("missing.key.path")).toBe("missing.key.path");
  });

  it("interpolates English templates", () => {
    const t = createTranslator("en");
    expect(t("sidebar.analysisTitle")).toBe("AI Analyst");
    expect(t("sidebar.sessionCount", { count: 2 })).toBe("2 sessions");
  });

  it("toggles locale values", () => {
    expect(toggleLocaleValue("zh-CN")).toBe("en");
    expect(toggleLocaleValue("en")).toBe("zh-CN");
  });

  it("uses the EnergyX storage key and English default locale", () => {
    expect(LOCALE_STORAGE_KEY).toBe("energyiq:locale:v2");
    expect(DEFAULT_LOCALE).toBe("en");
  });
});
