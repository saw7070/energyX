import type { EnergyOperatingDayDto, EnergyTariffFixedChargeDto } from "../../../lib/config-api";

/**
 * What a new project starts from in each country: its time zone, money, tax, published electricity tariffs, usual
 * opening hours and public holidays. Everything here is a starting point the person checks and can change before
 * the project is created; the figures carry their source and date so nobody mistakes them for their own bill.
 */
export type CountryCode = "SG" | "MY";

export type TariffPresetId = "sg-sp-regulated" | "my-tnb-lv-general" | "my-tnb-lv-tou" | "my-tnb-mv-general" | "my-tnb-mv-tou";
/** A published tariff, or the person's own price. */
export type TariffPlanId = TariffPresetId | "custom";

export type TariffPreset = {
  id: TariffPresetId;
  country: CountryCode;
  /** Price per kWh, or the off-peak price when peak is set. In the currency's main unit (S$, RM). */
  rate: number;
  peak?: { rate: number; days: EnergyOperatingDayDto[]; from: string; to: string };
  /** Parts of the price per kWh, shown so people can match it to their bill. Values in sen/cents. */
  parts: Array<{ key: TariffPartKey; peak?: number; value: number }>;
  fixedCharges: EnergyTariffFixedChargeDto[];
  source: string;
};

export type TariffPartKey = "energy" | "capacity" | "network" | "afa" | "allIn";

export type CountryDefaults = {
  timezone: string;
  currency: string;
  tax: { name: string; pct: number; basis: "tax_exclusive" | "tax_inclusive" } | null;
  tariffs: TariffPreset[];
};

const WEEKDAYS: EnergyOperatingDayDto[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];

// Fuel adjustment (AFA) for September 2026, set monthly by the Energy Commission.
const AFA_SEN = 3.67;
const sen = (value: number) => Math.round(value * 100) / 10_000;

export const COUNTRY_DEFAULTS: Record<CountryCode, CountryDefaults> = {
  SG: {
    timezone: "Asia/Singapore",
    currency: "SGD",
    tax: { name: "GST", pct: 9, basis: "tax_exclusive" },
    tariffs: [
      {
        id: "sg-sp-regulated",
        country: "SG",
        rate: 0.2859,
        parts: [{ key: "allIn", value: 28.59 }],
        fixedCharges: [],
        source: "SP Group regulated tariff, 1 Oct – 31 Dec 2026, before 9% GST",
      },
    ],
  },
  MY: {
    timezone: "Asia/Kuala_Lumpur",
    currency: "MYR",
    // TNB lists commercial and industrial accounts as not charged SST on electricity.
    tax: null,
    tariffs: [
      {
        id: "my-tnb-lv-general",
        country: "MY",
        rate: sen(27.03 + 8.83 + 14.82 + AFA_SEN),
        parts: [
          { key: "energy", value: 27.03 }, { key: "capacity", value: 8.83 },
          { key: "network", value: 14.82 }, { key: "afa", value: AFA_SEN },
        ],
        fixedCharges: [{ label: "Retail charge", amount: 20, unit: "per_month" }],
        source: "TNB non-domestic tariff (RP4, from 1 Jul 2025), fuel adjustment for Sep 2026",
      },
      {
        id: "my-tnb-lv-tou",
        country: "MY",
        rate: sen(24.43 + 8.83 + 14.82 + AFA_SEN),
        peak: { rate: sen(28.52 + 8.83 + 14.82 + AFA_SEN), days: WEEKDAYS, from: "14:00", to: "22:00" },
        parts: [
          { key: "energy", peak: 28.52, value: 24.43 }, { key: "capacity", value: 8.83 },
          { key: "network", value: 14.82 }, { key: "afa", value: AFA_SEN },
        ],
        fixedCharges: [{ label: "Retail charge", amount: 20, unit: "per_month" }],
        source: "TNB non-domestic tariff (RP4, from 1 Jul 2025), fuel adjustment for Sep 2026",
      },
      {
        id: "my-tnb-mv-general",
        country: "MY",
        rate: sen(29.83 + AFA_SEN),
        parts: [{ key: "energy", value: 29.83 }, { key: "afa", value: AFA_SEN }],
        fixedCharges: [
          { label: "Capacity charge (per kW of maximum demand)", amount: 29.43, unit: "per_kw_month" },
          { label: "Network charge (per kW of maximum demand)", amount: 59.84, unit: "per_kw_month" },
          { label: "Retail charge", amount: 200, unit: "per_month" },
        ],
        source: "TNB non-domestic tariff (RP4, from 1 Jul 2025), fuel adjustment for Sep 2026",
      },
      {
        id: "my-tnb-mv-tou",
        country: "MY",
        rate: sen(27.23 + AFA_SEN),
        peak: { rate: sen(31.32 + AFA_SEN), days: WEEKDAYS, from: "14:00", to: "22:00" },
        parts: [{ key: "energy", peak: 31.32, value: 27.23 }, { key: "afa", value: AFA_SEN }],
        fixedCharges: [
          { label: "Capacity charge (per kW of peak-hour maximum demand)", amount: 30.19, unit: "per_kw_month" },
          { label: "Network charge (per kW of peak-hour maximum demand)", amount: 66.87, unit: "per_kw_month" },
          { label: "Retail charge", amount: 200, unit: "per_month" },
        ],
        source: "TNB non-domestic tariff (RP4, from 1 Jul 2025), fuel adjustment for Sep 2026",
      },
    ],
  },
};

/** Malaysian states and federal territories, by the codes used for public holidays. */
export const MALAYSIA_STATES = [
  ["JHR", "Johor"], ["KDH", "Kedah"], ["KTN", "Kelantan"], ["MLK", "Melaka"], ["NSN", "Negeri Sembilan"],
  ["PHG", "Pahang"], ["PNG", "Penang"], ["PRK", "Perak"], ["PLS", "Perlis"], ["SGR", "Selangor"],
  ["TRG", "Terengganu"], ["SBH", "Sabah"], ["SWK", "Sarawak"], ["KUL", "Kuala Lumpur"], ["LBN", "Labuan"],
  ["PJY", "Putrajaya"],
] as const;
export type MalaysiaState = typeof MALAYSIA_STATES[number][0];

/** States whose weekend is Friday and Saturday, so the working week runs Sunday to Thursday. */
const FRIDAY_SATURDAY_WEEKEND: ReadonlySet<string> = new Set(["KDH", "KTN", "TRG"]);

export const usualOpeningDays = (country: CountryCode, state?: string): EnergyOperatingDayDto[] =>
  country === "MY" && state && FRIDAY_SATURDAY_WEEKEND.has(state)
    ? ["sunday", "monday", "tuesday", "wednesday", "thursday"]
    : WEEKDAYS;

export type PublicHoliday = {
  date: string;
  name: string;
  /** Islamic and some lunar dates are set by moon sighting and may move by a day. */
  provisional?: boolean;
  /** A replacement day for a holiday that fell on the weekend. */
  replacement?: boolean;
};

// Singapore: Ministry of Manpower lists for 2026 and 2027, including the days in lieu it announced.
const SINGAPORE: PublicHoliday[] = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-02-17", name: "Chinese New Year" },
  { date: "2026-02-18", name: "Chinese New Year (Day 2)" },
  { date: "2026-03-21", name: "Hari Raya Puasa", provisional: true },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-05-01", name: "Labour Day" },
  { date: "2026-05-27", name: "Hari Raya Haji", provisional: true },
  { date: "2026-05-31", name: "Vesak Day" },
  { date: "2026-06-01", name: "Vesak Day (in lieu)", replacement: true },
  { date: "2026-08-09", name: "National Day" },
  { date: "2026-08-10", name: "National Day (in lieu)", replacement: true },
  { date: "2026-11-08", name: "Deepavali" },
  { date: "2026-11-09", name: "Deepavali (in lieu)", replacement: true },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-02-06", name: "Chinese New Year" },
  { date: "2027-02-07", name: "Chinese New Year (Day 2)" },
  { date: "2027-02-08", name: "Chinese New Year (in lieu)", replacement: true },
  { date: "2027-03-10", name: "Hari Raya Puasa", provisional: true },
  { date: "2027-03-26", name: "Good Friday" },
  { date: "2027-05-01", name: "Labour Day" },
  { date: "2027-05-17", name: "Hari Raya Haji", provisional: true },
  { date: "2027-05-20", name: "Vesak Day" },
  { date: "2027-08-09", name: "National Day" },
  { date: "2027-10-28", name: "Deepavali" },
  { date: "2027-12-25", name: "Christmas Day" },
];

type MalaysianHoliday = { date: string; name: string; states: "all" | { only: string[] } | { except: string[] }; provisional?: boolean };

// Malaysia: federal and state holidays for 2026 and 2027 as gazetted by the Prime Minister's Department and the
// states. Weekend replacement days are worked out below rather than listed.
const MALAYSIA: MalaysianHoliday[] = [
  { date: "2026-01-01", name: "New Year's Day", states: { except: ["JHR", "KDH", "KTN", "PLS", "TRG"] } },
  { date: "2026-01-14", name: "Birthday of the Yang di-Pertuan Besar of Negeri Sembilan", states: { only: ["NSN"] } },
  { date: "2026-01-17", name: "Israk and Mikraj", states: { only: ["KDH", "NSN", "PLS", "TRG"] }, provisional: true },
  { date: "2026-02-01", name: "Thaipusam", states: { only: ["KUL", "PJY", "JHR", "NSN", "PRK", "PNG", "SGR"] } },
  { date: "2026-02-01", name: "Federal Territory Day", states: { only: ["KUL", "LBN", "PJY"] } },
  { date: "2026-02-17", name: "Chinese New Year", states: "all" },
  { date: "2026-02-18", name: "Chinese New Year (Day 2)", states: "all" },
  { date: "2026-02-19", name: "Beginning of Ramadan", states: { only: ["JHR", "KDH", "MLK"] }, provisional: true },
  { date: "2026-02-20", name: "Declaration of Independence Day", states: { only: ["MLK"] } },
  { date: "2026-03-04", name: "Anniversary of the Coronation of the Sultan of Terengganu", states: { only: ["TRG"] } },
  { date: "2026-03-07", name: "Nuzul Al-Quran", states: { only: ["KUL", "LBN", "PJY", "KTN", "PHG", "PRK", "PLS", "PNG", "SGR", "TRG"] }, provisional: true },
  { date: "2026-03-20", name: "Hari Raya Aidilfitri (additional holiday)", states: "all" },
  { date: "2026-03-21", name: "Hari Raya Aidilfitri", states: "all", provisional: true },
  { date: "2026-03-22", name: "Hari Raya Aidilfitri (Day 2)", states: "all", provisional: true },
  { date: "2026-03-23", name: "Hari Raya Aidilfitri (Day 3)", states: { only: ["KTN", "TRG"] }, provisional: true },
  { date: "2026-03-23", name: "Birthday of the Sultan of Johor", states: { only: ["JHR"] } },
  { date: "2026-03-30", name: "Birthday of the Governor of Sabah", states: { only: ["SBH"] } },
  { date: "2026-04-03", name: "Good Friday", states: { only: ["SBH", "SWK"] } },
  { date: "2026-04-26", name: "Birthday of the Sultan of Terengganu", states: { only: ["TRG"] } },
  { date: "2026-05-01", name: "Labour Day", states: "all" },
  { date: "2026-05-17", name: "Birthday of the Raja of Perlis", states: { only: ["PLS"] } },
  { date: "2026-05-22", name: "Hol Day of Sultan Ahmad Shah", states: { only: ["PHG"] } },
  { date: "2026-05-26", name: "Arafat Day", states: { only: ["TRG"] }, provisional: true },
  { date: "2026-05-27", name: "Hari Raya Haji", states: "all", provisional: true },
  { date: "2026-05-28", name: "Hari Raya Haji (Day 2)", states: { only: ["KDH", "KTN", "PLS", "TRG"] }, provisional: true },
  { date: "2026-05-30", name: "Harvest Festival (Kaamatan)", states: { only: ["LBN", "SBH"] } },
  { date: "2026-05-31", name: "Harvest Festival (Kaamatan) (Day 2)", states: { only: ["LBN", "SBH"] } },
  { date: "2026-05-31", name: "Wesak Day", states: "all" },
  { date: "2026-06-01", name: "Gawai Dayak Festival", states: { only: ["SWK"] } },
  { date: "2026-06-01", name: "Birthday of the Yang di-Pertuan Agong", states: "all" },
  { date: "2026-06-02", name: "Gawai Dayak Festival (Day 2)", states: { only: ["SWK"] } },
  { date: "2026-06-17", name: "Awal Muharram", states: "all", provisional: true },
  { date: "2026-06-21", name: "Birthday of the Sultan of Kedah", states: { only: ["KDH"] } },
  { date: "2026-07-07", name: "George Town World Heritage City Day", states: { only: ["PNG"] } },
  { date: "2026-07-11", name: "Birthday of the Governor of Penang", states: { only: ["PNG"] } },
  { date: "2026-07-21", name: "Hol Day of Sultan Iskandar", states: { only: ["JHR"] } },
  { date: "2026-07-22", name: "Sarawak Independence Day", states: { only: ["SWK"] } },
  { date: "2026-07-31", name: "Birthday of the Sultan of Pahang", states: { only: ["PHG"] } },
  { date: "2026-08-24", name: "Birthday of the Governor of Melaka", states: { only: ["MLK"] } },
  { date: "2026-08-25", name: "Prophet Muhammad's Birthday", states: "all", provisional: true },
  { date: "2026-08-31", name: "National Day", states: "all" },
  { date: "2026-09-01", name: "Selangor SUKMA 2026 special holiday", states: { only: ["SGR"] } },
  { date: "2026-09-16", name: "Malaysia Day", states: "all" },
  { date: "2026-09-29", name: "Birthday of the Sultan of Kelantan", states: { only: ["KTN"] } },
  { date: "2026-09-30", name: "Birthday of the Sultan of Kelantan (Day 2)", states: { only: ["KTN"] } },
  { date: "2026-10-10", name: "Birthday of the Governor of Sarawak", states: { only: ["SWK"] } },
  { date: "2026-10-26", name: "Sultan of Selangor's Silver Jubilee special holiday", states: { only: ["SGR"] } },
  { date: "2026-11-06", name: "Birthday of the Sultan of Perak", states: { only: ["PRK"] } },
  { date: "2026-11-08", name: "Deepavali", states: { except: ["SWK"] } },
  { date: "2026-12-11", name: "Birthday of the Sultan of Selangor", states: { only: ["SGR"] } },
  { date: "2026-12-24", name: "Christmas Eve", states: { only: ["SBH"] } },
  { date: "2026-12-25", name: "Christmas Day", states: "all" },
  { date: "2027-01-01", name: "New Year's Day", states: { except: ["JHR", "KDH", "KTN", "PLS", "TRG"] } },
  { date: "2027-01-06", name: "Israk and Mikraj", states: { only: ["KDH", "NSN", "PLS", "TRG"] }, provisional: true },
  { date: "2027-01-14", name: "Birthday of the Yang di-Pertuan Besar of Negeri Sembilan", states: { only: ["NSN"] } },
  { date: "2027-01-22", name: "Thaipusam", states: { only: ["KUL", "PJY", "JHR", "NSN", "PRK", "PNG", "SGR"] } },
  { date: "2027-02-01", name: "Federal Territory Day", states: { only: ["KUL", "LBN", "PJY"] } },
  { date: "2027-02-06", name: "Chinese New Year", states: "all" },
  { date: "2027-02-07", name: "Chinese New Year (Day 2)", states: "all" },
  { date: "2027-02-08", name: "Beginning of Ramadan", states: { only: ["JHR", "KDH", "MLK"] }, provisional: true },
  { date: "2027-02-20", name: "Declaration of Independence Day", states: { only: ["MLK"] } },
  { date: "2027-02-24", name: "Nuzul Al-Quran", states: { only: ["KUL", "LBN", "PJY", "KTN", "PHG", "PRK", "PLS", "PNG", "SGR", "TRG"] }, provisional: true },
  { date: "2027-03-04", name: "Anniversary of the Coronation of the Sultan of Terengganu", states: { only: ["TRG"] } },
  { date: "2027-03-10", name: "Hari Raya Aidilfitri", states: "all", provisional: true },
  { date: "2027-03-11", name: "Hari Raya Aidilfitri (Day 2)", states: "all", provisional: true },
  { date: "2027-03-12", name: "Hari Raya Aidilfitri (Day 3)", states: { only: ["KTN", "TRG"] }, provisional: true },
  { date: "2027-03-23", name: "Birthday of the Sultan of Johor", states: { only: ["JHR"] } },
  { date: "2027-03-26", name: "Good Friday", states: { only: ["SBH", "SWK"] } },
  { date: "2027-03-30", name: "Birthday of the Governor of Sabah", states: { only: ["SBH"] } },
  { date: "2027-04-26", name: "Birthday of the Sultan of Terengganu", states: { only: ["TRG"] } },
  { date: "2027-05-01", name: "Labour Day", states: "all" },
  { date: "2027-05-16", name: "Arafat Day", states: { only: ["TRG"] }, provisional: true },
  { date: "2027-05-17", name: "Hari Raya Haji", states: "all", provisional: true },
  { date: "2027-05-17", name: "Birthday of the Raja of Perlis", states: { only: ["PLS"] } },
  { date: "2027-05-18", name: "Hari Raya Haji (Day 2)", states: { only: ["KDH", "KTN", "PLS", "TRG"] }, provisional: true },
  { date: "2027-05-20", name: "Wesak Day", states: "all" },
  { date: "2027-05-22", name: "Hol Day of Sultan Ahmad Shah", states: { only: ["PHG"] } },
  { date: "2027-05-30", name: "Harvest Festival (Kaamatan)", states: { only: ["LBN", "SBH"] } },
  { date: "2027-05-31", name: "Harvest Festival (Kaamatan) (Day 2)", states: { only: ["LBN", "SBH"] } },
  { date: "2027-06-01", name: "Gawai Dayak Festival", states: { only: ["SWK"] } },
  { date: "2027-06-02", name: "Gawai Dayak Festival (Day 2)", states: { only: ["SWK"] } },
  { date: "2027-06-06", name: "Awal Muharram", states: "all", provisional: true },
  { date: "2027-06-07", name: "Birthday of the Yang di-Pertuan Agong", states: "all" },
  { date: "2027-06-20", name: "Birthday of the Sultan of Kedah", states: { only: ["KDH"] } },
  { date: "2027-07-07", name: "George Town World Heritage City Day", states: { only: ["PNG"] } },
  { date: "2027-07-10", name: "Birthday of the Governor of Penang", states: { only: ["PNG"] } },
  { date: "2027-07-11", name: "Hol Day of Sultan Iskandar", states: { only: ["JHR"] } },
  { date: "2027-07-22", name: "Sarawak Independence Day", states: { only: ["SWK"] } },
  { date: "2027-07-30", name: "Birthday of the Sultan of Pahang", states: { only: ["PHG"] } },
  { date: "2027-08-15", name: "Prophet Muhammad's Birthday", states: "all", provisional: true },
  { date: "2027-08-24", name: "Birthday of the Governor of Melaka", states: { only: ["MLK"] } },
  { date: "2027-08-31", name: "National Day", states: "all" },
  { date: "2027-09-16", name: "Malaysia Day", states: "all" },
  { date: "2027-09-29", name: "Birthday of the Sultan of Kelantan", states: { only: ["KTN"] } },
  { date: "2027-09-30", name: "Birthday of the Sultan of Kelantan (Day 2)", states: { only: ["KTN"] } },
  { date: "2027-10-09", name: "Birthday of the Governor of Sarawak", states: { only: ["SWK"] } },
  { date: "2027-10-28", name: "Deepavali", states: { except: ["SWK"] } },
  { date: "2027-11-05", name: "Birthday of the Sultan of Perak", states: { only: ["PRK"] } },
  { date: "2027-12-11", name: "Birthday of the Sultan of Selangor", states: { only: ["SGR"] } },
  { date: "2027-12-24", name: "Christmas Eve", states: { only: ["SBH"] } },
  { date: "2027-12-25", name: "Christmas Day", states: "all" },
];

const observedIn = (holiday: MalaysianHoliday, state: string): boolean =>
  holiday.states === "all" ? true
    : "only" in holiday.states ? holiday.states.only.includes(state)
      : !holiday.states.except.includes(state);

const nextDay = (date: string): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

const weekday = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * The public holidays a site observes, sorted by date with one name per day. Malaysian holidays that fall on the
 * weekly rest day move to the next working day that is not already a holiday: Sunday for most states, Friday where
 * the weekend is Friday and Saturday.
 */
export function publicHolidaysFor(country: CountryCode, state?: string): PublicHoliday[] {
  if (country === "SG") return SINGAPORE.map(holiday => ({ ...holiday }));
  if (!state) return [];
  const observed = MALAYSIA.filter(holiday => observedIn(holiday, state));
  const byDate = new Map<string, PublicHoliday>();
  for (const holiday of observed) {
    const existing = byDate.get(holiday.date);
    byDate.set(holiday.date, existing
      ? { ...existing, name: `${existing.name} / ${holiday.name}`, ...(existing.provisional || holiday.provisional ? { provisional: true } : {}) }
      : { date: holiday.date, name: holiday.name, ...(holiday.provisional ? { provisional: true } : {}) });
  }
  // Each holiday on the rest day earns its own replacement, so two on one Sunday give two working days off.
  const restDay = FRIDAY_SATURDAY_WEEKEND.has(state) ? 5 : 0;
  const weekendDays = FRIDAY_SATURDAY_WEEKEND.has(state) ? [5, 6] : [0, 6];
  for (const holiday of observed) {
    if (weekday(holiday.date) !== restDay) continue;
    let day = nextDay(holiday.date);
    while (byDate.has(day) || weekendDays.includes(weekday(day))) day = nextDay(day);
    byDate.set(day, { date: day, name: `${holiday.name} (replacement)`, replacement: true });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
