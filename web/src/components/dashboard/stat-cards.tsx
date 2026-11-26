"use client";

import { useEffect, useState } from "react";
import { animate, motion } from "motion/react";
import { AlarmClockIcon, CalendarOffIcon, UserCheckIcon, UserXIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

function Counter({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const controls = animate(0, value, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [value]);
  return <span className="tabular-nums">{display}</span>;
}

type Stat = {
  label: string;
  value: number;
  total?: number;
  hint: string;
  icon: React.ElementType;
  tone: "success" | "warning" | "danger" | "info";
};

const TONE: Record<Stat["tone"], { icon: string; bar: string }> = {
  success: { icon: "bg-success-soft text-success", bar: "bg-success" },
  warning: { icon: "bg-warning-soft text-warning", bar: "bg-warning" },
  danger: { icon: "bg-danger-soft text-danger", bar: "bg-danger" },
  info: { icon: "bg-info-soft text-info", bar: "bg-info" },
};

export function StatCards({
  stats,
}: {
  stats: { totalEmployees: number; present: number; late: number; absent: number; onLeave: number };
}) {
  const items: Stat[] = [
    { label: "Present", value: stats.present, total: stats.totalEmployees, hint: "checked in today", icon: UserCheckIcon, tone: "success" },
    { label: "Late", value: stats.late, total: stats.present, hint: "after shift + grace", icon: AlarmClockIcon, tone: "warning" },
    { label: "Absent", value: stats.absent, total: stats.totalEmployees, hint: "no check-in yet", icon: UserXIcon, tone: "danger" },
    { label: "On leave", value: stats.onLeave, total: stats.totalEmployees, hint: "approved leave", icon: CalendarOffIcon, tone: "info" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
      {items.map((s, i) => {
        const pct = s.total ? Math.round((s.value / s.total) * 100) : 0;
        const Icon = s.icon;
        return (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <Card className="relative gap-3 overflow-hidden p-4 transition-shadow hover:shadow-md md:p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{s.label}</span>
                <span className={cn("grid size-8 place-items-center rounded-lg", TONE[s.tone].icon)}>
                  <Icon className="size-4" />
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-heading text-3xl font-semibold md:text-4xl">
                  <Counter value={s.value} />
                </span>
                {s.total ? <span className="text-sm text-muted-foreground">/ {s.total}</span> : null}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className={cn("h-full rounded-full", TONE[s.tone].bar)}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ delay: 0.2 + i * 0.07, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <span className="text-xs text-muted-foreground">{s.hint}</span>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
