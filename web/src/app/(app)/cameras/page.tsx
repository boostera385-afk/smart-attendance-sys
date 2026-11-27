import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Notice, PageHeader } from "@/components/form-bits";
import { getViewer, isAdminRole } from "@/lib/auth";
import { ezvizConfigured } from "@/lib/ezviz";
import { createClient } from "@/lib/supabase/server";
import { CameraTable, ImportButton } from "./camera-table";

export const metadata: Metadata = { title: "Cameras" };

async function Cameras() {
  const v = await getViewer();
  if (!isAdminRole(v.role)) redirect("/me");
  const supabase = await createClient();
  const [{ data: cams }, { data: departments }] = await Promise.all([
    supabase.from("cameras").select("id, name, model, ezviz_serial, role, status, last_seen_at, last_error, voice_enabled, department_id, match_threshold").order("name"),
    supabase.from("departments").select("id, name").eq("active", true).order("name"),
  ]);
  const rows = cams ?? [];
  const recognising = rows.filter((c) => c.role !== "disabled" && c.role !== "presence");

  return (
    <div className="flex flex-col gap-4">
      {!ezvizConfigured() && (
        <Notice tone="danger">EZVIZ_APP_KEY and EZVIZ_APP_SECRET are not set on the server, so cameras can&apos;t be imported or tested.</Notice>
      )}
      {rows.length > 0 && recognising.length === 0 && (
        <Notice>No camera marks attendance yet. Set at least one camera to <b>Check-in</b> or <b>Check-in &amp; out</b>.</Notice>
      )}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {rows.length} camera{rows.length === 1 ? "" : "s"} · {recognising.length} marking attendance
            </p>
            <ImportButton />
          </div>
          <CameraTable rows={rows} departments={departments ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function CamerasPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Cameras"
        description="Choose which cameras check people in and out. Faces are matched from snapshots; no video is stored."
      />
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Check-in", "First time someone is seen that day = check-in."],
          ["Check-out", "Last time someone is seen (10+ min after check-in) = check-out."],
          ["Check-in & out", "One door camera does both: first sighting in, last sighting out."],
          ["Presence / Off", "Presence only updates “last seen”. Off = not used."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-xl border bg-card/60 p-3">
            <p className="font-medium">{t}</p>
            <p className="text-xs text-muted-foreground">{d}</p>
          </div>
        ))}
      </div>
      <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
        <Cameras />
      </Suspense>
    </div>
  );
}
