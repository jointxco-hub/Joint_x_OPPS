import { useState, useEffect } from "react";
import { HelpCircle, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export default function HelperHint({
  storageKey,
  title,
  body,
  learnMore,
  size = "sm",
}) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (storageKey && typeof window !== "undefined") {
      setDismissed(localStorage.getItem(`hint_dismissed:${storageKey}`) === "1");
    }
  }, [storageKey]);

  const dismiss = () => {
    if (storageKey) localStorage.setItem(`hint_dismissed:${storageKey}`, "1");
    setDismissed(true);
  };

  if (dismissed) return null;

  const iconSize = size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center text-muted-foreground hover:text-primary transition-colors"
          aria-label={`What is ${title}?`}
        >
          <HelpCircle className={iconSize} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="max-w-xs p-3 text-xs">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-semibold text-foreground">{title}</p>
          {storageKey && (
            <button
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground"
              title="Don't show this again"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <p className="text-muted-foreground mb-1">{body}</p>
        {learnMore && (
          <p className="text-muted-foreground/70 italic text-[11px] mt-2 pt-2 border-t border-border">
            {learnMore}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
