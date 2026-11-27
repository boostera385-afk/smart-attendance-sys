"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/form-bits";
import { addDays, fmtDate } from "@/lib/format";
import { addHoliday, removeHoliday, setOverride } from "./actions";

export type Cell = { date: string; kind: "work" | "off" | "none" | "override" | "off_override" | "holiday" | "leave"; text: string; reason?: string | null };
type Row = { id: string; name: string; department: string | null; cells: Cell[] };

const TONE: Record<Cell["kind"], string> = {
  work: "bg-card",
  off: "bg-muted/50 text-muted-foreground",
  none: "text-muted-foreground",
  override: "border-primary/50 bg-accent",
  off_override: "border-warning/40 bg-warning-soft",
  holiday: "border-info/30 bg-info-soft",
  leave: "border-info/30 bg-info-soft",
};
const dayName = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export function Roster({ rows, dates, week, today, canSetHours }: { rows: Row[]; dates: string[]; week: string; today: string; canSetHours: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState<{ row: Row; cell: Cell } | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous week" render={<Link href={`/shifts?week=${addDays(week, -7)}`} />}>
          <ChevronLeftIcon />
        </Button>
        <span className="text-sm font-medium">
          {fmtDate(dates[0])} – {fmtDate(dates[6])}
        </span>
        <Button variant="outline" size="icon" aria-label="Next week" render={<Link href={`/shifts?week=${addDays(week, 7)}`} />}>
          <ChevronRightIcon />
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="w-48 text-left font-medium text-muted-foreground">Employee</th>
              {dates.map((d) => (
                <th key={d} className={cn("font-medium", d === today ? "text-primary" : "text-muted-foreground")}>
                  {dayName(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="pr-2">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  <span className="text-muted-foreground">{r.department ?? "—"}</span>
                </td>
                {r.cells.map((c) => (
                  <td key={c.date}>
                    <button
                      type="button"
                      title={c.reason ?? undefined}
                      disabled={c.kind === "holiday" || c.kind === "leave" || c.date < today}
                      onClick={() => setEdit({ row: r, cell: c })}
                      className={cn("h-10 w-full rounded-lg border px-1 font-mono transition-colors enabled:hover:border-primary disabled:cursor-default", TONE[c.kind])}
                    >
                      {c.text}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <OverrideDialog {...edit} canSetHours={canSetHours} onClose={() => setEdit(null)} onSaved={() => router.refresh()} />}
    </div>
  );
}

function OverrideDialog({ row, cell, canSetHours, onClose, onSaved }: { row: Row; cell: Cell; canSetHours: boolean; onClose: () => void; onSaved: () => void }) {
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"normal" | "off" | "hours">(cell.kind === "off_override" ? "off" : cell.kind === "override" ? "hours" : "off");
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("17:00");
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row.name}</DialogTitle>
          <DialogDescription>{fmtDate(cell.date)} only. Normal hours: {cell.text}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label="This day" htmlFor="mode">
            <NativeSelect id="mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="off">Day off</option>
              {canSetHours && <option value="hours">Different hours</option>}
              <option value="normal">Normal schedule</option>
            </NativeSelect>
          </Field>
          {mode === "hours" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start" htmlFor="ostart">
                <Input id="ostart" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="End" htmlFor="oend">
                <Input id="oend" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
          )}
          {mode !== "normal" && (
            <Field label="Reason" htmlFor="oreason">
              <Input id="oreason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Swapped with Ali" />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await setOverride({ employeeId: row.id, date: cell.date, mode, start: from, end: to, reason });
                (r.ok ? toast.success : toast.error)(r.message);
                if (r.ok) {
                  onClose();
                  onSaved();
                }
              })
            }
          >
            {pending && <Loader2Icon className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Holidays({ rows }: { rows: { id: string; date: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      (r.ok ? toast.success : toast.error)(r.message);
      if (r.ok) after?.();
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addHoliday(date, name), () => { setDate(""); setName(""); });
        }}
      >
        <Input type="date" className="w-auto" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <Input className="min-w-48 flex-1" aria-label="Name" placeholder="e.g. Quaid-e-Azam Day" value={name} onChange={(e) => setName(e.target.value)} required />
        <Button type="submit" disabled={pending}>
          <PlusIcon /> Add
        </Button>
      </form>
      <ul className="divide-y text-sm">
        {rows.map((h) => (
          <li key={h.id} className="flex items-center gap-2 py-2">
            <span className="w-32 font-mono">{fmtDate(h.date)}</span>
            <span className="flex-1">{h.name}</span>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove ${h.name}`} disabled={pending} onClick={() => run(() => removeHoliday(h.id))}>
              <Trash2Icon />
            </Button>
          </li>
        ))}
        {!rows.length && <li className="py-2 text-muted-foreground">No holidays added.</li>}
      </ul>
    </div>
  );
}
