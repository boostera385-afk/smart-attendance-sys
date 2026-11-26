import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Presence — AI Attendance",
    short_name: "Presence",
    description: "Face-recognition attendance for the office.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f7f9fb",
    theme_color: "#1f9e8f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
