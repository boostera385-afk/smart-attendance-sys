"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CameraIcon, DownloadCloudIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, NativeSelect, StatusPill } from "@/components/form-bits";
import { fmtDateTime } from "@/lib/format";
import { importCameras, testCamera, updateCamera } from "./actions";

type Row = {
  id: string;
  name: string;
  model: string | null;
  ezviz_serial: string | null;
  role: string;
  status: string;
  last_seen_at: string | null;
  last_error: string | null;
  voice_enabled: boolean;
  department_id: string | null;
  match_threshold: number | null;
};

const ROLE_OPTIONS = [
  ["both", "Check-in & out"],
  ["entry", "Check-in"],
  ["exit", "Check-out"],
  ["presence", "Presence only"],
  ["disabled", "Off"],
] as const;

export function ImportButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await importCameras();
          (r.ok ? toast.success : toast.error)(r.message);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <DownloadCloudIcon />} Import from EZVIZ
    </Button>
  );
}

export function CameraTable({ rows, departments }: { rows: Row[]; departments: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const [snap, setSnap] = useState<{ name: string; url: string; live?: string } | null>(null);

  if (!rows.length) {
    return <EmptyState title="No cameras yet">Click “Import from EZVIZ” to load every camera on the account.</EmptyState>;
  }

  const save = (id: string, patch: Parameters<typeof updateCamera>[1]) =>
    start(async () => {
      setBusy(id);
      const r = await updateCamera(id, patch);
      setBusy(null);
      (r.ok ? toast.success : toast.error)(r.message);
      router.refresh();
    });

  const test = (row: Row) =>
    start(async () => {
      setBusy(row.id);
      const r = await testCamera(row.id);
      setBusy(null);
      if (!r.ok || !r.picUrl) {
        toast.error(r.message);
        return;
      }
      setSnap({ name: row.name, url: r.picUrl, live: r.live });
      router.refresh();
    });

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Camera</TableHead>
              <TableHead>Attendance role</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Voice</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Test</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <span className="font-medium">{c.name}</span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {c.model} · {c.ezviz_serial}
                  </span>
                </TableCell>
                <TableCell>
                  <NativeSelect
                    className="w-40"
                    value={c.role}
                    disabled={busy === c.id}
                    aria-label={`Role of ${c.name}`}
                    onChange={(e) => save(c.id, { role: e.target.value as NonNullable<Parameters<typeof updateCamera>[1]["role"]> })}
                  >
                    {ROLE_OPTIONS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                </TableCell>
                <TableCell>
                  <NativeSelect
                    className="w-36"
                    value={c.department_id ?? ""}
                    disabled={busy === c.id}
                    aria-label={`Department of ${c.name}`}
                    onChange={(e) => save(c.id, { department_id: e.target.value || null })}
                  >
                    <option value="">Everyone</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </NativeSelect>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={c.voice_enabled}
                    disabled={busy === c.id}
                    aria-label={`Voice greeting on ${c.name}`}
                    onCheckedChange={(v) => save(c.id, { voice_enabled: v })}
                  />
                </TableCell>
                <TableCell>
                  <StatusPill status={c.status} />
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {c.last_error ? <span className="text-danger">{c.last_error}</span> : c.last_seen_at ? `seen ${fmtDateTime(c.last_seen_at)}` : ""}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => test(c)}>
                    {busy === c.id ? <Loader2Icon className="animate-spin" /> : <CameraIcon />} Snapshot
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={Boolean(snap)} onOpenChange={(o) => !o && setSnap(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{snap?.name}</DialogTitle>
            <DialogDescription>{snap?.live}</DialogDescription>
          </DialogHeader>
          {snap && (
            // eslint-disable-next-line @next/next/no-img-element -- temporary EZVIZ URL
            <img src={snap.url} alt={`Snapshot from ${snap.name}`} className="w-full rounded-lg border" />
          )}
          <p className="text-xs text-muted-foreground">
            Faces should be at least ~80 px wide in this picture to be recognised. Shown once, not stored.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
