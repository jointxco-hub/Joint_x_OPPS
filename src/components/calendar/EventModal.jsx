import { useState } from 'react';
import { dataClient } from '@/api/dataClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ResponsiveModal from '@/components/common/ResponsiveModal';

const CATEGORIES = [
  'production', 'marketing', 'ops', 'wam', 'drop',
  'milestone', 'tactic', 'content_shoot', 'personal',
];

export default function EventModal({ open, onClose, event = null }) {
  const qc = useQueryClient();
  const isEdit = !!event;

  const [form, setForm] = useState({
    title: event?.title ?? '',
    category: event?.category ?? 'tactic',
    start_at: event?.start_at ? event.start_at.slice(0, 16) : '',
    end_at: event?.end_at ? event.end_at.slice(0, 16) : '',
    description: event?.description ?? '',
    scope: event?.scope ?? 'personal',
  });

  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));
  const setVal = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const mutation = useMutation({
    mutationFn: (data) =>
      isEdit
        ? dataClient.entities.CalendarEvent.update(event.id, data)
        : dataClient.entities.CalendarEvent.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendarEvents'] });
      toast.success(isEdit ? 'Event updated' : 'Event created');
      onClose();
    },
    onError: (err) => toast.error(err?.message || 'Failed to save event'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.start_at) {
      toast.error('Title and start time are required');
      return;
    }
    mutation.mutate(form);
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={isEdit ? 'Edit Event' : 'New Event'}
      size="md"
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save' : 'Create'}
          </Button>
        </div>
      }
    >
      <form className="space-y-4 py-2" onSubmit={handleSubmit}>
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Title *</label>
          <Input
            value={form.title}
            onChange={setVal('title')}
            placeholder="Event title"
            className="h-11 md:h-10"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Category</label>
            <Select value={form.category} onValueChange={set('category')}>
              <SelectTrigger className="h-11 md:h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => (
                  <SelectItem key={c} value={c} className="capitalize">{c.replace('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Scope</label>
            <Select value={form.scope} onValueChange={set('scope')}>
              <SelectTrigger className="h-11 md:h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="personal">Personal</SelectItem>
                <SelectItem value="team">Team</SelectItem>
                <SelectItem value="company">Company</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Start *</label>
            <Input
              type="datetime-local"
              value={form.start_at}
              onChange={setVal('start_at')}
              className="h-11 md:h-10"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">End</label>
            <Input
              type="datetime-local"
              value={form.end_at}
              onChange={setVal('end_at')}
              className="h-11 md:h-10"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={setVal('description')}
            placeholder="Optional notes…"
            rows={3}
            className="w-full text-sm bg-secondary/50 rounded-xl px-3 py-2 resize-none text-foreground placeholder:text-muted-foreground/60 border border-border focus:ring-1 focus:ring-primary/30 outline-none"
          />
        </div>
      </form>
    </ResponsiveModal>
  );
}
