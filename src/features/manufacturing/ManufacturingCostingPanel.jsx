import { useState } from "react";
import { calculateManufacturingQuote } from "./manufacturingCosting";

const INITIAL = { quantity: "2", materialUnit: "215", brandingUnit: "140", labourReferenceUnit: "460", overheadUnit: "75", setup: "250" };
const fields = [
  ["quantity", "Quantity"], ["materialUnit", "Materials / garment (R)"],
  ["brandingUnit", "Branding / garment (R)"], ["labourReferenceUnit", "Reference sewing / garment (R)"],
  ["overheadUnit", "Overhead / garment (R)"], ["setup", "One-time pattern and setup (R)"],
];
const rand = (n) => "R" + n.toFixed(2);
export default function ManufacturingCostingPanel({ onApply }) {
  const [values, setValues] = useState(INITIAL);
  const [arrangement, setArrangement] = useState("service_exchange");
  const [markup, setMarkup] = useState("50");
  const [contingency, setContingency] = useState("10");
  const [confirmed, setConfirmed] = useState(false);
  let result, error;
  try {
    const numbers = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim() === "" ? NaN : Number(value)]));
    result = calculateManufacturingQuote({
      ...numbers, partnerArrangement: arrangement,
      markupRate: Number(markup) / 100, contingencyRate: Number(contingency) / 100,
    });
  } catch (e) { error = e.message; }
  return (
    <section className="mb-4 rounded-2xl border border-border bg-card p-4" aria-label="Custom manufacturing calculator">
      <h2 className="text-sm font-semibold">Custom manufacturing · internal calculator</h2>
      <p className="mt-1 text-xs text-muted-foreground">Pilot rates only. Confirm fabric, construction and branding before applying a quote line. No supplier payment is created.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label]) => <label key={key} className="text-xs font-medium">{label}
          <input className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" type="number" min={key === "quantity" ? "1" : "0"} step={key === "quantity" ? "1" : "0.01"} value={values[key]} onChange={(e) => { setValues((old) => ({ ...old, [key]: e.target.value })); setConfirmed(false); }} />
        </label>)}
        <label className="text-xs font-medium">Partner arrangement
          <select className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={arrangement} onChange={(e) => { setArrangement(e.target.value); setConfirmed(false); }}>
            <option value="service_exchange">Service exchange · no cash sewing fee</option>
            <option value="standard">Standard paid production</option>
          </select>
        </label>
        {[["markup", "Markup (%)", markup, setMarkup], ["contingency", "Contingency (%)", contingency, setContingency]].map(([key, label, value, setter]) => <label key={key} className="text-xs font-medium">{label}
          <input className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" type="number" min="0" step="1" value={value} onChange={(e) => { setter(e.target.value); setConfirmed(false); }} />
        </label>)}
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : result ? <div className="mt-3 rounded-xl bg-secondary/40 p-3 text-sm">
        <p>Standard labour value: {rand(result.standardLabour)} · Partner cash payable: {rand(result.partnerCashPayable)}</p>
        <p>Fully costed estimate: {rand(result.fullCost)}</p>
        <p className="font-semibold">Client estimate: {rand(result.sellTotal)} ({rand(result.unitSellPrice)} / garment)</p>
      </div> : null}
      <label className="mt-3 flex items-start gap-2 text-xs">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        I have confirmed material requirements, branding method, and construction assumptions.
      </label>
      <button type="button" className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40" disabled={!result || !confirmed} onClick={() => onApply({ name: "Custom cut & sew garment", description: "Custom garment production including materials, pattern, cutting, sewing and branding. Specifications subject to approved sample.", quantity: result.quantity, rate: result.unitSellPrice })}>Add priced line to quote</button>
    </section>
  );
}
