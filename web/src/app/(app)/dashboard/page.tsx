import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrivalsChart, StatusDonut, WeeklyTrendChart } from "@/components/dashboard/charts";
import { Greeting } from "@/components/dashboard/greeting";
import { LiveFeed } from "@/components/dashboard/live-feed";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { CameraHealthPanel, DepartmentRates, ExtraTimePanel } from "@/components/dashboard/side-panels";
import { StatCards } from "@/components/dashboard/stat-cards";
import { Skeleton } from "@/components/ui/skeleton";
import { getViewer, isApproverRole } from "@/lib/auth";
import { loadDashboard } from "@/lib/dashboard";
import * as demo from "@/lib/demo-data";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Dashboard" };

/** Green = before shift start, amber = within grace, red = late. */
function ArrivalChip({ time, shiftStart = "09:00", grace = 15 }: { time: string; shiftStart?: string; grace?: number }) {
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const diff = mins(time) - mins(shiftStart);
  const [label, cls] =
    diff <= 0
      ? ["On time", "border-success/30 bg-success-soft text-success"]
      : diff < grace
        ? [`Within grace · +${diff} min`, "border-warning/40 bg-warning-soft text-warning"]
        : [`Late · +${diff} min`, "border-danger/30 bg-danger-soft text-danger"];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

type Data = Awaited<ReturnType<typeof loadDashboard>>;

function DemoData(): Data {
  return {
    stats: demo.todayStats,
    shiftStart: "09:00",
    weeklyTrend: demo.weeklyTrend,
    arrivalsByHour: demo.arrivalsByHour,
    departmentRates: demo.departmentRates,
    extraTime: demo.extraTime,
    recentEvents: demo.recentEvents,
    cameras: demo.cameras,
  };
}

async function Dashboard() {
  let d: Data;
  if (isSupabaseConfigured) {
    const v = await getViewer();
    if (!isApproverRole(v.role)) redirect("/me");
    d = await loadDashboard();
  } else {
    d = DemoData();
  }

  return (
    <>
      {isSupabaseConfigured && <RealtimeRefresh />}
      <div className="flex flex-col gap-1">
        <Greeting />
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Average arrival today <span className="font-mono text-foreground">{d.stats.avgArrival}</span>
          <ArrivalChip time={d.stats.avgArrival} shiftStart={d.shiftStart} />
        </p>
      </div>

      <StatCards stats={d.stats} />

      <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 md:gap-6 lg:col-span-2">
          <WeeklyTrendChart data={d.weeklyTrend} />
          <div className="grid gap-4 md:grid-cols-2 md:gap-6">
            <ArrivalsChart data={d.arrivalsByHour} shiftStart={d.shiftStart} />
            <StatusDonut present={d.stats.present} late={d.stats.late} absent={d.stats.absent} leave={d.stats.onLeave} />
          </div>
        </div>
        <div className="flex flex-col gap-4 md:gap-6">
          <LiveFeed key={d.recentEvents[0]?.id ?? "none"} initial={d.recentEvents} demoStream={isSupabaseConfigured ? undefined : demo.demoArrivals} />
          <DepartmentRates data={d.departmentRates} />
          <ExtraTimePanel {...d.extraTime} />
        </div>
      </div>

      <CameraHealthPanel cameras={d.cameras} />
    </>
  );
}

export default function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 md:gap-6">
      <Suspense
        fallback={
          <div className="flex flex-col gap-6">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
        }
      >
        <Dashboard />
      </Suspense>
    </div>
  );
}
