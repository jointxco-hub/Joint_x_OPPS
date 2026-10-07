import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSignedFileUrl } from "@/lib/privateFiles";

// MULTI-PICTURE PRODUCT ITEM LINE — the N-image sibling of
// QuickImagePreview (same file, same rationale: NOT FileLightbox, a
// lightweight Dialog-based glance viewer). Renders an order line's
// frozen image_gallery ([{ image_ref, role, caption }]) with prev/next
// navigation and a role label - built for exactly this one N-image use
// case, not a general media manager.
const ROLE_LABEL = { primary: "Primary", front: "Front", back: "Back", detail: "Detail", reference: "Reference" };

function GalleryImage({ imageRef }) {
  const { url, loading, error } = useSignedFileUrl(imageRef || "");
  if (loading) {
    return (
      <div className="flex h-40 w-full items-center justify-center">
        <div className="h-32 w-32 animate-pulse rounded-lg bg-secondary/60" />
      </div>
    );
  }
  if (error || !url) return <p className="p-8 text-center text-sm text-muted-foreground">Image unavailable.</p>;
  return <img src={url} alt="" className="max-h-[65vh] max-w-full object-contain" />;
}

/**
 * @param {{ open: boolean, onClose: () => void, images?: Array<{image_ref: string, role?: string, caption?: string}>, title?: string }} props
 */
export default function QuickImageGallery({ open, onClose, images, title }) {
  const list = Array.isArray(images) ? images.filter((i) => i?.image_ref) : [];
  const [index, setIndex] = useState(0);

  useEffect(() => { if (open) setIndex(0); }, [open]);

  const current = list[index];
  const canPrev = index > 0;
  const canNext = index < list.length - 1;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose?.(); }}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-3 overflow-hidden rounded-2xl p-4">
        <div className="min-w-0 pr-6">
          {title && <p className="truncate text-sm font-semibold text-foreground">{title}</p>}
          {current && (
            <p className="truncate text-xs text-muted-foreground">
              {ROLE_LABEL[current.role] || current.role || "Picture"}
              {current.caption ? ` — ${current.caption}` : ""}
              {list.length > 1 ? ` · ${index + 1} / ${list.length}` : ""}
            </p>
          )}
        </div>

        <div className="relative flex flex-1 items-center justify-center overflow-auto rounded-xl bg-secondary/30">
          {current ? <GalleryImage imageRef={current.image_ref} /> : (
            <p className="p-8 text-center text-sm text-muted-foreground">No pictures.</p>
          )}
          {list.length > 1 && (
            <>
              <Button
                variant="secondary" size="icon"
                className="absolute left-2 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full shadow"
                disabled={!canPrev}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary" size="icon"
                className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full shadow"
                disabled={!canNext}
                onClick={() => setIndex((i) => Math.min(list.length - 1, i + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>

        {list.length > 1 && (
          <div className="flex justify-center gap-1.5">
            {list.map((img, i) => (
              <button
                key={img.id || i}
                type="button"
                aria-label={`Picture ${i + 1}`}
                onClick={() => setIndex(i)}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${i === index ? "bg-primary" : "bg-secondary-foreground/20"}`}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
