"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Re-renders the page when a camera records a check-in/out (Supabase Realtime, RLS-filtered). */
export function RealtimeRefresh() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel("attendance-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "attendance_events" }, (p) => {
        if (p.new.type === "sighting") return;
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 500);
      })
      .subscribe();
    const poll = setInterval(() => router.refresh(), 120_000); // fallback if the socket drops
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [router]);
  return null;
}
