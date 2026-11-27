"use client";

import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

export function MonthPicker({ month }: { month: string }) {
  const router = useRouter();
  return (
    <Input
      type="month"
      aria-label="Month"
      className="w-44"
      value={month}
      onChange={(e) => e.target.value && router.push(`/reports?month=${e.target.value}`)}
    />
  );
}
