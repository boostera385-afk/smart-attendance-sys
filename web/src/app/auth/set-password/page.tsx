import type { Metadata } from "next";
import { BrandLockup, COMPANY, PropertyLine } from "@/components/brand";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Set your password" };

export default function SetPasswordPage() {
  return (
    <div className="app-backdrop flex min-h-dvh flex-col px-4 py-12">
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-sm">
          <BrandLockup href={null} className="mb-8" />
          <h1 className="text-2xl font-semibold">Set your password</h1>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">
            Welcome to {COMPANY}. Choose a password — you&apos;ll use it with your work email to sign in.
          </p>
          <SetPasswordForm />
        </div>
      </div>
      <PropertyLine className="mt-10" />
    </div>
  );
}
