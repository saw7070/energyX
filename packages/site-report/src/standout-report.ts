/**
 * The site report's short "Days that stood out" block: the days that used clearly more or less than a usual day of
 * the same kind, each with the meters that account for most of the difference. Kept apart from site-report-model.ts,
 * which only asks for the finished block.
 */
import { listText } from "./analysis-messages.js";
import { scopeDays, shortDate } from "./analysis-model.js";
import type { AnalysisData, AnalysisGroups } from "./analysis-types.js";
import type { EnergyIqLocale } from "./locale.js";
import { explainDays, meterGroupPlaces, STANDOUT_MOST_SHARE, STANDOUT_NAMED_MIN_KWH, STANDOUT_NAMED_SHARE, standoutDays, standoutMeters, type DayExplanation, type StandoutContributor } from "./standout-days.js";
import { daySentence, meterPlace, sharedMeterNames, standoutRule, standoutText } from "./standout-messages.js";

/** At most this many days are written out; the rest are counted. */
export const REPORT_STANDOUT_DAYS = 5;

/** Consecutive dates as one span: "3 Nov – 5 Nov", "9 Nov". */
function dateSpans(dates: string[], locale: EnergyIqLocale) {
  const spans: string[][] = [];
  for (const date of [...dates].sort()) {
    const last = spans.at(-1);
    if (last && Date.parse(`${date}T00:00:00Z`) - Date.parse(`${last.at(-1)}T00:00:00Z`) === 86_400_000) last.push(date); else spans.push([date]);
  }
  return spans.map(span => span.length === 1 ? shortDate(span[0]!, locale) : `${shortDate(span[0]!, locale)} – ${shortDate(span.at(-1)!, locale)}`);
}

/** One meter is named instead of its group when it accounts for at least this share of the group's change. */
const ONE_METER_SHARE = 0.8;
/** A second group or circuit is named too when its change is at least this share of the first one's. */
const SECOND_SHARE = 0.5;

/** The group or circuit behind a standout day's difference: what it used that day and what it usually uses. */
export type DayBehind = { kind: "group" | "meter"; id: string; name: string; kwh: number; usualKwh: number; place?: string | undefined };

/**
 * What a standout day's difference comes down to, ranked by group: the innermost group (one with no group inside it)
 * whose meters together moved most the same way as the whole site, or, within it, the one meter that explains most of
 * its change; a meter filed directly in a group that has groups inside it, or in no group, counts on its own. Without
 * groups, the meter that moved most. Named only when it explains a real part of the difference (the rule that names
 * meters). A group is added up from its meters that have complete readings that day and a usual day of their own; one
 * that sent nothing that day (offline, or marked not in use) counts as no change, as it does for the whole day, so a
 * silent meter never hides the rest of its group. A second one is named too when it moved nearly as much (both blocks'
 * lobbies), so one is never blamed for what two did. Empty when nothing stands out.
 */
export function behindTheDay(item: DayExplanation, groups: AnalysisGroups | undefined): DayBehind[] {
  if (item.status !== "standout" || item.deltaKwh == null || !item.moves?.length) return [];
  const sign = Math.sign(item.deltaKwh);
  const toward = (delta: number) => delta * sign;
  const enough = (delta: number) => toward(delta) >= Math.max(STANDOUT_NAMED_MIN_KWH, Math.abs(item.deltaKwh!) * STANDOUT_NAMED_SHARE);
  const meter = (move: StandoutContributor): DayBehind => ({ kind: "meter", id: move.id, name: move.name, kwh: move.kwh, usualKwh: move.usualKwh, place: move.place });
  const moves = new Map(item.moves.map(move => [move.id, move]));
  const known = new Map((groups?.list ?? []).map(group => [group.id, group]));
  const hasInside = new Set((groups?.list ?? []).flatMap(group => group.parentId && known.has(group.parentId) ? [group.parentId] : []));
  const members = new Map<string, string[]>();
  for (const entry of groups?.meters ?? []) if (entry.groupId && known.has(entry.groupId) && !hasInside.has(entry.groupId)) members.set(entry.groupId, [...(members.get(entry.groupId) ?? []), entry.id]);
  const inGroup = new Set([...members.values()].flat());
  type Candidate = { deltaKwh: number; pick: () => DayBehind };
  const candidates: Candidate[] = [
    ...[...members].flatMap(([id, ids]): Candidate[] => {
      const list = ids.flatMap(member => moves.get(member) ?? []);
      if (!list.length) return [];
      const deltaKwh = list.reduce((sum, move) => sum + move.deltaKwh, 0);
      return [{ deltaKwh, pick: () => {
        // One meter that explains most of its group's change is named itself: the circuit behind it. A group of one
        // meter is named by the group.
        const lead = [...list].sort((a, b) => toward(b.deltaKwh) - toward(a.deltaKwh))[0]!;
        return ids.length > 1 && toward(lead.deltaKwh) >= ONE_METER_SHARE * toward(deltaKwh) ? meter(lead)
          : { kind: "group", id, name: known.get(id)!.name, kwh: list.reduce((sum, move) => sum + move.kwh, 0), usualKwh: list.reduce((sum, move) => sum + move.usualKwh, 0) };
      } }];
    }),
    ...item.moves.filter(move => !inGroup.has(move.id)).map((move): Candidate => ({ deltaKwh: move.deltaKwh, pick: () => meter(move) })),
  ];
  const [best, next] = candidates.sort((a, b) => toward(b.deltaKwh) - toward(a.deltaKwh));
  if (!best || !enough(best.deltaKwh)) return [];
  return next && enough(next.deltaKwh) && toward(next.deltaKwh) >= SECOND_SHARE * toward(best.deltaKwh) ? [best.pick(), next.pick()] : [best.pick()];
}

/** "1.29 kWh", "0.9 kWh", "12.4 kWh": two decimals below 10, one above, without trailing zeros, the same in every language. */
export const behindKwh = (value: number) => `${value.toFixed(value >= 10 ? 1 : 2).replace(/\.?0+$/, "") || "0"} kWh`;

/**
 * "On 8 Nov the Block 264F block lighting used 1.29 kWh; it usually uses 0.9 kWh." A second one named is a sentence of
 * its own, and when what is named explains less than half of the day's difference, a last sentence says other meters
 * moved the same way.
 */
export function behindSentence(item: DayExplanation, behind: readonly DayBehind[], context: { locale: EnergyIqLocale; groups: AnalysisGroups | undefined; shared: ReadonlySet<string> }): string {
  const { locale } = context, t = standoutText(locale), en = locale === "en";
  // A name with a number in it ("Block 264E") is a proper name and stays as it is; English lowers an everyday group
  // name inside the sentence ("the block lighting"), and a code like "L1-L6A" stays as it is.
  const proper = (name: string) => /\d/.test(name);
  const inline = (name: string) => en && !proper(name) && /^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
  const nameOf = (one: DayBehind) => {
    if (one.kind === "meter") {
      const where = context.shared.has(one.name) ? meterPlace(one.place ?? "") : "";
      return t(where ? "behind.meterIn" : "behind.meter", { name: one.name, where });
    }
    const list = context.groups?.list ?? [];
    const group = list.find(entry => entry.id === one.id);
    const parent = group?.parentId ? list.find(entry => entry.id === group.parentId) : undefined;
    // Two groups with the same name (Block lighting in each block) are told apart by the group above them.
    const twin = list.some(entry => entry.id !== one.id && entry.name === one.name);
    return twin && parent ? t("behind.groupIn", { top: parent.name, name: inline(one.name) })
      : t(proper(one.name) ? "behind.groupNamed" : "behind.group", { name: inline(one.name) });
  };
  // English says "they usually use" for "Emergency lights" and "it" for "Block lighting"; other languages need neither.
  const plural = (one: DayBehind) => en && /[^s]s$/.test(one.name);
  const values = (one: DayBehind) => ({ kwh: behindKwh(one.kwh), usual: behindKwh(one.usualKwh) });
  const [first, second] = behind;
  if (!first) return "";
  const named = behind.reduce((sum, one) => sum + one.kwh - one.usualKwh, 0);
  const spread = item.deltaKwh != null && named * Math.sign(item.deltaKwh) < Math.abs(item.deltaKwh) * STANDOUT_MOST_SHARE;
  return [
    t(plural(first) ? "behind.day.plural" : "behind.day", { date: shortDate(item.date, locale), name: nameOf(first), ...values(first) }),
    second ? t(plural(second) ? "behind.also.plural" : "behind.also", { name: capitalise(nameOf(second)), ...values(second) }) : "",
    spread ? t(item.deltaKwh! > 0 ? "behind.spread.more" : "behind.spread.less") : "",
  ].filter(Boolean).join(locale === "zh-Hans" ? "" : " ");
}
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export type StandoutReport = {
  title: string;
  /** One sentence or two per day, the clearest difference first. */
  items: Array<{ date: string; text: string }>;
  /** "No day stood out…", how many more days stood out, and which days were not compared for missing readings. */
  note: string;
  /** The rule for calling a day out, in one plain sentence. */
  rule: string;
};

export function standoutReport(data: AnalysisData, locale: EnergyIqLocale = "en"): StandoutReport {
  const t = standoutText(locale);
  const lighting = data.hoursMeaning === "lights_on";
  const meters = standoutMeters([data.current.project, ...data.current.spaces]);
  const places = meterGroupPlaces(data.groups);
  const explained = explainDays({ days: scopeDays(data.current.project, data.holidays), meters, lighting, places });
  const shared = sharedMeterNames(meters);
  const found = standoutDays(explained);
  const shown = found.slice(0, REPORT_STANDOUT_DAYS);
  // Days with no readings at all are outside the data, not gaps worth naming.
  const missing = explained.filter(item => item.status === "missing" && item.totalKwh > 0).map(item => item.date);
  const runs = dateSpans(missing, locale);
  const note = [
    found.length ? "" : t(lighting ? "lights.none" : "none"),
    found.length > shown.length ? t(found.length - shown.length === 1 ? "moreDays.one" : "moreDays.other", { count: found.length - shown.length }) : "",
    missing.length ? t(missing.length === 1 ? "missingDays.one" : "missingDays.other", { dates: listText(runs, locale) }) : "",
  ].filter(Boolean).join(locale === "zh-Hans" ? "" : " ");
  return {
    title: t("title"),
    // Each day in one short sentence about the group or circuit behind it; the whole-site sentence when nothing stands out.
    items: shown.sort((a, b) => a.date.localeCompare(b.date)).map(item => {
      const behind = behindTheDay(item, data.groups);
      return { date: item.date, text: behind.length ? behindSentence(item, behind, { locale, groups: data.groups, shared }) : daySentence(item, locale, shared) };
    }),
    note,
    rule: standoutRule(locale, lighting),
  };
}
