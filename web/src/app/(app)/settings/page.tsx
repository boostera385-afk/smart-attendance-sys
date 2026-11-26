import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getAiSettings, getPayrollSettings } from "./actions";
import { AiSettingsForm } from "./ai-settings-form";
import { PayrollSettingsForm } from "./payroll-settings-form";

export const metadata: Metadata = { title: "Settings" };

async function PayrollSection() {
  const settings = await getPayrollSettings();
  return <PayrollSettingsForm {...settings} />;
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
        <p className="mt-3 text-sm text-muted-foreground">Payroll, AI leave review and integrations.</p>
      </div>
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
