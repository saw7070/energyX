// Business labels from Tuya SG Office DB.pptx slides 2–3.
// Physical IDs use the Device-ID-joined business mapping verified on 2026-09-06; never ordinal matching.
// No source device IDs or credentials are stored here. Presentation does not define accounting routes.
export const TUYA_OFFICE_METER_PRESENTATION: Record<string, { device_name?: string; circuit_name: string; group: string }> = {
  "panel-a-total": {
    "circuit_name": "DB1 L1 Power",
    "group": "Total Power"
  },
  "panel-a-lighting": {
    "circuit_name": "DB1 L1 Light",
    "group": "Lighting"
  },
  "panel-a-meter-03": {
    "circuit_name": "L1P1",
    "group": "Access Control",
    "device_name": "Main Entrance Access"
  },
  "panel-a-meter-04": {
    "circuit_name": "L1P16",
    "group": "Blind",
    "device_name": "Director Room Blind"
  },
  "panel-a-meter-05": {
    "circuit_name": "L1P15",
    "group": "Plug Load",
    "device_name": "Director Room Power"
  },
  "panel-a-meter-06": {
    "circuit_name": "L1P17",
    "group": "AV / TV",
    "device_name": "Big Meeting Room TV"
  },
  "panel-a-meter-07": {
    "circuit_name": "L1P7",
    "group": "Blind",
    "device_name": "Office Blind"
  },
  "panel-b-total": {
    "circuit_name": "DB2 L2 Power",
    "group": "Total Power"
  },
  "panel-b-lighting": {
    "circuit_name": "DB2 L2 Light",
    "group": "Lighting"
  },
  "panel-b-meter-03": {
    "circuit_name": "L2P5",
    "group": "AV / TV",
    "device_name": "Showroom TV 1"
  },
  "panel-b-meter-04": {
    "circuit_name": "L2P9",
    "group": "AV / TV",
    "device_name": "Showroom TV 2"
  },
  "panel-b-meter-05": {
    "circuit_name": "L2P14",
    "group": "AV / TV",
    "device_name": "Showroom Conow"
  },
  "panel-b-meter-06": {
    "circuit_name": "L2P13",
    "group": "AV / TV",
    "device_name": "Showroom NetZero"
  },
  "panel-b-meter-07": {
    "circuit_name": "L2P15",
    "group": "AV / TV",
    "device_name": "TV Meeting Room 2"
  },
  "panel-b-meter-08": {
    "circuit_name": "L2P17",
    "group": "Pantry",
    "device_name": "Fridge and Water Dispenser"
  },
  "panel-b-meter-09": {
    "circuit_name": "L2P11",
    "group": "Blind",
    "device_name": "Showroom Blind"
  },
  "panel-b-meter-10": {
    "circuit_name": "L2P8",
    "group": "Blind",
    "device_name": "Showroom Blind"
  },
  "panel-c-meter-01": {
    "circuit_name": "L3ISO1",
    "group": "LED",
    "device_name": "LED Display 1"
  },
  "panel-c-meter-02": {
    "circuit_name": "L3ISO2",
    "group": "LED",
    "device_name": "LED Display 2"
  },
  "panel-c-meter-03": {
    "circuit_name": "L3ISO3",
    "group": "LED",
    "device_name": "LED Display 3"
  },
  "tuya-office-db1-other-load": {
    "circuit_name": "DB1 Other Consumption",
    "group": "Other consumption"
  },
  "tuya-office-db2-other-load": {
    "circuit_name": "DB2 Other Consumption",
    "group": "Other consumption"
  },
  "tuya-office-db3-led-total": {
    "circuit_name": "LED Display Total",
    "group": "LED"
  }
};
