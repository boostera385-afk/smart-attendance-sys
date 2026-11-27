"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CameraIcon, CheckCircle2Icon, Loader2Icon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/form-bits";
import type { FacePhoto } from "@/lib/faces";

type Result = { ok: boolean; message: string };

const PROMPTS = ["Look straight at the camera", "Turn your head slightly left", "Turn your head slightly right", "Tilt your chin up a little", "Look straight again, no glasses if possible"];

/** Shrinks a photo to ≤1280 px JPEG (~150–300 KB) so uploads stay fast and under server limits. */
async function toJpeg(src: Blob): Promise<File> {
  const bmp = await createImageBitmap(src);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not read photo"))), "image/jpeg", 0.9));
  return new File([blob], "face.jpg", { type: "image/jpeg" });
}

export function FaceEnroll({
  photos,
  approved,
  upload,
  remove,
  approve,
}: {
  photos: FacePhoto[];
  approved: number;
  upload: (fd: FormData) => Promise<Result>;
  remove?: (photoId: string) => Promise<Result>;
  approve?: () => Promise<Result>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [camOpen, setCamOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const processing = photos.some((p) => p.status === "pending");

  // refresh while the worker is processing new photos
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [processing, router]);

  const send = (blobs: Blob[]) =>
    start(async () => {
      let ok = 0;
      for (const b of blobs) {
        try {
          const fd = new FormData();
          fd.append("photos", await toJpeg(b));
          const r = await upload(fd);
          if (!r.ok) {
            toast.error(r.message);
            break;
          }
          ok++;
        } catch (e) {
          toast.error((e as Error).message);
          break;
        }
      }
      if (ok) toast.success(`${ok} photo${ok === 1 ? "" : "s"} uploaded. Processing takes about a minute.`);
      router.refresh();
    });

  const act = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      (r.ok ? toast.success : toast.error)(r.message);
      router.refresh();
    });

  const processed = photos.filter((p) => p.status === "processed").length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Upload 3–5 clear, well-lit photos of the face from slightly different angles (like a passport photo, no sunglasses or masks).
        {approved > 0 ? ` ${approved} sample${approved === 1 ? " is" : "s are"} approved for recognition.` : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setCamOpen(true)} disabled={pending}>
          <CameraIcon /> Take photos
        </Button>
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Upload photos
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
            if (files.length) send(files);
          }}
        />
        {approve && processed > 0 && (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => act(approve)}>
            <CheckCircle2Icon /> Approve faces ({processed})
          </Button>
        )}
      </div>

      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {photos.map((p) => (
            <li key={p.id} className="group relative overflow-hidden rounded-xl border bg-muted">
              {p.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img src={p.url} alt="Enrollment photo" className="aspect-square w-full object-cover" />
              ) : (
                <div className="aspect-square" />
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-background/85 p-1.5 backdrop-blur">
                <StatusPill status={p.status} label={p.status === "pending" ? "Processing" : p.status === "processed" ? "Face found" : "Failed"} />
                {remove && (
                  <Button type="button" variant="ghost" size="icon-xs" aria-label="Delete photo" onClick={() => act(() => remove(p.id))}>
                    <Trash2Icon />
                  </Button>
                )}
              </div>
              {p.error && <p className="px-2 pt-1 pb-9 text-xs text-danger">{p.error}</p>}
            </li>
          ))}
        </ul>
      )}

      {camOpen && (
        <CameraCapture
          onClose={() => setCamOpen(false)}
          onDone={(shots) => {
            setCamOpen(false);
            send(shots);
          }}
        />
      )}
    </div>
  );
}

function CameraCapture({ onClose, onDone }: { onClose: () => void; onDone: (shots: Blob[]) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [shots, setShots] = useState<Blob[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError("Camera access was blocked. Allow the camera in your browser, or use Upload photos."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const snap = () => {
    const v = video.current;
    if (!v?.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      const next = [...shots, b];
      setShots(next);
      if (next.length >= PROMPTS.length) onDone(next);
    }, "image/jpeg", 0.92);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur" role="dialog" aria-modal aria-label="Take face photos">
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-2xl border bg-card p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <p className="font-medium">
            Photo {Math.min(shots.length + 1, PROMPTS.length)} of {PROMPTS.length}
          </p>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <XIcon />
          </Button>
        </div>
        {error ? (
          <p className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm">{error}</p>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video ref={video} autoPlay playsInline muted className="aspect-[4/3] w-full -scale-x-100 object-cover" />
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="h-3/4 w-1/2 rounded-[50%] border-2 border-dashed border-white/70" />
              </div>
            </div>
            <p className="text-center text-sm font-medium">{PROMPTS[shots.length] ?? "Done"}</p>
            <div className="flex justify-between gap-2">
              <Button variant="outline" disabled={!shots.length} onClick={() => onDone(shots)}>
                Use {shots.length} photo{shots.length === 1 ? "" : "s"}
              </Button>
              <Button onClick={snap}>
                <CameraIcon /> Capture
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
