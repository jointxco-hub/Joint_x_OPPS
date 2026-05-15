import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Bug, Lightbulb, Plus, Upload, Calendar, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import FileThumbnail from "@/components/files/FileThumbnail";
import { createWithOfflineQueue } from "@/lib/offlineQueue";

const bugPriorityColors = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-yellow-100 text-yellow-700",
  high: "bg-red-100 text-red-700"
};

const bugStatusColors = {
  open: "bg-red-100 text-red-700",
  in_review: "bg-yellow-100 text-yellow-700",
  resolved: "bg-green-100 text-green-700"
};

const ideaStatusColors = {
  pending: "bg-slate-100 text-slate-700",
  approved: "bg-blue-100 text-blue-700",
  in_progress: "bg-green-100 text-green-700"
};

export default function NotesHub() {
  const [showBugForm, setShowBugForm] = useState(false);
  const [showIdeaForm, setShowIdeaForm] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    dataClient.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const { data: bugs = [] } = useQuery({
    queryKey: ['bugReports'],
    queryFn: () => dataClient.entities.BugReport.list('-created_date', 200)
  });

  const { data: ideas = [] } = useQuery({
    queryKey: ['ideas'],
    queryFn: () => dataClient.entities.Idea.list('-created_date', 200)
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => dataClient.entities.User.list('-created_date', 100)
  });

  const { data: weeklyTasks = [] } = useQuery({
    queryKey: ['weeklyTasks'],
    queryFn: () => dataClient.entities.WeeklyTask.list('-created_date', 500)
  });

  const { data: notes = [] } = useQuery({
    queryKey: ['personalNotes', currentUser?.email],
    enabled: !!currentUser?.email,
    queryFn: () => dataClient.entities.PersonalNote.filter({ user_email: currentUser.email, is_archived: false }, '-created_date', 200)
  });

  const last7Days = new Date();
  last7Days.setDate(last7Days.getDate() - 7);

  const recentBugs = bugs.filter(b => new Date(b.created_date) > last7Days);
  const recentIdeas = ideas.filter(i => new Date(i.created_date) > last7Days);
  const tasksNeedingAttention = weeklyTasks.filter(t => 
    t.status === 'in_progress' && t.priority === 'high'
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Notes Hub</h1>
            <p className="text-slate-500 mt-1">Track bugs, ideas, and weekly reviews</p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant={reviewMode ? 'default' : 'outline'}
              onClick={() => setReviewMode(!reviewMode)}
            >
              <Calendar className="w-4 h-4 mr-2" />
              {reviewMode ? 'Exit Review' : 'Weekly Review'}
            </Button>
          </div>
        </div>

        {/* Weekly Review Mode */}
        {reviewMode && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card className="border-red-200">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Bug className="w-5 h-5 text-red-500" />
                  Bugs (Last 7 Days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-red-600">{recentBugs.length}</p>
                <p className="text-sm text-slate-500 mt-1">
                  {recentBugs.filter(b => b.status === 'open').length} still open
                </p>
              </CardContent>
            </Card>

            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-blue-500" />
                  New Ideas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-blue-600">{recentIdeas.length}</p>
                <p className="text-sm text-slate-500 mt-1">
                  {recentIdeas.filter(i => i.status === 'approved').length} approved
                </p>
              </CardContent>
            </Card>

            <Card className="border-orange-200">
              <CardHeader>
                <CardTitle className="text-lg">High Priority Tasks</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-orange-600">{tasksNeedingAttention.length}</p>
                <p className="text-sm text-slate-500 mt-1">Need attention</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Main Tabs */}
        <Tabs defaultValue="bugs">
          <TabsList className="mb-6">
            <TabsTrigger value="bugs">
              <Bug className="w-4 h-4 mr-2" />
              Bugs ({bugs.length})
            </TabsTrigger>
            <TabsTrigger value="ideas">
              <Lightbulb className="w-4 h-4 mr-2" />
              Ideas ({ideas.length})
            </TabsTrigger>
            <TabsTrigger value="notes">
              <StickyNote className="w-4 h-4 mr-2" />
              Notes ({notes.length})
            </TabsTrigger>
          </TabsList>

          {/* Bugs Tab */}
          <TabsContent value="bugs">
            <div className="flex justify-end mb-4">
              <Button onClick={() => setShowBugForm(true)}>
                <Plus className="w-4 h-4 mr-2" /> Report Bug
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {bugs.map(bug => (
                <BugCard key={bug.id} bug={bug} users={users} />
              ))}
            </div>

            {bugs.length === 0 && (
              <Card className="p-12 text-center">
                <Bug className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                <p className="text-slate-500">No bugs reported yet</p>
              </Card>
            )}
          </TabsContent>

          {/* Ideas Tab */}
          <TabsContent value="ideas">
            <div className="flex justify-end mb-4">
              <Button onClick={() => setShowIdeaForm(true)}>
                <Plus className="w-4 h-4 mr-2" /> Add Idea
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ideas.map(idea => (
                <IdeaCard key={idea.id} idea={idea} users={users} />
              ))}
            </div>

            {ideas.length === 0 && (
              <Card className="p-12 text-center">
                <Lightbulb className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                <p className="text-slate-500">No ideas yet</p>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="notes">
            <div className="flex justify-end mb-4">
              <Button onClick={() => setShowNoteForm(true)}>
                <Plus className="w-4 h-4 mr-2" /> Add Note
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {notes.map(note => (
                <NoteCard key={note.id} note={note} currentUser={currentUser} />
              ))}
            </div>
            {notes.length === 0 && (
              <Card className="p-12 text-center">
                <StickyNote className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                <p className="text-slate-500">No notes yet</p>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Forms */}
        {showBugForm && <BugFormDialog users={users} onClose={() => setShowBugForm(false)} />}
        {showIdeaForm && <IdeaFormDialog users={users} onClose={() => setShowIdeaForm(false)} />}
        {showNoteForm && <NoteFormDialog currentUser={currentUser} onClose={() => setShowNoteForm(false)} />}
      </div>
    </div>
  );
}

function BugCard({ bug, users }) {
  const [editing, setEditing] = useState(false);
  const assignedUser = users.find(u => u.email === bug.assigned_to);

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 mb-1">{bug.description}</h3>
              <p className="text-sm text-slate-600">{bug.page_feature}</p>
            </div>
            <Badge className={bugStatusColors[bug.status]}>
              {bug.status.replace('_', ' ')}
            </Badge>
          </div>

          {bug.screenshot_url && (
            <FileThumbnail
              fileUrl={bug.screenshot_url}
              title="Screenshot"
              className="w-full h-32 mb-3"
            />
          )}

          <div className="flex items-center gap-2">
            <Badge className={bugPriorityColors[bug.priority]}>{bug.priority}</Badge>
            {assignedUser && (
              <span className="text-xs text-slate-600 px-2 py-1 bg-slate-100 rounded">
                {assignedUser.full_name || assignedUser.email}
              </span>
            )}
            <span className="text-xs text-slate-400 ml-auto">
              {bug.created_date ? format(new Date(bug.created_date), 'MMM d') : ''}
            </span>
            <button onClick={() => setEditing(true)} className="text-xs text-primary font-medium hover:underline">
              Edit
            </button>
          </div>
        </CardContent>
      </Card>
      {editing && <BugFormDialog users={users} existing={bug} onClose={() => setEditing(false)} />}
    </>
  );
}

function IdeaCard({ idea, users }) {
  const assignedUser = users.find(u => u.email === idea.assigned_to);
  
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h3 className="font-semibold text-slate-900 mb-1">{idea.title}</h3>
            <p className="text-sm text-slate-600 line-clamp-2">
              {idea.description}
            </p>
          </div>
          <Badge className={ideaStatusColors[idea.status]}>
            {idea.status.replace('_', ' ')}
          </Badge>
        </div>

        {idea.attachment_url && (
          <FileThumbnail 
            fileUrl={idea.attachment_url}
            title="Attachment"
            className="w-full h-32 mb-3"
          />
        )}

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="capitalize">
            {idea.category}
          </Badge>
          {assignedUser && (
            <span className="text-xs text-slate-600 px-2 py-1 bg-slate-100 rounded">
              {assignedUser.full_name || assignedUser.email}
            </span>
          )}
          <span className="text-xs text-slate-400 ml-auto">
            {format(new Date(idea.created_date), 'MMM d')}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function BugFormDialog({ users, onClose, existing }) {
  const [formData, setFormData] = useState(existing ? {
    description: existing.description || "",
    page_feature: existing.page_feature || "",
    screenshot_url: existing.screenshot_url || "",
    priority: existing.priority || "medium",
    assigned_to: existing.assigned_to || "",
    status: existing.status || "open",
  } : {
    description: "",
    page_feature: "",
    screenshot_url: "",
    priority: "medium",
    assigned_to: "",
    status: "open"
  });
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (data) => {
      if (existing) {
        return dataClient.entities.BugReport.update(existing.id, data);
      }
      const user = await dataClient.auth.me().catch(() => null);
      return createWithOfflineQueue("BugReport", { ...data, reported_by: user?.email });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bugReports'] });
      toast.success(existing ? "Bug updated!" : "Bug reported!");
      onClose();
    }
  });

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
      setFormData({ ...formData, screenshot_url: file_url });
      toast.success("Screenshot uploaded!");
    } catch (error) {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Bug Report" : "Report Bug"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate({ ...formData, assigned_to: formData.assigned_to === "unassigned" ? null : formData.assigned_to }); }} className="space-y-4">
          <div>
            <Label>Bug Description *</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              placeholder="Describe the bug..."
              required
              rows={3}
            />
          </div>

          <div>
            <Label>Page/Feature *</Label>
            <Input
              value={formData.page_feature}
              onChange={(e) => setFormData({...formData, page_feature: e.target.value})}
              placeholder="e.g. Dashboard, Orders page"
              required
            />
          </div>

          <div>
            <Label>Screenshot (optional)</Label>
            <Button
              type="button"
              variant="outline"
              onClick={() => document.getElementById('bug-upload').click()}
              disabled={uploading}
              className="w-full"
            >
              <Upload className="w-4 h-4 mr-2" />
              {uploading ? "Uploading..." : formData.screenshot_url ? "Change Screenshot" : "Upload Screenshot"}
            </Button>
            <input
              id="bug-upload"
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
            {formData.screenshot_url && (
              <FileThumbnail 
                fileUrl={formData.screenshot_url}
                title="Screenshot"
                className="w-full h-32 mt-2"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Priority</Label>
              <Select value={formData.priority} onValueChange={(v) => setFormData({...formData, priority: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Assign To</Label>
              <Select value={formData.assigned_to} onValueChange={(v) => setFormData({...formData, assigned_to: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Optional..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {users.map(user => (
                    <SelectItem key={user.id} value={user.email}>
                      {user.full_name || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : existing ? "Save Changes" : "Report Bug"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IdeaFormDialog({ users, onClose }) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "other",
    attachment_url: "",
    assigned_to: "",
    status: "pending"
  });
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const user = await dataClient.auth.me().catch(() => null);
      return createWithOfflineQueue("Idea", { ...data, submitted_by: user?.email });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ideas'] });
      toast.success("Idea added!");
      onClose();
    }
  });

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
      setFormData({ ...formData, attachment_url: file_url });
      toast.success("File uploaded!");
    } catch (error) {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Idea</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate({ ...formData, assigned_to: formData.assigned_to === "unassigned" ? null : formData.assigned_to }); }} className="space-y-4">
          <div>
            <Label>Idea Title *</Label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              placeholder="Brief title..."
              required
            />
          </div>

          <div>
            <Label>Description *</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              placeholder="Describe your idea..."
              required
              rows={4}
            />
          </div>

          <div>
            <Label>Category</Label>
            <Select value={formData.category} onValueChange={(v) => setFormData({...formData, category: v})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ui">UI</SelectItem>
                <SelectItem value="automation">Automation</SelectItem>
                <SelectItem value="workflow">Workflow</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Attachment (optional)</Label>
            <Button
              type="button"
              variant="outline"
              onClick={() => document.getElementById('idea-upload').click()}
              disabled={uploading}
              className="w-full"
            >
              <Upload className="w-4 h-4 mr-2" />
              {uploading ? "Uploading..." : formData.attachment_url ? "Change File" : "Upload File"}
            </Button>
            <input
              id="idea-upload"
              type="file"
              onChange={handleFileUpload}
              className="hidden"
            />
            {formData.attachment_url && (
              <FileThumbnail 
                fileUrl={formData.attachment_url}
                title="Attachment"
                className="w-full h-32 mt-2"
              />
            )}
          </div>

          <div>
            <Label>Assign To</Label>
            <Select value={formData.assigned_to} onValueChange={(v) => setFormData({...formData, assigned_to: v})}>
              <SelectTrigger>
                <SelectValue placeholder="Optional..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {users.map(user => (
                  <SelectItem key={user.id} value={user.email}>
                    {user.full_name || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add Idea</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NoteCard({ note, currentUser }) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h3 className="font-semibold text-slate-900">{note.title}</h3>
            <Badge variant="outline" className="capitalize flex-shrink-0">{note.category}</Badge>
          </div>
          {note.body && <p className="text-sm text-slate-600 whitespace-pre-wrap">{note.body}</p>}
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-slate-400">{note.created_date ? format(new Date(note.created_date), 'MMM d') : 'Saved offline'}</p>
            <button onClick={() => setEditing(true)} className="text-xs text-primary font-medium hover:underline">Edit</button>
          </div>
        </CardContent>
      </Card>
      {editing && <NoteFormDialog currentUser={currentUser} existing={note} onClose={() => setEditing(false)} />}
    </>
  );
}

function NoteFormDialog({ currentUser, onClose, existing }) {
  const [formData, setFormData] = useState(existing ? {
    title: existing.title || "",
    body: existing.body || "",
    category: existing.category || "note",
    is_shared: existing.is_shared || false,
  } : {
    title: "",
    body: "",
    category: "note",
    is_shared: false,
  });
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data) => existing
      ? dataClient.entities.PersonalNote.update(existing.id, data)
      : createWithOfflineQueue("PersonalNote", { ...data, user_email: currentUser?.email }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personalNotes'] });
      toast.success(existing ? "Note updated" : "Note saved");
      onClose();
    }
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Note" : "New Note"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(formData); }} className="space-y-4">
          <div>
            <Label>Title *</Label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              placeholder="Quick reminder, supplier note, idea..."
              required
            />
          </div>
          <div>
            <Label>Note</Label>
            <Textarea
              value={formData.body}
              onChange={(e) => setFormData({...formData, body: e.target.value})}
              placeholder="Write the thing before it escapes..."
              rows={5}
            />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={formData.category} onValueChange={(v) => setFormData({...formData, category: v})}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="note">Note</SelectItem>
                <SelectItem value="idea">Idea</SelectItem>
                <SelectItem value="reminder">Reminder</SelectItem>
                <SelectItem value="supplier">Supplier</SelectItem>
                <SelectItem value="client">Client</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={formData.is_shared}
              onChange={(e) => setFormData({...formData, is_shared: e.target.checked})}
            />
            Share with admin
          </label>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending || (!existing && !currentUser?.email)}>
              {createMutation.isPending ? "Saving…" : existing ? "Save Changes" : "Save Note"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
