import { RecommendationItem } from "@/mock/types";
import { RequirementGuideContent, RequirementGuideTitle } from "@/components/analysis/RequirementGuide";

const DEFAULT_GUIDE: RequirementGuideContent = {
  title: "Energy Saving Recommendations",
  summary: "Recommendation cards translate analytics into clear operational actions.",
  dataAcquisition: [
    "Use the recommendations list from analysis data.",
    "Each item includes area, estimated saving, reason, suggested action, status, owner, and priority."
  ],
  chartGeneration: [
    "Render recommendation cards in a responsive 2-column grid.",
    "Show priority badges with colour coding and an action-log button."
  ]
};

const NAP_GUIDE: RequirementGuideContent = {
  title: "Energy Saving Recommendations",
  summary:
    "Data-driven operational actions for Level 6 & 7 based on circuit ranking, anomalies, and hourly profiles.",
  dataAcquisition: [
    "Generated from observed patterns: dominant fan/load circuits, mid-June weekday spikes, high-load weekends, after-hours share.",
    "Priorities reflect potential impact (High = large circuits or sustained anomalies; Medium = schedule or policy fixes).",
    "Estimated saving is qualitative until post-intervention measurement."
  ],
  chartGeneration: [
    "Render priority-coded cards with affected area, reason, and suggested BMS / operational action.",
    "Support downstream action logging from each card."
  ]
};

export function RecommendationCards({
  items,
  variant = "default"
}: {
  items: RecommendationItem[];
  variant?: "default" | "nap";
}) {
  const guide = variant === "nap" ? NAP_GUIDE : DEFAULT_GUIDE;

  return (
    <section className="panel p-4">
      <RequirementGuideTitle
        title="Energy Saving Recommendations"
        className="mb-3 text-sm font-semibold text-white"
        content={guide}
      />
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <article key={item.id} className="rounded-lg border border-shell-600 bg-shell-900 p-3">
            <div className="mb-2 flex items-start justify-between gap-2">
              <h3 className="text-sm font-medium text-white">{item.title}</h3>
              <span className={`rounded px-2 py-0.5 text-xs ${priorityStyle(item.priority)}`}>{item.priority}</span>
            </div>
            <div className="space-y-1 text-xs text-slate-300">
              <p>
                <span className="text-slate-500">Affected area:</span> {item.affectedArea}
              </p>
              <p>
                <span className="text-slate-500">Estimated saving:</span> {item.estimatedSaving}
              </p>
              <p>
                <span className="text-slate-500">Reason:</span> {item.reason}
              </p>
              <p>
                <span className="text-slate-500">Suggested action:</span> {item.suggestedAction}
              </p>
              <p>
                <span className="text-slate-500">Status:</span> {item.status}
              </p>
              <p>
                <span className="text-slate-500">Owner:</span> {item.owner}
              </p>
            </div>
            <div className="mt-2 flex justify-end">
              <button className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-500">Add to Action Log</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function priorityStyle(priority: RecommendationItem["priority"]) {
  if (priority === "High") {
    return "bg-rose-500/20 text-rose-300";
  }
  if (priority === "Medium") {
    return "bg-amber-500/20 text-amber-300";
  }
  return "bg-emerald-500/20 text-emerald-300";
}
