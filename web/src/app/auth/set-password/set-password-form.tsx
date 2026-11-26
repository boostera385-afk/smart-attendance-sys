"use client";

import { useActionState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setPassword, type SetPasswordState } from "./actions";

export function SetPasswordForm() {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
        <p className="text-xs text-muted-foreground">At least 10 characters, with letters and a number.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </div>
      {state.error && (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Loader2Icon className="size-4 animate-spin" />}
        Save password & continue
      </Button>
    </form>
  );
}
