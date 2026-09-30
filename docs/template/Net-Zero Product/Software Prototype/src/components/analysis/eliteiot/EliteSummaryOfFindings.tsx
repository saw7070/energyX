import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";
import { NapFindingSection } from "@/mock/napEnergyAnalysisData";

interface EliteSummaryOfFindingsProps {
  sections: NapFindingSection[];
}

export function EliteSummaryOfFindings({ sections }: EliteSummaryOfFindingsProps) {
  return (
    <section className="panel p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <RequirementGuideTitle
          title="Summary of Findings"
          className="text-sm font-semibold text-white"
          content={{
            title: "Summary of Findings",
            summary: "Structured insights grouped by theme, generated from the EliteIOT office monitoring dataset.",
            dataAcquisition: [
              "Derived from incoming and sub-meter readings for 15–29 Jun 2026 (Malaysia office).",
              "Anomaly baseline uses day-type means from the same 15-day monitoring window.",
              "Grouped into scope, type-group, category, day-type behaviour, peaks, and anomalies."
            ],
            chartGeneration: [
              "Render findings as themed cards with scannable bullet points.",
              "Support full-report export from the header action."
            ]
          }}
        />
        <button className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500">
          Generate Full Report
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {sections.map((section) => (
          <article
            key={section.title}
            className="rounded-lg border border-shell-600 bg-shell-900/60 p-3"
          >
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {section.title}
            </h3>
            <ul className="space-y-2">
              {section.items.map((item) => (
                <li key={item} className="flex gap-2 text-sm leading-snug text-slate-300">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
