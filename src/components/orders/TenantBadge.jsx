import { getTenantDisplayMeta } from "@/lib/tenantDisplay";

// OPPS tenant-identity badge (XOS 2.7A). One small, reusable component so
// the table row, kanban card, mobile card, and OrderDrawer header all
// render the exact same resolved identity - never a per-surface
// reimplementation. Deliberately neutral/dark styling, distinct from
// SourceBadge's per-source colored tones (src/lib/opsDisplay.jsx,
// unchanged by this PR) so the two are never visually confused.
export default function TenantBadge({ order, tenantsById, className = "" }) {
  const meta = getTenantDisplayMeta(order, tenantsById);
  const title = meta.unknown ? meta.name : meta.slug ? `${meta.name} (${meta.slug})` : meta.name;

  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
        meta.unknown
          ? "border-zinc-200 bg-zinc-50 text-zinc-400"
          : "border-zinc-300 bg-zinc-800 text-white"
      } ${className}`}
    >
      {meta.label}
    </span>
  );
}
