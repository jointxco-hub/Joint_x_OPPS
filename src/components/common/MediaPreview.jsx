import React, { useState } from "react";
import { Download, File, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";

function isImage(url = "") {
  return /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(url);
}

function isVideo(url = "") {
  return /\.(mp4|mov|webm|avi)(\?|$)/i.test(url);
}

export default function MediaPreview({ url, title = "Attachment", className = "" }) {
  const [open, setOpen] = useState(false);
  const image = isImage(url);
  const video = isVideo(url);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`aspect-square overflow-hidden rounded-xl border border-border bg-secondary/30 transition-all hover:border-primary/40 ${className}`}
      >
        {image ? (
          <img src={url} alt={title} loading="lazy" className="h-full w-full object-cover" />
        ) : video ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            <Play className="h-6 w-6" />
            Video
          </span>
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            <File className="h-6 w-6" />
            File
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div className="relative max-h-[90vh] w-full max-w-5xl rounded-2xl bg-card p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="truncate text-sm font-semibold text-foreground">{title}</p>
              <div className="flex items-center gap-1">
                <Button asChild variant="ghost" size="icon" className="rounded-full">
                  <a href={url} download>
                    <Download className="h-4 w-4" />
                  </a>
                </Button>
                <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex max-h-[78vh] items-center justify-center overflow-hidden rounded-xl bg-secondary/30">
              {image ? (
                <img src={url} alt={title} className="max-h-[78vh] max-w-full object-contain" />
              ) : video ? (
                <video src={url} controls className="max-h-[78vh] max-w-full" />
              ) : (
                <iframe src={url} title={title} className="h-[78vh] w-full border-0" />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
