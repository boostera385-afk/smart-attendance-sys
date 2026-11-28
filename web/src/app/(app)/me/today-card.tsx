"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckIcon,
  ClockIcon,
  Loader2Icon,
  LogInIcon,
  LogOutIcon,
  MapPinIcon,
  MapPinOffIcon,
  RefreshCwIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/form-bits";
import { fmtDays, fmtMinutes, TZ } from "@/lib/format";
import { dayClock, insideOffice, nearestOffice, type PortalToday } from "@/lib/portal";
import { portalCheck, type CheckResult } from "./actions";

const clockFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const hmFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const hm = (t: number | string | null | undefined) => (t == null ? "—" : hmFmt.format(new Date(t)));

/** Office clock that ignores a wrong phone/PC clock: offset to the server time sent with the page. */
function useServerNow(serverIso: string) {
  const [now, setNow] = useState(() => new Date(serverIso).getTime());
  useEffect(() => {
    const offset = new Date(serverIso).getTime() - Date.now();
    const tick = () => setNow(Date.now() + offset);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [serverIso]);
  return now;
}

export function TodayCard({ initial }: { initial: PortalToday }) {
  const router = useRouter();
  const now = useServerNow(initial.now);
  const t = initial;
  const c = dayClock(t, now);
  const [open, setOpen] = useState(false);
  const portalOn = t.mode !== "camera";
  const action = c.phase === "before" ? "check_in" : "check_out";

  // refresh every 5 min while no dialog is open, so HR corrections / camera events show up
  useEffect(() => {
    if (open) return;
    const id = setInterval(() => router.refresh(), 5 * 60_000);
    return () => clearInterval(id);
  }, [open, router]);

  const shiftLine = !t.shift
    ? "No shift today"
    : t.shift.kind === "flexible"
      ? `${fmtMinutes(t.shift.required_minutes)} flexible · ${fmtDays(t.shift.working_days)}`
      : `${t.shift.start_time.slice(0, 5)}–${t.shift.end_time.slice(0, 5)} · ${fmtDays(t.shift.working_days)} · ${t.shift.break_minutes} min paid break`;

  const beyondLabel = c.overtimeCounts ? "Overtime" : "Extra time";
  const blocked = t.on_leave ? "You're on approved leave today." : null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{dateFmt.format(new Date(now))}</p>
            <p className="font-mono text-5xl font-semibold tracking-tight tabular-nums md:text-6xl" suppressHydrationWarning>
              {clockFmt.format(new Date(now))}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <ClockIcon className="size-3.5" /> {shiftLine}
              {t.holiday && <StatusPill status="holiday" label="Holiday" />}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Checked in" value={hm(t.day?.check_in_at)}
              hint={t.day?.late_minutes ? `Late ${t.day.late_minutes}m` : c.phase !== "before" ? "On time" : t.scheduled_start ? `Starts ${hm(t.scheduled_start)}` : undefined}
              tone={t.day?.late_minutes ? "warning" : undefined} />
            <Stat label={c.phase === "done" ? "Checked out" : "Remaining"}
              value={c.phase === "done" ? hm(t.day?.check_out_at) : c.remainingMin == null ? "—" : fmtMinutes(c.remainingMin)}
              hint={c.phase === "done" ? `Worked ${fmtMinutes(t.day?.net_minutes ?? c.workedMin)}` : t.scheduled_end ? `Ends ${hm(t.scheduled_end)}` : undefined} />
            <Stat label={beyondLabel} value={c.beyondMin ? `+${fmtMinutes(c.beyondMin)}` : "—"}
              hint={c.overtimeCounts ? "Paid" : c.beyondMin && t.overtime_paid && t.shift ? `Paid after ${t.shift.overtime_after_minutes}m` : c.beyondMin ? "Recorded" : undefined}
              tone={c.beyondMin ? "success" : undefined} />
          </div>

          {t.day?.needs_review && (
            <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
              No check-out was recorded. HR will confirm your hours.
            </p>
          )}
        </div>

        <div className="flex flex-col items-center gap-4">
          <Ring progress={c.progress} done={c.phase === "done"}>
            <span className="text-xs text-muted-foreground">Worked</span>
            <span className="font-mono text-2xl font-semibold tabular-nums">{fmtMinutes(c.workedMin)}</span>
            {c.targetMin != null && <span className="text-xs text-muted-foreground">of {fmtMinutes(c.targetMin)}</span>}
          </Ring>

          {!portalOn ? (
            <p className="max-w-52 text-center text-sm text-muted-foreground">Check-in is done by the office camera.</p>
          ) : c.phase === "done" ? (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <CheckIcon className="size-4" /> Day complete
            </p>
          ) : blocked ? (
            <p className="max-w-52 text-center text-sm text-muted-foreground">{blocked}</p>
          ) : c.opensAt ? (
            <p className="max-w-52 text-center text-sm text-muted-foreground">Check-in opens at {hm(c.opensAt)}</p>
          ) : (
            <Button size="lg" className={cn("h-12 w-52 rounded-full text-base", action === "check_out" && "bg-foreground text-background hover:bg-foreground/85")}
              onClick={() => setOpen(true)}>
              {action === "check_in" ? <LogInIcon /> : <LogOutIcon />}
              {action === "check_in" ? "Check in" : "Check out"}
            </Button>
          )}
        </div>
      </CardContent>

      {open && (
        <CheckDialog
          today={t}
          action={action}
          now={now}
          onClose={(done) => {
            setOpen(false);
            if (done) router.refresh();
          }}
        />
      )}
    </Card>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warning" | "success" }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("font-mono text-lg font-semibold tabular-nums", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</p>
      {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Ring({ progress, done, children }: { progress: number; done: boolean; children: React.ReactNode }) {
  const r = 70;
  const len = 2 * Math.PI * r;
  return (
    <div className="relative size-44">
      <svg viewBox="0 0 160 160" className="size-full -rotate-90">
        <circle cx="80" cy="80" r={r} fill="none" strokeWidth="10" className="stroke-muted" />
        <motion.circle cx="80" cy="80" r={r} fill="none" strokeWidth="10" strokeLinecap="round"
          className={done || progress >= 1 ? "stroke-success" : "stroke-primary"}
          strokeDasharray={len}
          initial={{ strokeDashoffset: len }}
          animate={{ strokeDashoffset: len * (1 - progress) }}
          transition={{ duration: 0.8, ease: "easeOut" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check-in / check-out dialog: selfie + location, one confirm click.
// ---------------------------------------------------------------------------
type Geo =
  | { state: "off" }
  | { state: "locating" }
  | { state: "error"; message: string }
  | { state: "ok"; lat: number; lng: number; accuracy: number };

function CheckDialog({ today: t, action, now, onClose }: {
  today: PortalToday;
  action: "check_in" | "check_out";
  now: number;
  onClose: (done: boolean) => void;
}) {
  const c = dayClock(t, now);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [geo, setGeo] = useState<Geo>(t.require_location ? { state: "locating" } : { state: "off" });
  const [result, setResult] = useState<CheckResult | null>(null);
  const [pending, start] = useTransition();

  // camera
  const startCamera = useCallback(async () => {
    setCamErr(null);
    setCamReady(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (e) {
      const name = (e as { name?: string }).name;
      setCamErr(
        name === "NotAllowedError"
          ? "Camera access is blocked. Allow the camera for this site in your browser settings, then retry."
          : name === "NotFoundError"
            ? "No camera found on this device."
            : "Couldn't start the camera. Close other apps using it and retry.",
      );
    }
  }, []);

  useEffect(() => {
    if (!t.require_selfie) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starting an external device
    void startCamera();
    return () => streamRef.current?.getTracks().forEach((tr) => tr.stop());
  }, [t.require_selfie, startCamera]);

  // location: keep the most precise fix while the dialog is open
  const [geoTry, setGeoTry] = useState(0);
  useEffect(() => {
    if (!t.require_location) return;
    if (!navigator.geolocation) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- capability check
      setGeo({ state: "error", message: "This browser can't share location." });
      return;
    }
    setGeo({ state: "locating" });
    let best: number | null = null;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (best !== null && p.coords.accuracy >= best) return;
        best = p.coords.accuracy;
        setGeo({ state: "ok", lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      (err) =>
        setGeo((g) => g.state === "ok" ? g : {
          state: "error",
          message: err.code === err.PERMISSION_DENIED
            ? "Location access is blocked. Allow location for this site, then retry."
            : "Couldn't get your location. Turn on GPS / location services and retry.",
        }),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [t.require_location, geoTry]);

  const office = useMemo(
    () => (geo.state === "ok" ? nearestOffice(t.offices, geo.lat, geo.lng) : null),
    [geo, t.offices],
  );
  const inside = office && geo.state === "ok" ? insideOffice(office, geo.accuracy) : false;
  const tooImprecise = geo.state === "ok" && geo.accuracy > t.max_accuracy_m;

  const ready =
    (!t.require_selfie || (camReady && !camErr)) &&
    (!t.require_location || (geo.state === "ok" && !tooImprecise && (inside || !t.offices.length)));

  const capture = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return resolve(null);
      const w = Math.min(640, v.videoWidth);
      const h = Math.round((v.videoHeight / v.videoWidth) * w);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(v, 0, 0, w, h);
      setShot(canvas.toDataURL("image/jpeg", 0.8));
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8);
    });

  const submit = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("action", action);
      if (t.require_selfie) {
        const blob = await capture();
        if (!blob) {
          toast.error("Couldn't take the selfie. Please retry.");
          return;
        }
        fd.set("selfie", new File([blob], "selfie.jpg", { type: "image/jpeg" }));
      }
      if (geo.state === "ok") {
        fd.set("lat", String(geo.lat));
        fd.set("lng", String(geo.lng));
        fd.set("accuracy", String(Math.round(geo.accuracy)));
      }
      const r = await portalCheck(fd);
      if (!r.ok) {
        setShot(null);
        toast.error(r.message);
        return;
      }
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      setResult(r);
    });

  const isIn = action === "check_in";

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose(!!result)}>
      <DialogContent className="sm:max-w-md">
        <AnimatePresence mode="wait">
          {result ? (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 py-4 text-center">
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16 }}
                className="flex size-16 items-center justify-center rounded-full bg-success-soft text-success">
                <CheckIcon className="size-8" />
              </motion.span>
              <DialogTitle className="text-xl">{isIn ? "You're checked in" : "You're checked out"}</DialogTitle>
              <p className="font-mono text-4xl font-semibold tabular-nums">{hm(result.at)}</p>
              <DialogDescription>
                {isIn
                  ? result.lateMinutes ? `Late by ${fmtMinutes(result.lateMinutes)}. Have a great day!` : "On time. Have a great day!"
                  : `Worked ${fmtMinutes(result.netMinutes)}${result.overtimeMinutes ? ` · overtime ${fmtMinutes(result.overtimeMinutes)}` : result.extraMinutes ? ` · extra ${fmtMinutes(result.extraMinutes)}` : ""}. See you tomorrow!`}
              </DialogDescription>
              {result.office && <p className="text-xs text-muted-foreground">{result.office} · a receipt was emailed to you</p>}
              <Button className="mt-2 w-full" onClick={() => onClose(true)}>Done</Button>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>{isIn ? "Check in" : "Check out"}</DialogTitle>
                <DialogDescription>
                  Time is recorded by the server: <span className="font-mono font-medium text-foreground">{clockFmt.format(new Date(now))}</span>
                </DialogDescription>
              </DialogHeader>

              {t.require_selfie && (
                <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted">
                  <video ref={videoRef} playsInline muted onLoadedData={() => setCamReady(true)}
                    className={cn("size-full -scale-x-100 object-cover", shot && "hidden")} />
                  {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
                  {shot && <img src={shot} alt="Your selfie" className="size-full -scale-x-100 object-cover" />}
                  {!camReady && !camErr && (
                    <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      <Loader2Icon className="size-6 animate-spin" />
                    </span>
                  )}
                  {camErr && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm">
                      <CameraIcon className="size-6 text-muted-foreground" />
                      {camErr}
                      <Button size="sm" variant="outline" onClick={startCamera}><RefreshCwIcon /> Retry</Button>
                    </div>
                  )}
                  {camReady && !shot && (
                    <span className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs text-white drop-shadow">
                      Center your face in the frame
                    </span>
                  )}
                </div>
              )}

              {t.require_location && (
                <LocationRow geo={geo} office={office} inside={inside} tooImprecise={tooImprecise}
                  maxAccuracy={t.max_accuracy_m} noOffices={!t.offices.length} retry={() => setGeoTry((n) => n + 1)} />
              )}

              {isIn && c.lateIfNowMin > 0 && (
                <Warn>You&apos;re {fmtMinutes(c.lateIfNowMin)} late (shift started {hm(t.scheduled_start)}).</Warn>
              )}
              {!isIn && c.earlyIfNowMin > 0 && (
                <Warn>
                  {t.shift?.kind === "flexible"
                    ? `You still have ${fmtMinutes(c.earlyIfNowMin)} of your ${fmtMinutes(c.targetMin)} to go.`
                    : `Your shift ends at ${hm(t.scheduled_end)} — ${fmtMinutes(c.earlyIfNowMin)} early.`} Check-out is final for today.
                </Warn>
              )}
              {!isIn && c.phase === "working" && (
                <p className="text-sm text-muted-foreground">
                  In at {hm(t.day?.check_in_at)} · worked <span className="font-mono text-foreground">{fmtMinutes(c.workedMin)}</span>
                  {c.beyondMin > 0 && <> · {c.overtimeCounts ? "overtime" : "extra"} <span className="font-mono text-foreground">+{fmtMinutes(c.beyondMin)}</span></>}
                </p>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => onClose(false)} disabled={pending}>Cancel</Button>
                <Button onClick={submit} disabled={!ready || pending}
                  className={cn(!isIn && c.earlyIfNowMin > 0 && "bg-warning text-background hover:bg-warning/85")}>
                  {pending ? <Loader2Icon className="animate-spin" /> : isIn ? <LogInIcon /> : <LogOutIcon />}
                  {isIn ? "Confirm check in" : c.earlyIfNowMin > 0 ? "Check out early" : "Confirm check out"}
                </Button>
              </DialogFooter>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

function LocationRow({ geo, office, inside, tooImprecise, maxAccuracy, noOffices, retry }: {
  geo: Geo;
  office: { name: string; distance: number; radius_m: number } | null;
  inside: boolean;
  tooImprecise: boolean;
  maxAccuracy: number;
  noOffices: boolean;
  retry: () => void;
}) {
  let tone: "ok" | "bad" | "wait" = "wait";
  let text = "Finding your location…";
  if (geo.state === "error") [tone, text] = ["bad", geo.message];
  else if (geo.state === "ok") {
    if (noOffices) [tone, text] = ["bad", "The office location isn't set up yet. Please ask HR."];
    else if (tooImprecise) [tone, text] = ["wait", `Improving accuracy (±${Math.round(geo.accuracy)} m, need ±${maxAccuracy} m)…`];
    else if (inside) [tone, text] = ["ok", `At ${office!.name} · ${Math.round(office!.distance)} m (±${Math.round(geo.accuracy)} m)`];
    else [tone, text] = ["bad", `${Math.round(office!.distance)} m from ${office!.name}. You need to be within ${office!.radius_m} m.`];
  }
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
      tone === "ok" && "border-success/30 bg-success-soft", tone === "bad" && "border-danger/30 bg-danger-soft")}>
      {tone === "wait" ? <Loader2Icon className="size-4 shrink-0 animate-spin" /> : tone === "ok"
        ? <MapPinIcon className="size-4 shrink-0 text-success" /> : <MapPinOffIcon className="size-4 shrink-0 text-danger" />}
      <span className="flex-1">{text}</span>
      {tone === "bad" && <Button size="xs" variant="ghost" onClick={retry}><RefreshCwIcon /> Retry</Button>}
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>{children}</span>
    </p>
  );
}
