import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export function PageHeader({ title, description, action }) {
  return (
    <div className="flex flex-col gap-3 border-b border-zinc-200 bg-white px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-950 sm:text-xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ListSkeleton({ rows = 4 }) {
  return (
    <div className="space-y-3 px-4 py-5 sm:px-6" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function EmptyState({ title, description }) {
  return (
    <div className="px-4 py-14 text-center sm:px-6">
      <p className="text-sm font-medium text-zinc-700">{title}</p>
      {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="px-4 py-14 text-center sm:px-6" role="alert">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-red-50">
        <AlertTriangle className="h-4 w-4 text-red-600" />
      </div>
      <p className="text-sm font-medium text-zinc-700">Couldn't load this</p>
      <p className="mt-1 text-sm text-zinc-500">{message || 'Please try again.'}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mx-auto mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      )}
    </div>
  );
}

export function StatusBadge({ label, tone = 'info', className = '' }) {
  const toneClasses = {
    info: 'bg-blue-50 text-blue-700 border-blue-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    destructive: 'bg-red-50 text-red-700 border-red-200',
    neutral: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${toneClasses[tone] || toneClasses.neutral} ${className}`}
    >
      {label}
    </span>
  );
}

export function formatDate(value) {
  if (!value) return 'No date';
  try {
    return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
  } catch {
    return 'No date';
  }
}

export function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 'Amount pending';
  try {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `R${Math.round(amount)}`;
  }
}

export function formatFileSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
