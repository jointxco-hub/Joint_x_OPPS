// Joint X custom manufacturing costing — isolated Phase 1 engine.
// All money values are ZAR; callers supply approved rates, never inferred prices.
// No database writes, purchase orders, or partner payables are created here.
const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const nonnegative = (value, field) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid nonnegative amount: ${field}`);
  }
  return value;
};
export function calculateManufacturingQuote(input) {
  const quantity = input.quantity;
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("Quantity must be a positive integer");
  const materialUnit = nonnegative(input.materialUnit, "materialUnit");
  const brandingUnit = nonnegative(input.brandingUnit, "brandingUnit");
  const labourReferenceUnit = nonnegative(input.labourReferenceUnit, "labourReferenceUnit");
  const overheadUnit = nonnegative(input.overheadUnit, "overheadUnit");
  const setup = nonnegative(input.setup, "setup");
  const contingencyRate = nonnegative(input.contingencyRate ?? 0.1, "contingencyRate");
  const markupRate = nonnegative(input.markupRate ?? 0.5, "markupRate");
  const arrangement = input.partnerArrangement ?? "standard";
  if (!["standard", "service_exchange"].includes(arrangement)) throw new Error("Unknown partner arrangement");
  const negotiatedCashUnit = nonnegative(input.negotiatedCashUnit ?? 0, "negotiatedCashUnit");
  const negotiatedCashApproved = input.negotiatedCashApproved === true;
  if (negotiatedCashUnit > 0 && !negotiatedCashApproved) throw new Error("Negotiated partner cash charge requires approval");
  if (arrangement === "standard" && negotiatedCashUnit > 0) throw new Error("Negotiated cash override only applies to service exchange");
  const standardLabour = money(labourReferenceUnit * quantity);
  const partnerCashPayable = arrangement === "service_exchange"
    ? money(negotiatedCashUnit * quantity) : standardLabour;
  const baseCost = money((materialUnit + brandingUnit + labourReferenceUnit + overheadUnit) * quantity + setup);
  const contingency = money(baseCost * contingencyRate);
  const fullCost = money(baseCost + contingency);
  const targetSellTotal = money(fullCost * (1 + markupRate));
  // OPPS quotes calculate quantity × rounded unit rate. Align the displayed
  // estimate to the actual quote line rather than silently losing cents.
  const unitSellPrice = money(targetSellTotal / quantity);
  const sellTotal = money(unitSellPrice * quantity);
  const cashCost = money((materialUnit + brandingUnit + overheadUnit) * quantity + setup + partnerCashPayable);
  return {
    quantity, arrangement, standardLabour, partnerCashPayable,
    baseCost, contingency, fullCost, sellTotal,
    unitSellPrice,
    roundingAdjustment: money(sellTotal - targetSellTotal),
    cashCost,
    cashContributionBeforeUnallocatedCosts: money(sellTotal - cashCost),
    fullyCostedContribution: money(sellTotal - fullCost),
    // Cash cost excludes reference labour under service exchange.
    // Contingency is a pricing allowance, not a booked cash expense.
  };
}
