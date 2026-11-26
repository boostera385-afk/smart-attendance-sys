"use client";

import { useSyncExternalStore } from "react";

// Rendered from the viewer's clock (not the server's), so the page can stay static.
const subscribe = () => () => {};

export function Greeting() {
  const now = useSyncExternalStore(subscribe, () => new Date().toDateString(), () => null);
  if (!now) return <div className="h-14" aria-hidden />;
  const d = new Date();
  const h = d.getHours();
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
      </p>
      <h1 className="text-2xl font-semibold md:text-3xl">{greet} 👋</h1>
    </>
  );
}
