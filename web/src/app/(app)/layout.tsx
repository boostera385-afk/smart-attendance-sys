import { AppShell } from "@/components/app-shell";
import { ShiftAlerts } from "@/components/shift-alerts";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell notice={isSupabaseConfigured ? undefined : "Demo data — connect Supabase to go live"}>
      {children}
      {isSupabaseConfigured && <ShiftAlerts />}
    </AppShell>
  );
}
