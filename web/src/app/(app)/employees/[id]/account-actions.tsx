"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, MailIcon, UserCheckIcon, UserXIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-bits";
import { resendInvite, setEmployeeActive } from "../actions";

export function AccountActions({ id, active, signedIn, today }: { id: string; active: boolean; signedIn: boolean; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [leftOn, setLeftOn] = useState(today);

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn();
      (r.ok ? toast.success : toast.error)(r.message);
      setConfirm(false);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap gap-2">
      {active && (
        <Button variant="outline" disabled={pending} onClick={() => run(() => resendInvite(id))}>
          {pending ? <Loader2Icon className="animate-spin" /> : <MailIcon />}
          {signedIn ? "Send password reset" : "Resend invite"}
        </Button>
      )}
      {active ? (
        <Button variant="destructive" disabled={pending} onClick={() => setConfirm(true)}>
          <UserXIcon /> Deactivate
        </Button>
      ) : (
        <Button variant="outline" disabled={pending} onClick={() => run(() => setEmployeeActive(id, true))}>
          <UserCheckIcon /> Reactivate
        </Button>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate employee?</DialogTitle>
            <DialogDescription>
              Sign-in is blocked, the cameras stop recognising them and their face photos are deleted. Attendance and payslips are kept.
            </DialogDescription>
          </DialogHeader>
          <Field label="Last working day" htmlFor="leftOn">
            <Input id="leftOn" type="date" value={leftOn} onChange={(e) => setLeftOn(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="destructive" disabled={pending} onClick={() => run(() => setEmployeeActive(id, false, leftOn))}>
              {pending && <Loader2Icon className="animate-spin" />} Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
