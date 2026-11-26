"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const supabase = createClient();
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const query = new URLSearchParams(window.location.search);

      const errDesc = hash.get("error_description") ?? query.get("error_description");
      if (errDesc) {
        setError(errDesc.replace(/\+/g, " "));
        return;
      }

      const type = hash.get("type") ?? query.get("type");
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const code = query.get("code");

      let failed: string | null = null;
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        failed = error?.message ?? null;
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        failed = error?.message ?? null;
      } else {
        failed = "This sign-in link is missing information.";
      }
      if (failed) {
        setError(failed);
        return;
      }
      // remove tokens from the address bar / history before moving on
      window.history.replaceState(null, "", window.location.pathname);
      router.replace(type === "invite" || type === "recovery" ? "/auth/set-password" : "/dashboard");
    };
    void run();
  }, [router]);

  if (error) {
    return (
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-danger-soft text-danger">
          <TriangleAlertIcon className="size-6" />
        </span>
        <h1 className="text-xl font-semibold">This link didn&apos;t work</h1>
        <p className="text-sm text-muted-foreground">
          {error}. Links work once and expire — ask an admin to send a new invite.
        </p>
        <Button render={<Link href="/login" />}>Go to sign in</Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <Loader2Icon className="size-5 animate-spin text-primary" /> Signing you in…
    </div>
  );
}
