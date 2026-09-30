import { expect, it } from "vitest";
import { validateActionSuggestions } from "./action-suggestions.js";

const source = "<html><body><p>Switch off the LED display after closing &amp; check the timer.</p></body></html>";
const item = { title:"Display schedule",recommendation:"Check the timer and switch off after closing.",meterId:"led",sourceQuote:"Switch off the LED display after closing & check the timer." };
it("anchors suggestions to accepted report text and deduplicates by quotation and meter",()=>{
  const items=validateActionSuggestions({recommendations:[item,{...item,title:"Reworded heading"}]},source,new Set(["led"]));
  expect(items).toHaveLength(1); expect(items[0]?.id).toMatch(/^[a-f0-9]{24}$/);
  expect(validateActionSuggestions({recommendations:[{...item,meterId:null}]},source,new Set())[0]?.meterId).toBeNull();
});
it("rejects invented quotation and foreign meter IDs without inventing a mapping",()=>{
  expect(()=>validateActionSuggestions({recommendations:[{...item,sourceQuote:"Invented savings of 80 percent"}]},source,new Set(["led"]))).toThrow("REPORT_ACTION_QUOTE_NOT_FOUND");
  expect(()=>validateActionSuggestions({recommendations:[{...item,sourceQuote:"<div></div><p></p>"}]},source,new Set(["led"]))).toThrow("REPORT_ACTION_QUOTE_NOT_FOUND");
  expect(()=>validateActionSuggestions({recommendations:[item]},source,new Set(["other"]))).toThrow("REPORT_ACTION_METER_INVALID");
  expect(()=>validateActionSuggestions({recommendations:[{...item,ownerId:"other"}]},source,new Set(["led"]))).toThrow();
});
it("accepts no recommendations rather than forcing a fabricated action",()=>{
  expect(validateActionSuggestions({recommendations:[]},source,new Set())).toEqual([]);
});
it("keeps distinct measures under the same evidence-backed finding",()=>{
  const insight={title:"Display schedule",summary:"The report identifies an after-hours scheduling opportunity.",sourceQuote:item.sourceQuote};
  const another={...item,recommendation:"Inspect whether the timer can enforce the agreed schedule.",insight};
  const items=validateActionSuggestions({recommendations:[{...item,insight},another,another]},source,new Set(["led"]));
  expect(items).toHaveLength(2);
  expect(items[0]?.id).toBe(validateActionSuggestions({recommendations:[item]},source,new Set(["led"]))[0]?.id);
  expect(items[0]?.insight).toEqual(items[1]?.insight);
  for(const quote of ["An invented observation about this circuit.","<div></div><p></p>"]){
    expect(()=>validateActionSuggestions({recommendations:[{...item,insight:{...insight,sourceQuote:quote}}]},source,new Set(["led"]))).toThrow("REPORT_ACTION_QUOTE_NOT_FOUND");
  }
});

it("matches quotations with inline emphasis immediately before punctuation",()=>{
 const quote="The display used 12.5 kWh. Confirm the schedule first.";
 expect(validateActionSuggestions({recommendations:[{...item,sourceQuote:quote}]},"<p>The display used <strong>12.5 kWh</strong>. Confirm the schedule first.</p>",new Set(["led"]))).toHaveLength(1);
});

it("treats a null optional measure key as absent without inferring a new key",()=>{
 expect(validateActionSuggestions({recommendations:[{...item,measureKey:null}]},source,new Set(["led"]))[0]?.measureKey).toBeUndefined();
 expect(()=>validateActionSuggestions({recommendations:[{...item,measureKey:""}]},source,new Set(["led"]))).toThrow();
});
