import type { CameraHealth, CheckEvent } from "@/lib/demo-data";
import { addDays, fmtTime, todayLocal, TZ } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const ROLE: Record<string, CameraHealth["role"]> = { entry: "Entry", exit: "Exit", both: "Both", presence: "Presence", disabled: "Disabled" };
const weekday = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const localMinutes = (iso: string) => {
  const [h, m] = fmtTime(iso).split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Live dashboard numbers. RLS scopes everything: managers only see their own team. */
export async function loadDashboard() {
  const supabase = await createClient();
  const today = todayLocal();
  const weekStart = addDays(today, -6);
  const startOfDay = new Date(`${today}T00:00:00+05:00`).toISOString();

  const [{ data: emps }, { data: days }, { data: events }, { data: cams }, { data: leaves }] = await Promise.all([
    supabase.from("employees").select("id, full_name, department_id, departments(name)").in("status", ["active", "pending_enrollment"]),
    supabase.from("attendance_days").select("employee_id, work_date, check_in_at, status, extra_minutes, scheduled_start")
      .gte("work_date", weekStart).lte("work_date", today),
    supabase.from("attendance_events").select("id, employee_id, type, occurred_at, confidence, source, cameras(name)")
      .in("type", ["check_in", "check_out"]).eq("shadow", false).gte("occurred_at", startOfDay).order("occurred_at", { ascending: false }).limit(8),
    supabase.from("cameras").select("name, role, status, fps, departments(name)").order("name"),
    supabase.from("leaves").select("employee_id").eq("status", "approved").lte("start_date", today).gte("end_date", today),
  ]);

  const people = emps ?? [];
  const dept = new Map(people.map((e) => [e.id, (e.departments as unknown as { name: string } | null)?.name ?? "—"]));
  const name = new Map(people.map((e) => [e.id, e.full_name]));
  const todays = (days ?? []).filter((d) => d.work_date === today);
  const inToday = todays.filter((d) => d.check_in_at);
  const onLeave = new Set([...(leaves ?? []).map((l) => l.employee_id), ...todays.filter((d) => d.status === "leave").map((d) => d.employee_id)]);
  const present = inToday.length;
  const late = inToday.filter((d) => d.status === "late").length;

  const arrivals = inToday.map((d) => localMinutes(d.check_in_at!)).sort((a, b) => a - b);
  const avgArrival = arrivals.length ? hhmm(Math.round(arrivals.reduce((a, b) => a + b, 0) / arrivals.length)) : "—";

  // most common scheduled start today → arrival chart colouring
  const starts = todays.filter((d) => d.scheduled_start).map((d) => fmtTime(d.scheduled_start));
  const shiftStart = starts.sort((a, b) => starts.filter((x) => x === b).length - starts.filter((x) => x === a).length)[0] ?? "09:00";

  const slots = new Map<string, number>();
  if (arrivals.length) {
    const first = Math.floor(arrivals[0] / 15) * 15;
    const last = Math.min(first + 15 * 9, Math.floor(arrivals[arrivals.length - 1] / 15) * 15);
    for (let m = first; m <= last; m += 15) slots.set(hhmm(m), 0);
    for (const a of arrivals) {
      const s = hhmm(Math.min(last, Math.floor(a / 15) * 15));
      slots.set(s, (slots.get(s) ?? 0) + 1);
    }
  }

  const weeklyTrend = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStart, i);
    const rows = (days ?? []).filter((x) => x.work_date === d);
    return {
      day: d === today ? "Today" : weekday(d),
      present: rows.filter((x) => x.status === "present" || x.status === "half_day").length,
      late: rows.filter((x) => x.status === "late").length,
      absent: rows.filter((x) => x.status === "absent").length,
    };
  });

  const deptTotals = new Map<string, { total: number; present: number }>();
  for (const e of people) {
    const k = dept.get(e.id)!;
    const t = deptTotals.get(k) ?? { total: 0, present: 0 };
    t.total++;
    if (inToday.some((d) => d.employee_id === e.id)) t.present++;
    deptTotals.set(k, t);
  }

  const extraByEmp = new Map<string, number>();
  for (const d of days ?? []) if (d.extra_minutes) extraByEmp.set(d.employee_id, (extraByEmp.get(d.employee_id) ?? 0) + d.extra_minutes);

  const lateToday = new Set(todays.filter((d) => d.status === "late").map((d) => d.employee_id));
  const recentEvents: CheckEvent[] = (events ?? []).map((e) => ({
    id: String(e.id),
    name: name.get(e.employee_id ?? "") ?? "Unknown",
    department: dept.get(e.employee_id ?? "") ?? "—",
    camera: (e.cameras as unknown as { name: string } | null)?.name ?? (e.source === "web" ? "Portal" : "—"),
    type: e.type as "check_in" | "check_out",
    time: new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(e.occurred_at)),
    status: e.type === "check_in" && lateToday.has(e.employee_id ?? "") ? "late" : "on_time",
    confidence: e.confidence ?? 0,
  }));

  return {
    stats: { totalEmployees: people.length, present, late, absent: Math.max(0, people.length - present - onLeave.size), onLeave: onLeave.size, avgArrival },
    shiftStart,
    weeklyTrend,
    arrivalsByHour: [...slots].map(([slot, count]) => ({ slot, count })),
    departmentRates: [...deptTotals].filter(([, t]) => t.total).map(([department, t]) => ({ department, rate: Math.round((t.present / t.total) * 100) })),
    extraTime: {
      todayMinutes: todays.reduce((a, d) => a + (d.extra_minutes ?? 0), 0),
      weekMinutes: (days ?? []).reduce((a, d) => a + (d.extra_minutes ?? 0), 0),
      top: [...extraByEmp].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, minutes]) => ({ name: name.get(id) ?? "—", department: dept.get(id) ?? "—", minutes })),
    },
    recentEvents,
    cameras: (cams ?? []).map((c) => ({
      name: c.name,
      group: (c.departments as unknown as { name: string } | null)?.name ?? "—",
      role: ROLE[c.role] ?? "Disabled",
      status: c.status === "online" ? "online" : "offline",
      fps: c.role === "disabled" ? 0 : Number(c.fps),
    })) as CameraHealth[],
  };
}
