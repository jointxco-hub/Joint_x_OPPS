import { Building2, Package, Store, UserRound } from "lucide-react";

export const sourceMeta = {
  xlab: {
    label: "X LAB",
    tone: "bg-emerald-50 text-emerald-700 border-emerald-100",
    Icon: Store,
  },
  x1: {
    label: "X1",
    tone: "bg-blue-50 text-blue-700 border-blue-100",
    Icon: Package,
  },
  x1_sample: {
    label: "X1",
    tone: "bg-blue-50 text-blue-700 border-blue-100",
    Icon: Package,
  },
  manual: {
    label: "Manual",
    tone: "bg-slate-50 text-slate-600 border-slate-200",
    Icon: UserRound,
  },
  opps: {
    label: "OPPS",
    tone: "bg-slate-50 text-slate-600 border-slate-200",
    Icon: Building2,
  },
};

export function getSourceMeta(value) {
  const key = String(value || "manual").toLowerCase().replace(/\s+/g, "_");
  return sourceMeta[key] || sourceMeta.manual;
}

export function SourceBadge({ source, className = "" }) {
  const meta = getSourceMeta(source);
  const Icon = meta.Icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.tone} ${className}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function splitXlabTitle(title) {
  const cleaned = String(title || "").replace(/^\[X\s*LAB\]\s*/i, "").trim();
  const parts = cleaned.split(/\s+[—–-]\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      source: "xlab",
      primary: parts[parts.length - 1],
      secondary: parts.slice(0, -1).join(" - "),
      original: title,
    };
  }
  return {
    source: "xlab",
    primary: cleaned || "X LAB order",
    secondary: "Production order",
    original: title,
  };
}

export function getTaskDisplay(task) {
  const title = task?.title || "Untitled task";
  if (/^\[X\s*LAB\]/i.test(title)) return splitXlabTitle(title);
  if (/^\[X1\]/i.test(title)) {
    const cleaned = title.replace(/^\[X1\]\s*/i, "").trim();
    return { source: "x1", primary: cleaned || "X1 order", secondary: "Sample pack", original: title };
  }
  return {
    source: task?.source || "manual",
    primary: title,
    secondary: task?.description ? String(task.description).split("\n")[0] : "",
    original: title,
  };
}
