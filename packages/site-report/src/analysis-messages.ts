/**
 * Wording shared by the Analysis page and its pure helpers (analysis-model, day picker, type hints, peak donut), in every language.
 * The page's own sections keep their wording in analysis-story-messages.ts and analysis-view-messages.ts.
 */
import { defineMessages, translatorFor, type EnergyIqLocale } from "./locale.js";
import type { AnalysisCategory, AnalysisDayType, TimeBucket } from "./analysis-model.js";

export const analysisMessages = defineMessages({
  "page.loading": "Loading analysis…",

  "category.light": "Lighting",
  "category.load": "Power Load",
  "category.aircon": "Air-con / Ventilation",
  "category.it": "IT & network",
  "category.kitchen": "Kitchen & food",
  "category.plug": "Plugs & sockets",
  "category.other": "Other",
  "categoryHint.light": "Lights and lighting circuits.",
  "categoryHint.load": "Anything plugged into power sockets or wired to a power circuit: computers, screens and TVs, fridges and water dispensers, door access, blinds. In short, equipment that is not lighting or air-con.",
  "categoryHint.aircon": "Air-conditioning, fans and ventilation that cool or move air.",
  "categoryHint.it": "Computers, servers, routers and network switches, CCTV cameras, printers and display screens.",
  "categoryHint.kitchen": "Kitchen and food equipment: coffee machines, fridges and freezers, microwaves, ovens, fryers, kettles and water dispensers.",
  "categoryHint.plug": "General power points and sockets where many small items are plugged in, such as desk sockets and extension leads.",
  "categoryHint.other": "Meters not tagged as lighting, power or air-con, such as signage and LED display boards. A meter's type can be changed in Facility → Floor layout.",

  "dayType.weekday": "Weekday",
  "dayType.weekend": "Weekend",
  "dayType.public_holiday": "Holiday",
  "dayTypeLower.weekday": "weekday",
  "dayTypeLower.weekend": "weekend",
  "dayTypeLower.public_holiday": "holiday",

  "bucket.open": "Operating hours",
  "bucket.after_hours": "Weekday evenings & nights",
  "bucket.weekend": "Weekends",
  "bucket.holiday": "Public holidays",

  "status.good": "Good",
  "status.watch": "Watch",
  "status.act": "Act",
  "confidence.high": "High",
  "confidence.medium": "Medium",
  "confidence.check": "Check first",
  "effort.low": "Low",
  "effort.medium": "Medium",

  "list.separator": ", ",
  "list.and": "{rest} and {last}",
  "holiday.plannedClosure": "{name} (planned closure)",
  "tariff.plain": "{rates} {currency}/kWh",
  "tariff.inclTax": "{rates} {currency}/kWh incl. tax",
  "tariff.beforeTax": "{rates} {currency}/kWh before tax",

  "closed.rest": "Rest of {space} (not separately metered)",
  "plan.cutType": "Cut {name} left on after working hours",
  "plan.switchOff": "Switch off {name} after working hours",
  "plan.areaType": "{name} across {project}",
  "plan.areaCircuit": "{name} ({space})",
  "plan.draws": "Draws {kw} on average after working hours — {pct}% of its energy is used after working hours.",
  "plan.quietest": " On its quietest nights it already drops to {kw}.",
  "plan.math": "{kw} × {hours} hours a year after working hours{rate}",
  "plan.others": "Put {count} more items on an after-hours schedule",
  "plan.othersDetail": "Together they draw {kw} after working hours.",
  "plan.benchmark": "Run no higher than your own best level after working hours",
  "plan.benchmarkDetail": "The site has already held {kw} after working hours. Closed hours above that level used {kwh} kWh in these dates.",
  "plan.benchmarkMath": "{kwh} kWh × 365 / {days} days{rate}",
  "plan.check": "Check whether {name} must run overnight",
  "plan.checkDetail": "Usually needs to stay on, but draws {kw} after working hours. Confirm its settings before changing anything.",
  "plan.find": "Find what else stays on in {space} after working hours",
  "plan.findDetail": "{kw} is used after working hours by equipment that has no meter of its own. Walk the space after closing to find what is still running.",
  "plan.unusual.one": "Find out what happened on {count} unusual day",
  "plan.unusual.other": "Find out what happened on {count} unusual days",
  "plan.unusualDay": "{date} (+{pct}%)",
  "plan.unusualDetail": "{days} used more than {pct}% above a normal day of the same type.",

  "picker.weekdays": "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
  "picker.dayToShow": "Day to show: {day}",
  "picker.none": "none",
  "picker.choose": "Choose a day",
  "picker.holiday": "Holiday",
  "picker.weekend": "Weekend",
  "picker.readingsMissing": "Readings missing",
  "picker.energyUsed": "Energy used",
  "picker.tagHoliday": "public holiday",
  "picker.tagWeekend": "weekend",
  "picker.tagMissing": "some readings missing",
  "picker.describe": "{date}, {kwh} kWh",
  "picker.describeTags": "{date}, {tags}, {kwh} kWh",

  "hint.aria": "What does {label} mean?",
  "hint.at": "At {place} this is mostly {examples}.",
  "hint.here": "Here this is mostly {examples}.",

  "donut.others": "Other circuits ({count})",
  "donut.notSplit": "Not split by circuit",
  "donut.notSplitDetail": "Measured by the space's main meters, but no circuit meter shows where it went",
  "donut.aria": "{space} during this hour: {slices}",
  "donut.slice": "{name} {kwh} kWh ({pct})",
  "donut.title": "{name}: {kwh} kWh · {pct}",
  "donut.ofSpace": "{pct} of this space",
  "donut.thisHour": "this hour",
  "donut.listLabel": "Share of this space",
}, {
  "zh-Hans": {
    "page.loading": "正在加载用电分析…",

    "category.light": "照明",
    "category.load": "插座与设备用电",
    "category.aircon": "空调 / 通风",
    "category.it": "IT 与网络",
    "category.kitchen": "厨房与餐饮",
    "category.plug": "插座",
    "category.other": "其他",
    "categoryHint.light": "灯具和照明线路。",
    "categoryHint.load": "插在电源插座上或接在电源线路上的所有设备：电脑、显示屏和电视、冰箱和饮水机、门禁、电动窗帘等。简单来说，就是照明和空调以外的设备。",
    "categoryHint.aircon": "用来降温或送风的空调、风扇和通风设备。",
    "categoryHint.it": "电脑、服务器、路由器和网络交换机、监控摄像头、打印机和显示屏。",
    "categoryHint.kitchen": "厨房和餐饮设备：咖啡机、冰箱和冰柜、微波炉、烤箱、炸锅、电水壶和饮水机。",
    "categoryHint.plug": "接有许多小型电器的一般电源插座，例如办公桌插座和拖线板。",
    "categoryHint.other": "没有标记为照明、插座与设备用电或空调的电表，例如招牌和 LED 显示屏。电表类型可在“场地设施 → 楼层布局”中更改。",

    "dayType.weekday": "工作日",
    "dayType.weekend": "周末",
    "dayType.public_holiday": "假期",
    "dayTypeLower.weekday": "工作日",
    "dayTypeLower.weekend": "周末",
    "dayTypeLower.public_holiday": "假期",

    "bucket.open": "营业时间",
    "bucket.after_hours": "工作日晚上和夜间",
    "bucket.weekend": "周末",
    "bucket.holiday": "公共假期",

    "status.good": "良好",
    "status.watch": "留意",
    "status.act": "需处理",
    "confidence.high": "高",
    "confidence.medium": "中",
    "confidence.check": "先核实",
    "effort.low": "低",
    "effort.medium": "中",

    "list.separator": "、",
    "list.and": "{rest}和{last}",
    "holiday.plannedClosure": "{name}（计划停业）",
    "tariff.plain": "{rates} {currency}/kWh",
    "tariff.inclTax": "{rates} {currency}/kWh（含税）",
    "tariff.beforeTax": "{rates} {currency}/kWh（未含税）",

    "closed.rest": "{space}的其余用电（没有单独电表）",
    "plan.cutType": "减少非营业时间仍开着的{name}",
    "plan.switchOff": "非营业时间关闭 {name}",
    "plan.areaType": "{project}全场的{name}",
    "plan.areaCircuit": "{name}（{space}）",
    "plan.draws": "非营业时间平均功率为 {kw}，它有 {pct}% 的用电发生在非营业时间。",
    "plan.quietest": "在用电最少的夜晚，它已经能降到 {kw}。",
    "plan.math": "{kw} × 每年 {hours} 个非营业小时{rate}",
    "plan.others": "为另外 {count} 项设备设定非营业时间自动关闭",
    "plan.othersDetail": "它们在非营业时间合计功率为 {kw}。",
    "plan.benchmark": "非营业时间的用电不超过本场地自己做到过的最低水平",
    "plan.benchmarkDetail": "本场地在非营业时间曾经保持在 {kw}。所选日期内，非营业时间高于这个水平的用电为 {kwh} kWh。",
    "plan.benchmarkMath": "{kwh} kWh × 365 / {days} 天{rate}",
    "plan.check": "确认 {name} 是否必须通宵运行",
    "plan.checkDetail": "这类设备通常需要一直开着，但它在非营业时间的功率为 {kw}。改动前请先确认它的设置。",
    "plan.find": "找出{space}在非营业时间还有哪些设备开着",
    "plan.findDetail": "非营业时间有 {kw} 的用电来自没有独立电表的设备。请在关门后巡查这个区域，找出仍在运行的设备。",
    "plan.unusual.one": "查明 {count} 个异常日发生了什么",
    "plan.unusual.other": "查明 {count} 个异常日发生了什么",
    "plan.unusualDay": "{date}（+{pct}%）",
    "plan.unusualDetail": "{days}的用电比同类型的正常日子高出 {pct}% 以上。",

    "picker.weekdays": "一,二,三,四,五,六,日",
    "picker.dayToShow": "显示的日期：{day}",
    "picker.none": "无",
    "picker.choose": "选择日期",
    "picker.holiday": "假期",
    "picker.weekend": "周末",
    "picker.readingsMissing": "读数缺失",
    "picker.energyUsed": "用电量",
    "picker.tagHoliday": "公共假期",
    "picker.tagWeekend": "周末",
    "picker.tagMissing": "部分读数缺失",
    "picker.describe": "{date}，{kwh} kWh",
    "picker.describeTags": "{date}，{tags}，{kwh} kWh",

    "hint.aria": "“{label}”是什么意思？",
    "hint.at": "在{place}，这主要是{examples}。",
    "hint.here": "这里主要是{examples}。",

    "donut.others": "其他线路（{count}）",
    "donut.notSplit": "未按线路细分",
    "donut.notSplitDetail": "由这个区域的总表计量，但没有线路电表显示这部分电用在了哪里",
    "donut.aria": "{space}在这一小时内：{slices}",
    "donut.slice": "{name} {kwh} kWh（{pct}）",
    "donut.title": "{name}：{kwh} kWh · {pct}",
    "donut.ofSpace": "占该区域 {pct}",
    "donut.thisHour": "这一小时",
    "donut.listLabel": "占该区域的比例",
  },
  ms: {
    "page.loading": "Memuatkan analisis…",

    "category.light": "Pencahayaan",
    "category.load": "Beban kuasa",
    "category.aircon": "Penyaman udara / Pengudaraan",
    "category.it": "IT & rangkaian",
    "category.kitchen": "Dapur & makanan",
    "category.plug": "Palam & soket",
    "category.other": "Lain-lain",
    "categoryHint.light": "Lampu dan litar pencahayaan.",
    "categoryHint.load": "Apa sahaja yang dipasang pada soket kuasa atau disambungkan ke litar kuasa: komputer, skrin dan TV, peti sejuk dan dispenser air, akses pintu, bidai. Ringkasnya, peralatan yang bukan lampu atau penyaman udara.",
    "categoryHint.aircon": "Penyaman udara, kipas dan pengudaraan yang menyejukkan atau mengalirkan udara.",
    "categoryHint.it": "Komputer, pelayan, penghala dan suis rangkaian, kamera CCTV, pencetak dan skrin paparan.",
    "categoryHint.kitchen": "Peralatan dapur dan makanan: mesin kopi, peti sejuk dan peti beku, ketuhar gelombang mikro, ketuhar, penggoreng, cerek dan dispenser air.",
    "categoryHint.plug": "Soket kuasa am yang disambungkan dengan banyak peralatan kecil, seperti soket meja dan sambungan wayar.",
    "categoryHint.other": "Meter yang tidak ditag sebagai pencahayaan, kuasa atau penyaman udara, seperti papan tanda dan papan paparan LED. Jenis meter boleh ditukar dalam Premis → Susun atur lantai.",

    "dayType.weekday": "Hari bekerja",
    "dayType.weekend": "Hujung minggu",
    "dayType.public_holiday": "Cuti",
    "dayTypeLower.weekday": "hari bekerja",
    "dayTypeLower.weekend": "hujung minggu",
    "dayTypeLower.public_holiday": "hari cuti",

    "bucket.open": "Waktu operasi",
    "bucket.after_hours": "Petang & malam hari bekerja",
    "bucket.weekend": "Hujung minggu",
    "bucket.holiday": "Cuti umum",

    "status.good": "Baik",
    "status.watch": "Pantau",
    "status.act": "Bertindak",
    "confidence.high": "Tinggi",
    "confidence.medium": "Sederhana",
    "confidence.check": "Semak dahulu",
    "effort.low": "Rendah",
    "effort.medium": "Sederhana",

    "list.separator": ", ",
    "list.and": "{rest} dan {last}",
    "holiday.plannedClosure": "{name} (penutupan terancang)",
    "tariff.plain": "{rates} {currency}/kWh",
    "tariff.inclTax": "{rates} {currency}/kWh termasuk cukai",
    "tariff.beforeTax": "{rates} {currency}/kWh sebelum cukai",

    "closed.rest": "Selebihnya di {space} (tiada meter berasingan)",
    "plan.cutType": "Kurangkan {name} yang dibiarkan hidup selepas waktu bekerja",
    "plan.switchOff": "Matikan {name} selepas waktu bekerja",
    "plan.areaType": "{name} di seluruh {project}",
    "plan.areaCircuit": "{name} ({space})",
    "plan.draws": "Menggunakan purata {kw} selepas waktu bekerja — {pct}% daripada tenaganya digunakan selepas waktu bekerja.",
    "plan.quietest": " Pada malam yang paling senyap, ia sudah turun ke {kw}.",
    "plan.math": "{kw} × {hours} jam setahun selepas waktu bekerja{rate}",
    "plan.others": "Tetapkan jadual selepas waktu bekerja untuk {count} item lagi",
    "plan.othersDetail": "Bersama-sama, item ini menggunakan {kw} selepas waktu bekerja.",
    "plan.benchmark": "Jangan melebihi tahap terbaik anda sendiri selepas waktu bekerja",
    "plan.benchmarkDetail": "Premis ini pernah kekal pada {kw} selepas waktu bekerja. Waktu tutup yang melebihi tahap itu menggunakan {kwh} kWh dalam tarikh ini.",
    "plan.benchmarkMath": "{kwh} kWh × 365 / {days} hari{rate}",
    "plan.check": "Semak sama ada {name} perlu berjalan sepanjang malam",
    "plan.checkDetail": "Biasanya perlu kekal hidup, tetapi menggunakan {kw} selepas waktu bekerja. Sahkan tetapannya sebelum mengubah apa-apa.",
    "plan.find": "Cari apa lagi yang masih hidup di {space} selepas waktu bekerja",
    "plan.findDetail": "{kw} digunakan selepas waktu bekerja oleh peralatan yang tiada meter sendiri. Periksa ruang ini selepas tutup untuk mencari apa yang masih berjalan.",
    "plan.unusual.one": "Ketahui apa yang berlaku pada {count} hari luar biasa",
    "plan.unusual.other": "Ketahui apa yang berlaku pada {count} hari luar biasa",
    "plan.unusualDay": "{date} (+{pct}%)",
    "plan.unusualDetail": "{days} menggunakan lebih daripada {pct}% di atas hari biasa yang sama jenis.",

    "picker.weekdays": "Isn,Sel,Rab,Kha,Jum,Sab,Ahd",
    "picker.dayToShow": "Hari yang dipaparkan: {day}",
    "picker.none": "tiada",
    "picker.choose": "Pilih hari",
    "picker.holiday": "Cuti",
    "picker.weekend": "Hujung minggu",
    "picker.readingsMissing": "Bacaan hilang",
    "picker.energyUsed": "Tenaga digunakan",
    "picker.tagHoliday": "cuti umum",
    "picker.tagWeekend": "hujung minggu",
    "picker.tagMissing": "sebahagian bacaan hilang",
    "picker.describe": "{date}, {kwh} kWh",
    "picker.describeTags": "{date}, {tags}, {kwh} kWh",

    "hint.aria": "Apakah maksud {label}?",
    "hint.at": "Di {place}, ini kebanyakannya {examples}.",
    "hint.here": "Di sini, ini kebanyakannya {examples}.",

    "donut.others": "Litar lain ({count})",
    "donut.notSplit": "Tidak dipecahkan mengikut litar",
    "donut.notSplitDetail": "Diukur oleh meter utama ruang ini, tetapi tiada meter litar yang menunjukkan ke mana tenaga ini digunakan",
    "donut.aria": "{space} dalam jam ini: {slices}",
    "donut.slice": "{name} {kwh} kWh ({pct})",
    "donut.title": "{name}: {kwh} kWh · {pct}",
    "donut.ofSpace": "{pct} daripada ruang ini",
    "donut.thisHour": "jam ini",
    "donut.listLabel": "Bahagian daripada ruang ini",
  },
});

export const analysisText = (locale: EnergyIqLocale = "en") => translatorFor(analysisMessages, locale);

export const categoryLabel = (category: AnalysisCategory, locale: EnergyIqLocale = "en") => analysisText(locale)(`category.${category}`);
export const categoryDescription = (category: AnalysisCategory, locale: EnergyIqLocale = "en") => analysisText(locale)(`categoryHint.${category}`);
/** "Weekday", "Weekend", "Holiday" as a label. */
export const dayTypeLabel = (dayType: AnalysisDayType, locale: EnergyIqLocale = "en") => analysisText(locale)(`dayType.${dayType}`);
/** The same inside a sentence: "weekday", "weekend", "holiday". */
export const dayTypeWord = (dayType: AnalysisDayType, locale: EnergyIqLocale = "en") => analysisText(locale)(`dayTypeLower.${dayType}`);
export const timeBucketLabel = (bucket: TimeBucket, locale: EnergyIqLocale = "en") => analysisText(locale)(`bucket.${bucket}`);
const CONFIDENCE_KEYS = { High: "confidence.high", Medium: "confidence.medium", "Check first": "confidence.check" } as const;
const EFFORT_KEYS = { Low: "effort.low", Medium: "effort.medium" } as const;
/** Savings-plan confidence and effort stay English in the data (they drive styling); these are for display. */
export const confidenceLabel = (confidence: keyof typeof CONFIDENCE_KEYS, locale: EnergyIqLocale = "en") => analysisText(locale)(CONFIDENCE_KEYS[confidence]);
export const effortLabel = (effort: keyof typeof EFFORT_KEYS, locale: EnergyIqLocale = "en") => analysisText(locale)(EFFORT_KEYS[effort]);

/** "a", "a and b", "a, b and c" in the reader's language. */
export function listText(items: string[], locale: EnergyIqLocale = "en") {
  const t = analysisText(locale);
  return items.length <= 1 ? items[0] ?? "" : t("list.and", { rest: items.slice(0, -1).join(t("list.separator")), last: items.at(-1)! });
}
/** Items separated by commas (Chinese uses 、), without a final "and". */
export const joinText = (items: string[], locale: EnergyIqLocale = "en") => items.join(analysisText(locale)("list.separator"));

/** analysis-data marks planned closures in English (the site report reads that); show the mark in the reader's language. */
export const PLANNED_CLOSURE_SUFFIX = " (planned closure)";
export function holidayName(name: string, locale: EnergyIqLocale = "en") {
  if (locale === "en" || !name.endsWith(PLANNED_CLOSURE_SUFFIX)) return name;
  return analysisText(locale)("holiday.plannedClosure", { name: name.slice(0, -PLANNED_CLOSURE_SUFFIX.length) });
}

/** The published rate as words, e.g. "0.3 SGD/kWh before tax"; falls back to the English note when the parts are unknown. */
export function tariffNote(cost: { currency: string; note: string; rates?: number[]; basis?: string | null }, locale: EnergyIqLocale = "en") {
  if (locale === "en" || !cost.rates) return cost.note;
  const key = cost.basis === "tax_inclusive" ? "tariff.inclTax" : cost.basis === "tax_exclusive" ? "tariff.beforeTax" : "tariff.plain";
  return analysisText(locale)(key, { rates: cost.rates.join(" / "), currency: cost.currency });
}

/* `rich()`, which fills the same placeholders with React nodes, lives in rich.tsx so this file stays free of React. */
