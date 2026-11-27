"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, EyeOffIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/form-bits";
import { fmtDateTime } from "@/lib/format";
import { reviewUnknown } from "./actions";

type Face = { id: string; at: string; camera: string; url: string | null; suggestion: string | null; score: number | null };

export function UnknownGrid({ faces, employees }: { faces: Face[]; employees: { id: string; full_name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState<Record<string, string>>(() =>
    Object.fromEntries(faces.map((f) => [f.id, f.suggestion ?? ""])),
  );
  const run = (id: string, emp: string | null) =>
    start(async () => {
      const r = await reviewUnknown(id, emp);
      (r.ok ? toast.success : toast.error)(r.message);
      router.refresh();
    });

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {faces.map((f) => (
        <li key={f.id} className="flex flex-col overflow-hidden rounded-xl border">
          {f.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img src={f.url} alt="Unrecognised face" className="aspect-square w-full bg-muted object-cover" />
          ) : (
            <div className="aspect-square bg-muted" />
          )}
          <div className="flex flex-col gap-2 p-3">
            <p className="text-xs text-muted-foreground">
              {f.camera} · {fmtDateTime(f.at)}
              {f.score != null && f.suggestion && ` · ${Math.round(f.score * 100)}% like suggestion`}
            </p>
            <NativeSelect aria-label="Who is this?" value={pick[f.id] ?? ""} onChange={(e) => setPick({ ...pick, [f.id]: e.target.value })}>
              <option value="">Who is this?</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </NativeSelect>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={pending || !pick[f.id]} onClick={() => run(f.id, pick[f.id])}>
                <CheckIcon /> Save
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(f.id, null)}>
                <EyeOffIcon /> Ignore
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
