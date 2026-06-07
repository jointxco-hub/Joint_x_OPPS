import { useState } from "react";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createWithOfflineQueue } from "@/lib/offlineQueue";
import { toast } from "sonner";

export default function NewTaskForm({ users = [], onClose, onCreate }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [deadline, setDeadline] = useState("");
  const [productionType, setProductionType] = useState("");
  const [assignedTo, setAssignedTo] = useState("_none");
  const [showMore, setShowMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) { toast.error("Task title is required"); return; }
    setLoading(true);
    try {
      const payload = {
        title: trimmed,
        status: "not_started",
        priority,
        deadline: deadline || undefined,
        production_type: productionType || undefined,
        assigned_to: assignedTo && assignedTo !== "_none" ? [assignedTo] : [],
      };
      const created = await createWithOfflineQueue("OpsTask", payload);
      toast.success(created?.isQueuedOffline ? "Task saved offline. It will sync when online." : "Task created");
      onCreate(created);
    } catch (err) {
      toast.error(err?.message || "Failed to create task");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-sm bg-card shadow-xl z-50 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">New Task</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center hover:bg-border transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Title — the only required field */}
          <div>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="rounded-xl text-base h-11"
              autoFocus
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSubmit()}
            />
          </div>

          {/* Quick fields row */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="rounded-xl h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["urgent","high","medium","low"].map(p => (
                    <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Due Date</label>
              <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                className="rounded-xl h-9 text-sm" />
            </div>
          </div>

          {/* Expand for more options */}
          <button
            onClick={() => setShowMore(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {showMore ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showMore ? "Fewer options" : "More options (type, assignee)"}
          </button>

          {showMore && (
            <div className="space-y-3 pt-1 border-t border-border">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Type</label>
                <Select value={productionType || "_none"} onValueChange={v => setProductionType(v === "_none" ? "" : v)}>
                  <SelectTrigger className="rounded-xl h-9 text-sm"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">None</SelectItem>
                    {["single","bulk","x1_sample_pack","alethea"].map(t => (
                      <SelectItem key={t} value={t}>{t.replace(/_/g," ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Assign To</label>
                <Select value={assignedTo} onValueChange={setAssignedTo}>
                  <SelectTrigger className="rounded-xl h-9 text-sm"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Unassigned</SelectItem>
                    {users.filter(u => u.is_active !== false).map(u => (
                      <SelectItem key={u.id || u.email} value={u.email || u.user_email}>
                        {u.full_name || u.name || u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border">
          <Button onClick={handleSubmit} className="w-full rounded-xl h-10" disabled={loading || !title.trim()}>
            {loading ? "Creating…" : "Create Task"}
          </Button>
          <p className="text-center text-xs text-muted-foreground mt-2">Press Enter to save quickly — edit details after</p>
        </div>
      </div>
    </>
  );
}
