import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/form-bits";
import { getViewer, isAdminRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { UnknownGrid } from "./unknown-grid";

export const metadata: Metadata = { title: "Unknown faces" };

async function Unknown() {
  const v = await getViewer();
  if (!isAdminRole(v.role)) redirect("/me");
  const supabase = await createClient();
  const [{ data: faces }, { data: emps }] = await Promise.all([
    supabase.from("unknown_faces").select("id, occurred_at, snapshot_path, best_match_employee_id, best_match_score, cameras(name)")
      .eq("status", "pending").order("occurred_at", { ascending: false }).limit(60),
    supabase.from("employees").select("id, full_name").in("status", ["active", "pending_enrollment", "invited"]).order("full_name"),
  ]);
  if (!faces?.length) {
    return <EmptyState title="No unknown faces">Faces the cameras couldn&apos;t match appear here for 7 days.</EmptyState>;
  }
  const paths = faces.map((f) => f.snapshot_path).filter(Boolean) as string[];
  const signed = paths.length ? (await createAdminClient().storage.from("snapshots").createSignedUrls(paths, 600)).data ?? [] : [];
  const url = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return (
    <UnknownGrid
      employees={emps ?? []}
      faces={faces.map((f) => ({
        id: f.id,
        at: f.occurred_at,
        camera: (f.cameras as unknown as { name: string } | null)?.name ?? "—",
        url: f.snapshot_path ? url.get(f.snapshot_path) ?? null : null,
        suggestion: f.best_match_employee_id,
        score: f.best_match_score,
      }))}
    />
  );
}

export default function UnknownPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Unknown faces"
        description="People the cameras saw but couldn't match. Tell the system who it is to improve recognition, or ignore."
      />
      <Card>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-72 rounded-xl" />}>
            <Unknown />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
