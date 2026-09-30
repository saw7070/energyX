import { describe, expect, it } from "vitest";
import { readProjectSpatialReference, renderProjectSpatialSvg } from "@datafoundry/contracts";
const reference = { schemaVersion: 1, projectId: "office", provenance: {file: "Charles.html", status: "reference-derived"}, layout: {viewBox: [0,0,800,500], zones: [{id:"B",referenceBoard:"DB2",rect:[10,10,300,300]}, {id:"C",referenceBoard:"DB3",independentSpace:false,physicalParentRoom:"Showroom",equipment:"LED panels"}], rooms:[{name:"Showroom",zone:"B",rect:[20,60,200,150]}]} };
const notes = (value: unknown) => "Project information\n```json\n" + JSON.stringify(value) + "\n```";
describe("project spatial assets", () => {
  it("renders the stored reference and keeps equipment subgroups within their parent room", () => {
    const result = readProjectSpatialReference(notes(reference), "office")!;
    const svg = renderProjectSpatialSvg(result.reference);
    expect(svg).toContain("Showroom"); expect(svg).toContain("DB3 · subgroup"); expect(svg).not.toContain("Area C");
    expect(svg).toContain("not to scale"); expect(svg).not.toContain("kWh");
  });
  it("does not load another project's reference or malformed coordinates", () => {
    expect(readProjectSpatialReference(notes(reference), "school")).toBeNull();
    expect(readProjectSpatialReference(notes({...reference,layout:{...reference.layout,rooms:[{name:"Room",zone:"B",rect:[20,20,9999,100]}]}}), "office")).toBeNull();
    expect(readProjectSpatialReference("```json\n{broken}\n```", "office")).toBeNull();
  });
  it("accepts the meter locations a zone covers, and rejects a malformed list", () => {
    const withLocations = {...reference, layout:{...reference.layout, zones: reference.layout.zones.map(zone => ({...zone, meterLocations:["Showroom Area"]}))}};
    const loaded = readProjectSpatialReference(notes(withLocations), "office")!;
    expect(loaded.reference.layout.zones[0]!.meterLocations).toEqual(["Showroom Area"]);
    // The panel label an electrician reads is unchanged by naming the areas.
    expect(renderProjectSpatialSvg(loaded.reference)).toContain("DB2");

    const bad = (value: unknown) => ({...reference, layout:{...reference.layout, zones: [{...reference.layout.zones[0], meterLocations: value}, reference.layout.zones[1]]}});
    for (const value of [[], "Showroom Area", [""], [1], Array.from({length:51},(_,i)=>`Area ${i}`)]) {
      expect(readProjectSpatialReference(notes(bad(value)), "office")).toBeNull();
    }
  });

  it("escapes labels instead of allowing project notes to inject active SVG content", () => {
    const value = {...reference,layout:{...reference.layout,rooms:[{name:'<script>alert(1)</script>',zone:"B",rect:[20,60,200,150]}]}};
    const svg = renderProjectSpatialSvg(readProjectSpatialReference(notes(value), "office")!.reference);
    expect(svg).not.toContain("<script>"); expect(svg).toContain("&lt;script&gt;");
  });
});
