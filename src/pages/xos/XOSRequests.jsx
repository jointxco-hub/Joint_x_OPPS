import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useXosRequests } from '@/lib/useXosData';
import { createXosRequest } from '@/lib/xosModules';
import { getClientSafeRequestStatus, getRequestTypeLabel } from '@/lib/xosRequestStatus';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, StatusBadge, formatDate } from './xosUi';

const EMPTY_FORM = { title: '', category: 'general', priority: 'normal', message: '' };

function NewRequestSheet({ open, onOpenChange, hostname, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [state, setState] = useState({ loading: false, error: '' });

  const handleSubmit = async (event) => {
    event.preventDefault();
    const title = form.title.trim();
    const message = form.message.trim();

    if (title.length < 3) {
      setState({ loading: false, error: 'Add a request title.' });
      return;
    }
    if (message.length < 5) {
      setState({ loading: false, error: 'Add request details.' });
      return;
    }

    setState({ loading: true, error: '' });
    const result = await createXosRequest({
      hostname,
      title: title.slice(0, 160),
      message: message.slice(0, 2000),
      category: form.category,
      priority: form.priority,
    });

    if (result.error) {
      setState({ loading: false, error: result.error });
      return;
    }

    setForm(EMPTY_FORM);
    setState({ loading: false, error: '' });
    onCreated();
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New request</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-zinc-700">
            Title
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value.slice(0, 160) }))}
              maxLength={160}
              required
              className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-zinc-700">
              Category
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              >
                <option value="general">General</option>
                <option value="orders">Orders</option>
                <option value="files">Files</option>
                <option value="design">Design</option>
                <option value="store">Store</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              Priority
              <select
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
          </div>
          <label className="block text-sm font-medium text-zinc-700">
            Message
            <textarea
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value.slice(0, 2000) }))}
              maxLength={2000}
              required
              rows={5}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
            />
          </label>
          {state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
          <button
            type="submit"
            disabled={state.loading}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-zinc-950 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state.loading ? 'Sending…' : 'Send request'}
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export default function XOSRequests({ gate }) {
  const { data, isLoading, error, refetch } = useXosRequests({ hostname: gate.hostname, limit: 50 });
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['xos-requests'] });
  };

  return (
    <div className="pb-12">
      <PageHeader
        title="Requests"
        description="Send a request to your Joint X team and track its status."
        action={
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
          >
            <Plus className="h-4 w-4" />
            New Request
          </button>
        }
      />

      {isLoading && <ListSkeleton />}
      {!isLoading && error && <ErrorState message={error.message} onRetry={refetch} />}
      {!isLoading && !error && (data || []).length === 0 && (
        <EmptyState title="No requests yet." description="Requests you send will appear here." />
      )}
      {!isLoading && !error && (data || []).length > 0 && (
        <ul className="divide-y divide-zinc-100 px-4 sm:px-6">
          {data.map((request) => (
            <li key={request.id} className="py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-950">{request.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-500">{request.preview}</p>
                </div>
                <StatusBadge label={getClientSafeRequestStatus(request.status)} tone="neutral" />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span>{getRequestTypeLabel(request.request_type)}</span>
                <span aria-hidden="true">&middot;</span>
                <span>{formatDate(request.created_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <NewRequestSheet open={sheetOpen} onOpenChange={setSheetOpen} hostname={gate.hostname} onCreated={handleCreated} />
    </div>
  );
}
