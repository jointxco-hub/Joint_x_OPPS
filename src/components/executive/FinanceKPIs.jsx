import React from "react";
import { TrendingUp, TrendingDown, DollarSign, ShoppingBag, CreditCard, Receipt } from "lucide-react";

function KPICard({ label, value, sub, icon: Icon, color, trend }) {
  const colors = {
    green: "bg-green-50 text-green-700 border-green-100",
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    orange: "bg-orange-50 text-orange-700 border-orange-100",
    purple: "bg-purple-50 text-purple-700 border-purple-100",
    red: "bg-red-50 text-red-700 border-red-100",
    teal: "bg-teal-50 text-teal-700 border-teal-100",
  };
  return (
    <div className={`rounded-2xl p-4 border ${colors[color]} flex flex-col gap-1`}>
      <Icon className="w-4 h-4 opacity-60 mb-1" />
      <p className="text-xl font-bold leading-tight">{value}</p>
      <p className="text-xs font-medium opacity-70">{label}</p>
      {sub && (
        <p className="text-xs opacity-60 flex items-center gap-1 mt-0.5">
          {trend === "up" && <TrendingUp className="w-3 h-3" />}
          {trend === "down" && <TrendingDown className="w-3 h-3" />}
          {sub}
        </p>
      )}
    </div>
  );
}

export default function FinanceKPIs({ payments, expenses, orders, monthlyData }) {
  const completedPayments = payments.filter(p => p.status === "completed");
  const totalRevenue = completedPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const totalTax = completedPayments.reduce((s, p) => s + (p.tax_amount || 0), 0);
  const netRevenue = totalRevenue - totalTax;

  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const grossProfit = netRevenue - totalExpenses;
  const profitMargin = netRevenue > 0 ? ((grossProfit / netRevenue) * 100).toFixed(1) : 0;

  const thisMonthRevenue = monthlyData[monthlyData.length - 1]?.revenue || 0;
  const lastMonthRevenue = monthlyData[monthlyData.length - 2]?.revenue || 0;
  const revenueGrowth = lastMonthRevenue > 0
    ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1)
    : null;

  const activeOrders = orders.filter(o => !["delivered", "cancelled"].includes(o.status) && !o.is_archived).length;
  const outstandingBalance = orders
    .filter(o => !o.is_archived && !["cancelled"].includes(o.status))
    .reduce((s, o) => s + ((o.total_amount || 0) - (o.deposit_paid || 0)), 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      <KPICard
        label="Total Revenue"
        value={`R${totalRevenue.toLocaleString()}`}
        icon={DollarSign}
        color="green"
      />
      <KPICard
        label="This Month"
        value={`R${thisMonthRevenue.toLocaleString()}`}
        sub={revenueGrowth !== null ? `${revenueGrowth > 0 ? "+" : ""}${revenueGrowth}% vs last` : undefined}
        trend={revenueGrowth > 0 ? "up" : "down"}
        icon={TrendingUp}
        color="blue"
      />
      <KPICard
        label="Total Expenses"
        value={`R${totalExpenses.toLocaleString()}`}
        icon={CreditCard}
        color="red"
      />
      <KPICard
        label="Gross Profit"
        value={`R${grossProfit.toLocaleString()}`}
        sub={`${profitMargin}% margin`}
        icon={TrendingUp}
        color={grossProfit >= 0 ? "teal" : "red"}
      />
      <KPICard
        label="VAT Collected"
        value={`R${totalTax.toLocaleString()}`}
        icon={Receipt}
        color="purple"
      />
      <KPICard
        label="Outstanding"
        value={`R${outstandingBalance.toLocaleString()}`}
        sub={`${activeOrders} active orders`}
        icon={ShoppingBag}
        color="orange"
      />
    </div>
  );
}