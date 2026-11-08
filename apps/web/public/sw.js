// Minimal service worker for Sorted Field.
//
// Scope: installability only. Chromium gates the install prompt on the presence
// of a service worker with a fetch handler; this provides exactly that and
// nothing more. There is deliberately NO caching / offline strategy yet — every
// request goes straight to the network (see TASK-020 / EPIC-005). Add a cache
// here only when a real offline requirement exists.

self.addEventListener("install", () => {
  // Activate this worker immediately on first install.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of open clients without requiring a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass-through: network only. Present so the app is installable.
  event.respondWith(fetch(event.request));
});

// Defensive redirect validation: push data may come from older senders.
// Only same-origin app paths may be used for notification navigation.
function safeNotificationPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")
    || value.includes("\\") || /[\x00-\x1f\x7f]/.test(value)) return "/";
  return value;
}

// --- Web Push (TASK-118) -----------------------------------------------------
// The web tier sends a JSON body shaped by lib/push/payload.ts:
//   { title, body, tag, data: { url } }

self.addEventListener("push", (event) => {
  let msg = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    msg = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    msg = { title: "Sorted", body: event.data ? event.data.text() : "" };
  }
  const title = msg.title || "Sorted";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: msg.body || "",
      tag: msg.tag || undefined,
      data: { url: safeNotificationPath(msg.data && msg.data.url) },
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeNotificationPath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      // Keep this event alive until navigation and focus finish. If a tab
      // cannot navigate, try the next tab or open a new same-origin window.
      for (const client of clients) {
        // Focusing a tab without navigation support would leave the user on
        // the wrong screen. Try a navigable tab or open a new window instead.
        if (typeof client.navigate !== "function" || typeof client.focus !== "function") continue;
        try {
          await client.navigate(url);
          await client.focus();
          return;
        } catch {
          // A closed or blocked client must not consume the notification click.
          continue;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
