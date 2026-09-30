import { useMemo } from "react";
import { Bell } from "lucide-react";
import { alarms } from "@/mock/mockData";

export function NotificationBell() {
  const activeCount = useMemo(() => alarms.filter((alarm) => alarm.status === "active").length, []);

  return (
    <button className="relative rounded-md p-2 text-slate-400 transition hover:bg-shell-700 hover:text-white">
      <Bell className="h-5 w-5" />
      {activeCount > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {activeCount}
        </span>
      ) : null}
    </button>
  );
}
