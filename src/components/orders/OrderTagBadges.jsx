const ROLE_META = {
  cx:          { emoji: '💬', color: '#10B981' },
  designer:    { emoji: '🎨', color: '#A855F7' },
  photo:       { emoji: '📸', color: '#F97316' },
  runner:      { emoji: '🏃', color: '#EAB308' },
  ops_manager: { emoji: '⚙️', color: '#3B82F6' },
  social:      { emoji: '📱', color: '#EC4899' },
  founder:     { emoji: '🚀', color: '#EF4444' },
};

const ACTION_LABEL = {
  tag:      'tagged',
  assign:   'assigned',
  notify:   'notified',
  escalate: '🚨 escalation',
};

export default function OrderTagBadges({ order }) {
  const tags = Array.isArray(order.current_tags) ? order.current_tags : [];
  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((roleKey) => {
        const meta = ROLE_META[roleKey] ?? { emoji: '👤', color: '#6B7280' };
        return (
          <span
            key={roleKey}
            title={`${ACTION_LABEL.tag} → ${roleKey}`}
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}40` }}
          >
            {meta.emoji} {roleKey.replace('_', ' ')}
          </span>
        );
      })}
    </div>
  );
}
