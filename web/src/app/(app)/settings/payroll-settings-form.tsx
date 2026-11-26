"use client";

import { useState, useTransition } from "react";
import { Loader2Icon, WalletIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { saveOvertimePaid } from "./actions";

export function PayrollSettingsForm(initial: {
  overtimePaid: boolean;
  multiplier: number;
  demo: boolean;
  canEdit: boolean;
}) {
  const [on, setOn] = useState(initial.overtimePaid);
  const [pending, start] = useTransition();

  const toggle = (next: boolean) => {
    const prev = on;
    setOn(next);
    start(async () => {
      const r = await saveOvertimePaid(next);
      if (!r.ok) setOn(prev);
      (r.ok ? toast.success : toast.error)(r.message);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WalletIcon className="size-5 text-success" /> Payroll
          <Badge variant="outline" className="ml-1 text-muted-foreground">
            Admins only
          </Badge>
        </CardTitle>
        <CardDescription>Company-wide payroll rules.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!initial.canEdit && (
          <p className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
            Only admins can change payroll settings.
          </p>
        )}
        <label className="flex items-center justify-between gap-4 rounded-xl border bg-muted/40 p-4">
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2 text-sm font-medium">
              Pay overtime
              <Badge
                variant="outline"
                className={cn(
                  "h-4.5 px-1.5 text-[10px]",
                  on ? "border-success/30 bg-success-soft text-success" : "text-muted-foreground",
                )}
              >
                {on ? "On" : "Off"}
              </Badge>
            </span>
            <span className="text-xs text-muted-foreground">
              {on
                ? `Time after shift end (beyond the overtime threshold) is paid at ${initial.multiplier}× the hourly rate.`
                : "Extra time before and after shifts is recorded and shown on dashboards and payslips, but not paid."}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {pending && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
            <Switch checked={on} onCheckedChange={toggle} disabled={!initial.canEdit || pending} aria-label="Pay overtime" />
          </span>
        </label>
        <p className="text-xs text-muted-foreground">
          Applies to payroll drafts generated after the change. Approved payrolls are never recalculated.
        </p>
      </CardContent>
    </Card>
  );
}
