import test from "node:test";
import assert from "node:assert/strict";
import { calculateManufacturingQuote } from "../src/features/manufacturing/manufacturingCosting.js";
const base = {
  quantity: 2, materialUnit: 215, brandingUnit: 140,
  labourReferenceUnit: 460, overheadUnit: 75, setup: 250,
  contingencyRate: 0.1, markupRate: 0.5,
  partnerArrangement: "service_exchange",
};
test("two halter tops: labour valued but no partner cash payable", () => {
  const result = calculateManufacturingQuote(base);
  assert.equal(result.standardLabour, 920);
  assert.equal(result.partnerCashPayable, 0);
  assert.equal(result.baseCost, 2030);
  assert.equal(result.fullCost, 2233);
  assert.equal(result.sellTotal, 3349.5);
  assert.equal(result.unitSellPrice, 1674.75);
});
test("large jobs never automatically add a partner fee", () => {
  const result = calculateManufacturingQuote({ ...base, quantity: 100 });
  assert.equal(result.partnerCashPayable, 0);
});
test("negotiated fee requires explicit approval", () => {
  assert.throws(() => calculateManufacturingQuote({ ...base, negotiatedCashUnit: 50 }), /requires approval/);
  assert.equal(calculateManufacturingQuote({ ...base, negotiatedCashUnit: 50, negotiatedCashApproved: true }).partnerCashPayable, 100);
});
test("standard paid partner includes labour in cash costs", () => {
  const result = calculateManufacturingQuote({ ...base, partnerArrangement: "standard" });
  assert.equal(result.partnerCashPayable, 920);
});
test("invalid inputs are rejected", () => {
  assert.throws(() => calculateManufacturingQuote({ ...base, quantity: 0 }));
  assert.throws(() => calculateManufacturingQuote({ ...base, materialUnit: -1 }));
  assert.throws(() => calculateManufacturingQuote({ ...base, brandingUnit: NaN }));
});
