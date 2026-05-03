import { scoreColor } from '@/lib/twelveWeekYear';
import HelperHint from '@/components/common/HelperHint';
import { Zap } from 'lucide-react';

const colorMap = {
  green: { bg: 'bg-green-50', border: 'border-green-100', text: 'text-green-600' },
  amber: { bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-600' },
  red:   { bg: 'bg-red-50',   border: 'border-red-100',   text: 'text-red-600'   },
};

export default function ExecutionScoreCard({ score }) {
  const s = score ?? 0;
  const color = scoreColor(s);
  const { bg, border, text } = colorMap[color];

  return (
    <div className={`rounded-2xl border ${border} ${bg} p-4 flex flex-col items-center justify-center text-center gap-1`}>
      <div className="flex items-center gap-1 mb-1">
        <Zap className={`w-3.5 h-3.5 ${text}`} />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Execution</p>
        <HelperHint
          storageKey="execution_score"
          title="Execution Score"
          body="% of your weekly tactics completed. Aim for 85%+."
          learnMore="From the 12 Week Year — consistency of execution is the #1 predictor of results."
        />
      </div>
      <p className={`text-3xl font-bold ${text}`}>{s}%</p>
      <p className={`text-xs ${text} font-medium`}>
        {color === 'green' ? 'On fire' : color === 'amber' ? 'Stay focused' : 'Needs attention'}
      </p>
    </div>
  );
}
