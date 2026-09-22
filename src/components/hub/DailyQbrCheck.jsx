import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { CheckCircle2, Circle, ClipboardCheck } from 'lucide-react';
import HelperHint from '@/components/common/HelperHint';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { resolveEmployeeIdentityMode } from '@/lib/employeeIdentity';

// Phase 2C: reads/writes qbrs by canonical auth_user_id+tenant_id when
// both are known, falling back to the legacy email filter only for
// identities not yet resolved to a tenant. RLS
// (supabase/migrations/20260922100500_opps_employee_hub_phase2c_rls.sql)
// is what actually prevents one employee from writing another's QBR
// through direct table access — self read/write there requires BOTH
// auth_user_id = auth.uid() AND active tenant membership
// (can_access_tenant(tenant_id)); this component sends the right
// identity so a legitimate write succeeds, but the client-side filter
// alone is not the security boundary, same convention as everywhere
// else in this codebase.
//
// That same RLS correction removed every INSERT branch for a
// tenant_id-null row (see the migration header: "there is no legitimate
// insert a brand new row with an unknown tenant case"), so an insert
// attempted in 'legacy' mode (no tenant resolved yet) will now be
// REJECTED outright, not silently accepted as an unresolved row the way
// the first draft of this component would have tried. Every code path
// below checks and throws on `error` instead of assuming success - a
// failed write must never reach the success toast/local "done" state.
export default function DailyQbrCheck({ authUserId, tenantId, userEmail }) {
  const qc = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [note, setNote] = useState('');
  const identity = resolveEmployeeIdentityMode({ authUserId, tenantId, userEmail });

  const { data: existing, error: loadError } = useQuery({
    queryKey: ['daily-qbr', identity, today],
    enabled: identity.mode !== 'none' && !!supabase,
    queryFn: async () => {
      let query = supabase.from('qbrs').select('*').eq('date', today);
      query = identity.mode === 'canonical'
        ? query.eq('auth_user_id', identity.authUserId).eq('tenant_id', identity.tenantId)
        : query.eq('user_email', identity.userEmail);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async () => {
      if (identity.mode !== 'canonical') {
        // No resolved tenant membership yet - RLS will reject any
        // insert here (and self-read/write on an existing row requires
        // the same active-membership check), so fail fast with a
        // specific, actionable message instead of a raw Postgres error.
        throw new Error('Your workspace membership isn’t linked yet, so your QBR can’t be saved. Ask an admin to link your account.');
      }
      if (existing?.id) {
        const { error } = await supabase.from('qbrs').update({ qbr_done: !existing.qbr_done, note }).eq('id', existing.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from('qbrs').insert({
        date: today,
        qbr_done: true,
        note,
        auth_user_id: identity.authUserId,
        tenant_id: identity.tenantId,
        // user_email is dual-written for compatibility with anything
        // still reading qbrs by email.
        user_email: userEmail || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['daily-qbr', identity, today] });
      toast.success(existing?.qbr_done ? 'QBR unchecked' : 'QBR complete!');
    },
    onError: (error) => toast.error(error?.message || 'Could not save QBR'),
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
      {loadError && (
        <p className="mb-3 text-xs text-red-600">Could not load today's QBR. Try refreshing.</p>
      )}
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
