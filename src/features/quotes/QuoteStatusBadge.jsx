import { Badge } from "@/components/ui/badge";
import { QUOTE_STATUS_BADGE, QUOTE_STATUS_LABELS } from "./quoteStatus";

export default function QuoteStatusBadge({ status }) {
  const value = status || "draft";
  return (
    <Badge variant="outline" className={`rounded-full ${QUOTE_STATUS_BADGE[value] || QUOTE_STATUS_BADGE.draft}`}>
      {QUOTE_STATUS_LABELS[value] || String(value).replace(/_/g, " ")}
    </Badge>
  );
}
