import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { dataClient } from "@/api/dataClient";
import { supabase } from "@/lib/supabaseClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, MessageSquare, X, Send, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, File as FileIcon } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { isAssignableTeamUser, userDisplayName, userRoleLabel } from "@/lib/teamUsers";
import { useSignedFileUrl } from "@/lib/privateFiles";
import { classifyFileReference, fileNameFromReference, fileUrlFrom, getThumbnailWindow, isEditableKeyboardTarget } from "@/lib/filePresentation";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
// Maximum thumbnail-strip items mounted at once — opening a large
// collection must not fire a signing request per item all at once.
const THUMBNAIL_WINDOW_SIZE = 12;

// FileLightbox is the one shared full-screen file viewer in OPPS (Phase
// 1B.1). Two ways to call it:
//   - single file (unchanged, every existing caller keeps working):
//       <FileLightbox file={file} onClose={...} />
//   - a navigable collection:
//       <FileLightbox file={currentFile} files={files} index={index}
//                      onIndexChange={setIndex} onClose={...} />
// `index`/`onIndexChange` are optional even when `files` is passed — the
// component falls back to managing its own position internally so a caller
// that just wants "open this collection starting here" doesn't have to
// lift state for it. Defaults (rather than a JSDoc @param) mark them
// optional so every existing single-file caller keeps type-checking.
export default function FileLightbox({ file = null, files = [], index = 0, onIndexChange = null, onClose }) {
  const items = useMemo(() => {
    if (Array.isArray(files) && files.length > 0) return files;
    return file ? [file] : [];
  }, [files, file]);

  const [internalIndex, setInternalIndex] = useState(() => (typeof index === "number" ? index : 0));
  const isControlled = typeof index === "number" && typeof onIndexChange === "function";
  const rawIndex = isControlled ? index : internalIndex;
  const activeIndex = Math.min(Math.max(rawIndex, 0), Math.max(items.length - 1, 0));
  const setActiveIndex = (next) => {
    const clamped = Math.min(Math.max(next, 0), Math.max(items.length - 1, 0));
    if (isControlled) onIndexChange(clamped);
    else setInternalIndex(clamped);
  };

  const activeFile = items[activeIndex] || file || {};
  const hasMultiple = items.length > 1;
  const canGoPrev = activeIndex > 0;
  const canGoNext = activeIndex < items.length - 1;
  const goPrev = () => canGoPrev && setActiveIndex(activeIndex - 1);
  const goNext = () => canGoNext && setActiveIndex(activeIndex + 1);
  // Previous/Next, keyboard arrows, and "N of M" all operate on the FULL
  // `items` collection above — only the thumbnail STRIP's mounted DOM is
  // bounded, never actual gallery navigation.
  const thumbnailWindow = useMemo(
    () => getThumbnailWindow(items, activeIndex, THUMBNAIL_WINDOW_SIZE),
    [items, activeIndex]
  );

  const [showCommentForm, setShowCommentForm] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [commentData, setCommentData] = useState({
    comment_text: "",
    mentioned_user: "none",
    file_status: "none"
  });
  const queryClient = useQueryClient();

  const { data: comments = [] } = useQuery({
    queryKey: ['fileComments', activeFile.id],
    queryFn: () => dataClient.entities.FileComment.filter({ file_id: activeFile.id }, '-created_date', 100),
    enabled: !!activeFile.id
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => dataClient.entities.User.list('-created_date', 100)
  });

  const mentionableUsers = users.filter(isAssignableTeamUser);

  const createCommentMutation = useMutation({
    mutationFn: (data) => dataClient.entities.FileComment.create(data),
    onSuccess: async (_comment, variables) => {
      queryClient.invalidateQueries({ queryKey: ['fileComments', activeFile.id] });
      if (variables.mentioned_user && activeFile.tenant_id) {
        const currentUser = await dataClient.auth.me().catch(() => null);
        supabase.functions.invoke("send-push-notification", {
          body: { tenant_id: activeFile.tenant_id, user_email: variables.mentioned_user, event_type: "TAGGED", payload: { message: `${currentUser?.full_name || currentUser?.email || "A team member"} tagged you on ${activeFile.title || activeFile.name || "a file"}.` } },
        }).then(({ error }) => { if (error) console.warn("Tag push notification failed:", error); });
      }
      setShowCommentForm(false);
      setCommentData({ comment_text: "", mentioned_user: "none", file_status: "none" });
      toast.success("Comment added!");
    }
  });

  useEffect(() => {
    setImgError(false);
    setZoom(1);
    setShowCommentForm(false);
  }, [activeFile?.file_url, activeFile?.url, activeFile?.fileUrl, activeFile?.id]);

  // Keyboard navigation: ArrowLeft/ArrowRight move through the collection
  // (no wraparound — prev/next simply do nothing past the ends), Escape
  // always closes regardless of collection size. Arrow keys are ignored
  // while the event originates inside an editable control (the comment
  // textarea, the mention/status <select>s, any future input) — a staff
  // member moving their text cursor while writing a comment must never
  // accidentally switch files. Escape is NOT gated by this check; it
  // always closes.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
        return;
      }
      if (isEditableKeyboardTarget(event.target)) return;
      if (!hasMultiple) return;
      if (event.key === "ArrowLeft") goPrev();
      else if (event.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const handleAddComment = () => {
    if (!commentData.comment_text.trim()) {
      toast.error("Please enter a comment");
      return;
    }
    createCommentMutation.mutate({
      ...commentData,
      mentioned_user: commentData.mentioned_user === "none" ? "" : commentData.mentioned_user,
      file_id: activeFile.id
    });
  };

  const rawFileUrl = fileUrlFrom(activeFile);
  // Never persisted anywhere — signedFileUrl only ever lives in this local
  // hook state for as long as the lightbox is open. The raw canonical
  // rawFileUrl (private-upload://... or a stored storage URL) remains the
  // identity used for classification, titles, and any downstream write.
  const { url: signedFileUrl, loading: signingFile, error: signedFileError } = useSignedFileUrl(rawFileUrl);
  const fileUrl = signedFileUrl || "";
  const fileName = activeFile.title || activeFile.name || activeFile.file_name || fileNameFromReference(rawFileUrl);
  const fileType = activeFile.file_type || activeFile.mime_type || activeFile.type || "";
  const referenceCategory = (() => {
    const byUrl = classifyFileReference(rawFileUrl);
    return byUrl !== "unknown" ? byUrl : classifyFileReference(fileName);
  })();
  const isImage = fileType.startsWith("image/") || referenceCategory === "image";
  const isPdf = fileType === "application/pdf" || referenceCategory === "pdf";
  const isVideo = fileType.startsWith("video/") || referenceCategory === "video";

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + ZOOM_STEP) * 100) / 100));
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - ZOOM_STEP) * 100) / 100));
  const resetZoom = () => setZoom(1);

  const statusColors = {
    needs_fix: "bg-red-100 text-red-700",
    approved: "bg-green-100 text-green-700",
    pending_review: "bg-yellow-100 text-yellow-700",
    none: "bg-slate-100 text-slate-700"
  };

  const lightbox = (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-3 sm:p-5" role="dialog" aria-modal="true" aria-label={fileName || "File preview"}>
      <button className="absolute inset-0 cursor-default" aria-label="Close preview" onClick={onClose} />
      <div className="relative flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950">{fileName || "File preview"}</p>
            <p className="text-xs text-slate-500">
              In-app preview{hasMultiple ? ` · ${activeIndex + 1} of ${items.length}` : ""}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 rounded-full">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white">
          {/* File Preview */}
          <div className="relative flex min-h-[68vh] items-center justify-center bg-slate-100 p-3 sm:p-5">
            {hasMultiple && (
              <>
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={!canGoPrev}
                  aria-label="Previous file"
                  className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow-md transition-opacity hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeft className="h-5 w-5 text-slate-700" />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canGoNext}
                  aria-label="Next file"
                  className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow-md transition-opacity hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRight className="h-5 w-5 text-slate-700" />
                </button>
              </>
            )}

            {isImage && !signingFile && !signedFileError && (
              <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full bg-white/90 p-1 shadow-md">
                <button type="button" onClick={zoomOut} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out" className="rounded-full p-1.5 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30">
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="min-w-[3rem] text-center text-xs font-medium text-slate-600">{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={zoomIn} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in" className="rounded-full p-1.5 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30">
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button type="button" onClick={resetZoom} disabled={zoom === 1} aria-label="Reset zoom" className="rounded-full p-1.5 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30">
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            )}

            {signingFile ? (
              <div className="text-center text-slate-500">
                <p className="text-sm font-medium">Preparing secure file link...</p>
              </div>
            ) : signedFileError ? (
              <div className="text-center text-slate-500">
                <p className="mb-2 text-sm font-medium">File access is unavailable</p>
                <p className="text-xs">You may not have access to this tenant file, or the signed link expired.</p>
              </div>
            ) : isImage && !imgError ? (
              <div className="max-h-[76vh] w-full overflow-auto">
                <img
                  src={fileUrl}
                  alt={fileName || "File preview"}
                  className="mx-auto max-h-[76vh] w-auto max-w-full rounded-lg bg-white object-contain shadow-sm transition-transform duration-150"
                  style={{ transform: `scale(${zoom})` }}
                  onError={() => setImgError(true)}
                />
              </div>
            ) : isImage && imgError ? (
              <div className="text-center text-slate-500">
                <p className="mb-2 text-sm font-medium">Image could not be loaded</p>
                <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary text-xs underline">Open original URL</a>
              </div>
            ) : isVideo ? (
              <video
                src={fileUrl}
                controls
                className="max-h-[76vh] w-auto max-w-full rounded-lg bg-black shadow-sm"
              >
                <track kind="captions" />
              </video>
            ) : isPdf ? (
              <iframe
                src={fileUrl}
                className="h-[76vh] w-full rounded border bg-white"
                title={fileName || "PDF preview"}
              />
            ) : (
              <div className="text-center">
                <p className="text-slate-500 mb-4">Preview not available</p>
                <Button asChild>
                  <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                    <Download className="w-4 h-4 mr-2" /> Download File
                  </a>
                </Button>
              </div>
            )}
          </div>

          {hasMultiple && (
            <div className="flex gap-2 overflow-x-auto border-t border-slate-200 bg-white p-3">
              {thumbnailWindow.items.map((item, localIndex) => {
                const itemIndex = thumbnailWindow.startIndex + localIndex;
                return (
                  <LightboxThumbnailStripItem
                    key={item.file_url || itemIndex}
                    item={item}
                    isActive={itemIndex === activeIndex}
                    onSelect={() => setActiveIndex(itemIndex)}
                  />
                );
              })}
            </div>
          )}

          <div className="space-y-4 p-4">
            {/* Download Button */}
            <Button asChild variant="outline" className="w-full rounded-xl">
              <a href={fileUrl} download target="_blank" rel="noopener noreferrer">
                <Download className="w-4 h-4 mr-2" /> Download File
              </a>
            </Button>

            {/* Comments Section — only meaningful for a real ClientAsset row.
                Order file preview objects (built inline from
                order.file_urls) often have no `id`, so there is nothing to
                key a FileComment off; the whole section is omitted rather
                than shown disabled/broken. */}
            {activeFile.id && (
            <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Comments ({comments.length})
              </h3>
              <Button size="sm" onClick={() => setShowCommentForm(!showCommentForm)}>
                {showCommentForm ? "Cancel" : "Add Comment"}
              </Button>
            </div>

            {showCommentForm && (
              <div className="bg-slate-50 rounded-lg p-4 mb-4 space-y-3">
                <Textarea
                  placeholder="Add your comment..."
                  value={commentData.comment_text}
                  onChange={(e) => setCommentData({...commentData, comment_text: e.target.value})}
                  rows={3}
                />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Mention Team Member</label>
                    <Select
                      value={commentData.mentioned_user}
                      onValueChange={(v) => setCommentData({...commentData, mentioned_user: v})}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select user..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {mentionableUsers.map(user => (
                          <SelectItem key={user.id} value={user.email}>
                            {userDisplayName(user)} · {userRoleLabel(user)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">File Status</label>
                    <Select
                      value={commentData.file_status}
                      onValueChange={(v) => setCommentData({...commentData, file_status: v})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Status</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="needs_fix">Needs Fix</SelectItem>
                        <SelectItem value="pending_review">Pending Review</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button onClick={handleAddComment} className="w-full">
                  <Send className="w-4 h-4 mr-2" /> Post Comment
                </Button>
              </div>
            )}

            {/* Comments List */}
            <div className="space-y-3">
              {comments.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">No comments yet</p>
              ) : (
                comments.map(comment => (
                  <div key={comment.id} className="bg-slate-50 rounded-lg p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-900">
                          {comment.created_by}
                        </p>
                        <p className="text-xs text-slate-500">
                          {format(new Date(comment.created_date), 'MMM d, yyyy h:mm a')}
                        </p>
                      </div>
                      {comment.file_status && comment.file_status !== "none" && (
                        <span className={`text-xs px-2 py-1 rounded ${statusColors[comment.file_status]}`}>
                          {comment.file_status.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700">{comment.comment_text}</p>
                    {comment.mentioned_user && (
                      <p className="text-xs text-blue-600 mt-1">
                        @{comment.mentioned_user}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(lightbox, document.body);
}

// One entry in the compact thumbnail/navigation strip. Images resolve a
// secure signed thumbnail; anything else renders a plain type tile — no
// signing, no network request for non-visual files.
function LightboxThumbnailStripItem({ item, isActive, onSelect }) {
  const rawUrl = fileUrlFrom(item);
  const category = classifyFileReference(rawUrl);
  const isImage = category === "image";
  const { url: thumbUrl } = useSignedFileUrl(isImage ? rawUrl : "");
  const label = (item.title || item.name || fileNameFromReference(rawUrl)).slice(0, 40);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`View ${label}`}
      aria-current={isActive}
      className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 transition-all ${
        isActive ? "border-primary" : "border-transparent opacity-70 hover:opacity-100"
      }`}
      title={label}
    >
      {isImage && thumbUrl ? (
        <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-slate-100 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
          <FileIcon className="h-4 w-4" />
          {category === "unknown" ? "file" : category.split("-")[0]}
        </span>
      )}
    </button>
  );
}
