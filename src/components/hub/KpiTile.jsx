import HelperHint from '@/components/common/HelperHint';

export default function KpiTile({ kpi }) {
  const isLead = kpi.kind === 'lead';
  const pct = kpi.target_value > 0
    ? Math.round(((kpi.current_value ?? 0) / kpi.target_value) * 100)
    : 0;
  const onTrack = pct >= 80;

  return (
    <div className={`rounded-2xl border p-4 ${onTrack ? 'bg-green-50 border-green-100' : 'bg-card border-border'}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-xs text-muted-foreground font-medium truncate">{kpi.name}</p>
            <HelperHint
              storageKey={isLead ? 'lead_kpi' : 'lag_kpi'}
              title={isLead ? 'Lead KPI' : 'Lag KPI'}
              body={isLead
                ? 'An input you control (e.g., posts published). Lead indicators predict results.'
                : 'A result you measure (e.g., revenue). Lag indicators tell you what already happened.'
              }
              learnMore="Hormozi / 12 Week Year — lead inputs drive lag outputs."
            />
          </div>
          <p className={`text-xl font-bold ${onTrack ? 'text-green-700' : 'text-foreground'}`}>
            {kpi.current_value ?? 0}
            <span className="text-xs font-normal text-muted-foreground ml-1">/ {kpi.target_value}</span>
          </p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 font-medium ${isLead ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
          {isLead ? 'Lead' : 'Lag'}
        </span>
      </div>
      <div className="w-full bg-secondary rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full transition-all ${onTrack ? 'bg-green-500' : 'bg-primary'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground mt-1">{pct}% of target</p>
    </div>
  );
}
