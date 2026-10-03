/**
 * Suggests what a meter is used for from the equipment it feeds, e.g. "B5B · Router, Modem, Server, IP Camera ×5"
 * → "it". Each item in the list votes for at most one type of use; the type with the most items wins.
 */
export type SuggestedMeterCategory = "it" | "kitchen" | "plug" | "light" | "aircon";

/** When two types have the same number of items, the first here wins. */
const TIE_ORDER: SuggestedMeterCategory[] = ["kitchen", "it", "aircon", "light", "plug"];

/**
 * Words and phrases (lower case, matched as whole words) for each type. Phrases such as "led display" or
 * "chiller plant" override a shorter word inside them: within one item the match that ends last wins, and of
 * two matches ending together the longer one wins, so "Kitchen light" is lighting and "LED display" is IT.
 */
const KEYWORDS: Record<SuggestedMeterCategory, string[]> = {
  it: [
    "router", "routers", "modem", "modems", "server", "servers", "server rack", "rack", "switch", "network switch", "poe", "poe switch",
    "network", "wifi", "wi-fi", "access point", "access points", "camera", "cameras", "ip camera", "cctv", "nvr", "dvr",
    "printer", "printers", "scanner", "copier", "photocopier", "computer", "computers", "pc", "desktop", "laptop", "laptops",
    "monitor", "monitors", "ups", "tv", "tvs", "television", "display", "displays", "screen", "screens", "projector",
    "led display", "led panel", "led wall", "led screen", "led tv",
  ],
  kitchen: [
    "coffee", "coffee machine", "warmer", "microwave", "fridge", "fridges", "refrigerator", "freezer", "freezers", "chiller", "chillers",
    "fryer", "air fryer", "deep fryer", "oven", "ovens", "kettle", "waffle", "eggette", "bingsu", "blender", "blander", "ice",
    "ice maker", "dispenser", "water dispenser", "cooker", "rice cooker", "cuckoo", "toaster", "kitchen", "pantry", "juicer",
    "steamer", "stove", "hob", "induction", "grill", "dishwasher", "water boiler", "water cooler", "vending machine", "food warmer",
    "bain marie",
  ],
  plug: [
    "plug", "plugs", "plug load", "socket", "sockets", "power point", "power points", "outlet", "outlets", "extension",
    "power strip", "sso", "twin socket",
  ],
  light: [
    "light", "lights", "lighting", "lamp", "lamps", "led", "leds", "signboard", "signboards", "sign board", "signage", "downlight",
    "downlights", "spotlight", "spotlights", "floodlight", "floodlights", "bulb", "bulbs", "fluorescent", "light switch",
  ],
  aircon: [
    "aircon", "aircons", "air con", "air-con", "a/c", "aircond", "air conditioner", "air conditioners", "air conditioning",
    "fcu", "ahu", "split unit", "cooling", "cooling tower", "chiller plant", "chilled water", "fan coil", "vrv", "vrf",
    "hvac", "acmv", "ventilation", "exhaust fan", "fan", "fans", "air curtain",
  ],
};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");
const MATCHERS = TIE_ORDER.flatMap((category) => KEYWORDS[category].map((keyword) => ({
  category,
  length: keyword.length,
  // Whole words only, allowing any run of spaces or a hyphen between the words of a phrase.
  pattern: new RegExp(`(?<![\\p{L}\\p{N}])${keyword.split(/\s+/u).map(escape).join("[\\s-]+")}(?![\\p{L}\\p{N}])`, "giu"),
})));

/** The one type an item such as "IP Camera ×5" belongs to, or null when nothing matches. */
const itemCategory = (item: string): SuggestedMeterCategory | null => {
  let best: { category: SuggestedMeterCategory; end: number; length: number } | null = null;
  for (const matcher of MATCHERS) {
    for (const match of item.matchAll(matcher.pattern)) {
      const end = match.index + match[0].length;
      if (!best || end > best.end || (end === best.end && matcher.length > best.length)) {
        best = { category: matcher.category, end, length: matcher.length };
      }
    }
  }
  return best?.category ?? null;
};

/**
 * The likely type of use for a meter from its name or equipment list, or null when nothing in it is recognised.
 * Items are separated by commas, semicolons, "·" or "and"; quantities such as "×8" do not add weight.
 */
export const suggestMeterCategory = (text: string): SuggestedMeterCategory | null => {
  const counts = new Map<SuggestedMeterCategory, number>();
  for (const item of text.split(/\s*(?:[,;·\n]|\band\b)\s*/iu)) {
    const category = item.trim() ? itemCategory(item) : null;
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  let winner: SuggestedMeterCategory | null = null;
  for (const category of TIE_ORDER) {
    if ((counts.get(category) ?? 0) > (winner ? counts.get(winner)! : 0)) winner = category;
  }
  return winner;
};
