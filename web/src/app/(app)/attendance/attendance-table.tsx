"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, ImageIcon, Loader2Icon, MapPinIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, NativeSelect, StatusPill, Textarea } from "@/components/form-bits";
import { addDays, fmtDate, fmtMinutes, fmtTime } from "@/lib/format";
import { correctDay, getDayEvidence, type Evidence } from "./actions";

export type DayRow = {
  employeeId: string;
  name: string;
  code: string | null;
  department: string | null;
  checkIn: string | null;
  checkOut: string | null;
  net: number | null;
  late: number;
  early: number;
  extra: number;
  status: string;
  source: string | null;
  inSource: string | null;
  outSource: string | null;
  needsReview: boolean;
  note: string | null;
  scheduledStart: string | null;
};

const STATUS_LABEL: Record<string, string> = { not_in: "Not in yet", no_record: "No record", half_day: "Half day" };
const SOURCE_LABEL: Record<string, string> = { web: "portal", camera: "camera", manual: "HR", auto: "auto", selfie: "selfie" };

function Src({ s }: { s: string | null }) {
  if (!s) return null;
  return <span className="ml-1 text-xs text-muted-foreground">{SOURCE_LABEL[s] ?? s}</span>;
}

export function AttendanceTable({ rows, date, today, canCorrect }: { rows: DayRow[]; date: string; today: string; canCorrect: boolean }) {
  const router = useRouter();
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState("");
  const [edit, setEdit] = useState<DayRow | null>(null);
  const [proof, setProof] = useState<DayRow | null>(null);
  const departments = useMemo(() => [...new Set(rows.map((r) => r.department).filter(Boolean))].sort() as string[], [rows]);
  const filtered = rows.filter((r) => (!dept || r.department === dept) && (!status || (status === "review" ? r.needsReview : r.status === status)));
  const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
  const reviewCount = rows.filter((r) => r.needsReview).length;
  const go = (d: string) => router.push(`/attendance?date=${d}`);
  const monthStart = `${date.slice(0, 7)}-01`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => go(addDays(date, -1))}>
          <ChevronLeftIcon />
        </Button>
        <Input type="date" className="w-auto" value={date} max={today} onChange={(e) => e.target.value && go(e.target.value)} aria-label="Date" />
        <Button variant="outline" size="icon" aria-label="Next day" disabled={date >= today} onClick={() => go(addDays(date, 1))}>
          <ChevronRightIcon />
        </Button>
        {date !== today && (
          <Button variant="ghost" onClick={() => go(today)}>
            Today
          </Button>
        )}
        <NativeSelect className="w-auto" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </NativeSelect>
        <NativeSelect className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {Object.keys(counts).map((s) => (
            <option key={s} value={s}>
              {(STATUS_LABEL[s] ?? s.replace("_", " ")).replace(/^\w/, (c) => c.toUpperCase())} ({counts[s]})
            </option>
          ))}
          {reviewCount > 0 && <option value="review">Missing check-out ({reviewCount})</option>}
        </NativeSelect>
        <Button variant="outline" className="ml-auto" render={<a href={`/attendance/export?from=${monthStart}&to=${date}`} />}>
          <DownloadIcon /> Export month (CSV)
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        {fmtDate(date)} · {counts.present ?? 0} present · {counts.late ?? 0} late · {counts.absent ?? 0} absent · {counts.leave ?? 0} on leave
        {reviewCount > 0 && (
          <button type="button" className="ml-2 font-medium text-warning underline-offset-2 hover:underline" onClick={() => setStatus("review")}>
            · {reviewCount} missing check-out{reviewCount === 1 ? "" : "s"} to fix
          </button>
        )}
      </p>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>In</TableHead>
              <TableHead>Out</TableHead>
              <TableHead>Worked</TableHead>
              <TableHead>Late</TableHead>
              <TableHead>Extra</TableHead>
              <TableHead>Status</TableHead>
              {canCorrect && <TableHead className="text-right">Fix</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.employeeId}>
                <TableCell>
                  <span className="font-medium">{r.name}</span>
                  <span className="block text-xs text-muted-foreground">{r.department ?? "—"}</span>
                </TableCell>
                <TableCell className="font-mono">
                  {fmtTime(r.checkIn)}
                  <Src s={r.checkIn ? r.inSource : null} />
                </TableCell>
                <TableCell className="font-mono">
                  {r.needsReview ? (
                    <span className="text-xs text-warning">missing</span>
                  ) : (
                    <>
                      {fmtTime(r.checkOut)}
                      <Src s={r.checkOut ? r.outSource : null} />
                    </>
                  )}
                </TableCell>
                <TableCell className="font-mono">{fmtMinutes(r.net)}</TableCell>
                <TableCell className={r.late ? "font-mono text-warning" : "font-mono text-muted-foreground"}>{r.late ? `${r.late}m` : "—"}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{r.extra ? `+${fmtMinutes(r.extra)}` : "—"}</TableCell>
                <TableCell>
                  <StatusPill status={r.status} label={STATUS_LABEL[r.status]} />
                  {r.source === "manual" && (
                    <span className="mt-0.5 block text-xs text-muted-foreground" title={r.note ?? ""}>
                      corrected
                    </span>
                  )}
                </TableCell>
                {canCorrect && (
                  <TableCell className="text-right whitespace-nowrap">
                    {r.checkIn && (
                      <Button size="icon-sm" variant="ghost" aria-label={`Proof for ${r.name}`} title="Selfie & location" onClick={() => setProof(r)}>
                        <ImageIcon />
                      </Button>
                    )}
                    <Button size="icon-sm" variant="ghost" aria-label={`Correct ${r.name}`} onClick={() => setEdit(r)}>
                      <PencilIcon />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!filtered.length && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  Nobody to show for this day.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {edit && <CorrectDialog row={edit} date={date} onClose={() => setEdit(null)} onSaved={() => router.refresh()} />}
      {proof && <ProofDialog row={proof} date={date} onClose={() => setProof(null)} />}
    </div>
  );
}

function CorrectDialog({ row, date, onClose, onSaved }: { row: DayRow; date: string; onClose: () => void; onSaved: () => void }) {
  const [pending, start] = useTransition();
  const [checkIn, setIn] = useState(row.checkIn ? fmtTime(row.checkIn) : "");
  const [checkOut, setOut] = useState(row.checkOut ? fmtTime(row.checkOut) : "");
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct attendance</DialogTitle>
          <DialogDescription>
            {row.name} · {fmtDate(date)}. Late, worked hours and status are recalculated. The change is logged.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await correctDay({ employeeId: row.employeeId, date, checkIn, checkOut, note });
              (r.ok ? toast.success : toast.error)(r.message);
              if (r.ok) {
                onClose();
                onSaved();
              }
            });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in" htmlFor="ci">
              <Input id="ci" type="time" value={checkIn} onChange={(e) => setIn(e.target.value)} />
            </Field>
            <Field label="Check-out" htmlFor="co" hint="Earlier than check-in = next day">
              <Input id="co" type="time" value={checkOut} onChange={(e) => setOut(e.target.value)} />
            </Field>
          </div>
          <Field label="Reason" htmlFor="note">
            <Textarea id="note" required placeholder="e.g. Camera missed check-in, confirmed by manager" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />} Save correction
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProofDialog({ row, date, onClose }: { row: DayRow; date: string; onClose: () => void }) {
  const [items, setItems] = useState<Evidence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getDayEvidence(row.employeeId, date).then((r) => {
      if (!live) return;
      if (r.ok) setItems(r.items);
      else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [row.employeeId, date]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Check-in proof</DialogTitle>
          <DialogDescription>
            {row.name} · {fmtDate(date)}. Selfies and camera snapshots are kept 30 days.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : !items ? (
          <Loader2Icon className="mx-auto size-6 animate-spin text-muted-foreground" />
        ) : !items.length ? (
          <p className="text-sm text-muted-foreground">No check-in or check-out events with proof for this day.</p>
        ) : (
          <div className="grid max-h-[70vh] gap-3 overflow-y-auto sm:grid-cols-2">
            {items.map((e) => (
              <figure key={e.id} className="overflow-hidden rounded-xl border">
                {e.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                  <img src={e.imageUrl} alt={`${e.type} photo`} className={`aspect-[4/3] w-full bg-muted object-cover ${e.source === "web" ? "-scale-x-100" : ""}`} />
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center bg-muted text-xs text-muted-foreground">No photo</div>
                )}
                <figcaption className="flex flex-col gap-0.5 p-3 text-xs">
                  <span className="text-sm font-medium">
                    {e.type === "check_in" ? "Check-in" : "Check-out"} · <span className="font-mono">{fmtTime(e.at)}</span>
                    <span className="ml-1 font-normal text-muted-foreground">
                      {e.shadow ? "camera (test mode)" : e.source === "web" ? "portal" : e.source}
                    </span>
                  </span>
                  {e.camera && (
                    <span className="text-muted-foreground">
                      {e.camera}
                      {e.confidence ? ` · match ${Math.round(e.confidence * 100)}%` : ""}
                    </span>
                  )}
                  {e.lat != null && e.lng != null && (
                    <a href={`https://www.google.com/maps?q=${e.lat},${e.lng}`} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 text-muted-foreground underline-offset-2 hover:underline">
                      <MapPinIcon className="size-3" />
                      {e.distance != null ? `${Math.round(e.distance)} m from ${e.office ?? "office"}` : "Location"}
                      {e.accuracy != null && ` (±${Math.round(e.accuracy)} m)`}
                    </a>
                  )}
                  {e.ip && <span className="text-muted-foreground">IP {e.ip}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
