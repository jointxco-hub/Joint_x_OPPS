import React, { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dataClient } from "@/api/dataClient";
import { toast } from "sonner";

export default function NewTaskForm({ onClose, onCreate }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    status: "pending",
    priority: "medium",
    department: "",
    deadline: "",
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error("Task title is required"); return; }
    setLoading(true);
    await dataClient.entities.Task.create({ ...form, is_archived: false });
    setLoading(false);
    onCreate();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-card shadow-apple-xl z-50 flex flex-col animate-slide-in-right">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold text-foreground">New Task</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center hover:bg-border transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Task Title *</label>
            <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="What needs to be done?" className="rounded-xl" required autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Description</label>
            <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="Add details..." className="rounded-xl resize-none h-20" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Priority</label>
              <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["urgent", "high", "medium", "low"].map(p => (
                    <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Department</label>
              <Select value={form.department} onValueChange={v => setForm({ ...form, department: v })}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {["operations", "design", "production", "sales", "finance", "admin"].map(d => (
                    <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Deadline</label>
            <Input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })}
              className="rounded-xl" />
          </div>
        </form>
        <div className="p-5 border-t border-border">
          <Button onClick={handleSubmit} className="w-full rounded-xl" disabled={loading}>
            {loading ? "Creating..." : "Create Task"}
          </Button>
        </div>
      </div>
    </>
  );
}
