import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pastry Presence — Attendance",
    short_name: "Presence",
    description: "Face-recognition attendance, leave and payroll for Pastry Marketing.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0a0a20",
    theme_color: "#0a0a20",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
