"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Label, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

// Colour meaning used across the dashboard:
// green = on time / good · amber = within grace / watch · red = late, absent, needs improvement · blue = trends, leave
const trendConfig = {
  present: { label: "Present", color: "var(--blue)" },
  late: { label: "Late", color: "var(--warning)" },
  absent: { label: "Absent", color: "var(--danger)" },
} satisfies ChartConfig;

export function WeeklyTrendChart({ data }: { data: { day: string; present: number; late: number; absent: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance trend</CardTitle>
        <CardDescription>Last 7 working days</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={trendConfig} className="aspect-auto h-64 w-full">
          <AreaChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
            <defs>
              {(["present", "late", "absent"] as const).map((k) => (
                <linearGradient key={k} id={`fill-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={`var(--color-${k})`} stopOpacity={0.45} />
                  <stop offset="95%" stopColor={`var(--color-${k})`} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} width={40} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
            <Area dataKey="absent" type="monotone" fill="url(#fill-absent)" stroke="var(--color-absent)" strokeWidth={2} />
            <Area dataKey="late" type="monotone" fill="url(#fill-late)" stroke="var(--color-late)" strokeWidth={2} />
            <Area dataKey="present" type="monotone" fill="url(#fill-present)" stroke="var(--color-present)" strokeWidth={2} />
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const arrivalsConfig = { count: { label: "Arrivals", color: "var(--success)" } } satisfies ChartConfig;

type Punctuality = "ontime" | "grace" | "late";
const PUNCTUALITY: Record<Punctuality, { label: string; color: string }> = {
  ontime: { label: "On time", color: "var(--success)" },
  grace: { label: "Within grace", color: "var(--warning)" },
  late: { label: "Late", color: "var(--danger)" },
};

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.replace(/\D+$/, "").split(":").map(Number);
  return h * 60 + (m || 0);
};

export function ArrivalsChart({
  data,
  shiftStart = "09:00",
  graceMinutes = 15,
}: {
  data: { slot: string; count: number }[];
  shiftStart?: string;
  graceMinutes?: number;
}) {
  const start = toMinutes(shiftStart);
  const classify = (slot: string): Punctuality => {
    const t = toMinutes(slot);
    if (slot.endsWith("+") || t >= start + graceMinutes) return "late";
    return t < start ? "ontime" : "grace";
  };
  const rows = data.map((d) => ({ ...d, kind: classify(d.slot) }));
  const total = rows.reduce((s, r) => s + r.count, 0) || 1;
  const onTimePct = Math.round((rows.filter((r) => r.kind === "ontime").reduce((s, r) => s + r.count, 0) / total) * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Arrival times</CardTitle>
        <CardDescription>
          Check-ins per 15 minutes · <span className="font-medium text-success">{onTimePct}% on time</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={arrivalsConfig} className="aspect-auto h-56 w-full">
          <BarChart data={rows} margin={{ left: -16, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="slot" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
            <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
            <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent hideIndicator />} />
            <Bar dataKey="count" radius={[6, 6, 2, 2]}>
              {rows.map((r) => (
                <Cell key={r.slot} fill={PUNCTUALITY[r.kind].color} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {(Object.keys(PUNCTUALITY) as Punctuality[]).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: PUNCTUALITY[k].color }} />
              {PUNCTUALITY[k].label}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const statusConfig = {
  present: { label: "On time", color: "var(--success)" },
  late: { label: "Late", color: "var(--warning)" },
  absent: { label: "Absent", color: "var(--danger)" },
  leave: { label: "On leave", color: "var(--blue)" },
} satisfies ChartConfig;

export function StatusDonut({
  present,
  late,
  absent,
  leave,
}: {
  present: number;
  late: number;
  absent: number;
  leave: number;
}) {
  const data = [
    { key: "present", value: present - late },
    { key: "late", value: late },
    { key: "absent", value: absent },
    { key: "leave", value: leave },
  ];
  const total = present + absent + leave;
  const rate = total ? Math.round((present / total) * 100) : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today</CardTitle>
        <CardDescription>Status breakdown</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={statusConfig} className="mx-auto aspect-square h-52">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
            <Pie data={data} dataKey="value" nameKey="key" innerRadius="62%" strokeWidth={4} paddingAngle={2} cornerRadius={6}>
              {data.map((d) => (
                <Cell key={d.key} fill={`var(--color-${d.key})`} />
              ))}
              <Label
                content={({ viewBox }) =>
                  viewBox && "cx" in viewBox ? (
                    <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                      <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground font-display text-4xl">
                        {rate}%
                      </tspan>
                      <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 22} className="fill-muted-foreground text-xs">
                        attendance
                      </tspan>
                    </text>
                  ) : null
                }
              />
            </Pie>
          </PieChart>
        </ChartContainer>
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {data.map((d) => (
            <li key={d.key} className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm" style={{ background: statusConfig[d.key as keyof typeof statusConfig].color }} />
              <span className="text-muted-foreground">{statusConfig[d.key as keyof typeof statusConfig].label}</span>
              <span className="ml-auto font-mono tabular-nums">{d.value}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
