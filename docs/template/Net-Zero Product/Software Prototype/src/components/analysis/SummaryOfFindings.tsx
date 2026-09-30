import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";

export function SummaryOfFindings({ findings }: { findings: string[] }) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <RequirementGuideTitle
          title="Summary of Findings"
          className="text-sm font-semibold text-white"
          content={{
            title: "Summary of Findings Requirements",
            summary: "This list consolidates key insights from all analytical modules into report-ready bullets.",
            dataAcquisition: [
              "Read findings array from utility analysis mock dataset.",
              "Keep ordering deterministic for consistent reporting."
            ],
            chartGeneration: [
              "Render findings as concise bullet list.",
              "Allow report-generation action from the header."
            ]
          }}
        />
        <button className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500">Generate Full Report</button>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
        {findings.map((finding) => (
          <li key={finding}>{finding}</li>
        ))}
      </ul>
    </section>
  );
}
