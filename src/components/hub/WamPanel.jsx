import HelperHint from '@/components/common/HelperHint';
import { TrendingUp } from 'lucide-react';

export default function WamPanel({ weeklyScores = [], currentWeek }) {
  const weeks = Array.from({ length: 12 }, (_, i) => i + 1);
  const scoreMap = Object.fromEntries(weeklyScores.map(s => [s.week_number, s]));

  const wamWeeks = weeklyScores.filter(s => s.week_number <= currentWeek);
  const wam = wamWeeks.length > 0
    ? Math.round(wamWeeks.reduce((acc, s) => acc + (s.score_percentage ?? 0), 0) / wamWeeks.length)
    : null;

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">WAM</h2>
        <HelperHint
          storageKey="wam"
          title="WAM"
          body="Weekly Accountability Meeting — Friday review: wins, lessons, next-week focus. 15 minutes."
          learnMore="From the 12 Week Year — weekly review is the cadence that makes the system work."
        />
        {wam !== null && (
          <span className="ml-auto text-sm font-bold text-primary">{wam}% avg</span>
        )}
      </div>
      <div className="grid grid-cols-12 gap-0.5 items-end h-12">
        {weeks.map(w => {
          const score = scoreMap[w];
          const pct = score?.score_percentage ?? 0;
          const isCurrent = w === currentWeek;
          const isFuture = w > currentWeek;
          return (
            <div key={w} className="flex flex-col items-center gap-0.5">
              <div
                className={`w-full rounded-sm transition-all ${
                  isFuture ? 'bg-secondary' :
                  pct >= 85 ? 'bg-green-400' :
                  pct >= 70 ? 'bg-amber-400' : 'bg-red-400'
                } ${isCurrent ? 'ring-1 ring-primary ring-offset-1' : ''}`}
                style={{ height: `${Math.max(4, isFuture ? 4 : pct * 0.44)}px` }}
                title={`W${w}: ${isFuture ? 'upcoming' : `${pct}%`}`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-muted-foreground">W1</span>
        <span className="text-xs text-muted-foreground">W12</span>
      </div>
    </div>
  );
}
