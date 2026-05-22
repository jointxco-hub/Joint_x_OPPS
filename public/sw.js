const CACHE_NAME = "joint-x-shell-v2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg"
];

async function safeCacheAll(cache, urls) {
  await Promise.all(
    urls.map((url) =>
      cache.add(url).catch((error) => {
        console.warn("[sw] cache skipped", url, error);
      })
    )
  );
}

function extractAssetUrls(html) {
  const urls = new Set(APP_SHELL);
  const assetPattern = /["'](\/assets\/[^"']+)["']/g;
  const publicPattern = /(?:href|src)=["'](\/(?:icons|manifest\.webmanifest|favicon\.ico)[^"']*)["']/g;
  let match;

  while ((match = assetPattern.exec(html))) {
    urls.add(match[1]);
  }

  while ((match = publicPattern.exec(html))) {
    urls.add(match[1]);
  }

  return [...urls];
}

async function warmAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await safeCacheAll(cache, APP_SHELL);

  try {
    const response = await fetch("/", { cache: "no-store" });
    if (!response.ok) return;

    const copy = response.clone();
    const html = await response.text();
    await cache.put("/", copy.clone());
    await cache.put("/index.html", copy);
    await safeCacheAll(cache, extractAssetUrls(html));
  } catch (error) {
    console.warn("[sw] app shell warm failed", error);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(warmAppShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, copy.clone());
            cache.put("/", copy);
          });
          return response;
        })
        .catch(async () => {
          return (
            (await caches.match(request)) ||
            (await caches.match("/")) ||
            (await caches.match("/index.html"))
          );
        })
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;

        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) =>
      cached ||
      fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      }).catch(() => cached)
    )
  );
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "Joint X update",
    body: "You have a new notification.",
    icon: "/icons/icon-192.svg",
    badge: "/icons/icon-192.svg",
    data: { url: "/" }
  };

  try {
    if (event.data) {
      const data = event.data.json();
      payload = {
        title: data.title || payload.title,
        body: data.body || payload.body,
        icon: data.icon || payload.icon,
        badge: data.badge || payload.badge,
        tag: data.tag || 'joint-x-notification',
        data: {
          url: data.url || "/",
          event_type: data.event_type || 'generic',
          payload: data.payload || {}
        },
        actions: data.actions || [],
        requireInteraction: data.requireInteraction || false,
      };
    }
  } catch (err) {
    console.error("Failed to parse push payload:", err);
    if (event.data?.text) {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, payload)
      .then(() => {
        // Notify all clients about the notification
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => {
            client.postMessage({
              type: 'NOTIFICATION_RECEIVED',
              payload: payload.data
            });
          });
        });
      })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  const eventType = event.notification.data?.event_type || 'generic';
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      // Try to find a window that matches the URL
      for (const client of clients) {
        if (client.url.includes(new URL(url, self.location).pathname) && 'focus' in client) {
          return client.focus();
        }
      }
      // If no matching window, open a new one
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});

self.addEventListener("notificationclose", (event) => {
  // Can track notification dismissals here if needed
  console.log("Notification closed:", event.notification.tag);
});
