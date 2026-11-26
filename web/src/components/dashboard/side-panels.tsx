"use client";

import { motion } from "motion/react";
import { CameraIcon, CameraOffIcon, TimerIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CameraHealth } from "@/lib/demo-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function DepartmentRates({ data }: { data: { department: string; rate: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>By team</CardTitle>
        <CardDescription>Attendance rate this month</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {data.map((d, i) => {
          const level = d.rate >= 90 ? "good" : d.rate >= 85 ? "ok" : "improve";
          return (
          <div key={d.department} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                {d.department}
                {level === "improve" && (
                  <Badge variant="outline" className="h-4.5 border-danger/30 bg-danger-soft px-1.5 text-[10px] text-danger">
                    Needs improvement
                  </Badge>
                )}
              </span>
              <span
                className={cn(
                  "font-mono tabular-nums",
                  level === "good" ? "text-success" : level === "ok" ? "text-blue" : "text-danger",
                )}
              >
                {d.rate}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <motion.div
                className={cn("h-full rounded-full", level === "good" ? "bg-success" : level === "ok" ? "bg-blue" : "bg-danger")}
                initial={{ width: 0 }}
                whileInView={{ width: `${d.rate}%` }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

const fmtMinutes = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

/** Extra time = before shift start + after shift end. Shown as recognition only — never paid. */
export function ExtraTimePanel({
  todayMinutes,
  weekMinutes,
  top,
}: {
  todayMinutes: number;
  weekMinutes: number;
  top: { name: string; department: string; minutes: number }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TimerIcon className="size-4 text-success" /> Extra time
          <Badge variant="outline" className="h-4.5 px-1.5 text-[10px] text-muted-foreground">
            not paid
          </Badge>
        </CardTitle>
        <CardDescription>Before shift start + after shift end</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Today", value: todayMinutes },
            { label: "This week", value: weekMinutes },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border bg-success-soft/60 p-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 font-mono text-lg font-semibold text-success tabular-nums">{fmtMinutes(s.value)}</p>
            </div>
          ))}
        </div>
        <ul className="flex flex-col gap-2">
          {top.map((p, i) => (
            <li key={p.name} className="flex items-center gap-2 text-sm">
              <span className="grid size-5 place-items-center rounded-full bg-muted text-[10px] font-semibold">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {p.name} <span className="text-xs text-muted-foreground">· {p.department}</span>
              </span>
              <span className="font-mono text-xs text-success tabular-nums">+{fmtMinutes(p.minutes)}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">
          Recorded for recognition and reports only — it is not added to salary.
        </p>
      </CardContent>
    </Card>
  );
}

export function CameraHealthPanel({ cameras }: { cameras: CameraHealth[] }) {
  const online = cameras.filter((c) => c.status === "online").length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cameras</CardTitle>
        <CardDescription>
          {online} of {cameras.length} online
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {cameras.map((c) => {
          const live = c.status === "online" && c.role !== "Disabled";
          return (
            <div
              key={c.name}
              className={cn(
                "relative overflow-hidden rounded-lg border p-3",
                live ? "bg-gradient-to-br from-accent/60 to-card" : "bg-muted/40",
              )}
            >
              {live && (
                <span className="pointer-events-none absolute inset-x-0 top-0 h-full">
                  <span className="block h-0.5 w-full animate-scan bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
                </span>
              )}
              <div className="flex items-center justify-between">
                {c.status === "online" ? (
                  <CameraIcon className="size-4 text-primary" />
                ) : (
                  <CameraOffIcon className="size-4 text-danger" />
                )}
                <span
                  className={cn(
                    "size-2 rounded-full",
                    c.status === "online" ? "bg-success" : "bg-danger",
                  )}
                  aria-label={c.status}
                />
              </div>
              <p className="mt-2 truncate text-sm font-medium">{c.name}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <Badge variant="secondary" className="h-4.5 px-1.5 text-[10px]">
                  {c.role}
                </Badge>
                {live && <span className="font-mono text-[10px] text-muted-foreground">{c.fps} fps</span>}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
