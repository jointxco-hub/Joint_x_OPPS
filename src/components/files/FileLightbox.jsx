import React, { useState } from "react";
import { createPortal } from "react-dom";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, MessageSquare, X, Send } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function FileLightbox({ file, onClose }) {
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [commentData, setCommentData] = useState({
    comment_text: "",
    mentioned_user: "",
    file_status: "none"
  });
  const queryClient = useQueryClient();

  const { data: comments = [] } = useQuery({
    queryKey: ['fileComments', file.id],
    queryFn: () => dataClient.entities.FileComment.filter({ file_id: file.id }, '-created_date', 100),
    enabled: !!file.id
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => dataClient.entities.User.list('-created_date', 100)
  });

  const mentionableUsers = users.filter(isAssignableTeamUser);

  const createCommentMutation = useMutation({
    mutationFn: (data) => dataClient.entities.FileComment.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fileComments', file.id] });
      setShowCommentForm(false);
      setCommentData({ comment_text: "", mentioned_user: "", file_status: "none" });
      toast.success("Comment added!");
    }
  });

  const handleAddComment = () => {
    if (!commentData.comment_text.trim()) {
      toast.error("Please enter a comment");
      return;
    }
    createCommentMutation.mutate({
      ...commentData,
      file_id: file.id
    });
  };

  const fileUrl = file.file_url || file.url || file.fileUrl || "";
  const fileName = file.title || file.name || file.file_name || "";
  const fileType = file.file_type || file.mime_type || file.type || "";
  const imagePattern = /\.(jpg|jpeg|png|gif|webp|svg)(\?|#|$)/i;
  const pdfPattern = /\.pdf(\?|#|$)/i;
  const isImage = fileType.startsWith("image/") || imagePattern.test(fileUrl) || imagePattern.test(fileName);
  const isPdf = fileType === "application/pdf" || pdfPattern.test(fileUrl) || pdfPattern.test(fileName);

  const statusColors = {
    needs_fix: "bg-red-100 text-red-700",
    approved: "bg-green-100 text-green-700",
    pending_review: "bg-yellow-100 text-yellow-700",
    none: "bg-slate-100 text-slate-700"
  };

  const lightbox = (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-3 sm:p-5" role="dialog" aria-modal="true">
      <button className="absolute inset-0 cursor-default" aria-label="Close preview" onClick={onClose} />
      <div className="relative flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950">{fileName || "File preview"}</p>
            <p className="text-xs text-slate-500">In-app preview</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 rounded-full">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white">
          {/* File Preview */}
          <div className="flex min-h-[68vh] items-center justify-center bg-slate-100 p-3 sm:p-5">
            {isImage && !imgError ? (
              <img
                src={fileUrl}
                alt={fileName || "File preview"}
                className="max-h-[76vh] w-auto max-w-full rounded-lg bg-white object-contain shadow-sm"
                onError={() => setImgError(true)}
              />
            ) : isImage && imgError ? (
              <div className="text-center text-slate-500">
                <p className="mb-2 text-sm font-medium">Image could not be loaded</p>
                <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary text-xs underline">Open original URL</a>
              </div>
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

          <div className="space-y-4 p-4">
            {/* Download Button */}
            <Button asChild variant="outline" className="w-full rounded-xl">
              <a href={fileUrl} download target="_blank" rel="noopener noreferrer">
                <Download className="w-4 h-4 mr-2" /> Download File
              </a>
            </Button>

            {/* Comments Section */}
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
                        <SelectItem value="">None</SelectItem>
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
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(lightbox, document.body);
}
