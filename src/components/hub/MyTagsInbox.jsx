import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { AlertTriangle, CheckCheck, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { SourceBadge } from '@/lib/opsDisplay';

export default function MyTagsInbox({ tags = [], userEmail }) {
  const qc = useQueryClient();

  const resolveMutation = useMutation({
    mutationFn: async (tagId) => {
      const { error } = await supabase.from('order_tags').update({ resolved_at: new Date().toISOString() }).eq('id', tagId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-tags', userEmail] });
      toast.success('Tag resolved');
    },
    onError: () => toast.error('Could not resolve tag'),
  });

  const urgentCount = tags.filter((tag) => tag.orders?.priority === 'urgent' || tag.action === 'urgent').length;

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Needs Your Attention</h2>
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">{tags.length}</span>
          {urgentCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">
              <AlertTriangle className="h-3 w-3" /> {urgentCount} urgent
            </span>
          )}
        </div>
        <Link to="/Orders" className="text-xs text-primary hover:underline">Open orders</Link>
      </div>

      {tags.length === 0 ? (
        <p className="rounded-xl bg-secondary/40 px-3 py-4 text-center text-sm text-muted-foreground">Nothing tagged for you right now.</p>
      ) : (
        <div className="space-y-2">
          {tags.slice(0, 8).map(tag => {
            const order = tag.orders || {};
            const urgent = order.priority === 'urgent' || tag.action === 'urgent';
            return (
              <div key={tag.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${urgent ? 'border-red-100 bg-red-50' : 'border-border bg-secondary/30'}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-foreground">{order.client_name || 'Order'}</p>
                    <SourceBadge source={order.source} />
                    {urgent && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Urgent</span>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {order.order_number || 'No ref'} - {tag.role_key || tag.action || 'tag'} - {order.pipeline_stage || order.status || 'active'}
                  </p>
                </div>
                <button
                  onClick={() => resolveMutation.mutate(tag.id)}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-primary"
                  title="Mark resolved"
                  aria-label="Mark tag resolved"
                >
                  <CheckCheck className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
