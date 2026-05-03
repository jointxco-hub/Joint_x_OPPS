import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { Tag, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

export default function MyTagsInbox({ tags = [], userEmail }) {
  const qc = useQueryClient();

  const resolveMutation = useMutation({
    mutationFn: async (tagId) => {
      await supabase.from('order_tags').update({ resolved_at: new Date().toISOString() }).eq('id', tagId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-tags', userEmail] });
      toast.success('Tag resolved');
    },
    onError: () => toast.error('Could not resolve tag'),
  });

  if (tags.length === 0) return null;

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Tagged on Orders</h2>
          <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold">
            {tags.length}
          </span>
        </div>
        <Link to="/Orders" className="text-xs text-primary hover:underline">View orders</Link>
      </div>
      <div className="space-y-2">
        {tags.slice(0, 5).map(tag => (
          <div key={tag.id} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground truncate">
                {tag.orders?.customer_name ?? 'Order'}
              </p>
              <p className="text-xs text-muted-foreground capitalize">{tag.tag_type} · {tag.orders?.pipeline_stage}</p>
            </div>
            <button
              onClick={() => resolveMutation.mutate(tag.id)}
              className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
              title="Mark resolved"
            >
              <CheckCheck className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
