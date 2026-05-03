import { dataClient } from '@/api/dataClient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronRight } from 'lucide-react';

export default function PipelineStrip({ order, onStageChange }) {
  const qc = useQueryClient();

  const { data: stages = [] } = useQuery({
    queryKey: ['orderStages'],
    queryFn: () => dataClient.entities.OrderStage.list('sequence', 50),
    staleTime: 300_000,
  });

  const normalStages = stages.filter(s => !s.is_exception).sort((a, b) => a.sequence - b.sequence);
  const exceptionStages = stages.filter(s => s.is_exception);

  const updateMutation = useMutation({
    mutationFn: (stageKey) =>
      dataClient.entities.Order.update(order.id, { pipeline_stage: stageKey }),
    onSuccess: (_, stageKey) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      onStageChange?.(stageKey);
      toast.success('Stage updated');
    },
    onError: (err) => toast.error(err?.message || 'Failed to update stage'),
  });

  const currentKey = order.pipeline_stage || 'received';
  const currentIdx = normalStages.findIndex(s => s.key === currentKey);

  return (
    <div className="px-5 py-3 border-b border-border bg-secondary/20">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Pipeline Stage
      </p>

      {/* Normal stages — horizontal scrollable strip */}
      <div className="overflow-x-auto pb-1">
        <div className="flex items-center gap-0.5 min-w-max">
          {normalStages.map((stage, idx) => {
            const isPast = idx < currentIdx;
            const isCurrent = stage.key === currentKey;
            const isFuture = idx > currentIdx;
            return (
              <button
                key={stage.key}
                onClick={() => !isCurrent && updateMutation.mutate(stage.key)}
                disabled={updateMutation.isPending}
                title={stage.display_name}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap ${
                  isCurrent
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : isPast
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-secondary text-muted-foreground hover:bg-border hover:text-foreground'
                }`}
              >
                {isPast && <span className="text-green-600">✓</span>}
                {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-primary-foreground/60 animate-pulse" />}
                {stage.display_name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Exception stages — shown as red pills if active, or available to set */}
      {exceptionStages.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          <span className="text-[10px] text-muted-foreground self-center mr-1">Exceptions:</span>
          {exceptionStages.map(stage => {
            const isActive = stage.key === currentKey;
            return (
              <button
                key={stage.key}
                onClick={() => !isActive && updateMutation.mutate(stage.key)}
                disabled={updateMutation.isPending}
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full border transition-all ${
                  isActive
                    ? 'bg-red-100 text-red-700 border-red-300'
                    : 'bg-card text-muted-foreground border-border hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                }`}
              >
                {stage.display_name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
