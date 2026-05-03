import { useMemo, useState } from 'react';
import { addDays, format, isToday, startOfDay } from 'date-fns';
import { getWeekNumber } from '@/lib/twelveWeekYear';
import EventChip from './EventChip';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function getCycleWeekStart(cycleStart, weekNum) {
  const start = new Date(cycleStart);
  return addDays(start, (weekNum - 1) * 7);
}

export default function TwelveWeekView({ opsTasks = [], events = [], cycle, visibleCategories }) {
  const [overflowCell, setOverflowCell] = useState(null); // { week, day }

  const today = new Date();
  const currentWeek = cycle ? getWeekNumber(cycle.start_date, today) : 0;
  const cycleStart = cycle?.start_date ? new Date(cycle.start_date) : new Date();

  // Build a map: "W{week}_{dayIndex}" → items
  const cellMap = useMemo(() => {
    const map = {};

    // CalendarEvents: match by start_at date
    for (const evt of events) {
      if (!evt.start_at) continue;
      if (visibleCategories && !visibleCategories.includes(evt.category)) continue;
      const d = new Date(evt.start_at);
      if (!cycle?.start_date) continue;
      const week = getWeekNumber(cycle.start_date, d);
      if (week < 1 || week > 12) continue;
      const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
      const key = `${week}_${dow}`;
      map[key] = map[key] ?? [];
      map[key].push({ ...evt, _isOpsTask: false });
    }

    // OpsTask: match by day_of_week + week_number (relative to cycle)
    for (const task of opsTasks) {
      if (task.status === 'archived') continue;
      const week = task.week_number;
      if (!week || week < 1 || week > 12) continue;
      const dow = DAY_KEYS.indexOf(task.day_of_week);
      if (dow === -1) continue;
      const key = `${week}_${dow}`;
      map[key] = map[key] ?? [];
      map[key].push({ ...task, _isOpsTask: true });
    }

    return map;
  }, [events, opsTasks, cycle, visibleCategories]);

  if (!cycle) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="font-medium">No active 12-week cycle found.</p>
        <p className="text-sm mt-1">Create one in the Goals section to activate this view.</p>
      </div>
    );
  }

  return (
    // overflow-x-auto for horizontal scroll on mobile (v3 §19.6)
    <div className="overflow-x-auto rounded-2xl border border-border shadow-sm">
      <div className="min-w-[900px]">
        {/* Column headers: W1 … W12 */}
        <div className="grid" style={{ gridTemplateColumns: '56px repeat(12, 1fr)' }}>
          <div className="bg-card border-b border-r border-border" />
          {Array.from({ length: 12 }, (_, i) => {
            const w = i + 1;
            const wStart = getCycleWeekStart(cycleStart, w);
            const isCurrentW = w === currentWeek;
            return (
              <div
                key={w}
                className={`bg-card border-b border-r border-border px-1 py-2 text-center ${
                  isCurrentW ? 'border-t-2 border-t-primary' : ''
                }`}
              >
                <p className={`text-xs font-bold ${isCurrentW ? 'text-primary' : 'text-foreground'}`}>W{w}</p>
                <p className="text-[10px] text-muted-foreground">{format(wStart, 'MMM d')}</p>
              </div>
            );
          })}
        </div>

        {/* Day rows */}
        {DAYS.map((day, dayIdx) => (
          <div key={day} className="grid" style={{ gridTemplateColumns: '56px repeat(12, 1fr)' }}>
            {/* Sticky day label — via position: sticky only works if parent allows it */}
            <div className="bg-card border-b border-r border-border flex items-center justify-center sticky left-0 z-10">
              <span className="text-[11px] font-semibold text-muted-foreground">{day}</span>
            </div>

            {Array.from({ length: 12 }, (_, weekIdx) => {
              const w = weekIdx + 1;
              const cellDate = addDays(getCycleWeekStart(cycleStart, w), dayIdx);
              const isTodayCell = isToday(cellDate);
              const isCurrentW = w === currentWeek;
              const key = `${w}_${dayIdx}`;
              const items = cellMap[key] ?? [];
              const visible = items.slice(0, 3);
              const overflow = items.length - visible.length;
              const overflowing = overflowCell?.week === w && overflowCell?.day === dayIdx;

              return (
                <div
                  key={w}
                  className={`border-b border-r border-border p-0.5 min-h-[52px] relative ${
                    isTodayCell ? 'bg-primary/5' : 'bg-card hover:bg-secondary/30'
                  } ${isCurrentW ? 'border-r-2 border-r-primary/30' : ''}`}
                >
                  {isTodayCell && (
                    <span className="absolute top-0.5 right-0.5 text-[9px] text-primary font-bold">●</span>
                  )}
                  <div className="space-y-0.5">
                    {visible.map((item, idx) => (
                      <EventChip key={item.id ?? idx} item={item} isOpsTask={item._isOpsTask} />
                    ))}
                    {overflow > 0 && !overflowing && (
                      <button
                        onClick={() => setOverflowCell({ week: w, day: dayIdx })}
                        className="text-[10px] text-primary font-medium px-1"
                      >
                        +{overflow} more
                      </button>
                    )}
                    {overflowing && items.slice(3).map((item, idx) => (
                      <EventChip key={item.id ?? `ov${idx}`} item={item} isOpsTask={item._isOpsTask} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
