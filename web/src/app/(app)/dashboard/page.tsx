import type { Metadata } from "next";
import { ArrivalsChart, StatusDonut, WeeklyTrendChart } from "@/components/dashboard/charts";
import { Greeting } from "@/components/dashboard/greeting";
import { LiveFeed } from "@/components/dashboard/live-feed";
import { CameraHealthPanel, DepartmentRates, ExtraTimePanel } from "@/components/dashboard/side-panels";
import { StatCards } from "@/components/dashboard/stat-cards";
import {
  arrivalsByHour,
  cameras,
  demoArrivals,
  departmentRates,
  extraTime,
  recentEvents,
  todayStats,
  weeklyTrend,
} from "@/lib/demo-data";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Dashboard" };

/** Green = before shift start, amber = within grace, red = late. Defaults match the demo shift (09:00, 15 min). */
function ArrivalChip({ time, shiftStart = "09:00", grace = 15 }: { time: string; shiftStart?: string; grace?: number }) {
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const diff = mins(time) - mins(shiftStart);
  const [label, cls] =
    diff <= 0
      ? ["On time", "border-success/30 bg-success-soft text-success"]
      : diff < grace
        ? [`Within grace · +${diff} min`, "border-warning/40 bg-warning-soft text-warning"]
        : [`Late · +${diff} min`, "border-danger/30 bg-danger-soft text-danger"];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

export default function DashboardPage() {
  // TODO(phase 2): load from Supabase when configured.
  const demo = !isSupabaseConfigured;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-1">
        <Greeting />
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Average arrival today <span className="font-mono text-foreground">{todayStats.avgArrival}</span>
          <ArrivalChip time={todayStats.avgArrival} />
        </p>
      </div>

      <StatCards stats={todayStats} />

      <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 md:gap-6 lg:col-span-2">
          <WeeklyTrendChart data={weeklyTrend} />
          <div className="grid gap-4 md:grid-cols-2 md:gap-6">
            <ArrivalsChart data={arrivalsByHour} />
            <StatusDonut
              present={todayStats.present}
              late={todayStats.late}
              absent={todayStats.absent}
              leave={todayStats.onLeave}
            />
          </div>
        </div>
        <div className="flex flex-col gap-4 md:gap-6">
          <LiveFeed initial={recentEvents} demoStream={demo ? demoArrivals : undefined} />
          <DepartmentRates data={departmentRates} />
          <ExtraTimePanel {...extraTime} />
        </div>
      </div>

      <CameraHealthPanel cameras={cameras} />
    </div>
  );
}
