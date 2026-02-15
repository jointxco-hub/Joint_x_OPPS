import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, MessageSquare, X, Send } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function FileLightbox({ file, onClose }) {
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [commentData, setCommentData] = useState({
    comment_text: "",
    mentioned_user: "",
    file_status: "none"
  });
  const queryClient = useQueryClient();

  const { data: comments = [] } = useQuery({
    queryKey: ['fileComments', file.id],
    queryFn: () => base44.entities.FileComment.filter({ file_id: file.id }, '-created_date', 100),
    enabled: !!file.id
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list('-created_date', 100)
  });

  const createCommentMutation = useMutation({
    mutationFn: (data) => base44.entities.FileComment.create(data),
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

  const isImage = file.file_url?.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
  const isPdf = file.file_url?.match(/\.pdf$/i);

  const statusColors = {
    needs_fix: "bg-red-100 text-red-700",
    approved: "bg-green-100 text-green-700",
    pending_review: "bg-yellow-100 text-yellow-700",
    none: "bg-slate-100 text-slate-700"
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="truncate pr-4">{file.title}</span>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* File Preview */}
          <div className="bg-slate-50 rounded-lg p-4 flex items-center justify-center min-h-[300px]">
            {isImage ? (
              <img 
                src={file.file_url} 
                alt={file.title}
                className="max-w-full max-h-[500px] object-contain rounded"
              />
            ) : isPdf ? (
              <iframe 
                src={file.file_url}
                className="w-full h-[500px] rounded border"
                title={file.title}
              />
            ) : (
              <div className="text-center">
                <p className="text-slate-500 mb-4">Preview not available</p>
                <Button asChild>
                  <a href={file.file_url} target="_blank" rel="noopener noreferrer">
                    <Download className="w-4 h-4 mr-2" /> Download File
                  </a>
                </Button>
              </div>
            )}
          </div>

          {/* Download Button */}
          <Button asChild variant="outline" className="w-full">
            <a href={file.file_url} download target="_blank" rel="noopener noreferrer">
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
                        <SelectItem value={null}>None</SelectItem>
                        {users.map(user => (
                          <SelectItem key={user.id} value={user.email}>
                            {user.full_name || user.email}
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
      </DialogContent>
    </Dialog>
  );
}