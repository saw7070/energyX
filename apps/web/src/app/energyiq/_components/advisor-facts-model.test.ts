import { describe, expect, it } from "vitest";
import { addFact, FACTS_HEADING, readFacts, removeFact, withoutFacts } from "./advisor-facts-model";

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
});
