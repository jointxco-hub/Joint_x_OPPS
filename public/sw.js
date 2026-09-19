const IS_XOS_SERVICE_WORKER_HOST = self.location.hostname.endsWith(".xos.jointx.co.za");
const CACHE_NAME = "joint-x-shell-v5";
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
  if (IS_XOS_SERVICE_WORKER_HOST) return;
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
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => IS_XOS_SERVICE_WORKER_HOST || key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => IS_XOS_SERVICE_WORKER_HOST ? self.registration.unregister() : undefined)
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (IS_XOS_SERVICE_WORKER_HOST) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }
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
            (await caches.match("/index.html")) ||
            new Response("Offline", {
              status: 503,
              statusText: "Service Unavailable",
              headers: { "Content-Type": "text/plain" },
            })
          );
        })
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () =>
          (await caches.match(request)) ||
          new Response("Offline asset unavailable", {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "text/plain" },
          })
        )
    );
    return;
  }

  if (url.pathname === "/sw.js") {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) =>
      cached ||
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          cached ||
          new Response("Offline", {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "text/plain" },
          })
        )
    )
  );
});

self.addEventListener("push", (event) => {
  if (IS_XOS_SERVICE_WORKER_HOST) return;

  const work = (async () => {
    let data = {};

    try {
      if (event.data) data = event.data.json();
    } catch (error) {
      console.error("[sw] Failed to parse push payload", error);
      data = { body: event.data?.text?.() || "You have a new notification." };
    }

    const title = data.title || "Joint X update";
    const options = {
      body: data.body || "You have a new notification.",
      icon: data.icon || "/icons/icon-192.png",
      badge: data.badge || "/icons/icon-192.png",
      tag: data.tag || "joint-x-notification",
      data: {
        url: data.url || "/",
        event_type: data.event_type || "generic",
        payload: data.payload || {},
      },
      requireInteraction: Boolean(data.requireInteraction),
    };

    if (Array.isArray(data.actions) && data.actions.length > 0) {
      options.actions = data.actions;
    }

    console.log("[sw] Showing push notification", {
      title,
      tag: options.tag,
      url: options.data.url,
      event_type: options.data.event_type,
    });

    try {
      await self.registration.showNotification(title, options);
      console.log("[sw] Push notification shown", options.tag);
    } catch (error) {
      console.error("[sw] showNotification failed; retrying minimal notification", error);

      await self.registration.showNotification(title, {
        body: options.body,
        tag: options.tag,
        data: options.data,
        requireInteraction: options.requireInteraction,
      });
      console.log("[sw] Minimal push notification shown", options.tag);
    }

    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach((client) => {
      client.postMessage({
        type: "NOTIFICATION_RECEIVED",
        payload: options.data,
      });
    });
  })();

  event.waitUntil(work);
});

self.addEventListener("notificationclick", (event) => {
  if (IS_XOS_SERVICE_WORKER_HOST) return;
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
  if (IS_XOS_SERVICE_WORKER_HOST) return;
  // Can track notification dismissals here if needed
  console.log("Notification closed:", event.notification.tag);
});
