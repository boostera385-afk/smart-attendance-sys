import { AppShell } from "@/components/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell
      notice={
        isSupabaseConfigured
          ? "Dashboard shows sample data until cameras are connected"
          : "Demo data — connect Supabase to go live"
      }
    >
      {children}
    </AppShell>
  );
}
