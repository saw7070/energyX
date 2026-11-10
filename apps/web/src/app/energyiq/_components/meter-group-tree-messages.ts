import { defineMessages } from "./energyiq-messages";

/** Wording of the nested group breakdown shared by Devices and Analysis. */
export const meterGroupTreeMessages = defineMessages({
  "tree.aria": "Energy by group",
  "tree.share": "{pct} of {parent}",
  "tree.meters": "{count} meters",
  "tree.single": "1 meter, no sub-meter below it",
  "tree.unmetered": "Not measured by a sub-meter",
  "tree.row": "{name}: {kwh}, {pct} of {parent}",
  "tree.open": "Open {name}",
}, {
  "zh-Hans": {
    "tree.aria": "按分组的用电量",
    "tree.share": "占{parent}的 {pct}",
    "tree.meters": "{count} 个电表",
    "tree.single": "1 个电表，下面没有分表",
    "tree.unmetered": "没有分表计量的部分",
    "tree.row": "{name}：{kwh}，占{parent}的 {pct}",
    "tree.open": "打开 {name}",
  },
  ms: {
    "tree.aria": "Tenaga mengikut kumpulan",
    "tree.share": "{pct} daripada {parent}",
    "tree.meters": "{count} meter",
    "tree.single": "1 meter, tiada sub-meter di bawahnya",
    "tree.unmetered": "Tidak diukur oleh sub-meter",
    "tree.row": "{name}: {kwh}, {pct} daripada {parent}",
    "tree.open": "Buka {name}",
  },
});
