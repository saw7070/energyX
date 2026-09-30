import { Bolt, Lightbulb, Monitor, Plug, UtensilsCrossed } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const eliteCategoryIconMeta: Record<
  string,
  { label: string; Icon: LucideIcon; badgeClass: string; iconClass: string }
> = {
  "Incoming Source": {
    label: "Incoming 3Phase",
    Icon: Bolt,
    badgeClass: "bg-amber-500/15",
    iconClass: "text-amber-300"
  },
  "F&B": {
    label: "F&B",
    Icon: UtensilsCrossed,
    badgeClass: "bg-orange-500/15",
    iconClass: "text-orange-300"
  },
  Lighting: {
    label: "Lighting",
    Icon: Lightbulb,
    badgeClass: "bg-emerald-500/15",
    iconClass: "text-emerald-300"
  },
  "IT Devices": {
    label: "IT Devices",
    Icon: Monitor,
    badgeClass: "bg-blue-500/15",
    iconClass: "text-blue-300"
  },
  "General Plug": {
    label: "General Plug",
    Icon: Plug,
    badgeClass: "bg-violet-500/15",
    iconClass: "text-violet-300"
  }
};

interface EliteCategoryIconProps {
  category: string;
  size?: "sm" | "md";
}

export function EliteCategoryIcon({ category, size = "sm" }: EliteCategoryIconProps) {
  const meta = eliteCategoryIconMeta[category] ?? eliteCategoryIconMeta["F&B"];
  const Icon = meta.Icon;
  const boxClass = size === "md" ? "h-8 w-8" : "h-7 w-7";
  const iconClass = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";

  return (
    <span
      className={`inline-flex ${boxClass} shrink-0 items-center justify-center rounded-md ${meta.badgeClass}`}
      title={meta.label}
    >
      <Icon className={`${iconClass} ${meta.iconClass}`} />
    </span>
  );
}
