"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, SmartphoneIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own Install button instead of the mini-infobar
    deferred = e as InstallPrompt;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
    toast.success("Presence is installed. Open it from your desktop, Start menu or home screen.");
  });
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

/** Registers the service worker (installability, offline page, notification clicks). Mounted once in the root layout. */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}

/** "Install app" button for the header. Hidden once installed or when the browser can't install. */
export function InstallButton() {
  const [, rerender] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only checks after hydration
    setMounted(true);
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (!mounted || isStandalone()) return null;

  if (deferred) {
    return (
      <Button size="sm" variant="outline" className="rounded-full" onClick={async () => {
        const p = deferred;
        if (!p) return;
        await p.prompt();
        const { outcome } = await p.userChoice;
        if (outcome === "accepted") deferred = null;
        rerender((n) => n + 1);
      }}>
        <DownloadIcon /> Install app
      </Button>
    );
  }

  if (isIos()) {
    return (
      <Button size="sm" variant="ghost" className="rounded-full" onClick={() =>
        toast.info("Install on iPhone / iPad", { description: "Tap the Share button, then “Add to Home Screen”.", duration: 10_000 })}>
        <SmartphoneIcon /> Install
      </Button>
    );
  }
  return null;
}

/** System notification through the service worker (works in the installed app and on Android). */
export async function showSystemNotification(title: string, body: string, url: string, tag: string, silent: boolean) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const options = { body, icon: "/icon-192.png", badge: "/icon-192.png", tag, silent, data: { url } };
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) return void (await reg.showNotification(title, options));
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      location.assign(url);
      n.close();
    };
  } catch {}
}
