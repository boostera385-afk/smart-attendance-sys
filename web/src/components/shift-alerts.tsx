"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getAlertSchedule, type AlertSchedule } from "@/app/(app)/alerts-actions";
import { playChime, unlockAudio, type ChimeKind } from "@/lib/chime";
import { TZ } from "@/lib/format";

/** Fired by the portal after a check-in / check-out so the alert schedule reloads at once. */
export const ATTENDANCE_CHANGED = "presence:attendance-changed";

const PREF_KEY = "presence-alerts";
/** An alert that is more than this late (tab was closed) is skipped rather than fired late. */
const LATE_LIMIT_MS = 10 * 60_000;
const hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Per-device on/off switch for break & shift-end alerts (default on). */
export function alertsEnabled() {
  return store()?.getItem(PREF_KEY) !== "off";
}

export function setAlertsEnabled(on: boolean) {
  try {
    store()?.setItem(PREF_KEY, on ? "on" : "off");
  } catch {}
}

/** Ask for system-notification permission. Call from a click handler (browsers require a gesture). */
export async function requestAlertPermission(): Promise<NotificationPermission | "unsupported"> {
  unlockAudio();
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** Plays the chime so people can hear what the alerts sound like. */
export function previewChime(kind: ChimeKind) {
  unlockAudio();
  playChime(kind);
}

type Alert = { kind: ChimeKind; at: number; title: string; body: string };

function alertsFor(s: AlertSchedule): Alert[] {
  if (!s.checkedIn || s.checkedOut) return [];
  const list: Alert[] = [];
  if (s.breakStart) {
    list.push({
      kind: "break",
      at: new Date(s.breakStart).getTime(),
      title: "Break time ☕",
      body: s.breakEnd
        ? `Your paid break is on until ${hm.format(new Date(s.breakEnd))}. No need to check out. Enjoy!`
        : "Your paid break has started. No need to check out. Enjoy!",
    });
  }
  if (s.shiftEnd) {
    list.push({
      kind: "shift_end",
      at: new Date(s.shiftEnd).getTime(),
      title: "Shift complete 🎉",
      body: `Your shift ended at ${hm.format(new Date(s.shiftEnd))}. Great work today! Remember to check out.`,
    });
  }
  return list;
}

/**
 * Runs on every app page for signed-in employees: at break start and shift end it plays a chime,
 * shows a toast and (when the tab is in the background) a system notification. Each alert fires
 * once per day per device, even with several tabs open.
 */
export function ShiftAlerts() {
  const router = useRouter();
  const schedule = useRef<AlertSchedule | null>(null);
  const offset = useRef(0);

  const load = useCallback(async () => {
    const s = await getAlertSchedule().catch(() => null);
    schedule.current = s;
    if (s) offset.current = new Date(s.now).getTime() - Date.now();
  }, []);

  const fire = useCallback(
    (a: Alert) => {
      if (alertsEnabled()) playChime(a.kind);
      const isEnd = a.kind === "shift_end";
      toast(a.title, {
        description: a.body,
        duration: isEnd ? 60_000 : 20_000,
        action: isEnd ? { label: "Check out", onClick: () => router.push("/me") } : undefined,
      });
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
        try {
          const n = new Notification(a.title, { body: a.body, icon: "/icon.svg", tag: `presence-${a.kind}`, silent: alertsEnabled() });
          n.onclick = () => {
            window.focus();
            if (isEnd) router.push("/me");
            n.close();
          };
        } catch {}
      }
    },
    [router],
  );

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    void load();
    const reload = () => void load();
    const onVisible = () => document.visibilityState === "visible" && reload();
    window.addEventListener(ATTENDANCE_CHANGED, reload);
    document.addEventListener("visibilitychange", onVisible);
    const refresh = setInterval(reload, 10 * 60_000);

    const tick = setInterval(() => {
      const s = schedule.current;
      if (!s) return;
      const now = Date.now() + offset.current;
      for (const a of alertsFor(s)) {
        if (now < a.at || now - a.at > LATE_LIMIT_MS) continue;
        const key = `presence-alert:${s.workDate}:${a.kind}`;
        const st = store();
        if (st?.getItem(key)) continue;
        st?.setItem(key, String(now)); // claim first so other open tabs don't repeat it
        fire(a);
      }
    }, 10_000);

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener(ATTENDANCE_CHANGED, reload);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [load, fire]);

  return null;
}
