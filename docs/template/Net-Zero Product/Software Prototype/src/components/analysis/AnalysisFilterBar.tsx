import {
  AnalysisSpaceLevel,
  AnalysisTimeRange,
  CompareMode,
  OperationalProfileOption,
  Project
} from "@/mock/types";

interface AnalysisFilterBarProps {
  projects: Project[];
  selectedProjectId: string;
  selectedSpaceLevel: AnalysisSpaceLevel;
  selectedTimeRange: AnalysisTimeRange;
  selectedProfile: OperationalProfileOption;
  selectedCompare: CompareMode;
  onProjectChange: (projectId: string) => void;
  onSpaceLevelChange: (value: AnalysisSpaceLevel) => void;
  onTimeRangeChange: (value: AnalysisTimeRange) => void;
  onProfileChange: (value: OperationalProfileOption) => void;
  onCompareChange: (value: CompareMode) => void;
}

export function AnalysisFilterBar({
  projects,
  selectedProjectId,
  selectedSpaceLevel,
  selectedTimeRange,
  selectedProfile,
  selectedCompare,
  onProjectChange,
  onSpaceLevelChange,
  onTimeRangeChange,
  onProfileChange,
  onCompareChange
}: AnalysisFilterBarProps) {
  const spaceLevels: AnalysisSpaceLevel[] = ["Project", "Block", "Floor", "Room"];
  const timeRanges: AnalysisTimeRange[] = ["Today", "Last 7 Days", "MTD", "Last Month", "YTD", "Custom"];
  const profiles: OperationalProfileOption[] = [
    "Office Hours",
    "Dormitory Weekday",
    "Dormitory Weekend",
    "24-Hour Operation",
    "Custom Profile"
  ];
  const compareModes: CompareMode[] = ["Previous Period", "Similar Property Benchmark", "National Average"];

  return (
    <section className="panel p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Selector
          label="Project"
          value={selectedProjectId}
          options={projects.map((project) => ({ label: project.name, value: project.id }))}
          onChange={onProjectChange}
        />
        <Selector
          label="Space Level"
          value={selectedSpaceLevel}
          options={spaceLevels.map((item) => ({ label: item, value: item }))}
          onChange={(value) => onSpaceLevelChange(value as AnalysisSpaceLevel)}
        />
        <Selector
          label="Time Range"
          value={selectedTimeRange}
          options={timeRanges.map((item) => ({ label: item, value: item }))}
          onChange={(value) => onTimeRangeChange(value as AnalysisTimeRange)}
        />
        <Selector
          label="Operational Profile"
          value={selectedProfile}
          options={profiles.map((item) => ({ label: item, value: item }))}
          onChange={(value) => onProfileChange(value as OperationalProfileOption)}
        />
        <div className="space-y-1">
          <label className="text-xs text-slate-400">Compare</label>
          <div className="rounded-md border border-shell-600 bg-shell-800 p-1">
            {compareModes.map((mode) => (
              <button
                key={mode}
                className={`mr-1 rounded px-2.5 py-1 text-xs ${mode === selectedCompare ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
                onClick={() => onCompareChange(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Selector({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-slate-400">{label}</label>
      <select className="w-full rounded-md border border-shell-600 bg-shell-800 px-3 py-2 text-sm text-slate-200" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
