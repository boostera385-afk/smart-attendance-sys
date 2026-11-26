import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

/**
 * Service-role client. SERVER ONLY — bypasses RLS. Use solely after verifying the caller's role,
 * and only for data browsers must never read (e.g. the OpenAI API key in `public.secrets`).
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !key) throw new Error("SUPABASE_SECRET_KEY is not configured");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
