"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BotIcon, CheckIcon, FileTextIcon, Loader2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { EmptyState, Field, NativeSelect, StatusPill, Textarea } from "@/components/form-bits";
import { fmtDate } from "@/lib/format";
import { cancelLeave, decideLeave, documentUrl, requestLeave } from "./actions";

export type LeaveRow = {
  id: string;
  employee: string;
  department: string | null;
  type: string;
  paid: boolean;
  start: string;
  end: string;
  days: number;
  halfDay: boolean;
  reason: string;
  status: string;
  createdAt: string;
  note: string | null;
  via: string | null;
  checks: { key: string; label: string; passed: boolean; severity: "hard" | "soft"; detail?: string }[];
  aiVerdict: string | null;
  aiConfidence: number | null;
  aiSummary: string | null;
  hasDocument: boolean;
  cancelRequested: boolean;
};

type TypeRow = { id: string; name: string; paid: boolean; quota: number | null; monthlyLimit: number | null; docAfter: number | null; used: number; pending: number };

const dates = (l: LeaveRow) => (l.start === l.end ? fmtDate(l.start) : `${fmtDate(l.start)} – ${fmtDate(l.end)}`);

export function LeaveRequestForm({ types, today }: { types: TypeRow[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [half, setHalf] = useState(false);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const t = types.find((x) => x.id === typeId);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await requestLeave(fd);
          (r.ok ? toast.success : toast.error)(r.message);
          if (r.ok) {
            (e.target as HTMLFormElement).reset();
            setHalf(false);
            router.refresh();
          }
        });
      }}
    >
      <Field label="Type" htmlFor="type">
        <NativeSelect id="type" name="type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          {types.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} {x.paid ? "" : "(unpaid)"}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {t && (
        <p className="text-xs text-muted-foreground">
          {t.quota == null ? "No yearly limit." : `${Math.max(0, t.quota - t.used - t.pending)} of ${t.quota} days left this year.`}
          {t.monthlyLimit ? ` Max ${t.monthlyLimit} day(s) per month.` : ""}
          {t.docAfter != null ? ` Document needed for more than ${t.docAfter} day(s).` : ""}
        </p>
      )}
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={half} onCheckedChange={setHalf} /> Half day
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Field label={half ? "Date" : "From"} htmlFor="start">
          <Input id="start" name="start" type="date" required value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} />
        </Field>
        {!half && (
          <Field label="To" htmlFor="end">
            <Input id="end" name="end" type="date" required min={from} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label="Reason" htmlFor="reason">
        <Textarea id="reason" name="reason" required />
      </Field>
      <Field label="Document (optional)" htmlFor="document" hint="Medical note etc. PDF or photo, max 3.5 MB">
        <Input id="document" name="document" type="file" accept="application/pdf,image/*" />
      </Field>
      {half && <input type="hidden" name="halfDay" value="on" />}
      <Button type="submit" disabled={pending || !types.length}>
        {pending && <Loader2Icon className="animate-spin" />} Send request
      </Button>
    </form>
  );
}

function Checks({ l }: { l: LeaveRow }) {
  if (!l.checks.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-0.5 text-xs">
      {l.checks.map((c) => (
        <li key={c.key} className={c.passed ? "text-muted-foreground" : c.severity === "hard" ? "text-danger" : "text-warning"}>
          {c.passed ? "✓" : "✗"} {c.label}
          {c.detail ? ` — ${c.detail}` : ""}
        </li>
      ))}
    </ul>
  );
}

function OpenDoc({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await documentUrl(id);
          if (r.url) window.open(r.url, "_blank", "noopener");
          else toast.error(r.message);
        })
      }
    >
      <FileTextIcon /> Document
    </Button>
  );
}

export function MyLeaves({ rows, today }: { rows: LeaveRow[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!rows.length) return <EmptyState title="No leave requests yet" />;
  return (
    <ul className="divide-y">
      {rows.map((l) => (
        <li key={l.id} className="flex flex-wrap items-start gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {l.type} · {dates(l)} <span className="text-muted-foreground">({l.days} day{l.days === 1 ? "" : "s"})</span>
            </p>
            <p className="text-sm text-muted-foreground">{l.reason}</p>
            {l.note && <p className="mt-1 text-sm">HR: {l.note}</p>}
            {l.cancelRequested && <p className="mt-1 text-xs text-warning">Cancellation requested</p>}
          </div>
          <StatusPill status={l.status} />
          {(l.status === "pending" || (l.status === "approved" && l.start > today && !l.cancelRequested)) && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await cancelLeave(l.id);
                  (r.ok ? toast.success : toast.error)(r.message);
                  router.refresh();
                })
              }
            >
              Cancel
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ReviewQueue({ rows, recent }: { rows: LeaveRow[]; recent: LeaveRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reject, setReject] = useState<LeaveRow | null>(null);
  const [reason, setReason] = useState("");

  const decide = (l: LeaveRow, status: "approved" | "rejected" | "cancelled", note = "") =>
    start(async () => {
      const r = await decideLeave(l.id, status, note);
      (r.ok ? toast.success : toast.error)(r.message);
      if (r.ok) setReject(null);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      {!rows.length && <EmptyState title="Nothing waiting">New requests appear here and in your email.</EmptyState>}
      <ul className="flex flex-col gap-3">
        {rows.map((l) => (
          <li key={l.id} className="rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  {l.employee} <span className="font-normal text-muted-foreground">· {l.department ?? "—"}</span>
                </p>
                <p className="text-sm">
                  {l.type}
                  {!l.paid && " (unpaid)"} · {dates(l)} · {l.days} day{l.days === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{l.reason}</p>
              </div>
              {l.cancelRequested ? <StatusPill status="pending" label="Cancellation request" /> : <StatusPill status={l.status} />}
            </div>
            <Checks l={l} />
            {l.aiVerdict && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted/60 p-2 text-xs">
                <BotIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  AI suggests <b>{l.aiVerdict}</b>
                  {l.aiConfidence != null && ` (${Math.round(l.aiConfidence * 100)}%)`}: {l.aiSummary}
                </span>
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {l.cancelRequested ? (
                <Button size="sm" disabled={pending} onClick={() => decide(l, "cancelled")}>
                  <CheckIcon /> Approve cancellation
                </Button>
              ) : (
                <>
                  <Button size="sm" disabled={pending} onClick={() => decide(l, "approved")}>
                    <CheckIcon /> Approve
                  </Button>
                  <Button size="sm" variant="destructive" disabled={pending} onClick={() => { setReason(""); setReject(l); }}>
                    <XIcon /> Reject
                  </Button>
                </>
              )}
              {l.hasDocument && <OpenDoc id={l.id} />}
            </div>
          </li>
        ))}
      </ul>

      {recent.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">Recently decided</p>
          <ul className="divide-y text-sm">
            {recent.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  {l.employee} · {l.type} · {dates(l)}
                  {l.via && l.via !== "manual" && <span className="ml-1 text-xs text-muted-foreground">({l.via.replace("_", " ")})</span>}
                </span>
                <StatusPill status={l.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={Boolean(reject)} onOpenChange={(o) => !o && setReject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject leave request</DialogTitle>
            <DialogDescription>{reject && `${reject.employee} · ${reject.type} · ${dates(reject)}. The reason is emailed to them.`}</DialogDescription>
          </DialogHeader>
          <Textarea autoFocus placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="destructive" disabled={pending || !reason.trim()} onClick={() => reject && decide(reject, "rejected", reason)}>
              {pending && <Loader2Icon className="animate-spin" />} Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
