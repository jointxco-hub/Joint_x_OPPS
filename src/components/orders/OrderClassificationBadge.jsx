import { getOrderClassificationBadge } from "@/lib/orderClassification";

// OPPS-internal QA/test classification badge (XOS 2.7C). Mirrors
// TenantBadge's exact pattern: one small reusable component so the
// table row, kanban card, mobile card, and OrderDrawer header all render
// the same resolved classification - never a per-surface
// reimplementation. Renders nothing for an ordinary false/false order -
// deliberately not overbadged.
const TONE_CLASSES = {
  test: "border-purple-200 bg-purple-50 text-purple-700",
  excluded: "border-amber-200 bg-amber-50 text-amber-700",
  "test-excluded": "border-purple-300 bg-purple-100 text-purple-800",
};

export default function OrderClassificationBadge({ order, className = "" }) {
  const badge = getOrderClassificationBadge(order);
  if (!badge) return null;

  return (
    <span
      title={badge.title}
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${TONE_CLASSES[badge.key]} ${className}`}
    >
      {badge.label}
    </span>
  );
}
