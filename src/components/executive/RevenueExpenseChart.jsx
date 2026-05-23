import React from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from "recharts";

export default function RevenueExpenseChart({ monthlyData, onNavigate }) {
  const handleBarClick = (entry) => {
    if (!onNavigate || !entry?.monthKey) return;
    onNavigate("transactions", { month: entry.monthKey });
  };

  return (
    <div className="bg-card rounded-2xl border border-border shadow-apple-sm p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Revenue vs Expenses (Last 6 Months)</h2>
        {onNavigate && (
          <p className="text-[10px] text-muted-foreground">Click a bar to inspect that month</p>
        )}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={monthlyData}
          margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
          style={onNavigate ? { cursor: "pointer" } : undefined}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "12px",
              fontSize: 12,
            }}
            formatter={(v, name) => [`R${v.toLocaleString()}`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="revenue" name="Revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} onClick={handleBarClick} />
          <Bar dataKey="expenses" name="Expenses" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} opacity={0.75} onClick={handleBarClick} />
          <Bar dataKey="profit" name="Profit" fill="#22c55e" radius={[4, 4, 0, 0]} opacity={0.8} onClick={handleBarClick} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}