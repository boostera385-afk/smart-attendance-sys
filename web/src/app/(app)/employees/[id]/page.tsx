import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FaceEnroll } from "@/components/face-enroll";
import { StatusPill } from "@/components/form-bits";
import { listFacePhotos } from "@/lib/faces";
import { fmtDate, fmtDateTime, fmtDays, fmtMoney, todayLocal } from "@/lib/format";
import { approveFaces, deleteAllFacePhotos, deleteFacePhoto, uploadEmployeeFaces } from "../actions";
import { formOptions, loadEmployee } from "../data";
import { EmployeeForm } from "../employee-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { AccountActions } from "./account-actions";
import { SelfieRuleSelect } from "./selfie-rule";

export const metadata: Metadata = { title: "Employee" };

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, options] = await Promise.all([loadEmployee(id), formOptions()]);
  const { employee: e, account } = data;
  const [faces, { data: cfg }] = await Promise.all([
    listFacePhotos(id),
    createAdminClient().rpc("attendance_config", { p_org: e.organization_id }), // page is admin-only (loadEmployee)
  ]);
  const companySelfie = (cfg as { require_selfie?: boolean } | null)?.require_selfie !== false;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title text-4xl md:text-5xl">{e.full_name}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusPill status={e.status} label={e.status === "pending_enrollment" ? "Needs face approval" : undefined} />
            {[e.employee_code, e.designation, e.email].filter(Boolean).join(" · ")}
          </p>
        </div>
        <AccountActions id={e.id} active={e.status !== "inactive"} signedIn={Boolean(account?.lastSignIn)} today={todayLocal()} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Login</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {!account
              ? "No login account."
              : account.lastSignIn
                ? `Last sign-in ${fmtDateTime(account.lastSignIn)}`
                : `Invited ${fmtDateTime(account.invitedAt)}, password not set yet.`}
            {account?.banned && <p className="mt-1 text-danger">Sign-in blocked (inactive).</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Working hours history</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {data.scheduleHistory.slice(0, 4).map((h) => (
              <p key={h.from} className="flex justify-between gap-2">
                <span className="font-mono">
                  {h.kind === "flexible" ? "Flexible" : `${h.start?.slice(0, 5)}–${h.end?.slice(0, 5)}`} · {fmtDays(h.days)}
                </span>
                <span className="text-muted-foreground">from {fmtDate(h.from)}</span>
              </p>
            ))}
            {!data.scheduleHistory.length && <p className="text-muted-foreground">No working hours set.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Salary history</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {data.salaryHistory.slice(0, 4).map((s) => (
              <p key={s.from} className="flex justify-between gap-2">
                <span className="font-mono">{fmtMoney(s.basic + s.allowances.reduce((a, x) => a + Number(x.amount), 0))}</span>
                <span className="text-muted-foreground">from {fmtDate(s.from)}</span>
              </p>
            ))}
            {!data.salaryHistory.length && <p className="text-muted-foreground">No salary set.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Portal check-in</CardTitle>
          </CardHeader>
          <CardContent>
            <SelfieRuleSelect
              id={e.id}
              companyRequires={companySelfie}
              initial={e.selfie_required === null || e.selfie_required === undefined ? "default" : e.selfie_required ? "required" : "not_required"}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Face enrollment</CardTitle>
          <CardDescription>Check the photos show this person, then approve. Only approved faces are used by the cameras.</CardDescription>
        </CardHeader>
        <CardContent>
          <FaceEnroll
            photos={faces.photos}
            approved={faces.approved}
            upload={uploadEmployeeFaces.bind(null, e.id)}
            remove={deleteFacePhoto.bind(null, e.id)}
            removeAll={deleteAllFacePhotos.bind(null, e.id)}
            approve={approveFaces.bind(null, e.id)}
          />
        </CardContent>
      </Card>

      <EmployeeForm {...options} initial={data.initial} today={todayLocal()} />
    </>
  );
}

export default function EmployeePage({ params }: PageProps<"/employees/[id]">) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Button variant="ghost" size="sm" className="self-start" render={<Link href="/employees" />}>
        <ArrowLeftIcon /> Employees
      </Button>
      <Suspense fallback={<Skeleton className="h-[48rem] rounded-xl" />}>
        <Detail params={params} />
      </Suspense>
    </div>
  );
}
