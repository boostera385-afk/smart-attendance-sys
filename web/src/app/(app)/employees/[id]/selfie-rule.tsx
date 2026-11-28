"use client";

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/form-bits";
import { setSelfieRule, type SelfieRule } from "../actions";

export function SelfieRuleSelect({ id, initial, companyRequires }: { id: string; initial: SelfieRule; companyRequires: boolean }) {
  const [rule, setRule] = useState(initial);
  const [pending, start] = useTransition();
  const effective = rule === "default" ? companyRequires : rule === "required";

  const change = (next: SelfieRule) => {
    const prev = rule;
    setRule(next);
    start(async () => {
      const r = await setSelfieRule(id, next);
      if (!r.ok) setRule(prev);
      (r.ok ? toast.success : toast.error)(r.message);
    });
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Selfie on check-in / out</span>
        <span className="flex items-center gap-2">
          <NativeSelect value={rule} onChange={(e) => change(e.target.value as SelfieRule)} disabled={pending} aria-label="Selfie rule">
            <option value="default">Company default ({companyRequires ? "required" : "not required"})</option>
            <option value="required">Always required</option>
            <option value="not_required">Not required</option>
          </NativeSelect>
          {pending && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
        </span>
      </label>
      <p className="text-xs text-muted-foreground">
        {effective ? "Takes a selfie as proof each time." : "Checks in without a selfie (location rules still apply)."}
      </p>
    </div>
  );
}
