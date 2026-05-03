import { eventColors, opsTaskColor } from './eventColors';

export default function EventChip({ item, isOpsTask = false, onClick }) {
  const color = isOpsTask
    ? opsTaskColor
    : (eventColors[item.category] ?? eventColors.tactic);

  const isDone = item.status === 'complete' || item.status === 'done';

  return (
    <button
      onClick={onClick}
      title={item.title}
      className="w-full text-left px-1.5 py-0.5 rounded text-[11px] font-medium truncate leading-tight transition-opacity"
      style={{
        backgroundColor: color.bg,
        color: isDone ? '#9CA3AF' : color.fg,
        opacity: isDone ? 0.6 : 1,
        textDecoration: isDone ? 'line-through' : 'none',
      }}
    >
      {isOpsTask && <span className="mr-0.5">🔧</span>}
      {item.title}
    </button>
  );
}
