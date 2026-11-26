import type { Metadata } from "next";
import { Suspense } from "react";
import { ScanFaceIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="app-backdrop relative grid min-h-dvh lg:grid-cols-2">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      {/* Visual side */}
      <div className="relative hidden items-center justify-center overflow-hidden border-r bg-gradient-to-br from-accent via-background to-info-soft lg:flex">
        <div className="relative animate-float">
          <div className="relative grid size-64 place-items-center overflow-hidden rounded-[2.5rem] border bg-card/70 shadow-xl backdrop-blur">
            <ScanFaceIcon className="size-28 text-primary" strokeWidth={1.2} />
            <span className="absolute inset-x-6 top-6 bottom-6">
              <span className="block h-0.5 w-full animate-scan rounded-full bg-gradient-to-r from-transparent via-primary to-transparent shadow-[0_0_16px_var(--primary)]" />
            </span>
          </div>
          <div className="absolute -right-10 -bottom-6 rounded-xl border bg-card px-4 py-3 shadow-lg">
            <p className="text-xs text-muted-foreground">Checked in</p>
            <p className="font-mono text-lg font-semibold text-success">09:02 ✓</p>
          </div>
        </div>
        <p className="absolute bottom-10 max-w-sm text-center text-sm text-muted-foreground">
          Walk in. Get recognised. Attendance done — no cards, no queues.
        </p>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
              <ScanFaceIcon className="size-5" />
            </span>
            <span className="font-heading text-2xl font-semibold">Presence</span>
          </div>
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">Sign in to the office attendance dashboard.</p>
          <Suspense>
            <LoginForm demo={!isSupabaseConfigured} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
