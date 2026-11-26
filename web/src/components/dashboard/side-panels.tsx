"use client";

import { motion } from "motion/react";
import { CameraIcon, CameraOffIcon } from "lucide-react";
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
        {data.map((d, i) => (
          <div key={d.department} className="flex flex-col gap-1.5">
            <div className="flex justify-between text-sm">
              <span>{d.department}</span>
              <span className="font-mono tabular-nums text-muted-foreground">{d.rate}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <motion.div
                className={cn("h-full rounded-full", d.rate >= 90 ? "bg-success" : d.rate >= 85 ? "bg-primary" : "bg-warning")}
                initial={{ width: 0 }}
                whileInView={{ width: `${d.rate}%` }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
        ))}
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
