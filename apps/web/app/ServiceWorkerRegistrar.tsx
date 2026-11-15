"use client";

import { useEffect } from "react";

/**
 * Registers the Sorted Field service worker and explicitly checks for updates
 * on every production load. updateViaCache:none prevents iOS/iPadOS from
 * holding an old worker script behind an HTTP cache after a deployment.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });
        await registration.update();
      } catch {
        // PWA registration must never block the application shell.
      }
    };

    if (document.readyState === "complete") void register();
    else {
      const onLoad = () => void register();
      window.addEventListener("load", onLoad);
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  return null;
}
