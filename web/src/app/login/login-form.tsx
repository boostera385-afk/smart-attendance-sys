"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRightIcon, EyeIcon, EyeOffIcon, LockIcon, MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type LoginState } from "./actions";

const labelCls = "text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase";
const iconCls =
  "pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground/40 transition-colors group-focus-within:text-pastry-pink";
const inputCls = "h-11 pl-10 focus-visible:border-pastry-pink focus-visible:ring-pastry-pink/40";

export function LoginForm({ demo }: { demo: boolean }) {
  const next = useSearchParams().get("next") ?? "/dashboard";
  const linkError = useSearchParams().get("error") === "link";
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  const [showPassword, setShowPassword] = useState(false);

  return (
    <motion.form
      action={action}
      className="space-y-5"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.4 }}
    >
      <input type="hidden" name="next" value={next} />

      <div className="space-y-2">
        <Label htmlFor="email" className={labelCls}>
          Email
        </Label>
        <div className="group relative">
          <MailIcon className={iconCls} />
          <Input id="email" name="email" type="email" autoComplete="email" required={!demo}
            placeholder="you@company.com" className={inputCls} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password" className={labelCls}>
          Password
        </Label>
        <div className="group relative">
          <LockIcon className={iconCls} />
          <Input id="password" name="password" type={showPassword ? "text" : "password"}
            autoComplete="current-password" required={!demo} placeholder="••••••••" className={`${inputCls} pr-10`} />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            title={showPassword ? "Hide password" : "Show password"}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
      </div>

      {(state.error || linkError) && (
        <motion.p
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }}
          className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {state.error ?? "That sign-in link has expired. Ask your administrator for a new one."}
        </motion.p>
      )}

      <Button
        type="submit"
        disabled={pending}
        className="h-11 w-full gap-2 bg-pastry-lime font-semibold text-pastry-navy shadow-[0_12px_26px_-14px_oklch(0.842_0.182_116.5/0.7)] hover:bg-pastry-lime/90 focus-visible:ring-pastry-pink"
      >
        {pending ? (
          <span className="flex items-center gap-2">
            <span className="size-4 animate-spin rounded-full border-2 border-pastry-navy/30 border-t-pastry-navy" />
            Signing in...
          </span>
        ) : (
          <>
            {demo ? "Enter demo" : "Sign In"}
            <ArrowRightIcon className="size-4" />
          </>
        )}
      </Button>
    </motion.form>
  );
}
