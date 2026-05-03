import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { dataClient } from '@/api/dataClient';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ResponsiveModal from '@/components/common/ResponsiveModal';

const EXCEPTION_TYPES = [
  { key: 'materials_delayed',          label: 'Materials delayed',    severity: 'high' },
  { key: 'design_revision_requested',  label: 'Revision requested',   severity: 'medium' },
  { key: 'qa_failed',                  label: 'QA failed',            severity: 'high' },
  { key: 'customer_complaint',         label: 'Customer complaint',   severity: 'critical' },
  { key: 'payment_failed',             label: 'Payment failed',       severity: 'high' },
];

const SEVERITY_COLORS = {
  low:      'bg-slate-100 text-slate-700',
  medium:   'bg-amber-100 text-amber-700',
  high:     'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

export default function ExceptionFlag({ open, onClose, order, onStageChange }) {
  const qc = useQueryClient();
  const [exceptionType, setExceptionType] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      if (!exceptionType) throw new Error('Select an exception type');
      const selected = EXCEPTION_TYPES.find(e => e.key === exceptionType);

      // 1. Insert order_exception row
      if (supabase) {
        await supabase.from('order_exceptions').insert({
          order_id: order.id,
          exception_type: exceptionType,
          severity: selected?.severity ?? 'medium',
          description,
          raised_by: null,
        });
      }

      // 2. Advance pipeline_stage to the exception key (fires auto-tag trigger)
      await dataClient.entities.Order.update(order.id, { pipeline_stage: exceptionType });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success('Exception flagged — escalation tags sent');
      onStageChange?.(exceptionType);
      onClose();
    },
    onError: (err) => toast.error(err?.message || 'Failed to flag exception'),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="🚨 Flag Exception"
      description="This will create an exception record and escalate the order to the relevant roles."
      size="sm"
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!exceptionType || mutation.isPending}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {mutation.isPending ? 'Flagging…' : 'Flag Exception'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 py-2">
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Exception type *</label>
          <Select value={exceptionType} onValueChange={setExceptionType}>
            <SelectTrigger className="h-11 md:h-10">
              <SelectValue placeholder="Select exception…" />
            </SelectTrigger>
            <SelectContent>
              {EXCEPTION_TYPES.map(e => (
                <SelectItem key={e.key} value={e.key}>
                  <span className="flex items-center gap-2">
                    {e.label}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SEVERITY_COLORS[e.severity]}`}>
                      {e.severity}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Briefly describe what happened…"
            rows={3}
            className="w-full text-sm bg-secondary/50 rounded-xl px-3 py-2 resize-none text-foreground placeholder:text-muted-foreground/60 border border-border focus:ring-1 focus:ring-red-400/40 outline-none"
          />
        </div>

        {exceptionType && (
          <div className="text-xs text-muted-foreground bg-red-50 border border-red-100 rounded-xl p-3">
            This will escalate to the assigned roles for <strong>{exceptionType.replace(/_/g, ' ')}</strong> and create a stage-change record.
          </div>
        )}
      </div>
    </ResponsiveModal>
  );
}
