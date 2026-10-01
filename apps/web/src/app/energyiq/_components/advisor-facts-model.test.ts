import { describe, expect, it } from "vitest";
import { addFact, factEditText, factFromEditText, factLayout, FACTS_HEADING, readFacts, removeFact, updateFact, withoutFacts } from "./advisor-facts-model";

const block = "```json\n{\"schemaVersion\":1}\n```";
describe("things the advisor should know", () => {
  it("adds a dated fact under its own heading and keeps the rest of the notes", () => {
    const first = addFact(`Office brief.\n\n${block}`, "alwaysOn", "  Server room   runs 24/7 ", "2026-09-22");
    expect(first).toBe(`Office brief.\n\n${block}\n\n${FACTS_HEADING}\n\n- 2026-09-22 · Must stay on: Server room runs 24/7\n`);
    const second = addFact(first, "afterHours", "Cleaners 7–10 pm", "2026-09-23");
    expect(readFacts(second).map(fact => [fact.date, fact.kind, fact.text])).toEqual([["2026-09-22", "alwaysOn", "Server room runs 24/7"], ["2026-09-23", "afterHours", "Cleaners 7–10 pm"]]);
    expect(second.startsWith(`Office brief.\n\n${block}`)).toBe(true);
  });
  it("adds to an existing section that sits before other headings", () => {
    const notes = `${FACTS_HEADING}\n\n- 2026-09-01 · Note: Fridays mostly remote\n\n## Floor layout\n\n${block}\n`;
    const next = addFact(notes, "upcoming", "Renovation 1–5 Dec", "2026-09-22");
    expect(next).toContain("- 2026-09-01 · Note: Fridays mostly remote\n- 2026-09-22 · Coming up: Renovation 1–5 Dec\n\n## Floor layout");
    expect(readFacts(next)).toHaveLength(2);
  });
  it("removes exactly one fact and hides the section from the brief", () => {
    const notes = addFact(addFact("Brief", "alwaysOn", "Fridge", "2026-09-22"), "other", "Plain note", "2026-09-22");
    const facts = readFacts(notes);
    expect(readFacts(removeFact(notes, facts[0]!)).map(fact => fact.text)).toEqual(["Plain note"]);
    expect(withoutFacts(notes).trim()).toBe("Brief");
    expect(readFacts(`${FACTS_HEADING}\n- a bullet the advisor wrote freely`)[0]).toMatchObject({ kind: "other", text: "a bullet the advisor wrote freely" });
  });
  it("edits one fact's wording and type in place, keeping its date", () => {
    const notes = addFact(addFact("Brief", "alwaysOn", "Fridge", "2026-09-22"), "other", "Cleaners 7-10pm", "2026-09-23");
    const [, cleaners] = readFacts(notes);
    const next = updateFact(notes, cleaners!, "afterHours", "  Cleaners   7–10 pm on weekdays ");
    expect(readFacts(next).map(fact => [fact.date, fact.kind, fact.text])).toEqual([["2026-09-22", "alwaysOn", "Fridge"], ["2026-09-23", "afterHours", "Cleaners 7–10 pm on weekdays"]]);
    expect(next.startsWith("Brief")).toBe(true);
  });
});

describe("how a fact is laid out", () => {
  const equipment = "Circuit equipment list supplied by the site team: A18P — Coffee machine x1, Warmer machine x1; B2R — Balcony light x1, Toilet Light x3; B6B — Power Plug x6.";
  it("turns a code-to-equipment list into table rows", () => {
    expect(factLayout(equipment)).toEqual({ kind: "table", intro: "Circuit equipment list supplied by the site team", rows: [
      { code: "A18P", items: "Coffee machine ×1, Warmer machine ×1" },
      { code: "B2R", items: "Balcony light ×1, Toilet Light ×3" },
      { code: "B6B", items: "Power Plug ×6" },
    ] });
  });
  it("turns other multi-part notes into a list and leaves short notes alone", () => {
    expect(factLayout("Closures: 1 Dec renovation; 25 Dec Christmas; 1 Jan New Year")).toEqual({ kind: "list", intro: "Closures", items: ["1 Dec renovation", "25 Dec Christmas", "1 Jan New Year"] });
    expect(factLayout("Site team confirms electricity data are available through 11 September 2026; readings after that date are currently unavailable.")).toMatchObject({ kind: "plain" });
    expect(factLayout("Cleaners work 7–10 pm.")).toEqual({ kind: "plain", text: "Cleaners work 7–10 pm." });
  });
  it("edits long lists one item per line and stores them back on one line", () => {
    const edit = factEditText(equipment);
    expect(edit.split("\n")).toHaveLength(3);
    expect(factFromEditText(edit)).toBe(equipment);
  });
});
