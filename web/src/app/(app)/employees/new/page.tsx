import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/form-bits";
import { todayLocal } from "@/lib/format";
import { formOptions } from "../data";
import { EmployeeForm } from "../employee-form";

export const metadata: Metadata = { title: "Add employee" };

async function NewEmployee() {
  const options = await formOptions();
  return <EmployeeForm {...options} today={todayLocal()} />;
}

export default function NewEmployeePage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader title="Add employee" description="Profile, working hours and salary. An invite email is sent on save." />
      <Suspense fallback={<Skeleton className="h-[40rem] rounded-xl" />}>
        <NewEmployee />
      </Suspense>
    </div>
  );
}
