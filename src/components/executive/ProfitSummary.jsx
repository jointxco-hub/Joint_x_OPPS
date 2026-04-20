import React from "react";
import { format } from "date-fns";
import { AlertCircle } from "lucide-react";

// SBC Tax Brackets 2025/2026 (SARS)
function calcSBCTax(taxableIncome) {
  if (taxableIncome <= 0) return 0;
  if (taxableIncome <= 95750) return 0;
  if (taxableIncome <= 365000) return (taxableIncome - 95750) * 0.07;
  if (taxableIncome <= 550000) return 18848 + (taxableIncome - 365000) * 0.21;
  return 57698 + (taxableIncome - 550000) * 0.28;
}

export default function ProfitSummary({ payments, expenses }) {
  const completed = payments.filter(p => p.status === "completed");
  const totalRevenue = completed.reduce((s, p) => s + (p.amount || 0), 0);
  const totalVAT = completed.reduce((s, p) => s + (p.tax_amount || 0), 0);
  const netRevenue = totalRevenue - totalVAT;
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const expenseVAT = expenses.reduce((s, e) => s + (e.vat_amount || 0), 0);
  const grossProfit = netRevenue - totalExpenses;
  const vatPayable = totalVAT - expenseVAT;

  // Income tax estimate (SBC)
  const taxableIncome = grossProfit; // simplified: profit before owner drawings
  const incomeTaxEstimate = calcSBCTax(taxableIncome);

  // Provisional tax due date reminder
  const now = new Date();
  const provisionalDue = new Date(now.getFullYear(), 1, 28); // Feb 28
  if (provisionalDue < now) provisionalDue.setFullYear(now.getFullYear() + 1);
  const daysUntilDue = Math.ceil((provisionalDue - now) / (1000 * 60 * 60 * 24));

  const rows = [
    { label: "Gross Revenue", value: totalRevenue, positive: true },
    { label: "VAT Collected (Output)", value: -totalVAT, positive: false },
    { label: "Net Revenue", value: netRevenue, positive: true, bold: true },
    { label: "Total Expenses (incl. VAT)", value: -totalExpenses, positive: false },
    { label: "Gross Profit", value: grossProfit, positive: grossProfit >= 0, bold: true },
    null,
    { label: "VAT on Expenses (Input)", value: expenseVAT, positive: true },
    { label: "VAT Payable to SARS", value: vatPayable, positive: vatPayable <= 0, bold: true },
    null,
    { label: "SBC Income Tax Estimate", value: -incomeTaxEstimate, positive: false, bold: true, tax: true },
    { label: "Net After Tax (Est.)", value: grossProfit - incomeTaxEstimate, positive: (grossProfit - incomeTaxEstimate) >= 0, bold: true },
  ];

  const thisMonth = format(new Date(), "MMMM yyyy");

  return (
    <div className="bg-card rounded-2xl border border-border shadow-apple-sm p-5">
      <h2 className="text-sm font-semibold text-foreground mb-1">P&L Summary</h2>
      <p className="text-xs text-muted-foreground mb-4">All time · {thisMonth}</p>
      <div className="space-y-1.5">
        {rows.map((row, i) => {
          if (row === null) return <div key={i} className="border-t border-border my-2" />;
          return (
            <div key={i} className={`flex items-center justify-between py-1 ${row.bold ? "border-t border-border mt-1 pt-2" : ""}`}>
              <span className={`text-xs ${row.bold ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                {row.label}
                {row.tax && <span className="ml-1 text-[10px] text-orange-500 font-normal">(SBC estimate)</span>}
              </span>
              <span className={`text-xs font-medium ${
                row.bold
                  ? row.positive ? "text-green-600" : "text-red-500"
                  : row.positive ? "text-foreground" : "text-red-500"
              }`}>
                {row.value < 0 ? "-" : ""}R{Math.abs(row.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
          );
        })}
      </div>

      {/* Provisional Tax Reminder */}
      <div className={`mt-4 flex items-start gap-2 rounded-xl p-3 text-xs ${daysUntilDue <= 30 ? "bg-red-50 text-red-700" : "bg-orange-50 text-orange-700"}`}>
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-semibold">Provisional Tax Due: 28 Feb {provisionalDue.getFullYear()}</p>
          <p className="opacity-80">{daysUntilDue} days away · Pay to SARS via eFiling</p>
        </div>
      </div>
    </div>
  );
}