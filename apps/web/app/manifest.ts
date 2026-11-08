import type { MetadataRoute } from "next";

/**
 * Titan Go is the single installable PWA for the Titan Zero suite. Which modes
 * appear inside it (Build / Desk / Field / Pay) are determined by subscription
 * entitlements and role. This deployment currently opens in Field mode.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Titan Go",
    short_name: "Titan Go",
    description: "Titan Go — one mobile app for your Titan Zero business systems. Current mode: Field.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#070708",
    theme_color: "#f5c542",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Field Command",
        short_name: "Command",
        description: "Open Titan Go in Field command mode",
        url: "/app",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Today",
        short_name: "Today",
        description: "Open today's Field work",
        url: "/app/my-work",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Workforce",
        short_name: "Workforce",
        description: "Open Field workforce",
        url: "/app/workforce",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
