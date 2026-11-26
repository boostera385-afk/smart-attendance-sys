"use server";

import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string };

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const next = String(formData.get("next") || "/dashboard");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (!isSupabaseConfigured) redirect(safeNext); // demo mode

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (error) return { error: "Incorrect email or password." };
  redirect(safeNext);
}
