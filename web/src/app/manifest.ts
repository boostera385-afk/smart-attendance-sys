import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Pastry Presence — Attendance",
    short_name: "Presence",
    description: "Attendance, leave and payroll for Pastry Marketing.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0a0a20",
    theme_color: "#0a0a20",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Check in / out", short_name: "Check in", url: "/me", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Attendance", url: "/attendance", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Leaves", url: "/leaves", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
