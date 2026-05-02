import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  CheckCircle, Circle, Clock, ChevronDown, ChevronRight,
  Trash2, Pencil, Plus, Paperclip, MessageSquare, AlertTriangle, Archive
} from "lucide-react";

const statusColors = {
  not_started: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  complete: "bg-green-100 text-green-700",
  on_hold: "bg-orange-100 text-orange-700",
  archived: "bg-slate-100 text-slate-400"
};

const priorityColors = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-yellow-100 text-yellow-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700"
};

const productionTypeColors = {
  single: "bg-purple-100 text-purple-700",
  bulk: "bg-indigo-100 text-indigo-700",
  x1_sample_pack: "bg-pink-100 text-pink-700",
  alethea: "bg-teal-100 text-teal-700"
};

const productionTypeLabels = {
  single: "Single",
  bulk: "Bulk",
  x1_sample_pack: "X1 Sample Pack",
  alethea: "Alethea"
};

export default function OpsTaskCard({ task, users, onStatusToggle, onUpdate, onEdit, onDelete, onArchive }) {
  const [expanded, setExpanded] = useState(false);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [subtaskName, setSubtaskName] = useState("");

  const assignedUsers = users.filter(u =>
    Array.isArray(task.assigned_to) ? task.assigned_to.includes(u.email) : u.email === task.assigned_to
  );

  const completedSubtasks = (task.subtasks || []).filter(s => s.completed).length;
  const totalSubtasks = task.subtasks?.length || 0;

  const handleSubtaskToggle = (subtaskId) => {
    const updated = (task.subtasks || []).map(s =>
      s.id === subtaskId ? { ...s, completed: !s.completed } : s
    );
    onUpdate({ ...task, subtasks: updated });
  };

  const handleAddSubtask = () => {
    if (!subtaskName.trim()) return;
    const updated = [...(task.subtasks || []), {
      id: Date.now().toString(),
      name: subtaskName,
      completed: false,
      assigned_to: ""
    }];
    onUpdate({ ...task, subtasks: updated });
    setSubtaskName("");
    setShowSubtaskForm(false);
  };

  const handleDeleteSubtask = (subtaskId) => {
    onUpdate({ ...task, subtasks: (task.subtasks || []).filter(s => s.id !== subtaskId) });
  };

  const StatusIcon = task.status === 'complete' ? CheckCircle
    : task.status === 'in_progress' ? Clock
    : task.status === 'on_hold' ? AlertTriangle
    : Circle;

  const statusIconColor = task.status === 'complete' ? 'text-green-500'
    : task.status === 'in_progress' ? 'text-blue-500'
    : task.status === 'on_hold' ? 'text-orange-400'
    : 'text-slate-300';

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3 p-3">
        <button onClick={() => onStatusToggle(task)} className="mt-0.5 flex-shrink-0">
          <StatusIcon className={`w-5 h-5 ${statusIconColor}`} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold break-words ${task.status === 'complete' ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                {task.title}
              </p>
              {task.client_name && (
                <p className="text-xs text-slate-500 mt-0.5">Client: {task.client_name}</p>
              )}
              {task.due_date && (
                <p className="text-xs text-slate-400">Due: {task.due_date}</p>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {totalSubtasks > 0 && (
                <span className="text-xs px-2 py-0.5 bg-slate-100 rounded-full font-medium">
                  {completedSubtasks}/{totalSubtasks}
                </span>
              )}
              {(task.supporting_files?.length > 0) && (
                <Paperclip className="w-3.5 h-3.5 text-slate-400" />
              )}
              {(task.comments?.length > 0) && (
                <span className="flex items-center gap-0.5 text-xs text-slate-400">
                  <MessageSquare className="w-3 h-3" />
                  {task.comments.length}
                </span>
              )}
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setExpanded(!expanded)}>
                {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 mt-2">
            {task.production_type && (
              <Badge className={`text-xs ${productionTypeColors[task.production_type]} border-0`}>
                {productionTypeLabels[task.production_type]}
              </Badge>
            )}
            <Badge className={`text-xs ${priorityColors[task.priority]} border-0`}>{task.priority}</Badge>
            <Badge className={`text-xs ${statusColors[task.status]} border-0`}>{task.status?.replace('_', ' ')}</Badge>
            {task.production_stage && (
              <Badge className="text-xs bg-slate-100 text-slate-600 border-0">{task.production_stage}</Badge>
            )}
            {assignedUsers.map(u => (
              <span key={u.id} className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full">
                {u.full_name || u.email}
              </span>
            ))}
          </div>
        </div>

        <div className="flex gap-1 flex-shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5 text-slate-400" />
          </Button>
          {onArchive && task.status !== 'archived' && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onArchive} title="Archive">
              <Archive className="w-3.5 h-3.5 text-slate-400" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 space-y-3 border-t border-slate-100 pt-3">
          {task.description && (
            <p className="text-xs text-slate-600 bg-slate-50 rounded p-2">{task.description}</p>
          )}
          {task.deliverables && (
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-1">Deliverables</p>
              <p className="text-xs text-slate-600 bg-amber-50 rounded p-2">{task.deliverables}</p>
            </div>
          )}

          {/* Subtasks */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-700">Subtasks</p>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowSubtaskForm(!showSubtaskForm)}>
                <Plus className="w-3 h-3 mr-1" /> Add
              </Button>
            </div>
            {showSubtaskForm && (
              <div className="flex gap-2 mb-2">
                <Input
                  placeholder="Subtask name"
                  value={subtaskName}
                  onChange={(e) => setSubtaskName(e.target.value)}
                  className="h-7 text-xs"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddSubtask()}
                />
                <Button size="sm" className="h-7 text-xs" onClick={handleAddSubtask}>Add</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowSubtaskForm(false)}>✕</Button>
              </div>
            )}
            {(task.subtasks || []).map(s => (
              <div key={s.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded mb-1">
                <Checkbox checked={s.completed} onCheckedChange={() => handleSubtaskToggle(s.id)} />
                <span className={`text-xs flex-1 ${s.completed ? 'line-through text-slate-400' : ''}`}>{s.name}</span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleDeleteSubtask(s.id)}>
                  <Trash2 className="w-3 h-3 text-red-400" />
                </Button>
              </div>
            ))}
          </div>

          {/* Files */}
          {(task.supporting_files || []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-1">Files & Links</p>
              <div className="space-y-1">
                {task.supporting_files.map((f, i) => (
                  <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-blue-600 hover:underline bg-blue-50 rounded p-1.5">
                    <Paperclip className="w-3 h-3" />
                    {f.name}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {task.notes && (
            <div className="p-2 bg-yellow-50 border border-yellow-100 rounded text-xs text-slate-700">
              <p className="font-semibold text-slate-700 mb-1">Notes</p>
              {task.notes}
            </div>
          )}

          {/* Comments */}
          {(task.comments || []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-1">Comments</p>
              <div className="space-y-1">
                {task.comments.map((c, i) => (
                  <div key={i} className="bg-slate-50 rounded p-2">
                    <p className="text-xs font-medium text-slate-700">{c.author_name || c.author_email}</p>
                    <p className="text-xs text-slate-600">{c.text}</p>
                    <p className="text-xs text-slate-400">{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}