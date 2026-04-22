import React, { useState } from "react";
import { format } from "date-fns";
import {
  X, CheckCircle2, Clock, Flag, User, Calendar, MessageSquare,
  Paperclip, Archive, Edit2, ChevronDown, Plus, Send
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

export default function TaskDrawer({ task, orders, onClose, onUpdate, onArchive }) {
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
      author: user?.full_name || user?.email || 'Unknown',
      text: newComment,
      timestamp: new Date().toISOString()
    };
    const updated = { comments: [...(task.comments || []), comment] };
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
      const updated = { file_urls: [...(task.file_urls || []), file_url] };
      onUpdate(updated);
      toast.success("File uploaded");
    } catch {
      toast.error("Upload failed");
    }
    setUploading(false);
  };

  const statusConfig = {
    pending: "bg-amber-100 text-amber-700",
    in_progress: "bg-blue-100 text-blue-700",
    done: "bg-green-100 text-green-700",
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-card shadow-apple-xl z-50 flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusConfig[task.status] || 'bg-secondary text-muted-foreground'}`}>
              {(task.status || '').replace('_', ' ')}
            </span>
            {task.priority && (
              <Badge variant="outline" className="text-xs capitalize">{task.priority}</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(!editing)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center hover:bg-border transition-all">
              <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center hover:bg-border transition-all">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-5">
            {/* Title */}
            {editing ? (
              <Input value={form.title} onChange={e => setForm({...form, title: e.target.value})}
                className="text-lg font-semibold rounded-xl border-2 border-primary" />
            ) : (
              <h2 className="text-xl font-bold text-foreground">{task.title}</h2>
            )}

            {/* Description */}
            {editing ? (
              <Textarea value={form.description || ''} onChange={e => setForm({...form, description: e.target.value})}
                placeholder="Add description..." className="rounded-xl resize-none h-24" />
            ) : (
              task.description && <p className="text-sm text-muted-foreground leading-relaxed">{task.description}</p>
            )}

            {/* Fields */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                {editing ? (
                  <Select value={form.status} onValueChange={v => setForm({...form, status: v})}>
                    <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize text-xs">{s.replace('_',' ')}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <span className={`text-xs font-medium px-2 py-1 rounded-lg ${statusConfig[task.status] || 'bg-secondary text-muted-foreground'}`}>
                    {(task.status || '').replace('_', ' ')}
                  </span>
                )}
              </Field>
              <Field label="Priority">
                {editing ? (
                  <Select value={form.priority} onValueChange={v => setForm({...form, priority: v})}>
                    <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p} className="capitalize text-xs">{p}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <span className="text-xs font-medium capitalize text-foreground">{task.priority || '—'}</span>
                )}
              </Field>
              <Field label="Deadline">
                {editing ? (
                  <Input type="date" value={form.deadline || ''} onChange={e => setForm({...form, deadline: e.target.value})} className="h-8 rounded-lg text-xs" />
                ) : (
                  <span className="text-xs text-foreground">{task.deadline ? format(new Date(task.deadline), 'MMM d, yyyy') : '—'}</span>
                )}
              </Field>
              <Field label="Assigned To">
                <span className="text-xs text-foreground">{task.assigned_to_name || task.assigned_to || '—'}</span>
              </Field>
              {task.department && (
                <Field label="Department">
                  <span className="text-xs capitalize text-foreground">{task.department}</span>
                </Field>
              )}
              {task.linked_order_id && (
                <Field label="Linked Order">
                  <span className="text-xs text-primary font-medium">#{task.linked_order_id?.slice(0,8)}</span>
                </Field>
              )}
            </div>

            {editing && (
              <Button onClick={handleSave} className="w-full rounded-xl">Save Changes</Button>
            )}

            {/* Files */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Files</h3>
                <label className="cursor-pointer">
                  <span className="text-xs text-primary font-medium">{uploading ? 'Uploading...' : '+ Upload'}</span>
                  <input type="file" className="hidden" onChange={uploadFile} disabled={uploading} />
                </label>
              </div>
              {task.file_urls?.length > 0 ? (
                <div className="space-y-2">
                  {task.file_urls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 p-2.5 bg-secondary rounded-xl text-xs text-foreground hover:bg-border transition-all">
                      <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                      File {i + 1}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No files attached</p>
              )}
            </div>

            {/* Comments */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Comments</h3>
              {task.comments?.length > 0 && (
                <div className="space-y-3 mb-3">
                  {task.comments.map((c, i) => (
                    <div key={i} className="bg-secondary/50 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-foreground">{c.author}</span>
                        <span className="text-xs text-muted-foreground">{c.timestamp ? format(new Date(c.timestamp), 'MMM d, HH:mm') : ''}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{c.text}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input value={newComment} onChange={e => setNewComment(e.target.value)}
                  placeholder="Add a comment..." className="rounded-xl text-sm"
                  onKeyDown={e => e.key === 'Enter' && addComment()} />
                <Button size="icon" variant="outline" onClick={addComment} className="rounded-xl flex-shrink-0">
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-border">
          {showArchiveConfirm ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground text-center">Type <strong>DELETE</strong> to archive this task</p>
              <Input value={archiveInput} onChange={e => setArchiveInput(e.target.value)}
                placeholder="Type DELETE" className="rounded-xl text-center" />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowArchiveConfirm(false)} className="flex-1 rounded-xl">Cancel</Button>
                <Button variant="destructive" onClick={onArchive} disabled={archiveInput !== 'DELETE'} className="flex-1 rounded-xl">
                  Archive
                </Button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowArchiveConfirm(true)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-destructive transition-all mx-auto">
              <Archive className="w-3.5 h-3.5" /> Archive task
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Field({ label, children }) {
  return (
    <div className="bg-secondary/30 rounded-xl p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {children}
    </div>
  );
}
