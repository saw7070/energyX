import { describe, expect, it } from "vitest";
import { splitAdvisorFigures } from "./advisor-figures";

describe("splitAdvisorFigures", () => {
  it("leaves an answer without figures untouched", () => {
    expect(splitAdvisorFigures("Use was normal.")).toEqual({ text: "Use was normal.", figures: [] });
  });

  it("pulls up to three figures out of the answer text", () => {
    const answer = 'Night use rose.\n\n```figures\n[{"label":"Night-time load","value":"48 kW","tone":"alert"},{"label":"Usual night","value":"28 kW"},{"label":"If fixed","value":"S$1,080 a month","tone":"good"},{"label":"Extra","value":"1"}]\n```';
    expect(splitAdvisorFigures(answer)).toEqual({
      text: "Night use rose.",
      figures: [
        { label: "Night-time load", value: "48 kW", tone: "alert" },
        { label: "Usual night", value: "28 kW", tone: "neutral" },
        { label: "If fixed", value: "S$1,080 a month", tone: "good" },
      ],
    });
  });

  it("hides an unfinished block while the answer streams", () => {
    expect(splitAdvisorFigures('Night use rose.\n```figures\n[{"label":"Ni')).toEqual({ text: "Night use rose.", figures: [] });
  });

  it("drops a malformed block instead of showing it as code", () => {
    expect(splitAdvisorFigures("Done.\n```figures\nnot json\n```\nMore.")).toEqual({ text: "Done.\n\nMore.", figures: [] });
    expect(splitAdvisorFigures('A\n```figures\n[{"label":"x"}]\n```').figures).toEqual([]);
  });
});
