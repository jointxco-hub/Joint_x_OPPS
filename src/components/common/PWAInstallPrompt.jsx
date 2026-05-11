import { useEffect, useState } from "react";
import { Download, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { flushOfflineQueue, getOfflineQueueCount } from "@/lib/offlineQueue";
import { toast } from "sonner";

export default function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(getOfflineQueueCount());
  const [notificationPermission, setNotificationPermission] = useState(
    "Notification" in window ? Notification.permission : "unsupported"
  );

  useEffect(() => {
    const handleInstall = (event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    const handleOnline = async () => {
      setOnline(true);
      const result = await flushOfflineQueue();
      setQueueCount(result.remaining);
      if (result.synced > 0) toast.success(`${result.synced} offline item${result.synced > 1 ? "s" : ""} synced`);
    };
    const handleOffline = () => setOnline(false);
    const handleQueue = () => setQueueCount(getOfflineQueueCount());

    window.addEventListener("beforeinstallprompt", handleInstall);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("jx-offline-queue-change", handleQueue);
    if (navigator.onLine) flushOfflineQueue().then(r => setQueueCount(r.remaining));

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
    <div className="fixed left-4 right-4 bottom-24 lg:left-auto lg:right-5 lg:bottom-5 lg:w-[340px] z-[60]">
      <div className="rounded-xl border border-border bg-card shadow-apple-lg px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          {online ? <Download className="w-4 h-4 text-primary" /> : <WifiOff className="w-4 h-4 text-amber-600" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {!online ? "Offline mode" : queueCount > 0 ? `${queueCount} waiting to sync` : canAskNotifications ? "Enable mobile alerts" : "Install Joint X"}
          </p>
          <p className="text-xs text-muted-foreground">
            {!online ? "New expenses, notes, bugs and ideas will sync when online." : queueCount > 0 ? "Tap sync if it does not run automatically." : canAskNotifications ? "Get notified when you are tagged or assigned." : "Add it to your phone for faster access."}
          </p>
        </div>
        {queueCount > 0 ? (
          <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => flushOfflineQueue().then(r => setQueueCount(r.remaining))}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        ) : canAskNotifications ? (
          <Button size="sm" className="h-8" onClick={enableNotifications}>Enable</Button>
        ) : installEvent ? (
          <Button size="sm" className="h-8" onClick={install}>Install</Button>
        ) : null}
      </div>
    </div>
  );
}
