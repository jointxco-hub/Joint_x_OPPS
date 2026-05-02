import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Users, Paperclip, Plus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const STAGES = ['design', 'sourcing', 'sampling', 'cutting', 'printing', 'pressing', 'finishing', 'packing', 'delivery', 'other'];

export default function OpsTaskFormDialog({ task, users, clients, orders, projects, aletheaProjects, onClose, onSubmit, defaultDate }) {
  const [formData, setFormData] = useState(task ? { ...task } : {
    title: "",
    description: "",
    production_type: "",
    status: "not_started",
    priority: "medium",
    start_date: undefined,
    due_date: defaultDate || undefined,
    assigned_to: [],
    client_id: "",
    client_name: "",
    order_id: "",
    project_id: "",
    alethea_project_id: "",
    production_stage: "",
    deliverables: "",
    notes: "",
    week_number: 1,
    day_of_week: "monday",
    supporting_files: [],
    subtasks: [],
    comments: []
  });

  const [selectedUsers, setSelectedUsers] = useState(
    Array.isArray(task?.assigned_to) ? task.assigned_to : task?.assigned_to ? [task.assigned_to] : []
  );
  const [newFileUrl, setNewFileUrl] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [newComment, setNewComment] = useState("");

  const toggleUser = (email) => {
    setSelectedUsers(prev => prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]);
  };

  const handleClientChange = (clientId) => {
    const client = clients.find(c => c.id === clientId);
    setFormData({ ...formData, client_id: clientId, client_name: client?.name || "" });
  };

  const handleAddFileUrl = () => {
    if (!newFileUrl.trim()) return;
    const file = { name: newFileName || newFileUrl, url: newFileUrl, type: "link" };
    setFormData({ ...formData, supporting_files: [...(formData.supporting_files || []), file] });
    setNewFileUrl(""); setNewFileName("");
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
    const newFile = { name: file.name, url: file_url, type: file.type };
    setFormData(prev => ({ ...prev, supporting_files: [...(prev.supporting_files || []), newFile] }));
    setUploading(false);
    toast.success("File uploaded");
  };

  const removeFile = (idx) => {
    setFormData({ ...formData, supporting_files: formData.supporting_files.filter((_, i) => i !== idx) });
  };

  const addComment = () => {
    if (!newComment.trim()) return;
    const comment = {
      id: Date.now().toString(),
      author_email: "",
      author_name: "You",
      text: newComment,
      created_at: new Date().toISOString()
    };
    setFormData({ ...formData, comments: [...(formData.comments || []), comment] });
    setNewComment("");
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ ...formData, assigned_to: selectedUsers });
  };

  const set = (key, val) => setFormData(prev => ({ ...prev, [key]: val }));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit Task' : 'New Ops Task'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            placeholder="Task title *"
            value={formData.title}
            onChange={(e) => set('title', e.target.value)}
            required
          />

          <Textarea
            placeholder="Description / brief"
            value={formData.description}
            onChange={(e) => set('description', e.target.value)}
            rows={2}
          />

          {/* Production Type + Stage */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Production Type</label>
              <Select value={formData.production_type} onValueChange={(v) => set('production_type', v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single</SelectItem>
                  <SelectItem value="bulk">Bulk</SelectItem>
                  <SelectItem value="x1_sample_pack">X1 Sample Pack</SelectItem>
                  <SelectItem value="alethea">Alethea</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Production Stage</label>
              <Select value={formData.production_stage} onValueChange={(v) => set('production_stage', v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {STAGES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Status + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Status</label>
              <Select value={formData.status} onValueChange={(v) => set('status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">Not Started</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="on_hold">On Hold</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Priority</label>
              <Select value={formData.priority} onValueChange={(v) => set('priority', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Dates + Week + Day */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Start Date</label>
              <Input type="date" value={formData.start_date} onChange={(e) => set('start_date', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Due Date</label>
              <Input type="date" value={formData.due_date} onChange={(e) => set('due_date', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Calendar Week</label>
              <Select value={String(formData.week_number)} onValueChange={(v) => set('week_number', parseInt(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[...Array(52)].map((_, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>Week {i + 1}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Day</label>
              <Select value={formData.day_of_week} onValueChange={(v) => set('day_of_week', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAYS.map(d => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Team Assignment */}
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> Assign Team Members
            </label>
            <div className="border rounded-lg p-3 max-h-36 overflow-y-auto space-y-2 bg-slate-50">
              {users.length === 0 && <p className="text-xs text-slate-400">No users found</p>}
              {users.map(u => (
                <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={selectedUsers.includes(u.email)} onCheckedChange={() => toggleUser(u.email)} />
                  <span className="text-sm">{u.full_name || u.email}</span>
                </label>
              ))}
            </div>
            {selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {selectedUsers.map(email => {
                  const u = users.find(x => x.email === email);
                  return <Badge key={email} variant="outline" className="text-xs">{u?.full_name || email}</Badge>;
                })}
              </div>
            )}
          </div>

          {/* Client + Order + Project links */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Client</label>
              <Select value={formData.client_id} onValueChange={handleClientChange}>
                <SelectTrigger><SelectValue placeholder="Link client..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {!formData.client_id && (
                <Input
                  className="mt-1 h-8 text-xs"
                  placeholder="Or type client name..."
                  value={formData.client_name}
                  onChange={(e) => set('client_name', e.target.value)}
                />
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Link Order</label>
              <Select value={formData.order_id} onValueChange={(v) => set('order_id', v)}>
                <SelectTrigger><SelectValue placeholder="Optional..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {orders.map(o => <SelectItem key={o.id} value={o.id}>{o.order_number} – {o.client_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Link Project</label>
              <Select value={formData.project_id} onValueChange={(v) => set('project_id', v)}>
                <SelectTrigger><SelectValue placeholder="Optional..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Link Alethea Project</label>
              <Select value={formData.alethea_project_id} onValueChange={(v) => set('alethea_project_id', v)}>
                <SelectTrigger><SelectValue placeholder="Optional..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {aletheaProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Deliverables */}
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Deliverables</label>
            <Textarea
              placeholder="What needs to be delivered..."
              value={formData.deliverables}
              onChange={(e) => set('deliverables', e.target.value)}
              rows={2}
            />
          </div>

          {/* Supporting Files */}
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block flex items-center gap-1">
              <Paperclip className="w-3.5 h-3.5" /> Supporting Files & Links
            </label>
            <div className="space-y-2">
              {(formData.supporting_files || []).map((f, i) => (
                <div key={i} className="flex items-center gap-2 bg-slate-50 rounded p-2">
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 flex-1 truncate hover:underline">{f.name}</a>
                  <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeFile(i)}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input className="h-7 text-xs flex-1" placeholder="File name" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} />
                <Input className="h-7 text-xs flex-1" placeholder="URL / link" value={newFileUrl} onChange={(e) => setNewFileUrl(e.target.value)} />
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={handleAddFileUrl}>
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
                Upload file...
                <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
              </label>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Notes</label>
            <Textarea
              placeholder="Internal notes..."
              value={formData.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
            />
          </div>

          {/* Comments */}
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Comments</label>
            <div className="space-y-1 mb-2 max-h-24 overflow-y-auto">
              {(formData.comments || []).map((c, i) => (
                <div key={i} className="bg-slate-50 rounded p-2">
                  <p className="text-xs font-medium text-slate-700">{c.author_name}</p>
                  <p className="text-xs text-slate-600">{c.text}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                className="h-7 text-xs"
                placeholder="Add comment..."
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addComment())}
              />
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={addComment}>Add</Button>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">{task ? 'Update Task' : 'Create Task'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
