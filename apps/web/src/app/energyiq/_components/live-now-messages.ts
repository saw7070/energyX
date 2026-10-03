import { defineMessages } from "./energyiq-messages";

/** Overview's live power line (live-now.tsx): what the site is drawing now, from 15-minute meter readings. */
export const liveNowMessages = defineMessages({
  label: "Live now",
  power: "Using {power} kW now",
  today: "{energy} kWh so far today",
  updated: "updated {time}, every {minutes} minutes",
  partial: "{reporting} of {total} main meters are reporting, so there is no site total right now.",
  waiting: "Live readings start within {minutes} minutes of connecting, and power shows from the second reading.",
  note: "Live figures are a quick view. Reports use the full daily update.",
}, {
  "zh-Hans": {
    label: "实时",
    power: "当前用电 {power} kW",
    today: "今天至今 {energy} kWh",
    updated: "更新于 {time}，每 {minutes} 分钟一次",
    partial: "{total} 个主电表中有 {reporting} 个在上报，暂时无法给出全站合计。",
    waiting: "连接后 {minutes} 分钟内开始实时读数，第二次读数起显示功率。",
    note: "实时数字仅供快速查看，报告使用完整的每日更新。",
  },
  ms: {
    label: "Langsung",
    power: "Menggunakan {power} kW sekarang",
    today: "{energy} kWh setakat hari ini",
    updated: "dikemas kini {time}, setiap {minutes} minit",
    partial: "{reporting} daripada {total} meter utama sedang melapor, jadi tiada jumlah tapak buat masa ini.",
    waiting: "Bacaan langsung bermula dalam {minutes} minit selepas disambungkan, dan kuasa dipaparkan dari bacaan kedua.",
    note: "Angka langsung ialah paparan pantas. Laporan menggunakan kemas kini harian penuh.",
  },
});
