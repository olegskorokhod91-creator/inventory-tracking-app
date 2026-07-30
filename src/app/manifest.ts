import type { MetadataRoute } from "next";

// Next.js file-based manifest convention - auto-served at
// /manifest.webmanifest and auto-linked into every page's <head>, no manual
// <link rel="manifest"> needed.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Order Tracker",
    short_name: "Order Tracker",
    description: "Order tracking for short-term rental properties",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
