import { useState } from "react";
import { Archive, X, Save, Paperclip, ChevronDown, ChevronUp, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { dataClient } from "@/api/dataClient";
import { toast } from "sonner";
import CommentThread from "@/components/common/CommentThread";
import MediaPreview from "@/components/common/MediaPreview";

const STATUSES = ["not_started", "in_progress", "on_hold", "complete"];
const PRIORITIES = ["urgent", "high", "medium", "normal", "low"];
const PROD_TYPES = ["single", "bulk", "x1_sample_pack", "alethea"];
const PROD_STAGES = ["design","sourcing","sampling","cutting","printing","pressing","finishing","packing","delivery","other"];

const statusConfig = {
  not_started: "bg-slate-100 text-slate-700",
  in_progress:  "bg-primary/10 text-primary",
  on_hold:      "bg-orange-100 text-orange-700",
  complete:     "bg-green-100 text-green-700",
};

const priorityConfig = {
  urgent: "bg-red-100 text-red-700",
  high:   "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700",
  normal: "bg-slate-100 text-slate-600",
  low:    "bg-slate-100 text-slate-400",
};

export default function TaskDrawer({ task, users = [], onClose, onUpdate, onArchive }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title || "");
  const [showDetails, setShowDetails] = useState(true);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiveInput, setArchiveInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");

  const saveTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== task.title) onUpdate({ title: trimmed });
    setEditingTitle(false);
  };

  const set = (field, value) => onUpdate({ [field]: value });

  const uploadFile = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of files) {
        const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
        uploaded.push({ name: file.name, url: file_url, type: file.type });
      }
      const existing = task.supporting_files || [];
      onUpdate({ supporting_files: [...existing, ...uploaded] });
      toast.success(uploaded.length === 1 ? "File uploaded" : `${uploaded.length} files uploaded`);
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const addSubtask = () => {
    if (!newSubtask.trim()) return;
    const updated = [...(task.subtasks || []), { id: Date.now().toString(), name: newSubtask.trim(), completed: false }];
    onUpdate({ subtasks: updated });
    setNewSubtask("");
  };

  const toggleSubtask = (id) => {
    const updated = (task.subtasks || []).map(s => s.id === id ? { ...s, completed: !s.completed } : s);
    onUpdate({ subtasks: updated });
  };

  const removeSubtask = (id) => {
    onUpdate({ subtasks: (task.subtasks || []).filter(s => s.id !== id) });
  };

  const assignedUsers = users.filter(u =>
    Array.isArray(task.assigned_to)
      ? task.assigned_to.includes(u.email)
      : u.email === task.assigned_to
  );

  const toggleAssignee = (email) => {
    const current = Array.isArray(task.assigned_to) ? task.assigned_to : task.assigned_to ? [task.assigned_to] : [];
    const next = current.includes(email) ? current.filter(e => e !== email) : [...current, email];
    onUpdate({ assigned_to: next });
  };

  const subtasksDone = (task.subtasks || []).filter(s => s.completed).length;
  const subtasksTotal = (task.subtasks || []).length;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col bg-card shadow-xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusConfig[task.status] || statusConfig.not_started}`}>
              {task.status?.replace(/_/g, ' ')}
            </span>
            {task.priority && (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${priorityConfig[task.priority] || ''}`}>
                {task.priority}
              </span>
            )}
            {subtasksTotal > 0 && (
              <span className="text-xs text-muted-foreground">{subtasksDone}/{subtasksTotal} subtasks</span>
            )}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center hover:bg-border transition-all flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Title — click to edit inline */}
          <div className="px-4 pt-4 pb-2">
            {editingTitle ? (
              <div className="flex gap-2">
                <Input
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={e => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") { setTitleDraft(task.title); setEditingTitle(false); } }}
                  className="text-lg font-bold rounded-xl flex-1"
                  autoFocus
                />
                <Button size="sm" onClick={saveTitle} className="rounded-xl gap-1">
                  <Save className="w-3.5 h-3.5" /> Save
                </Button>
              </div>
            ) : (
              <button
                className="text-left w-full group"
                onClick={() => { setTitleDraft(task.title || ""); setEditingTitle(true); }}
                title="Click to rename"
              >
                <h2 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors leading-snug">
                  {task.title}
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5 group-hover:text-primary/70">click to rename</p>
              </button>
            )}
            {task.order_id && (
              <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-lg bg-primary/8 border border-primary/15 w-fit">
                <Link2 className="w-3 h-3 text-primary flex-shrink-0" />
                <span className="text-xs text-primary font-medium">
                  {task.notes?.startsWith('Order #') ? task.notes.split('—')[0].trim() : 'Linked to order'}
                </span>
              </div>
            )}
          </div>

          {/* Quick status + priority toggles */}
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            <div className="flex-1 min-w-[120px]">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Status</label>
              <Select value={task.status || "not_started"} onValueChange={v => set("status", v)}>
                <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Priority</label>
              <Select value={task.priority || "medium"} onValueChange={v => set("priority", v)}>
                <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map(p => <SelectItem key={p} value={p} className="text-xs capitalize">{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Due Date</label>
              <Input
                type="date"
                value={task.due_date || task.deadline || ""}
                onChange={e => onUpdate({ due_date: e.target.value, deadline: e.target.value })}
                className="h-8 rounded-lg text-xs"
              />
            </div>
          </div>

          {/* Collapsible details section */}
          <div className="border-t border-border">
            <button
              onClick={() => setShowDetails(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:bg-secondary/30 transition-all"
            >
              Details & Links
              {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showDetails && (
              <div className="px-4 pb-4 space-y-3">
                {/* Production type + stage */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Type</label>
                    <Select value={task.production_type || "_none"} onValueChange={v => set("production_type", v === "_none" ? null : v)}>
                      <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none" className="text-xs">None</SelectItem>
                        {PROD_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t.replace(/_/g,' ')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Stage</label>
                    <Select value={task.production_stage || "_none"} onValueChange={v => set("production_stage", v === "_none" ? null : v)}>
                      <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none" className="text-xs">None</SelectItem>
                        {PROD_STAGES.map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Client name */}
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Client</label>
                  <Input
                    value={task.client_name || ""}
                    onChange={e => set("client_name", e.target.value)}
                    placeholder="Client name..."
                    className="h-8 rounded-lg text-xs"
                    onBlur={e => set("client_name", e.target.value)}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Description</label>
                  <Textarea
                    defaultValue={task.description || ""}
                    placeholder="Add details..."
                    rows={2}
                    className="rounded-lg text-sm resize-none"
                    onBlur={e => set("description", e.target.value)}
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Notes</label>
                  <Textarea
                    defaultValue={task.notes || ""}
                    placeholder="Internal notes..."
                    rows={2}
                    className="rounded-lg text-sm resize-none"
                    onBlur={e => set("notes", e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Assigned team members */}
          <div className="border-t border-border px-4 py-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Assigned To</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {assignedUsers.length === 0 && (
                <span className="text-xs text-muted-foreground">Unassigned</span>
              )}
              {assignedUsers.map(u => (
                <button
                  key={u.id}
                  onClick={() => toggleAssignee(u.email)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium hover:bg-red-50 hover:text-red-600 transition-colors"
                  title="Click to remove"
                >
                  {u.full_name?.split(' ')[0] || u.email}
                  <X className="w-3 h-3" />
                </button>
              ))}
            </div>
            <details className="group">
              <summary className="text-xs text-primary cursor-pointer list-none hover:underline">
                + Add / remove team members
              </summary>
              <div className="mt-2 border rounded-xl p-2 max-h-36 overflow-y-auto space-y-1 bg-secondary/20">
                {users.filter(u => u.is_active !== false).map(u => (
                  <label key={u.id || u.email} className="flex items-center gap-2 cursor-pointer p-1 rounded-lg hover:bg-secondary/50">
                    <Checkbox
                      checked={Array.isArray(task.assigned_to) ? task.assigned_to.includes(u.email) : task.assigned_to === u.email}
                      onCheckedChange={() => toggleAssignee(u.email)}
                    />
                    <span className="text-sm">{u.full_name || u.name || u.email}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>

          {/* Subtasks */}
          <div className="border-t border-border px-4 py-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Subtasks {subtasksTotal > 0 && `(${subtasksDone}/${subtasksTotal})`}
            </p>
            <div className="space-y-1 mb-2">
              {(task.subtasks || []).map(s => (
                <div key={s.id} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-secondary/30 group">
                  <Checkbox checked={s.completed} onCheckedChange={() => toggleSubtask(s.id)} />
                  <span className={`text-sm flex-1 ${s.completed ? "line-through text-muted-foreground" : ""}`}>{s.name}</span>
                  <button onClick={() => removeSubtask(s.id)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newSubtask}
                onChange={e => setNewSubtask(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addSubtask()}
                placeholder="Add subtask…"
                className="h-8 rounded-lg text-xs flex-1"
              />
              <Button size="sm" onClick={addSubtask} variant="outline" className="h-8 rounded-lg text-xs">Add</Button>
            </div>
          </div>

          {/* Attachments */}
          <div className="border-t border-border px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Attachments</p>
              <label className="cursor-pointer text-xs text-primary hover:underline">
                {uploading ? "Uploading…" : <><Paperclip className="w-3 h-3 inline mr-1" />Upload</>}
                <input type="file" className="hidden" multiple onChange={uploadFile} disabled={uploading} />
              </label>
            </div>
            {(task.supporting_files || task.file_urls || []).length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {(task.supporting_files || []).map((f, i) => (
                  <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"
                    className="flex flex-col items-center gap-1 p-2 rounded-xl bg-secondary/40 hover:bg-secondary/70 text-center">
                    <Paperclip className="w-4 h-4 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground truncate w-full text-center">{f.name}</span>
                  </a>
                ))}
                {(task.file_urls || []).map((url, i) => (
                  <MediaPreview key={url} url={url} title={`File ${i + 1}`} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-3 rounded-xl bg-secondary/30">No files attached</p>
            )}
          </div>

          {/* Comments */}
          <div className="border-t border-border px-4 py-3 pb-4">
            <CommentThread
              comments={task.comments || []}
              users={users}
              onChange={comments => onUpdate({ comments })}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border p-3 flex-shrink-0">
          {showArchiveConfirm ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Type DELETE to confirm archiving this task</p>
              <Input value={archiveInput} onChange={e => setArchiveInput(e.target.value)} placeholder="DELETE" className="h-8 rounded-lg text-sm" />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 rounded-lg" onClick={() => setShowArchiveConfirm(false)}>Cancel</Button>
                <Button size="sm" variant="destructive" className="flex-1 rounded-lg" disabled={archiveInput !== "DELETE"} onClick={onArchive}>Archive</Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowArchiveConfirm(true)}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-destructive transition-colors w-full justify-center py-1"
            >
              <Archive className="h-3.5 w-3.5" /> Archive task
            </button>
          )}
        </div>
      </div>
    </>
  );
}
