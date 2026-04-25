import React, { useState } from "react";
import { format } from "date-fns";
import {
  X, Clock, Paperclip, Archive, Edit2, Send
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { dataClient } from "@/api/dataClient";
import { toast } from "sonner";

const STATUSES = ["pending", "in_progress", "done"];
const PRIORITIES = ["urgent", "high", "medium", "low"];

export default function TaskDrawer({ task, onClose, onUpdate, onArchive }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...task });
  const [newComment, setNewComment] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiveInput, setArchiveInput] = useState("");

  const handleSave = () => {
    onUpdate(form);
    setEditing(false);
  };

  const addComment = async () => {
    if (!newComment.trim()) return;

    const user = await dataClient.auth.me().catch(() => null);

    const comment = {
      author: user?.full_name || user?.email || "Unknown",
      text: newComment,
      timestamp: new Date().toISOString(),
    };

    const updated = {
      comments: [...(task.comments || []), comment],
    };

    onUpdate(updated);
    setNewComment("");
    toast.success("Comment added");
  };

  const uploadFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);

    try {
      const { file_url } = await dataClient.integrations.Core.UploadFile({ file });

      const updated = {
        file_urls: [...(task.file_urls || []), file_url],
      };

      onUpdate(updated);
      toast.success("File uploaded");
    } catch (err) {
      toast.error("Upload failed");
    }

    setUploading(false);
  };

  // ✅ FIXED ARCHIVE FUNCTION (THIS WAS THE MAIN BUG)
 const handleArchive = () => {
  if (onArchive) {
    onArchive();
  }
};

  const statusConfig = {
    pending: "bg-amber-100 text-amber-700",
    in_progress: "bg-blue-100 text-blue-700",
    done: "bg-green-100 text-green-700",
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-card z-50 flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <span className={`text-xs px-2 py-1 rounded ${statusConfig[task.status]}`}>
            {task.status}
          </span>

          <div className="flex gap-2">
            <button onClick={() => setEditing(!editing)}>
              <Edit2 className="w-4 h-4" />
            </button>

            <button onClick={onClose}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">

          {editing ? (
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="text-lg"
            />
          ) : (
            <h2 className="text-lg font-bold">{task.title}</h2>
          )}

          {/* Comments */}
          <div className="mt-6">
            <h3 className="text-xs uppercase mb-2">Comments</h3>

            {task.comments?.map((c, i) => (
              <div key={i} className="text-xs p-2 bg-muted rounded mb-2">
                <b>{c.author}</b>: {c.text}
              </div>
            ))}

            <div className="flex gap-2 mt-2">
              <Input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Comment..."
                onKeyDown={(e) => e.key === "Enter" && addComment()}
              />
              <Button onClick={addComment}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t">

          {showArchiveConfirm ? (
            <div className="space-y-2">
              <Input
                value={archiveInput}
                onChange={(e) => setArchiveInput(e.target.value)}
                placeholder="Type DELETE"
              />

              <div className="flex gap-2">
                <Button onClick={() => setShowArchiveConfirm(false)}>
                  Cancel
                </Button>

                <Button
                  disabled={archiveInput !== "DELETE"}
                  onClick={handleArchive}
                  variant="destructive"
                >
                  Archive
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowArchiveConfirm(true)}
              className="flex items-center gap-2 text-xs"
            >
              <Archive className="w-4 h-4" />
              Archive task
            </button>
          )}
        </div>

      </div>
    </>
  );
}