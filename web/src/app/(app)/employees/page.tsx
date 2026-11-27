import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/form-bits";
import { listEmployees } from "./data";
import { EmployeeTable } from "./employee-table";

export const metadata: Metadata = { title: "Employees" };

async function Employees() {
  const rows = await listEmployees();
  if (!rows.length) {
    return (
      <EmptyState title="No employees yet">
        Add the first employee — they get an email invite to set a password and upload face photos.
      </EmptyState>
    );
  }
  return <EmployeeTable rows={rows} />;
}

export default function EmployeesPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Employees"
        description="Profiles, working hours, salary, login invites and face enrollment."
        actions={
          <Button render={<Link href="/employees/new" />}>
            <PlusIcon /> Add employee
          </Button>
        }
      />
      <Card>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-72 rounded-xl" />}>
            <Employees />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
