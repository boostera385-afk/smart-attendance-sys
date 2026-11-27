import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fmtTime } from "@/lib/format";

const csv = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // quote, and neutralise spreadsheet formulas
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** CSV of attendance days in a range (max 92 days). RLS limits rows to what the caller may see. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: role } = await supabase.rpc("current_app_role");
  if (!role || role === "employee") return new NextResponse("Forbidden", { status: 403 });

  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(from) || !iso.test(to) || from > to) return new NextResponse("Invalid range", { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 92) return new NextResponse("Range too long (max 92 days)", { status: 400 });

  const { data, error } = await supabase
    .from("attendance_days")
    .select("work_date, check_in_at, check_out_at, net_minutes, late_minutes, early_leave_minutes, overtime_minutes, extra_minutes, status, check_in_source, check_out_source, note, employees(full_name, employee_code, departments(name))")
    .gte("work_date", from)
    .lte("work_date", to)
    .order("work_date")
    .limit(20000);
  if (error) return new NextResponse(error.message, { status: 500 });

  const header = ["Date", "Employee", "Code", "Department", "Check-in", "Check-out", "Worked (min)", "Late (min)", "Early leave (min)", "Overtime (min)", "Extra (min)", "Status", "Source", "Note"];
  const lines = (data ?? []).map((d) => {
    const e = d.employees as unknown as { full_name: string; employee_code: string | null; departments: { name: string } | null } | null;
    return [
      d.work_date, e?.full_name, e?.employee_code, e?.departments?.name,
      d.check_in_at ? fmtTime(d.check_in_at) : "", d.check_out_at ? fmtTime(d.check_out_at) : "",
      d.net_minutes, d.late_minutes, d.early_leave_minutes, d.overtime_minutes, d.extra_minutes, d.status,
      [d.check_in_source, d.check_out_source].filter(Boolean).join("/"), d.note,
    ].map(csv).join(",");
  });
  const body = "﻿" + [header.map(csv).join(","), ...lines].join("\r\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance_${from}_${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
