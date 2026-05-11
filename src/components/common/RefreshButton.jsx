import React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function RefreshButton({ onRefresh, isRefreshing = false, className = "", title = "Refresh" }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onRefresh}
      disabled={isRefreshing}
      title={title}
      aria-label={title}
      className={cn("h-9 w-9 rounded-full text-muted-foreground hover:text-foreground", className)}
    >
      <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
    </Button>
  );
}
