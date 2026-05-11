import React, { useState } from "react";
import { Archive, Edit2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dataClient } from "@/api/dataClient";
import { toast } from "sonner";
import CommentThread from "@/components/common/CommentThread";
import MediaPreview from "@/components/common/MediaPreview";

const STATUSES = ["pending", "in_progress", "done"];
const PRIORITIES = ["urgent", "high", "medium", "normal", "low"];
const DEPARTMENTS = ["operations", "design", "production", "sales", "finance", "admin"];

export default function TaskDrawer({ task, users = [], onClose, onUpdate, onArchive }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...task });
  const [uploading, setUploading] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiveInput, setArchiveInput] = useState("");

  const statusConfig = {
    pending: "bg-amber-100 text-amber-700",
    in_progress: "bg-blue-100 text-blue-700",
    done: "bg-green-100 text-green-700",
  };

  const handleSave = () => {
    onUpdate(form);
    setEditing(false);
  };

  const uploadFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
      onUpdate({ file_urls: [...(task.file_urls || []), file_url] });
      toast.success("File uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const updateAssignee = (value) => {
    const user = users.find((item) => (item.email || item.user_email) === value);
    setForm({
      ...form,
      assigned_to: value === "_none" ? "" : value,
      assigned_to_name: value === "_none" ? "" : user?.full_name || user?.name || "",
      assigned_user_id: value === "_none" ? "" : user?.id,
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col bg-card shadow-apple-xl">
        <div className="flex items-center justify-between border-b p-5">
          <span className={`rounded px-2 py-1 text-xs ${statusConfig[task.status] || statusConfig.pending}`}>
            {task.status}
          </span>
          <div className="flex gap-2">
            <button onClick={() => setEditing((value) => !value)} title="Edit task">
              <Edit2 className="h-4 w-4" />
            </button>
            <button onClick={onClose} title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {editing ? (
            <div className="space-y-4">
              <Field label="Title">
                <Input value={form.title || ""} onChange={(event) => setForm({ ...form, title: event.target.value })} className="text-lg" />
              </Field>
              <Field label="Description">
                <Textarea value={form.description || ""} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status">
                  <Select value={form.status || "pending"} onValueChange={(value) => setForm({ ...form, status: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((item) => <SelectItem key={item} value={item}>{item.replace("_", " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select value={form.priority || "medium"} onValueChange={(value) => setForm({ ...form, priority: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIORITIES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Department">
                  <Select value={form.department || "operations"} onValueChange={(value) => setForm({ ...form, department: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DEPARTMENTS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Deadline">
                  <Input type="date" value={form.deadline || form.due_date || ""} onChange={(event) => setForm({ ...form, deadline: event.target.value })} />
                </Field>
              </div>
              <Field label="Assigned To">
                <Select value={form.assigned_to || "_none"} onValueChange={updateAssignee}>
                  <SelectTrigger><SelectValue placeholder="Assign team member" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Unassigned</SelectItem>
                    {users.filter((user) => user.is_active !== false).map((user) => (
                      <SelectItem key={user.id || user.email} value={user.email || user.user_email}>
                        {user.full_name || user.name || user.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button onClick={handleSave} className="w-full gap-2 rounded-xl">
                <Save className="h-4 w-4" />
                Save task details
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold">{task.title}</h2>
                {task.description && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p>}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Info label="Department" value={task.department || "general"} />
                <Info label="Assigned" value={task.assigned_to_name || task.assigned_to || "Unassigned"} />
                <Info label="Deadline" value={task.deadline || task.due_date || "No date"} />
                <Info label="Priority" value={task.priority || "normal"} />
              </div>
            </div>
          )}

          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attachments</h3>
              <label className="cursor-pointer text-xs text-primary">
                {uploading ? "Uploading..." : "Upload"}
                <input type="file" className="hidden" onChange={uploadFile} disabled={uploading} />
              </label>
            </div>
            {(task.file_urls || []).length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {(task.file_urls || []).map((url, index) => <MediaPreview key={url} url={url} title={`Task file ${index + 1}`} />)}
              </div>
            ) : (
              <p className="rounded-xl bg-secondary/40 px-3 py-4 text-center text-xs text-muted-foreground">No files attached</p>
            )}
          </div>

          <div className="mt-6">
            <CommentThread
              comments={task.comments || []}
              users={users}
              onChange={(comments) => onUpdate({ comments })}
            />
          </div>
        </div>

        <div className="border-t p-4">
          {showArchiveConfirm ? (
            <div className="space-y-2">
              <Input value={archiveInput} onChange={(event) => setArchiveInput(event.target.value)} placeholder="Type DELETE" />
              <div className="flex gap-2">
                <Button onClick={() => setShowArchiveConfirm(false)}>Cancel</Button>
                <Button disabled={archiveInput !== "DELETE"} onClick={onArchive} variant="destructive">Archive</Button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowArchiveConfirm(true)} className="flex items-center gap-2 text-xs">
              <Archive className="h-4 w-4" />
              Archive task
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-xl bg-secondary/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium capitalize">{value}</p>
    </div>
  );
}
