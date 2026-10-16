import { useState } from "react";
import { calculateManufacturingQuote } from "./manufacturingCosting";

const INITIAL = { quantity: "2", materialUnit: "", brandingUnit: "", labourReferenceUnit: "", overheadUnit: "", setup: "" };
const fields = [
  ["quantity", "Quantity"], ["materialUnit", "Materials / garment (R)"],
  ["brandingUnit", "Branding / garment (R)"], ["labourReferenceUnit", "Reference sewing / garment (R)"],
  ["overheadUnit", "Overhead / garment (R)"], ["setup", "One-time pattern and setup (R)"],
];
const ERROR_LABELS = Object.fromEntries(fields.map(([key, label]) => [key, label]));
const rand = (n) => "R" + n.toFixed(2);
export default function ManufacturingCostingPanel({ onApply }) {
  const [values, setValues] = useState(INITIAL);
  const [arrangement, setArrangement] = useState("service_exchange");
  const [markup, setMarkup] = useState("50");
  const [contingency, setContingency] = useState("10");
  const [confirmed, setConfirmed] = useState(false);
  const [garment, setGarment] = useState({ name: "", category: "", fabric: "", construction: "", branding: "" });
  const changeGarment = (key, value) => { setGarment((prev) => ({ ...prev, [key]: value })); setConfirmed(false); };
  let result, error;
  try {
    const numbers = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim() === "" ? NaN : Number(value)]));
    result = calculateManufacturingQuote({
      ...numbers, partnerArrangement: arrangement,
      markupRate: Number(markup) / 100, contingencyRate: Number(contingency) / 100,
    });
  } catch (e) {
    const match = /^Invalid nonnegative amount: (.+)$/.exec(e.message);
    error = match ? `Enter a valid amount for ${ERROR_LABELS[match[1]] || match[1]}. Use 0 if there is no cost.` : e.message;
  }
  const garmentReady = Boolean(garment.name.trim() && garment.category.trim() && garment.fabric.trim());
  return (
    <section className="mb-4 rounded-2xl border border-border bg-card p-4" aria-label="Custom manufacturing calculator">
      <h2 className="text-sm font-semibold">Custom manufacturing · internal calculator</h2>
      <p className="mt-1 text-xs text-muted-foreground">Enter approved costs before applying a quote line. Reference values are not supplier invoices. No supplier payment is created.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {[
          ["name", "Garment name", "e.g. Halter crop top"],
          ["category", "Garment category", "e.g. Cut and sew top"],
          ["fabric", "Fabric / material", "e.g. Cotton rib knit"],
          ["branding", "Branding method", "e.g. DTF / embroidery / none"],
        ].map(([key, label, placeholder]) => <label key={key} className="text-xs font-medium">{label}
          <input className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={garment[key]} placeholder={placeholder} onChange={(e) => changeGarment(key, e.target.value)} />
        </label>)}
        <label className="text-xs font-medium sm:col-span-2">Construction and specifications
          <textarea className="mt-1 block min-h-16 w-full rounded-lg border border-input bg-background p-3 text-sm" value={garment.construction} placeholder="Fit, seams, finishing, sample approval requirements" onChange={(e) => changeGarment("construction", e.target.value)} />
        </label>
      </div>
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
      {!garmentReady ? <p className="mt-2 text-xs text-muted-foreground">Enter garment name, category and fabric to add a quote line.</p> : null}
      <button type="button" className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40" disabled={!result || !confirmed || !garmentReady} onClick={() => onApply({ name: garment.name.trim(), description: [garment.category.trim(), `Fabric: ${garment.fabric.trim()}`, garment.branding.trim() ? `Branding: ${garment.branding.trim()}` : "", garment.construction.trim(), "Specifications subject to approved sample."].filter(Boolean).join(". "), quantity: result.quantity, rate: result.unitSellPrice })}>Add priced line to quote</button>
    </section>
  );
}
