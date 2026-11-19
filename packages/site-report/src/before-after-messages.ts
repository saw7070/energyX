/**
 * The words for a change's before and after (before-after.ts), in every language: the takeaway ("Since 1 Dec, night
 * use is 29% lower: about 14 kWh a day, S$118 a month."), how sure it is, and how it was compared. Analysis uses them
 * now; the energy review and the Overview can use the same sentences.
 */
import { openingLabel, shortDate } from "./analysis-model.js";
import { BEFORE_AFTER_MIN_DAYS, BEFORE_AFTER_RELIABLE_DAYS, type BeforeAfter, type BeforeAfterComparison } from "./before-after.js";
import { defineMessages, forHoursMeaning, translatorFor, type EnergyIqLocale } from "./locale.js";
import { moneyText } from "./site-report-model.js";

export const beforeAfterMessages = defineMessages({
  "what.site": "use",
  "lights.what.site": "night use",
  "what.meters": "use on the {count} meters it affects",
  "lights.what.meters": "night use on the {count} meters it affects",
  "what.meter": "use on {name}",
  "lights.what.meter": "night use on {name}",
  "takeaway.lower": "Since {date}, {what} is {pct}% lower: about {kwh} a day, {cost} a month.",
  "takeaway.lowerKwh": "Since {date}, {what} is {pct}% lower: about {kwh} a day, {month} a month.",
  "takeaway.higher": "Since {date}, {what} is {pct}% higher: about {kwh} a day more, {cost} a month.",
  "takeaway.higherKwh": "Since {date}, {what} is {pct}% higher: about {kwh} a day more, {month} a month.",
  "takeaway.same": "Since {date}, {what} is about the same as before.",
  "takeaway.new": "Since {date}, {what} is about {kwh} a day, where it was nothing before.",
  waiting: "Recorded: {title} starts {date}. The comparison appears after {min} complete days.",
  waitingSome: "Recorded: {title} starts {date}. The comparison appears after {min} complete days ({days} so far).",
  noBefore: "Since {date} there are {after} complete days to compare, but too few complete days before the change: {before} of the {min} needed.",
  baseline: "Before the change, {what} averaged {kwh} a day over {days} complete days.",
  "status.earlyAfter": "Early figure: {after} complete days since the change. It is called reliable from {reliable} days.",
  "status.earlyBefore": "Early figure: only {before} complete days before the change to compare with. It is called reliable from {reliable} days.",
  "status.reliable": "Reliable: {after} complete days since the change, against {before} before it.",
  "basis.lights": "Compared like for like: only the lights-on hours ({hours}), on the same kinds of day (weekdays, weekends, public holidays), complete days only. The day of the change is left out.",
  "basis.day": "Compared like for like: whole days of the same kinds (weekdays, weekends, public holidays), complete days only. The day of the change is left out.",
  "unmatched.one": "1 day since the change is left out: no day of the same kind came before it.",
  "unmatched.other": "{count} days since the change are left out: no day of the same kind came before them.",
}, {
  "zh-Hans": {
    "what.site": "用电",
    "lights.what.site": "夜间用电",
    "what.meters": "受影响的 {count} 个电表的用电",
    "lights.what.meters": "受影响的 {count} 个电表的夜间用电",
    "what.meter": "{name} 的用电",
    "lights.what.meter": "{name} 的夜间用电",
    "takeaway.lower": "自{date}起，{what}降低了 {pct}%：每天约少 {kwh}，每月约省 {cost}。",
    "takeaway.lowerKwh": "自{date}起，{what}降低了 {pct}%：每天约少 {kwh}，每月约少 {month}。",
    "takeaway.higher": "自{date}起，{what}增加了 {pct}%：每天约多 {kwh}，每月约多花 {cost}。",
    "takeaway.higherKwh": "自{date}起，{what}增加了 {pct}%：每天约多 {kwh}，每月约多 {month}。",
    "takeaway.same": "自{date}起，{what}与之前大致相同。",
    "takeaway.new": "自{date}起，{what}约为每天 {kwh}，而之前为零。",
    waiting: "已记录：{title}，{date}开始。有 {min} 个完整日的数据后即可比较。",
    waitingSome: "已记录：{title}，{date}开始。有 {min} 个完整日的数据后即可比较（目前 {days} 个）。",
    noBefore: "自{date}起已有 {after} 个完整日可比较，但改动前的完整日太少：只有 {before} 个，需要 {min} 个。",
    baseline: "改动前，{what}平均每天 {kwh}（{days} 个完整日）。",
    "status.earlyAfter": "初步结果：改动后有 {after} 个完整日。满 {reliable} 天后结果才算可靠。",
    "status.earlyBefore": "初步结果：改动前只有 {before} 个完整日可比较。满 {reliable} 天后结果才算可靠。",
    "status.reliable": "可靠结果：改动后 {after} 个完整日，与改动前 {before} 个完整日比较。",
    "basis.lights": "按同类比较：只比较亮灯时段（{hours}），并按同类日子（工作日、周末、公共假期）比较，只用完整日。改动当天不计入。",
    "basis.day": "按同类比较：按同类日子（工作日、周末、公共假期）比较全天用电，只用完整日。改动当天不计入。",
    "unmatched.one": "改动后有 1 天未计入：改动前没有同类日子可比较。",
    "unmatched.other": "改动后有 {count} 天未计入：改动前没有同类日子可比较。",
  },
  ms: {
    "what.site": "penggunaan",
    "lights.what.site": "penggunaan waktu malam",
    "what.meters": "penggunaan pada {count} meter yang terlibat",
    "lights.what.meters": "penggunaan waktu malam pada {count} meter yang terlibat",
    "what.meter": "penggunaan {name}",
    "lights.what.meter": "penggunaan waktu malam {name}",
    "takeaway.lower": "Sejak {date}, {what} {pct}% lebih rendah: kira-kira {kwh} sehari, {cost} sebulan.",
    "takeaway.lowerKwh": "Sejak {date}, {what} {pct}% lebih rendah: kira-kira {kwh} sehari, {month} sebulan.",
    "takeaway.higher": "Sejak {date}, {what} {pct}% lebih tinggi: kira-kira {kwh} lebih sehari, {cost} sebulan.",
    "takeaway.higherKwh": "Sejak {date}, {what} {pct}% lebih tinggi: kira-kira {kwh} lebih sehari, {month} sebulan.",
    "takeaway.same": "Sejak {date}, {what} lebih kurang sama seperti sebelumnya.",
    "takeaway.new": "Sejak {date}, {what} kira-kira {kwh} sehari, sedangkan sebelumnya tiada.",
    waiting: "Direkodkan: {title} bermula {date}. Perbandingan dipaparkan selepas {min} hari lengkap.",
    waitingSome: "Direkodkan: {title} bermula {date}. Perbandingan dipaparkan selepas {min} hari lengkap ({days} setakat ini).",
    noBefore: "Sejak {date} ada {after} hari lengkap untuk dibandingkan, tetapi terlalu sedikit hari lengkap sebelum perubahan: {before} daripada {min} yang diperlukan.",
    baseline: "Sebelum perubahan, {what} purata {kwh} sehari dalam {days} hari lengkap.",
    "status.earlyAfter": "Angka awal: {after} hari lengkap sejak perubahan. Ia dianggap boleh dipercayai mulai {reliable} hari.",
    "status.earlyBefore": "Angka awal: hanya {before} hari lengkap sebelum perubahan untuk dibandingkan. Ia dianggap boleh dipercayai mulai {reliable} hari.",
    "status.reliable": "Boleh dipercayai: {after} hari lengkap sejak perubahan, berbanding {before} hari sebelumnya.",
    "basis.lights": "Dibandingkan secara setara: hanya waktu lampu menyala ({hours}), pada jenis hari yang sama (hari bekerja, hujung minggu, cuti umum), hari lengkap sahaja. Hari perubahan tidak dikira.",
    "basis.day": "Dibandingkan secara setara: sehari penuh pada jenis hari yang sama (hari bekerja, hujung minggu, cuti umum), hari lengkap sahaja. Hari perubahan tidak dikira.",
    "unmatched.one": "1 hari sejak perubahan tidak dikira: tiada hari yang sama jenis sebelum perubahan.",
    "unmatched.other": "{count} hari sejak perubahan tidak dikira: tiada hari yang sama jenis sebelumnya.",
  },
});
export type BeforeAfterMessageKey = keyof typeof beforeAfterMessages.en;

// Numbers keep one format (1,234.5) in every language, as on the rest of EnergyIQ.
const grouped = (value: number, digits = 0) => value.toLocaleString("en-SG", { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** "14 kWh" for a day's worth from 10 kWh, "6.4 kWh" below it. */
export const beforeAfterKwh = (value: number) => `${grouped(Math.abs(value), Math.abs(value) >= 10 ? 0 : 1)} kWh`;
/** A whole number of percent without its sign, for "{pct}%": 29. */
export const beforeAfterPct = (value: number) => Math.round(Math.abs(value));
/** Below this many percent either way, the change reads "about the same as before". */
export const BEFORE_AFTER_SAME_PCT = 1;

const textFor = (result: Pick<BeforeAfter, "measure">, locale: EnergyIqLocale) =>
  forHoursMeaning(translatorFor(beforeAfterMessages, locale), beforeAfterMessages, result.measure === "lights_on" ? "lights_on" : "opening");

/** What is compared, inside a sentence: "night use", "use on the 3 meters it affects", "night use on Block lighting". */
export function beforeAfterWhat(result: Pick<BeforeAfter, "measure" | "scope" | "meters">, locale: EnergyIqLocale = "en"): string {
  const t = textFor(result, locale);
  if (result.scope === "site") return t("what.site");
  return result.meters.length === 1 ? t("what.meter", { name: result.meters[0]!.name }) : t("what.meters", { count: result.meters.length });
}

/**
 * The one sentence a reader needs: what changed since the change and what it is worth, or that it is recorded and
 * waiting for its days, or that there are too few days before it to compare with.
 */
export function beforeAfterTakeaway(result: BeforeAfter, locale: EnergyIqLocale = "en"): string {
  const t = textFor(result, locale);
  const date = shortDate(result.change.date, locale);
  const what = beforeAfterWhat(result, locale);
  if (result.status === "upcoming" || result.status === "waiting") {
    return result.afterDays > 0
      ? t("waitingSome", { title: result.change.title, date, min: BEFORE_AFTER_MIN_DAYS, days: result.afterDays })
      : t("waiting", { title: result.change.title, date, min: BEFORE_AFTER_MIN_DAYS });
  }
  const figures = result.figures;
  if (!figures) return t("noBefore", { date, after: result.afterDays, before: result.beforeDays, min: BEFORE_AFTER_MIN_DAYS });
  if (figures.changePct == null) return figures.afterKwh > 0 ? t("takeaway.new", { date, what, kwh: beforeAfterKwh(figures.afterKwh) }) : t("takeaway.same", { date, what });
  if (Math.abs(figures.changePct) < BEFORE_AFTER_SAME_PCT) return t("takeaway.same", { date, what });
  const lower = figures.changeKwh < 0;
  const cost = figures.month.change.cost;
  const values = {
    date, what, pct: beforeAfterPct(figures.changePct), kwh: beforeAfterKwh(figures.changeKwh),
    cost: cost != null && result.currency ? moneyText(Math.abs(cost), result.currency) : "",
    month: `${grouped(Math.abs(figures.month.change.kwh))} kWh`,
  };
  return t(lower ? cost != null && result.currency ? "takeaway.lower" : "takeaway.lowerKwh" : cost != null && result.currency ? "takeaway.higher" : "takeaway.higherKwh", values);
}

/** The baseline while a change waits for its days: "Before the change, night use averaged 47 kWh a day over 28 complete days." Empty without one. */
export function beforeAfterBaseline(result: BeforeAfter, locale: EnergyIqLocale = "en"): string {
  if (result.baselineKwh == null || !result.beforeDays) return "";
  return textFor(result, locale)("baseline", { what: beforeAfterWhat(result, locale), kwh: beforeAfterKwh(result.baselineKwh), days: result.beforeDays });
}

/** How sure the figure is: early (and why) or reliable, plus any days since the change left out. Empty without a figure. */
export function beforeAfterStatusNote(result: BeforeAfterComparison & Pick<BeforeAfter, "measure">, locale: EnergyIqLocale = "en"): string {
  const t = textFor(result, locale);
  const parts: string[] = [];
  if (result.status === "reliable") parts.push(t("status.reliable", { after: result.afterDays, before: result.beforeDays }));
  if (result.status === "early") parts.push(result.afterDays < BEFORE_AFTER_RELIABLE_DAYS
    ? t("status.earlyAfter", { after: result.afterDays, reliable: BEFORE_AFTER_RELIABLE_DAYS })
    : t("status.earlyBefore", { before: result.beforeDays, reliable: BEFORE_AFTER_RELIABLE_DAYS }));
  if (result.figures && result.unmatchedAfterDays) parts.push(t(result.unmatchedAfterDays === 1 ? "unmatched.one" : "unmatched.other", { count: result.unmatchedAfterDays }));
  return parts.join(locale === "zh-Hans" ? "" : " ");
}

/** How the days were compared: the same hours (the lights-on hours, or whole days), the same kinds of day, complete days only. */
export function beforeAfterBasis(result: Pick<BeforeAfter, "measure" | "hours">, locale: EnergyIqLocale = "en"): string {
  const t = textFor(result, locale);
  return result.measure === "lights_on" ? t("basis.lights", { hours: openingLabel(result.hours, locale, "lights_on") }) : t("basis.day");
}
