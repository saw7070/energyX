/**
 * A site's own device list for starting it from Tuya: one meter per line with its name and Tuya device ID, and
 * optionally its block or area and what it powers. Read from cells copied out of Excel (tab separated) or a CSV file,
 * with or without a header row.
 */
export type LiveDeviceListEntry = {
  /** The line in the pasted text or file, from 1. */
  line: number;
  name: string;
  deviceId: string;
  area?: string;
  equipment?: string;
};

export const DEVICE_LIST_MAX_ROWS = 200;

type Column = "name" | "deviceId" | "area" | "equipment";

const HEADERS: Array<[Column, RegExp]> = [
  ["deviceId", /^(?:(?:tuya\s*)?(?:meter\s*)?(?:device\s*)?id|virtual\s*id|设备\s*id|id\s*peranti)$/iu],
  ["name", /^(?:(?:device|meter)?\s*name|meter|device|label|设备名称|名称|电表|nama(?:\s*(?:peranti|meter))?)$/iu],
  ["area", /^(?:(?:block|blk|area|location|zone|floor|level)(?:\s*(?:number|no\.?|#))?|楼栋|区域|位置|楼层|blok|kawasan|lokasi|tingkat)$/iu],
  ["equipment", /^(?:what\s*it\s*(?:powers|measures|tracks)|(?:meter\s*)?tracking\s*location|equipment|description|load|items?|用途|负载|说明|peralatan|keterangan)$/iu],
];

/** What a Tuya device ID looks like: letters and digits, with at least one digit (names rarely qualify). */
const looksLikeDeviceId = (value: string): boolean => /^[A-Za-z0-9]{8,64}$/u.test(value) && /\d/u.test(value) && /[A-Za-z]/u.test(value);

export function parseLiveDeviceList(text: string): LiveDeviceListEntry[] {
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  const entries: LiveDeviceListEntry[] = [];
  let columns: Partial<Record<Column, number>> | undefined;
  const titleRows = leadingTitleRows(lines);
  // A sheet that names each block once, on its own row above that block's meters.
  let blockHeading: string | undefined;
  for (const [index, line] of lines.entries()) {
    if (!line.trim() || titleRows.has(index)) continue;
    const cells = splitLine(line).map((cell) => cell.replace(/\s+/gu, " ").trim());
    if (cells.every((cell) => !cell)) continue;
    if (columns === undefined) {
      columns = headerColumns(cells) ?? {};
      if (Object.keys(columns).length > 0) continue;
    }
    if (columns.area !== undefined && isBlockHeading(cells, columns)) {
      blockHeading = cells[columns.area];
      continue;
    }
    const entry = Object.keys(columns).length > 0 ? fromHeader(cells, columns) : fromPosition(cells);
    entries.push({ line: index + 1, ...entry, ...(entry.area || !blockHeading ? {} : { area: blockHeading }) });
  }
  return withBlockInRepeatedNames(entries);
}

/**
 * A sheet often starts with a title ("SKTC Energy Monitoring Meter Layout") above its headings. Lines holding a single
 * piece of text and no device ID, before a heading line among the first few lines, are titles, not meters.
 */
const leadingTitleRows = (lines: string[]): Set<number> => {
  const candidates: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const cells = splitLine(line).map((cell) => cell.replace(/\s+/gu, " ").trim());
    if (cells.every((cell) => !cell)) continue;
    if (headerColumns(cells)) return new Set(candidates);
    if (candidates.length >= 5 || cells.filter(Boolean).length !== 1 || cells.some(looksLikeDeviceId)) return new Set();
    candidates.push(index);
  }
  return new Set();
};

/**
 * The first sheet of an Excel device list, as the tab-separated text a copy from Excel gives. Rows after the last one
 * holding a device ID are dropped: sheets often carry notes below the meters (SKTC's "Key Questions").
 */
export function deviceListTextFromSheet(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const text = rows.map((row) => row.map((cell) => cell === null || cell === undefined ? ""
    : cell instanceof Date ? cell.toISOString()
    : (typeof cell === "string" ? decodeXmlText(cell) : String(cell)).replace(/[\t\r\n]+/gu, " ").trim()));
  let last = -1;
  text.forEach((cells, index) => { if (cells.some(looksLikeDeviceId)) last = index; });
  return text.slice(0, last + 1).map((cells) => cells.join("\t")).join("\n");
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * read-excel-file (9.3) hands over the sheet's text as written in the file's XML, so "Pavilion DL & Fan" arrives as
 * "Pavilion DL &amp; Fan". Decode in one pass, so a cell that really says "&amp;" (stored as "&amp;amp;") stays so.
 */
export const decodeXmlText = (value: string): string =>
  value.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#x([\da-f]{1,6}));/giu, (match, name?: string, decimal?: string, hex?: string) => {
    if (name) return XML_ENTITIES[name.toLowerCase()] ?? match;
    const code = decimal ? Number(decimal) : Number.parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });

/** Only the block column has text: the row names the block for the meters below it. */
const isBlockHeading = (cells: string[], columns: Partial<Record<Column, number>>): boolean =>
  Boolean(cells[columns.area!]) && !cells.some(looksLikeDeviceId)
  && cells.every((cell, index) => index === columns.area || !cell);

/**
 * Blocks often repeat the same meter names ("Emergency Lighting" in every block). Put the block in front of a name
 * that more than one block uses, so the meters stay tell-apart in charts instead of becoming "Name (2)".
 */
const withBlockInRepeatedNames = (entries: LiveDeviceListEntry[]): LiveDeviceListEntry[] => {
  const blocksByName = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.name || !entry.area) continue;
    const key = entry.name.toLowerCase();
    blocksByName.set(key, (blocksByName.get(key) ?? new Set()).add(entry.area.toLowerCase()));
  }
  return entries.map((entry) => entry.name && entry.area && (blocksByName.get(entry.name.toLowerCase())?.size ?? 0) > 1
    && !entry.name.toLowerCase().startsWith(entry.area.toLowerCase())
    ? { ...entry, name: `${entry.area} ${entry.name}` }
    : entry);
};

/** Column positions when the line is a header naming at least the device ID or the name column. */
const headerColumns = (cells: string[]): Partial<Record<Column, number>> | undefined => {
  // A line holding a device ID is a meter, even when its name is "Meter".
  if (cells.some(looksLikeDeviceId)) return undefined;
  const columns: Partial<Record<Column, number>> = {};
  cells.forEach((cell, index) => {
    const match = HEADERS.find(([column, pattern]) => columns[column] === undefined && pattern.test(cell));
    if (match) columns[match[0]] = index;
  });
  return columns.deviceId !== undefined || columns.name !== undefined ? columns : undefined;
};

const fromHeader = (cells: string[], columns: Partial<Record<Column, number>>): Omit<LiveDeviceListEntry, "line"> => {
  const cell = (column: Column) => (columns[column] === undefined ? "" : cells[columns[column]!] ?? "");
  // A header without a name or ID column: the first other column with text stands in for it.
  const others = cells.filter((_, index) => !Object.values(columns).includes(index));
  const deviceId = columns.deviceId === undefined ? others.find(looksLikeDeviceId) ?? "" : cell("deviceId");
  const name = columns.name === undefined ? others.find((value) => value && value !== deviceId) ?? "" : cell("name");
  return withOptional({ name, deviceId, area: cell("area"), equipment: cell("equipment") });
};

/** No header: name, device ID, block or area, what it powers. A list that starts with the ID is read the other way round. */
const fromPosition = (cells: string[]): Omit<LiveDeviceListEntry, "line"> => {
  const idFirst = looksLikeDeviceId(cells[0] ?? "") && !looksLikeDeviceId(cells[1] ?? "");
  const [name, deviceId] = idFirst ? [cells[1] ?? "", cells[0] ?? ""] : [cells[0] ?? "", cells[1] ?? ""];
  // Unquoted commas inside "what it powers" split it; join the rest back together.
  return withOptional({ name, deviceId, area: cells[2] ?? "", equipment: cells.slice(3).filter(Boolean).join(", ") });
};

const withOptional = (entry: { name: string; deviceId: string; area: string; equipment: string }): Omit<LiveDeviceListEntry, "line"> => ({
  name: entry.name,
  deviceId: entry.deviceId,
  ...(entry.area ? { area: entry.area } : {}),
  ...(entry.equipment ? { equipment: entry.equipment } : {}),
});

/** Tab separated when the line has a tab (cells copied from Excel), else CSV with commas or semicolons and quotes. */
const splitLine = (line: string): string[] => {
  if (line.includes("\t")) return line.split("\t").map(unquote);
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.trim() === "") { cell = ""; quoted = true; }
    else if (char === "," || char === ";") { cells.push(cell); cell = ""; }
    else cell += char;
  }
  cells.push(cell);
  return cells;
};

/** Excel quotes a copied cell that holds a line break or a quote. */
const unquote = (cell: string): string => {
  const trimmed = cell.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).replace(/""/gu, '"') : cell;
};
