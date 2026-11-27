import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/form-bits";
import { getViewer, isAdminRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DepartmentList } from "./department-list";

export const metadata: Metadata = { title: "Departments" };

async function Departments() {
  const v = await getViewer();
  if (!isAdminRole(v.role)) redirect("/me");
  const supabase = await createClient();
  const [{ data: depts }, { data: emps }, { data: heads }] = await Promise.all([
    supabase.from("departments").select("id, name, color, active, ezviz_group_name").order("name"),
    supabase.from("employees").select("department_id, status"),
    createAdminClient().from("profiles").select("managed_department_id, employees(full_name)")
      .eq("organization_id", v.orgId).eq("role", "manager").not("managed_department_id", "is", null),
  ]);
  const count = new Map<string, number>();
  for (const e of emps ?? []) {
    if (e.department_id && e.status !== "inactive") count.set(e.department_id, (count.get(e.department_id) ?? 0) + 1);
  }
  const head = new Map(
    (heads ?? []).map((h) => [h.managed_department_id as string, (h.employees as unknown as { full_name: string } | null)?.full_name ?? ""]),
  );
  const rows = (depts ?? []).map((d) => ({ ...d, employees: count.get(d.id) ?? 0, head: head.get(d.id) ?? null }));
  return <DepartmentList rows={rows} />;
}

export default function DepartmentsPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Departments"
        description="Teams used in the employee list, attendance, payslips and reports. A department head is a manager set on the employee form."
      />
      <Card>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
            <Departments />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
