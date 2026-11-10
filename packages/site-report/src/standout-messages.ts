/**
 * Wording for "why was this day different?" (standout-days.ts), in every language, and the helpers that turn one
 * day's explanation into plain sentences. The Analysis chart and the Overview report both speak through these.
 */
import { listText } from "./analysis-messages.js";
import { dateWithDay } from "./analysis-model.js";
import { defineMessages, translatorFor, type EnergyIqLocale } from "./locale.js";
import { STANDOUT_MIN_PCT, type DayExplanation, type DayKind, type StandoutContributor } from "./standout-days.js";

export const standoutMessages = defineMessages({
  "kind.weekday": "a usual weekday",
  "kind.weekend": "a usual weekend day",
  "kind.public_holiday": "a usual public holiday",
  "kind.any": "a usual day",
  "kinds.weekday": "weekdays",
  "kinds.weekend": "weekend days",
  "kinds.public_holiday": "public holidays",
  "kinds.any": "days",
  "day.more": "{date} used {kwh}, {delta} more than {kind} ({usual}).",
  "day.less": "{date} used {kwh}, {delta} less than {kind} ({usual}).",
  "day.close": "{date} used {kwh}, close to {kind} ({usual}).",
  "day.missing": "Readings were missing on this day, so it is not compared with a usual day.",
  "day.fewDays": "Too few complete {kinds} in these dates to say what is usual.",
  "lead.most.more": "Most of the extra:",
  "lead.most.less": "Most of the drop:",
  "lead.spread.more": "Biggest increases:",
  "lead.spread.less": "Biggest drops:",
  "lead.none": "No single meter accounts for much of it; the change was spread across many meters.",
  "rest": "The rest was spread across other meters.",
  "contrib.most.more": "Most of the extra: {items}.",
  "contrib.most.less": "Most of the drop: {items}.",
  "contrib.spread.more": "Biggest increases: {items}. The rest was spread across other meters.",
  "contrib.spread.less": "Biggest drops: {items}. The rest was spread across other meters.",
  "item": "{name} {delta}",
  "item.where": "{name} ({where}) {delta}",
  "rule": "A day is called out when it differs from a usual day of the same kind (the middle value of complete days in these dates) by more than {pct}% and by more than twice the normal day-to-day variation.",
  "lights.rule": "A day is called out when it differs from a usual day (the middle value of complete days in these dates) by more than {pct}% and by more than twice the normal day-to-day variation.",
  "title": "Days that stood out",
  "none": "No day stood out from a usual day of its kind.",
  "lights.none": "No day stood out from a usual day.",
  "moreDays.one": "Plus {count} more day.",
  "moreDays.other": "Plus {count} more days.",
  "missingDays.one": "Readings were missing on {dates}, so that day is not compared.",
  "missingDays.other": "Readings were missing on {dates}, so those days are not compared.",
}, {
  "zh-Hans": {
    "kind.weekday": "正常的工作日",
    "kind.weekend": "正常的周末日",
    "kind.public_holiday": "正常的公共假期",
    "kind.any": "正常日子",
    "kinds.weekday": "工作日",
    "kinds.weekend": "周末日",
    "kinds.public_holiday": "公共假期",
    "kinds.any": "日子",
    "day.more": "{date}用电 {kwh}，比{kind}（{usual}）多 {delta}。",
    "day.less": "{date}用电 {kwh}，比{kind}（{usual}）少 {delta}。",
    "day.close": "{date}用电 {kwh}，与{kind}（{usual}）相近。",
    "day.missing": "这一天读数缺失，因此不与正常日子比较。",
    "day.fewDays": "所选日期内读数完整的{kinds}太少，无法判断正常用电。",
    "lead.most.more": "多用的电主要来自：",
    "lead.most.less": "少用的电主要来自：",
    "lead.spread.more": "增加最多的是：",
    "lead.spread.less": "减少最多的是：",
    "lead.none": "没有哪个电表占了大部分，变化分散在许多电表上。",
    "rest": "其余分散在其他电表上。",
    "contrib.most.more": "多用的电主要来自：{items}。",
    "contrib.most.less": "少用的电主要来自：{items}。",
    "contrib.spread.more": "增加最多的是：{items}。其余分散在其他电表上。",
    "contrib.spread.less": "减少最多的是：{items}。其余分散在其他电表上。",
    "item": "{name} {delta}",
    "item.where": "{name}（{where}）{delta}",
    "rule": "某天与同类正常日子（所选日期内完整日子的中间值）相差超过 {pct}%，并且超过日常波动的两倍，才会被指出。",
    "lights.rule": "某天与正常日子（所选日期内完整日子的中间值）相差超过 {pct}%，并且超过日常波动的两倍，才会被指出。",
    "title": "与平常不同的日子",
    "none": "没有哪一天与同类正常日子明显不同。",
    "lights.none": "没有哪一天与正常日子明显不同。",
    "moreDays.one": "另有 {count} 天。",
    "moreDays.other": "另有 {count} 天。",
    "missingDays.one": "{dates}读数缺失，因此这一天不作比较。",
    "missingDays.other": "{dates}读数缺失，因此这些日子不作比较。",
  },
  ms: {
    "kind.weekday": "hari bekerja biasa",
    "kind.weekend": "hari hujung minggu biasa",
    "kind.public_holiday": "cuti umum biasa",
    "kind.any": "hari biasa",
    "kinds.weekday": "hari bekerja",
    "kinds.weekend": "hari hujung minggu",
    "kinds.public_holiday": "cuti umum",
    "kinds.any": "hari",
    "day.more": "{date} menggunakan {kwh}, {delta} lebih daripada {kind} ({usual}).",
    "day.less": "{date} menggunakan {kwh}, {delta} kurang daripada {kind} ({usual}).",
    "day.close": "{date} menggunakan {kwh}, hampir sama dengan {kind} ({usual}).",
    "day.missing": "Bacaan hilang pada hari ini, jadi ia tidak dibandingkan dengan hari biasa.",
    "day.fewDays": "Terlalu sedikit {kinds} lengkap dalam tarikh ini untuk menentukan penggunaan biasa.",
    "lead.most.more": "Kebanyakan lebihan daripada:",
    "lead.most.less": "Kebanyakan pengurangan daripada:",
    "lead.spread.more": "Kenaikan terbesar:",
    "lead.spread.less": "Penurunan terbesar:",
    "lead.none": "Tiada satu meter pun menyumbang sebahagian besar; perubahan tersebar di banyak meter.",
    "rest": "Selebihnya tersebar di meter lain.",
    "contrib.most.more": "Kebanyakan lebihan daripada: {items}.",
    "contrib.most.less": "Kebanyakan pengurangan daripada: {items}.",
    "contrib.spread.more": "Kenaikan terbesar: {items}. Selebihnya tersebar di meter lain.",
    "contrib.spread.less": "Penurunan terbesar: {items}. Selebihnya tersebar di meter lain.",
    "item": "{name} {delta}",
    "item.where": "{name} ({where}) {delta}",
    "rule": "Sesuatu hari ditonjolkan apabila ia berbeza daripada hari biasa yang sama jenis (nilai tengah hari lengkap dalam tarikh ini) lebih daripada {pct}% dan lebih daripada dua kali ganda perubahan harian biasa.",
    "lights.rule": "Sesuatu hari ditonjolkan apabila ia berbeza daripada hari biasa (nilai tengah hari lengkap dalam tarikh ini) lebih daripada {pct}% dan lebih daripada dua kali ganda perubahan harian biasa.",
    "title": "Hari yang menonjol",
    "none": "Tiada hari yang menonjol berbanding hari biasa yang sama jenis.",
    "lights.none": "Tiada hari yang menonjol berbanding hari biasa.",
    "moreDays.one": "Dan {count} hari lagi.",
    "moreDays.other": "Dan {count} hari lagi.",
    "missingDays.one": "Bacaan hilang pada {dates}, jadi hari itu tidak dibandingkan.",
    "missingDays.other": "Bacaan hilang pada {dates}, jadi hari-hari itu tidak dibandingkan.",
  },
});

export type StandoutKey = keyof typeof standoutMessages.en;
export const standoutText = (locale: EnergyIqLocale) => translatorFor(standoutMessages, locale);

/** "48.4 kWh", one decimal and the same digits in every language. */
export const standoutKwh = (value: number) => `${value.toLocaleString("en-SG", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`;
/** "+1.5 kWh" or "−0.6 kWh". */
export const signedKwh = (value: number) => `${value >= 0 ? "+" : "−"}${standoutKwh(Math.abs(value))}`;
/** Sentences of one paragraph; Chinese runs them together without spaces. */
const joinSentences = (parts: Array<string | null>, locale: EnergyIqLocale) => parts.filter(Boolean).join(locale === "zh-Hans" ? "" : " ");

/** A meter's group (or location), worth showing beside its name: not the project root ("Project") or the site itself. */
export const meterPlace = (place: string, siteName = "") => place && place !== "Project" && place !== siteName ? place : "";

/** The first sentence: how the day compares with a usual day of its kind, or why it is not compared. */
export function dayHeadline(item: DayExplanation, locale: EnergyIqLocale = "en"): string {
  const t = standoutText(locale);
  if (item.status === "missing") return t("day.missing");
  if (item.status === "few-days") return t("day.fewDays", { kinds: t(`kinds.${item.kind}`) });
  const values = { date: dateWithDay(item.date, locale), kwh: standoutKwh(item.totalKwh), kind: t(`kind.${item.kind}`), usual: standoutKwh(item.usualKwh!), delta: standoutKwh(Math.abs(item.deltaKwh!)) };
  return t(item.status === "usual" ? "day.close" : item.deltaKwh! > 0 ? "day.more" : "day.less", values);
}

/** "Most of the extra:" and the like, for a list of meters; null when there is no list to introduce. */
export function contributorsLead(item: DayExplanation, locale: EnergyIqLocale = "en"): string | null {
  if (item.status !== "standout" || (item.lead !== "most" && item.lead !== "spread")) return null;
  return standoutText(locale)(`lead.${item.lead}.${item.deltaKwh! > 0 ? "more" : "less"}`);
}

/** One meter and its change, with its place in brackets when another meter has the same name. */
export function contributorText(contributor: StandoutContributor, locale: EnergyIqLocale = "en", sharedNames: ReadonlySet<string> = new Set()) {
  const t = standoutText(locale);
  const where = sharedNames.has(contributor.name) ? meterPlace(contributor.place) : "";
  return t(where ? "item.where" : "item", { name: contributor.name, where, delta: signedKwh(contributor.deltaKwh) });
}

/** The second sentence for a standout day: which meters account for most of the difference. Null without meter readings. */
export function contributorsSentence(item: DayExplanation, locale: EnergyIqLocale = "en", sharedNames: ReadonlySet<string> = new Set()): string | null {
  if (item.status !== "standout" || !item.lead) return null;
  const t = standoutText(locale);
  if (item.lead === "none") return t("lead.none");
  return t(`contrib.${item.lead}.${item.deltaKwh! > 0 ? "more" : "less"}`, { items: listText(item.contributors.map(contributor => contributorText(contributor, locale, sharedNames)), locale) });
}

/** The whole explanation of one day as plain sentences, e.g. for the report or a screen reader. */
export const daySentence = (item: DayExplanation, locale: EnergyIqLocale = "en", sharedNames: ReadonlySet<string> = new Set()) =>
  joinSentences([dayHeadline(item, locale), contributorsSentence(item, locale, sharedNames)], locale);

/** The rule for calling a day out, in one plain sentence. */
export const standoutRule = (locale: EnergyIqLocale = "en", lighting = false) => standoutText(locale)(lighting ? "lights.rule" : "rule", { pct: STANDOUT_MIN_PCT });

/** Names used by more than one meter, so a sentence can add the place to tell them apart. */
export const sharedMeterNames = (meters: Array<{ name: string }>) => {
  const seen = new Set<string>(), shared = new Set<string>();
  for (const meter of meters) (seen.has(meter.name) ? shared : seen).add(meter.name);
  return shared;
};

/** The word for one kind of day, for headings: "a usual weekday". */
export const usualKindText = (kind: DayKind, locale: EnergyIqLocale = "en") => standoutText(locale)(`kind.${kind}`);
