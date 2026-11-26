import type { Metadata } from "next";
import { ArrivalsChart, StatusDonut, WeeklyTrendChart } from "@/components/dashboard/charts";
import { Greeting } from "@/components/dashboard/greeting";
import { LiveFeed } from "@/components/dashboard/live-feed";
import { CameraHealthPanel, DepartmentRates } from "@/components/dashboard/side-panels";
import { StatCards } from "@/components/dashboard/stat-cards";
import {
  arrivalsByHour,
  cameras,
  demoArrivals,
  departmentRates,
  recentEvents,
  todayStats,
  weeklyTrend,
} from "@/lib/demo-data";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  // TODO(phase 2): load from Supabase when configured.
  const demo = !isSupabaseConfigured;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-1">
        <Greeting />
        <p className="text-sm text-muted-foreground">
          Average arrival today <span className="font-mono text-foreground">{todayStats.avgArrival}</span>
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
        </div>
      </div>

      <CameraHealthPanel cameras={cameras} />
    </div>
  );
}
