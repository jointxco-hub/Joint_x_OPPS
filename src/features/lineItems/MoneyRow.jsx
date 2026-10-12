import { Input } from "@/components/ui/input";
import LabeledNumber from "./LabeledNumber";

function formatMoney(value) {
  return `R${Number(value || 0).toLocaleString()}`;
}

// Shared Qty / Price / Discount / Total fields for a Quote or Invoice line
// item. Below `md:` the Qty -> Price -> Total trio renders as one compact
// flowing row instead of three separate full-width blocks; `md:contents`
// hands the same elements back to the parent's 12-col grid unchanged at
// `md:` and up, so desktop/tablet layout is untouched. Discount sits in
// its own smaller row directly below. Every value/onChange pair is passed
// straight through to the existing <Input> — no new state, no calculation,
// the same handlers the callers used before this was extracted.
export default function MoneyRow({
  quantity, onQuantityChange,
  rate, onRateChange, rateInputClassName = "",
  discount, onDiscountChange,
  total, totalLabel = "Total", totalColSpan = "md:col-span-2",
}) {
  return (
    <>
      <div className="flex items-center gap-1.5 md:contents">
        <LabeledNumber label="Qty" className="min-w-0 flex-1 md:col-span-2">
          <Input
            value={quantity ?? ""}
            onChange={onQuantityChange}
            type="number"
            min="0"
            step="0.01"
            placeholder="1"
            className="h-8 rounded-lg text-sm"
          />
        </LabeledNumber>
        <span className="flex-none pt-3 text-sm font-medium text-muted-foreground md:hidden" aria-hidden="true">×</span>
        <LabeledNumber label="Price" className="min-w-0 flex-1 md:col-span-2">
          <Input
            value={rate ?? ""}
            onChange={onRateChange}
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            className={`h-8 rounded-lg text-sm ${rateInputClassName}`}
          />
        </LabeledNumber>
        <span className="flex-none pt-3 text-sm font-medium text-muted-foreground md:hidden" aria-hidden="true">→</span>
        <div className={`min-w-0 flex-1 rounded-lg bg-secondary/50 px-2 py-1 ${totalColSpan}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{totalLabel}</p>
          <p className="truncate text-sm font-semibold text-foreground">{formatMoney(total)}</p>
        </div>
      </div>
      <LabeledNumber label="Discount" className="max-w-[45%] md:col-span-2 md:max-w-none">
        <Input
          value={discount ?? ""}
          onChange={onDiscountChange}
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          className="h-8 rounded-lg text-sm"
        />
      </LabeledNumber>
    </>
  );
}
