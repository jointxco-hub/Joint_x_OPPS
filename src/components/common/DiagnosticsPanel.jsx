import { useState } from "react";
import { Bug, X, Copy, RefreshCw } from "lucide-react";
import { collectDiagnosticSnapshot } from "@/lib/devDiagnostics";

// Temporary staff-facing panel for comparing normal browser / installed
// PWA / mobile order-count discrepancies. Small floating trigger so it's
// reachable identically on all three surfaces without a URL/query-param
// trick that an installed PWA's fixed start_url would drop. Remove this
// component (and its one mount point in Dashboard.jsx) once the
// discrepancy is confirmed fixed - it is not meant to be permanent UI.
export default function DiagnosticsPanel() {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setCopied(false);
    try {
      setSnapshot(await collectDiagnosticSnapshot());
    } finally {
      setLoading(false);
    }
  };

  const openPanel = async () => {
    setOpen(true);
    if (!snapshot) await refresh();
  };

  const copy = async () => {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (e.g. non-HTTPS, permission
      // denied) - the JSON is still visible/selectable in the <pre> below.
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        aria-label="Open diagnostics"
        className="fixed bottom-4 right-4 z-[999] flex h-10 w-10 items-center justify-center rounded-full bg-foreground/80 text-background shadow-lg hover:bg-foreground"
      >
        <Bug className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Diagnostics (temporary)</p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={refresh} disabled={loading} className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button type="button" onClick={copy} className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Copy">
              <Copy className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {copied && <p className="mb-2 text-xs font-medium text-emerald-700">Copied to clipboard.</p>}
          <pre className="whitespace-pre-wrap break-all text-[11px] leading-4 text-foreground">
            {snapshot ? JSON.stringify(snapshot, null, 2) : "Loading..."}
          </pre>
        </div>
      </div>
    </div>
  );
}
