import { Button } from '@/components/ui/button';
import { Plus, LayoutGrid, List, Calendar, Rows3 } from 'lucide-react';
import HelperHint from '@/components/common/HelperHint';
import { eventColors } from './eventColors';

const VIEWS = [
  { key: 'twelveWeek', label: '12-Week', icon: Rows3 },
  { key: 'calendar',   label: 'Month',   icon: Calendar },
  { key: 'weekly',     label: 'Weekly',  icon: LayoutGrid },
  { key: 'list',       label: 'List',    icon: List },
];

const CATEGORIES = Object.keys(eventColors);

export default function CalendarToolbar({
  viewMode,
  onViewChange,
  categories,
  onCategoryToggle,
  onNewEvent,
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-3 mb-6">
      {/* View switcher */}
      <div className="flex gap-1 bg-secondary rounded-xl p-1 flex-wrap">
        {VIEWS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onViewChange(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {key === 'twelveWeek' && (
              <HelperHint
                storageKey="twelve_week_view"
                title="12 Week View"
                body="Your full cycle on one screen — 12 weeks across, 7 days down. Today is highlighted."
                learnMore="From the 12 Week Year — see the whole cycle at a glance."
              />
            )}
          </button>
        ))}
      </div>

      {/* Category filters */}
      <div className="flex gap-1 flex-wrap">
        {CATEGORIES.map(cat => {
          const color = eventColors[cat];
          const active = categories?.includes(cat) ?? true;
          return (
            <button
              key={cat}
              onClick={() => onCategoryToggle(cat)}
              className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border transition-opacity"
              style={{
                backgroundColor: active ? color.bg : 'transparent',
                color: active ? color.fg : '#9CA3AF',
                borderColor: active ? color.dot : '#E5E7EB',
                opacity: active ? 1 : 0.5,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: active ? color.dot : '#D1D5DB' }}
              />
              {cat.replace('_', ' ')}
            </button>
          );
        })}
      </div>

      <div className="md:ml-auto">
        <Button size="sm" onClick={onNewEvent} className="gap-1.5">
          <Plus className="w-4 h-4" /> New Event
        </Button>
      </div>
    </div>
  );
}
