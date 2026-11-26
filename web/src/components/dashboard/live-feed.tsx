"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CameraIcon, LogInIcon, LogOutIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckEvent } from "@/lib/demo-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
}

/** Deterministic hue per person so avatars are stable across renders. */
function hue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function LiveFeed({
  initial,
  demoStream,
}: {
  initial: CheckEvent[];
  demoStream?: Omit<CheckEvent, "id" | "time">[];
}) {
  const [events, setEvents] = useState(initial);

  // Demo mode: simulate a new check-in every few seconds. Replaced by Supabase Realtime when live.
  useEffect(() => {
    if (!demoStream?.length) return;
    let i = 0;
    const timer = setInterval(() => {
      const next = demoStream[i % demoStream.length];
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      setEvents((prev) => [{ ...next, id: `demo-${Date.now()}`, time }, ...prev].slice(0, 7));
      i++;
    }, 6000);
    return () => clearInterval(timer);
  }, [demoStream]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-success" />
            <span className="relative inline-flex size-2.5 rounded-full bg-success" />
          </span>
          Live check-ins
        </CardTitle>
        <CardDescription>Updates instantly as cameras recognise people</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <AnimatePresence initial={false} mode="popLayout">
          {events.map((e) => (
            <motion.div
              key={e.id}
              layout
              initial={{ opacity: 0, y: -16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/60"
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
                style={{ background: `oklch(0.62 0.12 ${hue(e.name)})` }}
                aria-hidden
              >
                {initials(e.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{e.name}</p>
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  <CameraIcon className="size-3" /> {e.camera} · {e.department}
                  {e.extraMinutes ? (
                    <span className="ml-1 font-medium text-success" title="Extra time — recorded, not paid">
                      +{e.extraMinutes}m {e.type === "check_in" ? "early" : "extra"}
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="flex items-center gap-1 font-mono text-sm tabular-nums">
                  {e.type === "check_in" ? (
                    <LogInIcon className="size-3.5 text-success" />
                  ) : (
                    <LogOutIcon className="size-3.5 text-info" />
                  )}
                  {e.time}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-4.5 px-1.5 text-[10px]",
                    e.type === "check_out"
                      ? "border-info/30 bg-info-soft text-info"
                      : e.status === "late"
                        ? "border-warning/40 bg-warning-soft text-warning"
                        : "border-success/30 bg-success-soft text-success",
                  )}
                >
                  {e.type === "check_out" ? "Out" : e.status === "late" ? "Late" : "On time"}
                </Badge>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
