import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useSignedFileUrl } from "@/lib/privateFiles";

// A deliberately minimal, view-only image preview - the "quick glance at
// this product/mockup/artwork thumbnail without leaving the order" use
// case. This is NOT a replacement for FileLightbox (the one full-featured
// file viewer in OPPS, with comments/tagging/multi-file navigation/its
// own custom z-[1000] portal) - that component stays exactly as-is for
// its own callers. This one exists because no lightweight, Dialog-based,
// comment-free image-only viewer existed yet, and FileLightbox's full
// file-management surface would be the wrong tool for a fast production-
// inspection glance staff take mid-composition-work.
//
// Built on the shared Dialog/DialogContent primitive (src/components/ui/
// dialog.jsx, already fixed to the established z-[90] above-Order-Drawer
// layer) - not a new portal/z-index convention. Escape, backdrop click,
// and the X button all close it for free via that primitive's default
// Radix behavior - nothing custom needed here.
//
// Resolves via useSignedFileUrl (src/lib/privateFiles.js) - the same
// resolver SecureImage itself uses - so a private-upload://... reference
// renders correctly. The signed URL only ever lives in this component's
// local hook state for as long as the dialog is open; the raw durable
// reference passed in via `value` is never mutated or persisted anywhere
// from here. Opening/closing this component performs zero writes.
/**
 * @param {{ open: boolean, onClose: () => void, value?: string, title?: string, subtitle?: string }} props
 */
export default function QuickImagePreview({ open, onClose, value, title, subtitle }) {
  const { url, loading, error } = useSignedFileUrl(open ? value : "");

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose?.(); }}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-3 overflow-hidden rounded-2xl p-4">
        {(title || subtitle) && (
          <div className="min-w-0 pr-6">
            {title && <p className="truncate text-sm font-semibold text-foreground">{title}</p>}
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        )}

        <div className="flex flex-1 items-center justify-center overflow-auto rounded-xl bg-secondary/30">
          {loading ? (
            <div className="flex h-40 w-full items-center justify-center">
              <div className="h-32 w-32 animate-pulse rounded-lg bg-secondary/60" />
            </div>
          ) : error || !url ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Image unavailable.</p>
          ) : (
            <img
              src={url}
              alt={title || "Preview"}
              className="max-h-[65vh] max-w-full object-contain"
            />
          )}
        </div>

        {url && !loading && !error && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="self-center text-xs font-medium text-primary hover:underline"
          >
            Open full size
          </a>
        )}
      </DialogContent>
    </Dialog>
  );
}
