import { useMemo, useState } from "react";
import { Download, FileText, Sparkles } from "lucide-react";
import { AssistantTemplate } from "@/mock/types";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";

export function AIUtilityAssistant({ templates }: { templates: AssistantTemplate[] }) {
  const [activeTemplateId, setActiveTemplateId] = useState(templates[0]?.id ?? "");
  const activeTemplate = useMemo(
    () => templates.find((template) => template.id === activeTemplateId) ?? templates[0],
    [activeTemplateId, templates]
  );

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RequirementGuideTitle
            title="AI Utility Assistant"
            className="text-sm font-semibold text-white"
            content={{
              title: "AI Utility Assistant Requirements",
              summary: "Provide template-driven AI prompts and responses for report drafting and operator guidance.",
              dataAcquisition: [
                "Load assistant templates from analysis mock data.",
                "Track selected template in local state for interaction."
              ],
              chartGeneration: [
                "Render template list as selectable buttons.",
                "Render simulated chat dialogue (user prompt + AI response).",
                "Expose report/export action buttons for future workflow integration."
              ]
            }}
          />
          <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] text-blue-300">AI-assisted</span>
        </div>
        <div className="flex gap-2">
          <button className="rounded-md border border-shell-600 px-2.5 py-1 text-xs text-slate-300 hover:bg-shell-700">
            <FileText className="mr-1 inline h-3.5 w-3.5" />
            Generate Report
          </button>
          <button className="rounded-md border border-shell-600 px-2.5 py-1 text-xs text-slate-300 hover:bg-shell-700">
            <Download className="mr-1 inline h-3.5 w-3.5" />
            Export Summary
          </button>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          {templates.map((template) => (
            <button
              key={template.id}
              className={`w-full rounded-md border p-2 text-left text-xs ${
                template.id === activeTemplateId ? "border-blue-500 bg-blue-500/10 text-blue-200" : "border-shell-600 bg-shell-900 text-slate-300 hover:bg-shell-800"
              }`}
              onClick={() => setActiveTemplateId(template.id)}
            >
              {template.prompt}
            </button>
          ))}
        </div>
        <div className="rounded-lg border border-shell-600 bg-shell-900 p-3">
          <div className="mb-3 flex items-start gap-2 text-xs">
            <div className="rounded-full bg-slate-700 px-2 py-1 text-slate-200">You</div>
            <p className="rounded-lg bg-shell-800 px-3 py-2 text-slate-200">{activeTemplate?.prompt}</p>
          </div>
          <div className="flex items-start gap-2 text-xs">
            <div className="rounded-full bg-blue-500/20 px-2 py-1 text-blue-300">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <p className="rounded-lg bg-blue-500/10 px-3 py-2 text-slate-200">{activeTemplate?.response}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
