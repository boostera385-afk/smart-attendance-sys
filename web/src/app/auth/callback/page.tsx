import type { Metadata } from "next";
import { AuthCallback } from "./auth-callback";

export const metadata: Metadata = { title: "Signing you in" };

// Landing page for Supabase's default email links (invite / password reset).
// Those links put the session in the URL #fragment, which only the browser can read.
export default function AuthCallbackPage() {
  return (
    <div className="app-backdrop flex min-h-dvh items-center justify-center px-4">
      <AuthCallback />
    </div>
  );
}
