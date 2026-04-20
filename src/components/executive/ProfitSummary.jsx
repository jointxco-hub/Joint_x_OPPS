import React from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";

export default function ProfitSummary({ payments, expenses }) {
  const completed = payments.filter(p => p.status === "completed");
  const totalRevenue = completed.reduce((s, p) => s + (p.amount || 0), 0);
  const totalVAT = completed.reduce((s, p) => s + (p.tax_amount || 0), 0);
  const netRevenue = totalRevenue - totalVAT;
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const expenseVAT = expenses.reduce((s, e) => s + (e.vat_amount || 0), 0);
  const grossProfit = netRevenue - totalExpenses;
  const vatPayable = totalVAT - expenseVAT;

  const rows = [
    { label: "Gross Revenue", value: totalRevenue, positive: true },
    { label: "VAT Collected (Output)", value: -totalVAT, positive: false },
    { label: "Net Revenue", value: netRevenue, positive: true, bold: true },
    { label: "Total Expenses", value: -totalExpenses, positive: false },
    { label: "Gross Profit", value: grossProfit, positive: grossProfit >= 0, bold: true },
    null,
    { label: "VAT on Expenses (Input)", value: expenseVAT, positive: true },
    { label: "VAT Payable to SARS", value: vatPayable, positive: vatPayable <= 0, bold: true },
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
              </span>
              <span className={`text-xs font-medium ${
                row.bold
                  ? row.positive ? "text-green-600" : "text-red-500"
                  : row.positive ? "text-foreground" : "text-red-500"
              }`}>
                {row.value < 0 ? "-" : ""}R{Math.abs(row.value).toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}