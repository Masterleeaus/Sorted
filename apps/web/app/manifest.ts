import type { MetadataRoute } from "next";

/**
 * Sorted is the installable Field application. Other ecosystem products,
 * including Supercharged Desk and LMS Academy, retain separate identities.
 * Do not claim that unavailable app modes are installed in this PWA.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sorted",
    short_name: "Sorted",
    description: "Sorted — field service operations, scheduling and workforce.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#070708",
    theme_color: "#17365d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Field Command",
        short_name: "Command",
        description: "Open Sorted field command",
        url: "/app",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Today",
        short_name: "Today",
        description: "Open today's field work",
        url: "/app/my-work",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Workforce",
        short_name: "Workforce",
        description: "Open Sorted workforce",
        url: "/app/workforce",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
