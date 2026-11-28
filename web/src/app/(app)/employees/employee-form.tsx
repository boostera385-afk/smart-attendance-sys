"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { WEEKDAYS, fmtMinutes } from "@/lib/format";
import { ROLE_LABEL, validateEmployee, type EmployeeFormData, type EmployeeInput } from "@/lib/employees";
import type { AppRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, NativeSelect } from "@/components/form-bits";
import { createEmployee, updateEmployee } from "./actions";

const PRESETS = [
  { label: "Morning 09:00–17:00", start: "09:00", end: "17:00" },
  { label: "Day 10:00–19:00", start: "10:00", end: "19:00" },
  { label: "Evening 18:00–02:00", start: "18:00", end: "02:00" },
  { label: "Night 21:00–06:00", start: "21:00", end: "06:00" },
];

function spanMinutes(start: string, end: string) {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let d = m(end) - m(start);
  if (d <= 0) d += 24 * 60;
  return d;
}

export function EmployeeForm({ departments, branches, canAssignAdmin, initial, today }: EmployeeFormData & { today: string }) {
  const router = useRouter();
  const editing = Boolean(initial?.id);
  const [pending, start] = useTransition();
  const [f, setF] = useState<EmployeeInput>({
    fullName: "",
    employeeCode: "",
    email: "",
    phone: "",
    designation: "",
    joinedOn: today,
    departmentId: departments[0]?.id ?? "",
    newDepartment: "",
    branchId: branches[0]?.id ?? "",
    role: "employee",
    managesDepartment: false,
    scheduleChanged: !editing,
    scheduleFrom: today,
    kind: "fixed",
    start: "09:00",
    end: "17:00",
    requiredHours: 8,
    workingDays: [1, 2, 3, 4, 5, 6],
    breakMinutes: 60,
    breakStart: "",
    breakMode: "paid",
    graceIn: 15,
    graceOut: 10,
    overtimeAfter: 30,
    salaryChanged: !editing,
    salaryFrom: today,
    basicSalary: null,
    allowances: [],
    lateDeduction: true,
    overtimeEnabled: false,
    ...initial,
  });
  const [addingDept, setAddingDept] = useState(departments.length === 0);
  const set = <K extends keyof EmployeeInput>(k: K, v: EmployeeInput[K]) => setF((p) => ({ ...p, [k]: v }));

  const span = useMemo(() => (f.start && f.end && f.start !== f.end ? spanMinutes(f.start, f.end) : 0), [f.start, f.end]);
  const crossesMidnight = f.start && f.end && f.end <= f.start;
  const roleOptions: AppRole[] = canAssignAdmin ? ["employee", "manager", "admin", "super_admin"] : ["employee", "manager"];
  if (initial?.role && !roleOptions.includes(initial.role)) roleOptions.push(initial.role);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: EmployeeInput = {
      ...f,
      departmentId: addingDept ? "" : f.departmentId,
      newDepartment: addingDept ? f.newDepartment : "",
      salaryChanged: f.salaryChanged && f.basicSalary != null,
    };
    const err = validateEmployee(input, !editing);
    if (err) {
      toast.error(err);
      return;
    }
    start(async () => {
      const r = editing ? await updateEmployee(initial!.id, input) : await createEmployee(input);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      if (!editing && r.id) router.push(`/employees/${r.id}`);
      else router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Profile</CardTitle>
          <CardDescription>The invite email goes to this address. They set their own password.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Full name" htmlFor="fullName">
            <Input id="fullName" value={f.fullName} onChange={(e) => set("fullName", e.target.value)} required autoComplete="off" />
          </Field>
          <Field label="Employee code" htmlFor="code" hint="Optional, e.g. PM-014">
            <Input id="code" value={f.employeeCode} onChange={(e) => set("employeeCode", e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} required />
          </Field>
          <Field label="WhatsApp number" htmlFor="phone" hint="International format, e.g. +923001234567">
            <Input id="phone" type="tel" placeholder="+92…" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Designation" htmlFor="designation">
            <Input id="designation" value={f.designation} onChange={(e) => set("designation", e.target.value)} />
          </Field>
          <Field label="Joined on" htmlFor="joinedOn">
            <Input id="joinedOn" type="date" value={f.joinedOn} onChange={(e) => set("joinedOn", e.target.value)} required />
          </Field>
          <Field label="Department" htmlFor="dept">
            {addingDept ? (
              <div className="flex gap-2">
                <Input id="dept" placeholder="New department name" value={f.newDepartment} onChange={(e) => set("newDepartment", e.target.value)} />
                {departments.length > 0 && (
                  <Button type="button" variant="ghost" onClick={() => setAddingDept(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex gap-2">
                <NativeSelect id="dept" value={f.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
                <Button type="button" variant="outline" size="icon" aria-label="New department" title="New department" onClick={() => setAddingDept(true)}>
                  <PlusIcon />
                </Button>
              </div>
            )}
          </Field>
          <Field label="Branch" htmlFor="branch">
            <NativeSelect id="branch" value={f.branchId} onChange={(e) => set("branchId", e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Access" htmlFor="role">
            <NativeSelect id="role" value={f.role} onChange={(e) => set("role", e.target.value as AppRole)}>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {f.role === "manager" && (
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <Switch checked={f.managesDepartment} onCheckedChange={(v) => set("managesDepartment", v)} />
              Head of this department (sees the team&apos;s attendance and approves their leave)
            </label>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            2. Working hours
            {editing && (
              <label className="flex items-center gap-2 text-sm font-normal">
                <Switch checked={f.scheduleChanged} onCheckedChange={(v) => set("scheduleChanged", v)} />
                Change working hours
              </label>
            )}
          </CardTitle>
          <CardDescription>
            Late, early leave and overtime are calculated from these hours. Changes start from a date; past days keep their old hours.
          </CardDescription>
        </CardHeader>
        {f.scheduleChanged && (
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setF((x) => ({ ...x, kind: "fixed", start: p.start, end: p.end }))}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Type" htmlFor="kind">
                <NativeSelect id="kind" value={f.kind} onChange={(e) => set("kind", e.target.value as "fixed" | "flexible")}>
                  <option value="fixed">Fixed hours</option>
                  <option value="flexible">Flexible (required hours only)</option>
                </NativeSelect>
              </Field>
              {f.kind === "fixed" ? (
                <>
                  <Field label="Start" htmlFor="start">
                    <Input id="start" type="time" value={f.start} onChange={(e) => set("start", e.target.value)} />
                  </Field>
                  <Field label="End" htmlFor="end" hint={span ? `${fmtMinutes(span)}${crossesMidnight ? " · ends next day" : ""}` : undefined}>
                    <Input id="end" type="time" value={f.end} onChange={(e) => set("end", e.target.value)} />
                  </Field>
                </>
              ) : (
                <Field label="Required hours per day" htmlFor="req">
                  <Input id="req" type="number" min={1} max={16} step={0.5} value={f.requiredHours} onChange={(e) => set("requiredHours", Number(e.target.value))} />
                </Field>
              )}
              <Field label="Starts from" htmlFor="from">
                <Input id="from" type="date" value={f.scheduleFrom} onChange={(e) => set("scheduleFrom", e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Working days</span>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d, i) => {
                  const n = i + 1;
                  const on = f.workingDays.includes(n);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set("workingDays", on ? f.workingDays.filter((x) => x !== n) : [...f.workingDays, n])}
                      className={cn(
                        "h-8 w-12 rounded-lg border text-sm transition-colors",
                        on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Break (min)" htmlFor="break">
                <Input id="break" type="number" min={0} max={240} value={f.breakMinutes} onChange={(e) => set("breakMinutes", Number(e.target.value))} />
              </Field>
              <Field label="Break starts" htmlFor="breakStart" hint="Paid, never deducted. Chime alert at this time">
                <Input id="breakStart" type="time" value={f.breakStart} onChange={(e) => set("breakStart", e.target.value)} />
              </Field>
              <Field label="Late after (min)" htmlFor="graceIn">
                <Input id="graceIn" type="number" min={0} max={120} value={f.graceIn} onChange={(e) => set("graceIn", Number(e.target.value))} />
              </Field>
              <Field label="Early leave grace" htmlFor="graceOut">
                <Input id="graceOut" type="number" min={0} max={120} value={f.graceOut} onChange={(e) => set("graceOut", Number(e.target.value))} />
              </Field>
              <Field label="Overtime after (min)" htmlFor="ot">
                <Input id="ot" type="number" min={0} max={240} value={f.overtimeAfter} onChange={(e) => set("overtimeAfter", Number(e.target.value))} />
              </Field>
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            3. Salary
            <label className="flex items-center gap-2 text-sm font-normal">
              <Switch checked={f.salaryChanged} onCheckedChange={(v) => set("salaryChanged", v)} />
              {editing ? "Change salary" : "Set salary now"}
            </label>
          </CardTitle>
          <CardDescription>Only HR/admins and the employee can see the salary. Managers never see it.</CardDescription>
        </CardHeader>
        {f.salaryChanged && (
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Basic salary (PKR / month)" htmlFor="basic">
                <Input
                  id="basic"
                  type="number"
                  min={0}
                  step={500}
                  value={f.basicSalary ?? ""}
                  onChange={(e) => set("basicSalary", e.target.value === "" ? null : Number(e.target.value))}
                />
              </Field>
              <Field label="Applies from" htmlFor="salaryFrom">
                <Input id="salaryFrom" type="date" value={f.salaryFrom} onChange={(e) => set("salaryFrom", e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Monthly allowances</span>
              {f.allowances.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder="e.g. Transport"
                    value={a.name}
                    onChange={(e) => set("allowances", f.allowances.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <Input
                    type="number"
                    min={0}
                    className="w-36"
                    value={a.amount || ""}
                    onChange={(e) => set("allowances", f.allowances.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))}
                  />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove allowance" onClick={() => set("allowances", f.allowances.filter((_, j) => j !== i))}>
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => set("allowances", [...f.allowances, { name: "", amount: 0 }])}>
                <PlusIcon /> Add allowance
              </Button>
            </div>
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={f.lateDeduction} onCheckedChange={(v) => set("lateDeduction", v)} />
              Apply late / early-leave deductions (company policy)
            </label>
          </CardContent>
        )}
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />}
          {editing ? "Save changes" : "Save & send invite"}
        </Button>
      </div>
    </form>
  );
}
