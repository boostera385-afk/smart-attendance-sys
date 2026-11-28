"use client";

import { useState, useTransition } from "react";
import { CameraIcon, CrosshairIcon, FingerprintIcon, Loader2Icon, MapPinIcon, MonitorSmartphoneIcon, PlusIcon, SplitIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { AttendanceMode, AttendanceSettings } from "@/lib/portal";
import { saveAttendanceSettings, saveOffice, type OfficeRow } from "./attendance-actions";

const MODES: { id: AttendanceMode; title: string; body: string; icon: typeof CameraIcon }[] = [
  { id: "portal", title: "Portal only", body: "Employees check in from the portal. Cameras run in test mode and change nothing.", icon: MonitorSmartphoneIcon },
  { id: "hybrid", title: "Portal + camera", body: "Both are live. Whichever records first counts.", icon: SplitIcon },
  { id: "camera", title: "Camera only", body: "Face recognition at the door. Portal buttons are hidden.", icon: CameraIcon },
];

export function AttendanceSettingsForm(initial: {
  settings: AttendanceSettings;
  offices: OfficeRow[];
  canEdit: boolean;
  demo: boolean;
}) {
  const [s, setS] = useState(initial.settings);
  const [pending, start] = useTransition();
  const disabled = !initial.canEdit || pending;

  const save = (next: AttendanceSettings) => {
    const prev = s;
    setS(next);
    start(async () => {
      const r = await saveAttendanceSettings(next);
      if (!r.ok) setS(prev);
      (r.ok ? toast.success : toast.error)(r.message);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FingerprintIcon className="size-5 text-primary" /> Attendance
          <Badge variant="outline" className="ml-1 text-muted-foreground">Admins only</Badge>
          {pending && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
        </CardTitle>
        <CardDescription>How check-ins are recorded, and the proof required from employees.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!initial.canEdit && (
          <p className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">Only admins can change attendance settings.</p>
        )}

        <div role="radiogroup" aria-label="Attendance mode" className="grid gap-3 md:grid-cols-3">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={s.mode === m.id} disabled={disabled}
              onClick={() => s.mode !== m.id && save({ ...s, mode: m.id })}
              className={cn("flex flex-col gap-1 rounded-xl border p-4 text-left transition-colors disabled:opacity-60",
                s.mode === m.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}>
              <span className="flex items-center gap-2 text-sm font-medium"><m.icon className="size-4" /> {m.title}</span>
              <span className="text-xs text-muted-foreground">{m.body}</span>
            </button>
          ))}
        </div>

        {s.mode !== "camera" && (
          <div className="flex flex-col gap-3">
            <Toggle label="Selfie on check-in and check-out" checked={s.requireSelfie} disabled={disabled}
              hint="Front camera photo, kept 30 days as proof. Company default: change it for one person on their employee page."
              onChange={(v) => save({ ...s, requireSelfie: v })} />
            <Toggle label="Must be at the office (GPS)" checked={s.requireLocation} disabled={disabled}
              hint={`Check-in only works inside an office radius. Location must be precise to ±${s.maxAccuracyM} m.`}
              onChange={(v) => save({ ...s, requireLocation: v })} />
            {s.requireLocation && (
              <label className="flex items-center justify-between gap-4 px-1 text-sm">
                <span className="text-muted-foreground">Required GPS accuracy (m)</span>
                <Input type="number" min={20} max={500} className="w-24" defaultValue={s.maxAccuracyM} disabled={disabled}
                  onBlur={(e) => {
                    const n = Number(e.currentTarget.value);
                    if (n && n !== s.maxAccuracyM) save({ ...s, maxAccuracyM: n });
                  }} />
              </label>
            )}
          </div>
        )}

        <Offices initial={initial.offices} disabled={!initial.canEdit} />
      </CardContent>
    </Card>
  );
}

function Toggle({ label, hint, checked, disabled, onChange }: {
  label: string; hint: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl border bg-muted/40 p-4">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
    </label>
  );
}

type Draft = { id?: string; name: string; lat: string; lng: string; radius: string; employees: number };
const toDraft = (o: OfficeRow): Draft => ({ id: o.id, name: o.name, lat: o.lat?.toString() ?? "", lng: o.lng?.toString() ?? "", radius: String(o.radiusM), employees: o.employees });

function Offices({ initial, disabled }: { initial: OfficeRow[]; disabled: boolean }) {
  const [rows, setRows] = useState<Draft[]>(initial.length ? initial.map(toDraft) : [{ name: "Head office", lat: "", lng: "", radius: "100", employees: 0 }]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-medium"><MapPinIcon className="size-4" /> Office locations</p>
        <Button size="sm" variant="outline" disabled={disabled}
          onClick={() => setRows((r) => [...r, { name: "", lat: "", lng: "", radius: "100", employees: 0 }])}>
          <PlusIcon /> Add office
        </Button>
      </div>
      {rows.map((r, i) => (
        <OfficeEditor key={r.id ?? `new-${i}`} row={r} disabled={disabled}
          onSaved={(id) => setRows((all) => all.map((x, j) => (j === i ? { ...x, id } : x)))} />
      ))}
      <p className="text-xs text-muted-foreground">
        Employees check in at their own branch, or at any office when no branch is set. Tip: stand in the office and use
        &ldquo;Use my location&rdquo;, then keep the radius at 100 m or more to allow for GPS drift indoors.
      </p>
    </div>
  );
}

function OfficeEditor({ row, disabled, onSaved }: { row: Draft; disabled: boolean; onSaved: (id: string) => void }) {
  const [d, setD] = useState(row);
  const [pending, start] = useTransition();
  const [locating, setLocating] = useState(false);

  const locate = () => {
    if (!navigator.geolocation) return toast.error("This browser can't share location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setD((x) => ({ ...x, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }));
        toast.info(`Location captured (±${Math.round(p.coords.accuracy)} m). Save to apply.`);
      },
      () => {
        setLocating(false);
        toast.error("Couldn't get your location. Allow location access and retry.");
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  const save = () =>
    start(async () => {
      const r = await saveOffice({ id: d.id, name: d.name, lat: Number(d.lat), lng: Number(d.lng), radiusM: Number(d.radius) });
      (r.ok ? toast.success : toast.error)(r.message);
      if (r.ok && r.id) onSaved(r.id);
    });

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });
  const mapUrl = d.lat && d.lng ? `https://www.google.com/maps?q=${d.lat},${d.lng}` : null;

  return (
    <div className="grid gap-2 rounded-xl border p-3 md:grid-cols-[1.4fr_1fr_1fr_0.7fr_auto] md:items-end">
      <Labeled label="Name"><Input value={d.name} onChange={set("name")} disabled={disabled} placeholder="Head office" /></Labeled>
      <Labeled label="Latitude"><Input value={d.lat} onChange={set("lat")} disabled={disabled} inputMode="decimal" placeholder="31.520370" /></Labeled>
      <Labeled label="Longitude"><Input value={d.lng} onChange={set("lng")} disabled={disabled} inputMode="decimal" placeholder="74.358749" /></Labeled>
      <Labeled label="Radius (m)"><Input value={d.radius} onChange={set("radius")} disabled={disabled} type="number" min={30} max={2000} /></Labeled>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={locate} disabled={disabled || locating} title="Use my location">
          {locating ? <Loader2Icon className="animate-spin" /> : <CrosshairIcon />}
          <span className="md:sr-only">Use my location</span>
        </Button>
        <Button size="sm" onClick={save} disabled={disabled || pending}>
          {pending && <Loader2Icon className="animate-spin" />} Save
        </Button>
      </div>
      <p className="text-xs text-muted-foreground md:col-span-5">
        {d.id ? `${d.employees} employee${d.employees === 1 ? "" : "s"} assigned` : "Not saved yet"}
        {mapUrl && <> · <a href={mapUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">check on map</a></>}
      </p>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
