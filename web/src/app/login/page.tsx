import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandLockup, COMPANY, PropertyLine } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { LoginForm } from "./login-form";
import { LoginHero } from "./login-hero";

export const metadata: Metadata = { title: "Sign in" };

// Layout mirrors the Pastry CRM sign-in (marshmallow-crm, feat/login-pastry-brand-theme).
export default function LoginPage() {
  return (
    <div className="relative flex min-h-dvh overflow-hidden">
      {/* Brand panel */}
      <div className="pastry-panel relative hidden flex-col justify-between overflow-hidden p-12 lg:flex lg:w-[46%]">
        <div className="absolute inset-0 bg-gradient-to-br from-black/15 via-transparent to-black/10" />
        <LoginHero />
      </div>

      {/* Form */}
      <div className="relative flex flex-1 flex-col items-center bg-background p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(0.656_0.212_354.3/0.06),transparent_60%)]" />
        <div className="absolute top-4 right-4 z-20">
          <ThemeToggle />
        </div>

        <div className="relative z-10 my-auto w-full max-w-sm space-y-8">
          <BrandLockup href={null} className="mb-4 lg:hidden" />

          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Welcome back</h1>
            <p className="mt-2 text-sm text-muted-foreground">Sign in to your account to continue</p>
          </div>

          <Suspense>
            <LoginForm demo={!isSupabaseConfigured} />
          </Suspense>

          <p className="text-center text-[11px] text-muted-foreground/60">
            Accounts are created by your administrator
          </p>
        </div>

        <PropertyLine className="relative z-10 pt-8" />
        <span className="sr-only">{COMPANY}</span>
      </div>
    </div>
  );
}
