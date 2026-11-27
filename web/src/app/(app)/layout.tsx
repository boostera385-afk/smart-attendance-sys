import { AppShell } from "@/components/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell notice={isSupabaseConfigured ? undefined : "Demo data — connect Supabase to go live"}>
      {children}
    </AppShell>
  );
}
