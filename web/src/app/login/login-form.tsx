"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ demo }: { demo: boolean }) {
  const next = useSearchParams().get("next") ?? "/dashboard";
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Work email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required={!demo} placeholder="you@company.com" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required={!demo} />
      </div>
      {state.error && (
        <motion.p
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }}
          className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {state.error}
        </motion.p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Loader2Icon className="size-4 animate-spin" />}
        {demo ? "Enter demo" : "Sign in"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Access is by invitation only. Ask HR if you need an account.
      </p>
    </form>
  );
}
