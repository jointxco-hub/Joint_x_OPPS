import { getWeekNumber, getDaysRemaining, CYCLE_LENGTH_DAYS } from '@/lib/twelveWeekYear';
import { format } from 'date-fns';

export default function CycleProgressBar({ cycle }) {
  if (!cycle) return null;

  const today = new Date();
  const week = getWeekNumber(cycle.start_date, today);
  const daysLeft = getDaysRemaining(cycle.start_date, today);
  const pct = Math.round(((CYCLE_LENGTH_DAYS - daysLeft) / CYCLE_LENGTH_DAYS) * 100);
  const endDate = new Date(cycle.start_date);
  endDate.setDate(endDate.getDate() + CYCLE_LENGTH_DAYS);

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm px-5 py-4 mb-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">12-Week Cycle</p>
          <p className="text-sm font-bold text-foreground">{cycle.name}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-primary">Wk {week}<span className="text-muted-foreground text-sm font-normal">/12</span></p>
          <p className="text-xs text-muted-foreground">{daysLeft}d left · ends {format(endDate, 'MMM d')}</p>
        </div>
      </div>
      <div className="w-full bg-secondary rounded-full h-2">
        <div
          className="bg-primary h-2 rounded-full transition-all duration-700"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className={`w-1 h-1 rounded-full ${i < week ? 'bg-primary' : 'bg-secondary'}`}
          />
        ))}
      </div>
    </div>
  );
}
