import { useEffect, useState } from "react";
import { Download, ListChecks, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { flushOfflineQueue, getOfflineQueueCount, getOfflineQueueItems } from "@/lib/offlineQueue";
import { toast } from "sonner";

function describeQueuedItem(item) {
  const payload = item?.payload || {};
  const title =
    payload.title ||
    payload.name ||
    payload.client_name ||
    payload.order_number ||
    payload.file_name ||
    payload.file_url ||
    "Untitled item";
  const entity = String(item?.entityName || "Item").replace(/([a-z])([A-Z])/g, "$1 $2");
  return {
    entity,
    title,
    detail: [payload.order_id ? "Linked order" : null, payload.folder_id ? "Folder link" : null]
      .filter(Boolean)
      .join(" · "),
  };
}

export default function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(getOfflineQueueCount());
  const [queueItems, setQueueItems] = useState(getOfflineQueueItems());
  const [showQueue, setShowQueue] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(
    "Notification" in window ? Notification.permission : "unsupported"
  );

  const refreshQueue = () => {
    setQueueCount(getOfflineQueueCount());
    setQueueItems(getOfflineQueueItems());
  };

  const syncQueue = async () => {
    setSyncing(true);
    try {
      const result = await flushOfflineQueue();
      refreshQueue();
      if (result.synced > 0) toast.success(`${result.synced} offline item${result.synced > 1 ? "s" : ""} synced`);
      if (result.synced === 0 && result.remaining > 0) toast.info("Still waiting to sync. Check connection or permissions.");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const handleInstall = (event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    const handleOnline = async () => {
      setOnline(true);
      const result = await flushOfflineQueue();
      refreshQueue();
      if (result.synced > 0) toast.success(`${result.synced} offline item${result.synced > 1 ? "s" : ""} synced`);
    };
    const handleOffline = () => setOnline(false);
    const handleQueue = refreshQueue;

    window.addEventListener("beforeinstallprompt", handleInstall);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("jx-offline-queue-change", handleQueue);
    if (navigator.onLine) flushOfflineQueue().then(refreshQueue);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstall);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("jx-offline-queue-change", handleQueue);
    };
  }, []);

  const install = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  };

  const enableNotifications = async () => {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setNotificationPermission(result);
    if (result === "granted") {
      toast.success("Mobile notifications enabled");
      navigator.serviceWorker?.ready?.then((registration) => {
        registration.showNotification?.("Joint X notifications enabled", {
          body: "Tags, task assignments and order updates can now alert this device.",
          icon: "/icons/icon-192.svg",
        });
      });
    }
  };

  const canAskNotifications = notificationPermission === "default";

  if (!installEvent && online && queueCount === 0 && !canAskNotifications) return null;

  return (
    <>
      <div className="fixed left-4 right-4 bottom-24 lg:left-auto lg:right-5 lg:bottom-5 lg:w-[360px] z-[60]">
        <div className="rounded-xl border border-border bg-card shadow-apple-lg px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            {online ? <Download className="w-4 h-4 text-primary" /> : <WifiOff className="w-4 h-4 text-amber-600" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {!online ? "Offline mode" : queueCount > 0 ? `${queueCount} waiting to sync` : canAskNotifications ? "Enable mobile alerts" : "Install Joint X"}
            </p>
            <p className="text-xs text-muted-foreground">
              {!online ? "Tasks, notes, folders, file links, bugs, ideas, and expenses will sync when online." : queueCount > 0 ? "Review queued work or sync now." : canAskNotifications ? "Get notified when you are tagged or assigned." : "Add it to your phone for faster access."}
            </p>
          </div>
          {queueCount > 0 ? (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => setShowQueue(true)} title="Queued work">
                <ListChecks className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="h-8 px-2" onClick={syncQueue} disabled={syncing || !online} title="Sync now">
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              </Button>
            </div>
          ) : canAskNotifications ? (
            <Button size="sm" className="h-8" onClick={enableNotifications}>Enable</Button>
          ) : installEvent ? (
            <Button size="sm" className="h-8" onClick={install}>Install</Button>
          ) : null}
        </div>
      </div>

      <Dialog open={showQueue} onOpenChange={setShowQueue}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Offline queue</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              These items are saved on this device and will sync when OPPS is online.
            </p>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
              {queueItems.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No queued work.</p>
              ) : queueItems.map((item) => {
                const details = describeQueuedItem(item);
                return (
                  <div key={item.id} className="border-b border-border p-3 last:border-b-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{details.title}</p>
                        <p className="text-xs text-muted-foreground">{details.entity}{details.detail ? ` · ${details.detail}` : ""}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {item.action}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Queued {item.queuedAt ? new Date(item.queuedAt).toLocaleString() : "recently"}
                    </p>
                  </div>
                );
              })}
            </div>
            <Button className="w-full rounded-xl" onClick={syncQueue} disabled={syncing || !online || queueItems.length === 0}>
              <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {online ? "Sync queued work" : "Waiting for connection"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
