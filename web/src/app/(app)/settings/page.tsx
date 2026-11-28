import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getAiSettings, getPayrollSettings } from "./actions";
import { getAttendanceSettings } from "./attendance-actions";
import { AttendanceSettingsForm } from "./attendance-settings-form";
import { AiSettingsForm } from "./ai-settings-form";
import { PayrollSettingsForm } from "./payroll-settings-form";

export const metadata: Metadata = { title: "Settings" };

async function PayrollSection() {
  const settings = await getPayrollSettings();
  return <PayrollSettingsForm {...settings} />;
}

async function AttendanceSection() {
  const data = await getAttendanceSettings();
  return <AttendanceSettingsForm {...data} />;
}

async function AiSection() {
  const settings = await getAiSettings();
  return <AiSettingsForm {...settings} />;
}

export default function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="page-title text-4xl md:text-5xl">Settings</h1>
        <p className="mt-3 text-sm text-muted-foreground">Attendance, payroll, AI leave review and integrations.</p>
      </div>
      <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
        <AttendanceSection />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-44 rounded-xl" />}>
        <PayrollSection />
      </Suspense>
      <Suspense
        fallback={
          <div className="flex flex-col gap-4">
            <Skeleton className="h-80 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
        }
      >
        <AiSection />
      </Suspense>
    </div>
  );
}
