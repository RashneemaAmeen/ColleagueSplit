import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ColleagueSplit",
    short_name: "ColleagueSplit",
    description: "Spend together. Split smarter.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6faf8",
    theme_color: "#0f766e",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Add expense", url: "/expenses/new", icons: [{ src: "/icons/192", sizes: "192x192" }] },
      { name: "Settle up", url: "/settle", icons: [{ src: "/icons/192", sizes: "192x192" }] },
    ],
  };
}
