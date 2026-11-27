"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckCircle2Icon,
  ImagePlusIcon,
  Loader2Icon,
  RefreshCwIcon,
  RotateCcwIcon,
  SwitchCameraIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { StatusPill } from "@/components/form-bits";
import type { FacePhoto } from "@/lib/faces";
import { analyze, checkFile, guideFor, toJpeg, type Frame, type Quality } from "@/lib/image-quality";

type Result = { ok: boolean; message: string };

const RECOMMENDED = 5;
const PROMPTS = [
  "Look straight at the camera",
  "Turn your head slightly left",
  "Turn your head slightly right",
  "Tilt your chin up a little",
  "Look straight again, neutral face",
];

export function FaceEnroll({
  photos,
  approved,
  upload,
  remove,
  removeAll,
  approve,
  maxPhotos = 20,
  canRemoveApproved = true,
}: {
  photos: FacePhoto[];
  approved: number;
  upload: (fd: FormData) => Promise<Result>;
  remove?: (photoId: string) => Promise<Result>;
  removeAll?: () => Promise<Result>;
  approve?: () => Promise<Result>;
  maxPhotos?: number;
  /** false → only photos not yet approved can be deleted (self-service). */
  canRemoveApproved?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [camOpen, setCamOpen] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "one"; photo: FacePhoto } | { kind: "all" } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const processing = photos.some((p) => p.status === "pending");
  const ready = photos.filter((p) => p.status === "processed").length;
  const awaitingApproval = photos.filter((p) => p.status === "processed" && !p.approved).length;
  const failed = photos.filter((p) => p.status === "failed").length;
  const room = Math.max(0, maxPhotos - photos.length);
  const busy = pending || progress !== null;

  // refresh while the worker is processing new photos
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(t);
  }, [processing, router]);

  /** Uploads one photo per request so a single bad file can't sink the batch, with progress. */
  const send = useCallback(
    (items: (Blob | ImageBitmap)[]) =>
      start(async () => {
        const list = items.slice(0, room);
        if (items.length > list.length) toast.warning(`Only ${room} more photo${room === 1 ? "" : "s"} allowed. The rest were skipped.`);
        if (!list.length) return;
        setProgress({ done: 0, total: list.length });
        let ok = 0;
        const errors: string[] = [];
        for (const item of list) {
          try {
            const fd = new FormData();
            fd.append("photos", await toJpeg(item));
            const r = await upload(fd);
            if (r.ok) ok++;
            else {
              errors.push(r.message);
              if (/limit|allowed/i.test(r.message)) break;
            }
          } catch (e) {
            errors.push(navigator.onLine ? (e as Error).message : "You are offline. Check your connection and try again.");
          } finally {
            if (item instanceof ImageBitmap) item.close();
            setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
          }
        }
        setProgress(null);
        if (ok) toast.success(`${ok} photo${ok === 1 ? "" : "s"} uploaded`, { description: "Face check takes about a minute." });
        if (errors.length) toast.error(`${errors.length} photo${errors.length === 1 ? "" : "s"} not uploaded`, { description: [...new Set(errors)].join(" ") });
        router.refresh();
      }),
    [room, router, upload],
  );

  const pickFiles = async (files: File[]) => {
    if (!files.length) return;
    if (!room) return void toast.error(`Photo limit reached (${maxPhotos}). Delete some first.`);
    const seen = new Set<string>();
    const unique = files.filter((f) => {
      const k = `${f.name}:${f.size}:${f.lastModified}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
    const checks = await Promise.all(unique.map(async (f) => ({ f, r: await checkFile(f) })));
    const rejected = checks.filter((c) => !c.r.ok);
    if (rejected.length) {
      toast.error(`${rejected.length} photo${rejected.length === 1 ? "" : "s"} can't be used`, {
        description: rejected.slice(0, 4).map((c) => `${c.f.name}: ${(c.r as { reason: string }).reason}`).join("\n"),
      });
    }
    const good = checks.flatMap((c) => (c.r.ok ? [c.r.bitmap] : []));
    if (good.length) send(good);
  };

  const act = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      (r.ok ? toast.success : toast.error)(r.message);
      setConfirm(null);
      router.refresh();
    });

  return (
    <div
      className="flex flex-col gap-4"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!busy) pickFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">
            {ready} of {RECOMMENDED} recommended photos ready
            {approved > 0 && <span className="font-normal text-muted-foreground"> · {approved} approved for recognition</span>}
          </span>
          <span className="text-xs text-muted-foreground">
            {photos.length}/{maxPhotos} stored
          </span>
        </div>
        <Progress value={Math.min(100, (ready / RECOMMENDED) * 100)} aria-label="Enrollment progress" />
      </div>

      <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <li>• Good, even light on the face, no strong light behind</li>
        <li>• Only one person, face filling the oval</li>
        <li>• No sunglasses, mask or cap; hair off the eyes</li>
        <li>• Slightly different angles; hold still for a sharp photo</li>
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setCamOpen(true)} disabled={busy || !room}>
          <CameraIcon /> Take photos
        </Button>
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy || !room}>
          {progress ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
          {progress ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : "Upload photos"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            pickFiles(files);
          }}
        />
        {approve && awaitingApproval > 0 && (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => act(approve)}>
            <CheckCircle2Icon /> Approve faces ({awaitingApproval})
          </Button>
        )}
        {removeAll && photos.length > 0 && (
          <Button type="button" variant="ghost" className="ml-auto text-danger" disabled={busy} onClick={() => setConfirm({ kind: "all" })}>
            <RotateCcwIcon /> Start over
          </Button>
        )}
      </div>
      {!room && <p className="text-xs text-warning">Photo limit reached. Delete failed or old photos to add new ones.</p>}
      {failed > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-danger">
          <AlertTriangleIcon className="size-3.5" /> {failed} photo{failed === 1 ? "" : "s"} failed the face check. Delete and retake {failed === 1 ? "it" : "them"}.
        </p>
      )}

      {photos.length === 0 ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground transition-colors hover:bg-muted/50",
            dragOver && "border-primary bg-primary/5",
          )}
        >
          <ImagePlusIcon className="size-8" />
          <span>
            <span className="font-medium text-foreground">No photos yet.</span> Take photos with the camera, or drop JPG / PNG files here.
          </span>
        </button>
      ) : (
        <ul className={cn("grid grid-cols-2 gap-3 rounded-xl sm:grid-cols-3 lg:grid-cols-5", dragOver && "outline-2 outline-offset-4 outline-primary outline-dashed")}>
          {photos.map((p) => {
            const deletable = remove && (canRemoveApproved || !p.approved);
            return (
              <li key={p.id} className={cn("relative overflow-hidden rounded-xl border bg-muted", p.status === "failed" && "border-danger/40")}>
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                  <img src={p.url} alt="Enrollment photo" loading="lazy" className={cn("aspect-square w-full object-cover", p.status === "failed" && "opacity-60")} />
                ) : (
                  <div className="aspect-square" />
                )}
                {p.status === "pending" && (
                  <div className="absolute inset-0 grid place-items-center bg-background/40">
                    <Loader2Icon className="size-6 animate-spin text-foreground/70" />
                  </div>
                )}
                {p.error && <p className="absolute inset-x-0 top-0 bg-danger-soft/95 px-2 py-1 text-xs text-danger">{p.error}</p>}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-background/85 p-1.5 backdrop-blur">
                  <StatusPill
                    status={p.approved ? "approved" : p.status}
                    label={p.approved ? "Approved" : p.status === "pending" ? "Checking…" : p.status === "processed" ? "Face found" : "Failed"}
                  />
                  {deletable && (
                    <Button type="button" variant="ghost" size="icon-xs" aria-label="Delete photo" disabled={busy} onClick={() => setConfirm({ kind: "one", photo: p })}>
                      <Trash2Icon />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {camOpen && (
        <CameraCapture
          max={Math.min(RECOMMENDED, room)}
          onClose={() => setCamOpen(false)}
          onDone={(shots) => {
            setCamOpen(false);
            send(shots);
          }}
        />
      )}

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && !pending && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.kind === "all" ? "Delete all face photos?" : "Delete this photo?"}</DialogTitle>
            <DialogDescription>
              {confirm?.kind === "all"
                ? `All ${photos.length} photos and face samples are removed permanently. Cameras stop recognising this person until new photos are approved.`
                : confirm?.photo.approved
                  ? "This photo is approved and used by the cameras. Its face sample is removed permanently."
                  : "The photo is removed permanently."}
              {confirm?.kind === "one" && confirm.photo.approved && approved <= 1 && " It is the last approved sample, so recognition stops until new photos are approved."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (confirm?.kind === "all" && removeAll) act(removeAll);
                else if (confirm?.kind === "one" && remove) act(() => remove(confirm.photo.id));
              }}
            >
              {pending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Camera capture
// ---------------------------------------------------------------------------------------------

type Shot = { blob: Blob; url: string; warnings: string[] };

function cameraError(e: unknown): string {
  const name = (e as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera access is blocked. Click the camera icon in the address bar to allow it, then try again, or use Upload photos.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device. Use Upload photos instead.";
  if (name === "NotReadableError" || name === "AbortError") return "The camera is being used by another app (Zoom, Teams…). Close it and try again.";
  return "The camera could not be started. Try again, or use Upload photos.";
}

const STABLE_TICKS = 5; // × 200 ms ≈ 1 s of good frames before auto-capture

function CameraCapture({ max, onClose, onDone }: { max: number; onClose: () => void; onDone: (shots: Blob[]) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const prev = useRef<Frame | null>(null);
  const cooldown = useRef(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [requestedDevice, setRequestedDevice] = useState<string | null>(null);
  const activeDevice = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<"starting" | "live" | "review" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [aspect, setAspect] = useState(4 / 3);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [streak, setStreak] = useState(0);
  const [auto, setAuto] = useState(true);
  const [flash, setFlash] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [slot, setSlot] = useState<number | null>(null); // retaking this index
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const shotsRef = useRef(shots);
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  const live = phase === "live" || phase === "starting";

  // start / restart the stream (camera switch, retry, back from review)
  useEffect(() => {
    if (!live) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError("This browser can't open the camera here (it needs HTTPS and a modern browser). Use Upload photos.");
        return setPhase("error");
      }
      try {
        const constraints: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 960 } };
        stream = await navigator.mediaDevices.getUserMedia({
          video: requestedDevice ? { ...constraints, deviceId: { exact: requestedDevice } } : { ...constraints, facingMode: "user" },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const track = stream.getVideoTracks()[0];
        track.onended = () => {
          setError("The camera was disconnected.");
          setPhase("error");
        };
        const v = video.current;
        if (!v) return stream.getTracks().forEach((t) => t.stop());
        v.srcObject = stream;
        await v.play().catch(() => {});
        await new Promise<void>((res) => (v.videoWidth ? res() : v.addEventListener("loadedmetadata", () => res(), { once: true })));
        setAspect(v.videoWidth / v.videoHeight);
        setPhase("live");
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(all.filter((d) => d.kind === "videoinput"));
        activeDevice.current = track.getSettings().deviceId ?? null;
      } catch (e) {
        if (cancelled) return;
        setError(cameraError(e));
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      prev.current = null;
    };
  }, [live, attempt, requestedDevice]);

  const capture = useCallback(
    (q: Quality | null) => {
      const v = video.current;
      if (!v?.videoWidth) return;
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0); // saved un-mirrored (true orientation)
      setFlash(true);
      setTimeout(() => setFlash(false), 150);
      cooldown.current = Date.now() + 1500;
      setStreak(0);
      c.toBlob(
        (b) => {
          if (!b) return void toast.error("Could not capture the photo. Try again.");
          const shot: Shot = { blob: b, url: URL.createObjectURL(b), warnings: (q?.issues ?? []).map((i) => i.message) };
          const next = [...shotsRef.current];
          if (slot !== null && next[slot]) {
            URL.revokeObjectURL(next[slot].url);
            next[slot] = shot;
          } else next.push(shot);
          shotsRef.current = next;
          setShots(next);
          setSlot(null);
          if (slot !== null || next.length >= max) setPhase("review");
        },
        "image/jpeg",
        0.92,
      );
    },
    [max, slot],
  );

  // live quality loop (~5 fps) → ring colour, hint, auto-capture
  useEffect(() => {
    if (phase !== "live") return;
    let stop = false;
    let running = false;
    let good = 0;
    const tick = async () => {
      const v = video.current;
      if (stop || running || !v?.videoWidth || document.hidden) return;
      running = true;
      const { quality: q, frame } = await analyze(v, { region: guideFor(v.videoWidth, v.videoHeight), prev: prev.current }).finally(() => {
        running = false;
      });
      if (stop) return;
      prev.current = frame;
      setQuality(q);
      const ok = !q.issues.some((i) => i.blocking);
      good = ok && Date.now() > cooldown.current ? good + 1 : 0;
      setStreak(good);
      if (auto && good >= STABLE_TICKS) {
        good = 0;
        capture(q);
      }
    };
    const t = setInterval(tick, 200);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [phase, auto, capture]);

  const requestClose = () => (shots.length && !confirmDiscard ? setConfirmDiscard(true) : onClose());

  const switchCamera = () => {
    const i = devices.findIndex((d) => d.deviceId === activeDevice.current);
    setRequestedDevice(devices[(i + 1) % devices.length].deviceId);
    setPhase("starting");
  };

  const index = slot ?? shots.length;
  const blocking = quality?.issues.find((i) => i.blocking);
  const ok = quality !== null && !blocking;
  const tone = !quality ? "idle" : ok ? "good" : "bad";
  const hint = phase === "starting" ? "Starting camera…" : blocking?.message ?? (ok ? (auto ? "Perfect, hold still…" : "Looks good, capture now") : "Position your face in the oval");
  const g = guideFor(aspect, 1);

  return (
    <Dialog open onOpenChange={(o) => !o && requestClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{phase === "review" ? "Review photos" : `Photo ${Math.min(index + 1, max)} of ${max}`}</DialogTitle>
          <DialogDescription>
            {phase === "review" ? "Retake any photo that is blurry or badly lit, then upload." : PROMPTS[index % PROMPTS.length]}
          </DialogDescription>
        </DialogHeader>

        {phase === "error" ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={() => { setError(null); setPhase("starting"); setAttempt((a) => a + 1); }}>
              <RefreshCwIcon /> Try again
            </Button>
          </div>
        ) : phase === "review" ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {shots.map((s, i) => (
              <li key={s.url} className="overflow-hidden rounded-lg border bg-muted">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                  <img src={s.url} alt={`Photo ${i + 1}`} className="aspect-square w-full object-cover" />
                  <span className="absolute top-1 left-1 rounded bg-background/85 px-1.5 text-xs font-medium">{i + 1}</span>
                  {s.warnings.length > 0 && (
                    <span title={s.warnings.join(" · ")} className="absolute top-1 right-1 flex items-center gap-1 rounded bg-warning-soft px-1.5 text-xs text-warning">
                      <AlertTriangleIcon className="size-3" /> Check
                    </span>
                  )}
                </div>
                <div className="flex justify-between p-1">
                  <Button variant="ghost" size="xs" onClick={() => { setSlot(i); setPhase("starting"); }}>
                    <RotateCcwIcon /> Retake
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={() => {
                      URL.revokeObjectURL(s.url);
                      setShots((cur) => cur.filter((x) => x !== s));
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </li>
            ))}
            {shots.length < max && (
              <li>
                <button
                  type="button"
                  onClick={() => setPhase("starting")}
                  className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm text-muted-foreground hover:bg-muted/50"
                >
                  <CameraIcon className="size-6" /> Add photo
                </button>
              </li>
            )}
          </ul>
        ) : (
          <>
            <div className="relative mx-auto w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: aspect, maxHeight: "60dvh", maxWidth: `calc(60dvh * ${aspect})` }}>
              <video ref={video} autoPlay playsInline muted className="size-full -scale-x-100 object-cover" />
              <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${aspect * 100} 100`} preserveAspectRatio="none" aria-hidden>
                <defs>
                  <mask id="face-hole">
                    <rect width="100%" height="100%" fill="white" />
                    <ellipse cx={aspect * 50} cy="50" rx={g.w * aspect * 50} ry={g.h * 50} fill="black" />
                  </mask>
                </defs>
                <rect width="100%" height="100%" fill="black" opacity="0.45" mask="url(#face-hole)" />
                <ellipse
                  cx={aspect * 50}
                  cy="50"
                  rx={g.w * aspect * 50}
                  ry={g.h * 50}
                  fill="none"
                  strokeWidth="1.2"
                  className={cn(
                    "transition-[stroke] duration-200",
                    tone === "good" ? "stroke-success" : tone === "bad" ? "stroke-warning" : "stroke-white/70",
                  )}
                  strokeDasharray={tone === "idle" ? "3 2" : undefined}
                />
                {auto && tone === "good" && (
                  <ellipse
                    cx={aspect * 50}
                    cy="50"
                    rx={g.w * aspect * 50 + 2}
                    ry={g.h * 50 + 2}
                    fill="none"
                    strokeWidth="1.6"
                    pathLength={100}
                    strokeDasharray={`${(Math.min(streak, STABLE_TICKS) / STABLE_TICKS) * 100} 100`}
                    className="stroke-success transition-[stroke-dasharray] duration-200"
                  />
                )}
              </svg>
              {phase === "starting" && (
                <div className="absolute inset-0 grid place-items-center text-white/80">
                  <Loader2Icon className="size-8 animate-spin" />
                </div>
              )}
              {flash && <div className="absolute inset-0 bg-white" />}
              {shots.length > 0 && (
                <div className="absolute bottom-2 left-2 flex gap-1">
                  {shots.map((s, i) => (
                    // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                    <img key={s.url} src={s.url} alt="" className={cn("size-10 rounded-md border-2 object-cover", i === slot ? "border-warning" : "border-white/80")} />
                  ))}
                </div>
              )}
            </div>
            <p
              role="status"
              aria-live="polite"
              className={cn("text-center text-sm font-medium", tone === "good" ? "text-success" : tone === "bad" ? "text-warning" : "text-muted-foreground")}
            >
              {hint}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={auto} onCheckedChange={setAuto} /> Auto-capture
              </label>
              {devices.length > 1 && (
                <Button variant="ghost" size="sm" onClick={switchCamera} disabled={phase !== "live"}>
                  <SwitchCameraIcon /> Switch camera
                </Button>
              )}
            </div>
          </>
        )}

        {confirmDiscard && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
            <span>Discard {shots.length} unsaved photo{shots.length === 1 ? "" : "s"}?</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(false)}>
                Keep
              </Button>
              <Button size="sm" variant="destructive" onClick={onClose}>
                Discard
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          {phase === "review" ? (
            <>
              <Button variant="outline" onClick={requestClose}>
                Cancel
              </Button>
              <Button disabled={!shots.length} onClick={() => onDone(shots.map((s) => s.blob))}>
                <UploadIcon /> Upload {shots.length} photo{shots.length === 1 ? "" : "s"}
              </Button>
            </>
          ) : phase === "error" ? (
            <Button variant="outline" onClick={requestClose}>
              Close
            </Button>
          ) : (
            <>
              {shots.length > 0 && (
                <Button variant="outline" onClick={() => { setSlot(null); setPhase("review"); }}>
                  Review {shots.length}
                </Button>
              )}
              <Button onClick={() => capture(quality)} disabled={phase !== "live"}>
                <CameraIcon /> Capture
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
