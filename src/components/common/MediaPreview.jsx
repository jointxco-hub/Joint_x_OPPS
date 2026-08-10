import { useState } from "react";
import { File, Play } from "lucide-react";
import FileLightbox from "@/components/files/FileLightbox";
import SecureImage from "@/components/common/SecureImage";
import { classifyFileReference } from "@/lib/filePresentation";

// A compact thumbnail/button for a single file reference. Previewing it now
// always opens the one shared FileLightbox instead of maintaining a second
// full-screen modal implementation (Phase 1B.1, Goal 2) — MediaPreview
// itself never imports FileLightbox's internals, it only renders it.
//
// Image thumbnails always go through SecureImage — the raw canonical `url`
// (which may be a private-upload://... reference, or a legacy private
// Supabase storage URL) is not directly browser-loadable, and SecureImage
// is the existing, single secure-signing rendering path for it. MediaPreview
// never invents a second signing helper, and never persists the resolved
// signed URL — only SecureImage's own local hook state ever sees it.
//
// Three ways callers use this:
//   1. Standalone (no onClick prop): the thumbnail is self-contained —
//      clicking it opens FileLightbox itself in single-file mode. This is
//      what FileThumbnail.jsx relies on.
//   2. Parent-controlled (onClick prop provided): the parent owns what
//      happens on click (e.g. it wants to open FileLightbox itself with a
//      full gallery collection instead of just this one file). MediaPreview
//      renders a single non-nested <button> and defers entirely to the
//      parent — this also removes the button-inside-button markup the
//      previous per-caller modal implementations required.
//   3. Decorative (interactive={false}): a plain, non-clickable thumbnail —
//      for use inside an already-interactive parent element (e.g. a
//      selection tile in a picker), where a second click target would
//      conflict with the parent's own click handling.
/**
 * @param {{ url?: string, title?: string, className?: string, onClick?: () => void, interactive?: boolean }} props
 */
export default function MediaPreview({ url, title = "Attachment", className = "", onClick, interactive = true }) {
  const [open, setOpen] = useState(false);
  const category = classifyFileReference(url);

  const thumbnail = <ThumbnailPreviewImage url={url} title={title} category={category} />;

  if (!interactive) {
    return <div className={`aspect-square overflow-hidden rounded-xl border border-border bg-secondary/30 ${className}`}>{thumbnail}</div>;
  }

  const handleClick = onClick || (() => setOpen(true));

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`aspect-square overflow-hidden rounded-xl border border-border bg-secondary/30 transition-all hover:border-primary/40 ${className}`}
      >
        {thumbnail}
      </button>

      {open && !onClick && (
        <FileLightbox file={{ file_url: url, title }} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ThumbnailPreviewImage({ url, title, category }) {
  if (category === "image") {
    return (
      <SecureImage
        value={url}
        alt={title}
        className="h-full w-full object-cover"
        fallback={
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            <File className="h-6 w-6" />
            File
          </span>
        }
      />
    );
  }
  if (category === "video") {
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
        <Play className="h-6 w-6" />
        Video
      </span>
    );
  }
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
      <File className="h-6 w-6" />
      File
    </span>
  );
}
