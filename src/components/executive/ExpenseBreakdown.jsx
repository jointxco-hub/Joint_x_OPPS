import React from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

const CATEGORY_LABELS = {
  production: "Production",
  raw_materials: "Raw Materials",
  packaging: "Packaging",
  shipping: "Shipping",
  marketing: "Marketing",
  software: "Software",
  rent_utilities: "Rent & Utilities",
  wages: "Wages",
  admin: "Admin",
  owner_drawings: "Owner Drawings",
};

const COLORS = [
  "#3b82f6", "#ef4444", "#f59e0b", "#10b981",
  "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"
];

export default function ExpenseBreakdown({ expenses }) {
  const categoryTotals = expenses.reduce((acc, e) => {
    const key = e.category || "admin";
    acc[key] = (acc[key] || 0) + (e.amount || 0);
    return acc;
  }, {});

  const data = Object.entries(categoryTotals)
    .map(([key, value]) => ({ name: CATEGORY_LABELS[key] || key, value }))
    .sort((a, b) => b.value - a.value);

  const total = data.reduce((s, d) => s + d.value, 0);

  if (data.length === 0) {
    return (
      <div className="bg-card rounded-2xl border border-border shadow-apple-sm p-5 flex items-center justify-center min-h-[200px]">
        <p className="text-muted-foreground text-sm">No expenses recorded yet</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl border border-border shadow-apple-sm p-5">
      <h2 className="text-sm font-semibold text-foreground mb-4">Expense Breakdown</h2>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: 11 }}
            formatter={(v) => [`R${v.toLocaleString()}`, ""]}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-3 space-y-1.5">
        {data.slice(0, 5).map((d, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="text-muted-foreground">{d.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">R{d.value.toLocaleString()}</span>
              <span className="text-muted-foreground opacity-60">{total > 0 ? ((d.value / total) * 100).toFixed(0) : 0}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}