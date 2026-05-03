import { Star } from 'lucide-react';
import HelperHint from '@/components/common/HelperHint';

export default function NorthStarBanner({ northStar }) {
  if (!northStar) return null;

  const progress = northStar.progress ?? 0;

  return (
    <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent rounded-3xl border border-primary/20 p-5 mb-6">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
          <Star className="w-5 h-5 text-primary fill-primary/30" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <p className="text-xs font-semibold text-primary uppercase tracking-wide">North Star</p>
            <HelperHint
              storageKey="north_star"
              title="North Star"
              body="The single most important company goal for this 12-week cycle. Everyone's work points to this."
              learnMore="From Brian Moran's 12 Week Year — we treat 12 weeks as a year and execute against one company goal."
            />
          </div>
          <p className="text-sm font-bold text-foreground leading-snug">{northStar.title}</p>
          {northStar.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{northStar.description}</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xl font-bold text-primary">{progress}%</p>
          <p className="text-xs text-muted-foreground">progress</p>
        </div>
      </div>
      {/* Progress bar */}
      <div className="mt-3 w-full bg-primary/10 rounded-full h-1.5">
        <div
          className="bg-primary h-1.5 rounded-full transition-all duration-700"
          style={{ width: `${Math.min(100, progress)}%` }}
        />
      </div>
    </div>
  );
}
