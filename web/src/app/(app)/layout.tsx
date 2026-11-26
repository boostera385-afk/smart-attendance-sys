import { AppShell } from "@/components/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell demo={!isSupabaseConfigured}>{children}</AppShell>;
}
