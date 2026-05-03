import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { CheckCircle2, Circle, ClipboardCheck } from 'lucide-react';
import HelperHint from '@/components/common/HelperHint';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function DailyQbrCheck({ userEmail }) {
  const qc = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [note, setNote] = useState('');

  const { data: existing } = useQuery({
    queryKey: ['daily-qbr', userEmail, today],
    enabled: !!userEmail && !!supabase,
    queryFn: async () => {
      const { data } = await supabase
        .from('qbrs')
        .select('*')
        .eq('user_email', userEmail)
        .eq('date', today)
        .maybeSingle();
      return data;
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async () => {
      if (existing?.id) {
        await supabase.from('qbrs').update({ qbr_done: !existing.qbr_done, note }).eq('id', existing.id);
      } else {
        await supabase.from('qbrs').insert({ user_email: userEmail, date: today, qbr_done: true, note });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['daily-qbr', userEmail, today] });
      toast.success(existing?.qbr_done ? 'QBR unchecked' : 'QBR complete!');
    },
    onError: () => toast.error('Could not save QBR'),
  });

  const done = !!existing?.qbr_done;

  return (
    <div className={`rounded-2xl border p-4 transition-colors ${done ? 'bg-green-50 border-green-100' : 'bg-card border-border'}`}>
      <div className="flex items-center gap-1 mb-3">
        <ClipboardCheck className={`w-3.5 h-3.5 ${done ? 'text-green-600' : 'text-primary'}`} />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Daily QBR</p>
        <HelperHint
          storageKey="qbr"
          title="QBR"
          body="Queen Bee Role — the single most important repeatable activity for your role. Do this daily."
          learnMore="Mike Michalowicz, Clockwork — protect the activity that keeps the hive alive."
        />
      </div>
      <button
        onClick={() => upsertMutation.mutate()}
        disabled={upsertMutation.isPending}
        className="flex items-center gap-2 w-full text-left group mb-3"
      >
        {done
          ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
          : <Circle className="w-5 h-5 text-muted-foreground/40 flex-shrink-0 group-hover:text-muted-foreground transition-colors" />
        }
        <span className={`text-sm font-medium ${done ? 'text-green-700 line-through' : 'text-foreground'}`}>
          {done ? 'QBR done today' : 'Mark QBR done'}
        </span>
      </button>
      {!done && (
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Add a note (optional)..."
          rows={2}
          className="w-full text-xs bg-secondary/60 rounded-xl px-3 py-2 resize-none text-foreground placeholder:text-muted-foreground/60 border-0 focus:ring-1 focus:ring-primary/30 outline-none"
        />
      )}
    </div>
  );
}
