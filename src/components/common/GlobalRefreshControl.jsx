import React, { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";

const HIDDEN_PATHS = new Set(["/SignIn", "/TrackOrder", "/track"]);

export default function GlobalRefreshControl() {
  const queryClient = useQueryClient();
  const fetchingCount = useIsFetching();
  const location = useLocation();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  if (isLoadingAuth || !isAuthenticated || HIDDEN_PATHS.has(location.pathname)) {
    return null;
  }

  const isBusy = refreshing || fetchingCount > 0;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
    } finally {
      window.setTimeout(() => setRefreshing(false), 450);
    }
  };

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={refreshing}
      title="Refresh app data"
      aria-label="Refresh app data"
      className={cn(
        "fixed right-4 bottom-24 z-40 flex h-11 w-11 items-center justify-center rounded-full",
        "border border-border/80 bg-card/88 text-muted-foreground shadow-apple backdrop-blur-xl",
        "hover:border-primary/30 hover:text-primary active:scale-95",
        "lg:bottom-5 lg:right-5"
      )}
    >
      <RefreshCw className={cn("h-4 w-4", isBusy && "animate-spin")} />
    </button>
  );
}
