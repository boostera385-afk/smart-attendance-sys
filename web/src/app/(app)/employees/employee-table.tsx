"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ScanFaceIcon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect, StatusPill } from "@/components/form-bits";
import { ROLE_LABEL } from "@/lib/employees";
import type { EmployeeRow } from "./data";

export function EmployeeTable({ rows }: { rows: EmployeeRow[] }) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState("");
  const departments = useMemo(() => [...new Set(rows.map((r) => r.department).filter(Boolean))].sort() as string[], [rows]);
  const filtered = rows.filter(
    (r) =>
      (!q || `${r.full_name} ${r.email} ${r.employee_code} ${r.designation}`.toLowerCase().includes(q.toLowerCase())) &&
      (!dept || r.department === dept) &&
      (!status || r.status === status),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name, email, code…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search employees" />
        </div>
        <NativeSelect className="w-auto" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </NativeSelect>
        <NativeSelect className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="pending_enrollment">Needs face approval</option>
          <option value="invited">Invited</option>
          <option value="inactive">Inactive</option>
        </NativeSelect>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Face</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id} className="cursor-pointer">
                <TableCell>
                  <Link href={`/employees/${r.id}`} className="flex flex-col hover:underline">
                    <span className="font-medium">{r.full_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {[r.employee_code, r.designation, r.email].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                </TableCell>
                <TableCell>{r.department ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.schedule ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.role ? ROLE_LABEL[r.role] : "No login"}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center gap-1 text-xs ${r.faces ? "text-success" : "text-muted-foreground"}`}>
                    <ScanFaceIcon className="size-3.5" /> {r.faces ? `${r.faces} approved` : "none"}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusPill status={r.status} label={r.status === "pending_enrollment" ? "Needs face approval" : undefined} />
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No employees match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
