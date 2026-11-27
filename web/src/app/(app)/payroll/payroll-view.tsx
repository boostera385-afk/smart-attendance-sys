"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheckIcon, BanknoteIcon, ChevronDownIcon, Loader2Icon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Field, NativeSelect, StatusPill } from "@/components/form-bits";
import { fmtDateTime, fmtMoney, fmtMonth } from "@/lib/format";
import { addAdjustment, generatePayroll, removeAdjustment, setRunStatus } from "./actions";

type Slip = {
  id: string;
  employee: string;
  department: string | null;
  currency: string;
  gross: number;
  deductions: number;
  net: number;
  worked: number;
  scheduled: number;
  absent: number;
  late: number;
  lines: { label: string; amount: number; type: string; detail?: string }[];
  emailedAt: string | null;
};

type Props = {
  month: string;
  run: { id: string; status: string; generated_at: string; approved_at: string | null; paid_at: string | null } | null;
  history: { period: string; status: string }[];
  employees: { id: string; full_name: string }[];
  adjustments: { id: string; employee_id: string; employee: string; kind: string; amount: number; reason: string }[];
  slips: Slip[];
};

export function PayrollView({ month, run, history, employees, adjustments, slips }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [adj, setAdj] = useState({ employeeId: employees[0]?.id ?? "", kind: "bonus" as "bonus" | "allowance" | "reimbursement" | "deduction" | "advance", amount: "", reason: "" });
  const locked = run && run.status !== "draft";
  const currency = slips[0]?.currency ?? "PKR";

  const act = (fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      (r.ok ? toast.success : toast.error)(r.message);
      if (r.ok) after?.();
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Month" htmlFor="month">
          <Input id="month" type="month" className="w-44" value={month} onChange={(e) => e.target.value && router.push(`/payroll?month=${e.target.value}`)} />
        </Field>
        {run && <StatusPill status={run.status} />}
        <div className="ml-auto flex flex-wrap gap-2">
          {!locked && (
            <Button variant="outline" disabled={pending} onClick={() => act(() => generatePayroll(month))}>
              {pending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} {run ? "Recalculate draft" : "Generate draft"}
            </Button>
          )}
          {run?.status === "draft" && slips.length > 0 && (
            <Button
              disabled={pending}
              onClick={() => {
                if (confirm(`Approve ${fmtMonth(month)} payroll and email ${slips.length} payslips? Approved payroll can't be changed.`)) {
                  act(() => setRunStatus(run.id, "approved"));
                }
              }}
            >
              <BadgeCheckIcon /> Approve & email payslips
            </Button>
          )}
          {run?.status === "approved" && (
            <Button disabled={pending} onClick={() => act(() => setRunStatus(run.id, "paid"))}>
              <BanknoteIcon /> Mark as paid
            </Button>
          )}
        </div>
      </div>

      {history.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {history.map((h) => (
            <button
              key={h.period}
              onClick={() => router.push(`/payroll?month=${h.period.slice(0, 7)}`)}
              className={`rounded-full border px-2 py-0.5 ${h.period.startsWith(month) ? "border-primary bg-accent" : "hover:bg-muted"}`}
            >
              {fmtMonth(h.period)} · {h.status}
            </button>
          ))}
        </div>
      )}

      {!slips.length ? (
        <EmptyState title={run ? "No payslips in this draft" : `No payroll for ${fmtMonth(month)} yet`}>
          Drafts are generated automatically on payroll day, or click “Generate draft”. Only employees with a salary are included.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Days</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Deductions</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {slips.map((s) => (
                <Fragment key={s.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(open === s.id ? null : s.id)}>
                    <TableCell>
                      <span className="font-medium">{s.employee}</span>
                      <span className="block text-xs text-muted-foreground">
                        {s.department ?? "—"}
                        {s.emailedAt && ` · emailed ${fmtDateTime(s.emailedAt)}`}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.worked}/{s.scheduled} worked
                      {s.absent > 0 && <span className="text-danger"> · {s.absent} absent</span>}
                      {s.late > 0 && <span className="text-warning"> · {s.late} late</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(s.gross, s.currency)}</TableCell>
                    <TableCell className="text-right font-mono text-danger">{s.deductions ? `−${fmtMoney(s.deductions, s.currency)}` : "—"}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{fmtMoney(s.net, s.currency)}</TableCell>
                    <TableCell>
                      <ChevronDownIcon className={`size-4 transition-transform ${open === s.id ? "rotate-180" : ""}`} />
                    </TableCell>
                  </TableRow>
                  {open === s.id && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-muted/40">
                        <ul className="grid gap-1 text-sm sm:grid-cols-2">
                          {s.lines.map((l, i) => (
                            <li key={i} className="flex justify-between gap-4">
                              <span>
                                {l.label}
                                {l.detail && <span className="text-xs text-muted-foreground"> · {l.detail}</span>}
                              </span>
                              <span className={`font-mono ${l.type === "deduction" ? "text-danger" : l.type === "info" ? "text-muted-foreground" : ""}`}>
                                {l.type === "info" ? "info" : `${l.type === "deduction" ? "−" : ""}${fmtMoney(l.amount, s.currency)}`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4}>Total net ({slips.length})</TableCell>
                <TableCell className="text-right font-mono font-semibold">{fmtMoney(slips.reduce((a, s) => a + s.net, 0), currency)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border p-4">
        <p className="font-medium">Adjustments for {fmtMonth(month)}</p>
        <p className="text-xs text-muted-foreground">Bonuses, reimbursements, advances and one-off deductions. Included in the payslip of this month.</p>
        {adjustments.length > 0 && (
          <ul className="divide-y text-sm">
            {adjustments.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  {a.employee} · <span className="capitalize">{a.kind}</span> · {a.reason}
                </span>
                <span className={`font-mono ${a.kind === "deduction" || a.kind === "advance" ? "text-danger" : ""}`}>{fmtMoney(a.amount, currency)}</span>
                {!locked && (
                  <Button size="icon-xs" variant="ghost" aria-label="Remove" disabled={pending} onClick={() => act(() => removeAdjustment(a.id))}>
                    <Trash2Icon />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!locked && (
          <form
            className="grid gap-2 sm:grid-cols-[1fr_9rem_8rem_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              act(() => addAdjustment({ ...adj, period: month, amount: Number(adj.amount) }), () => setAdj({ ...adj, amount: "", reason: "" }));
            }}
          >
            <NativeSelect aria-label="Employee" value={adj.employeeId} onChange={(e) => setAdj({ ...adj, employeeId: e.target.value })}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Kind" value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value as typeof adj.kind })}>
              <option value="bonus">Bonus</option>
              <option value="allowance">Allowance</option>
              <option value="reimbursement">Reimbursement</option>
              <option value="advance">Advance</option>
              <option value="deduction">Deduction</option>
            </NativeSelect>
            <Input aria-label="Amount" type="number" min={1} placeholder="Amount" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} />
            <Input aria-label="Reason" placeholder="Reason" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
            <Button type="submit" disabled={pending || !employees.length}>
              <PlusIcon /> Add
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
