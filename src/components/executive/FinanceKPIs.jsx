import React from "react";
import {
  TrendingUp, TrendingDown, DollarSign, ShoppingBag,
  CreditCard, Receipt, AlertTriangle, TestTube, Archive,
  Banknote, Clock, ClipboardCheck, RotateCcw,
} from "lucide-react";

function KPICard({ label, value, sub, icon: Icon, color, trend, warning, onClick }) {
  const colors = {
    green:  "bg-green-50 text-green-700 border-green-100",
    blue:   "bg-blue-50 text-blue-700 border-blue-100",
    orange: "bg-orange-50 text-orange-700 border-orange-100",
    purple: "bg-purple-50 text-purple-700 border-purple-100",
    red:    "bg-red-50 text-red-700 border-red-100",
    teal:   "bg-teal-50 text-teal-700 border-teal-100",
    amber:  "bg-amber-50 text-amber-700 border-amber-100",
    slate:  "bg-slate-50 text-slate-600 border-slate-200",
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`rounded-2xl p-4 border ${colors[color] || colors.slate} flex flex-col gap-1 relative text-left w-full ${onClick ? "cursor-pointer hover:brightness-95 transition-all active:scale-[0.98]" : ""}`}
    >
      {warning && (
        <AlertTriangle className="absolute top-3 right-3 w-3 h-3 text-amber-400 opacity-70" />
      )}
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
    </Tag>
  );
}

export default function FinanceKPIs({ payments, expenses, orders, monthlyData, onNavigate }) {
  const nav = onNavigate ? (tab, filters) => onNavigate(tab, filters) : undefined;
  // ── Revenue ─────────────────────────────────────────────────
  const activePayments = payments.filter(p =>
    p.status === "completed" && !p.is_archived && !p.is_test && !p.excluded_from_reports
  );
  const totalRevenue = activePayments.reduce((s, p) => s + (p.amount || 0), 0);
  const totalTax     = activePayments.reduce((s, p) => s + (p.tax_amount || 0), 0);
  const netRevenue   = totalRevenue - totalTax;

  // ── Expenses ─────────────────────────────────────────────────
  const activeExpenses = expenses.filter(e =>
    !e.is_archived && !e.is_test && !e.excluded_from_reports
  );
  const totalExpenses    = activeExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const pendingExpenses  = activeExpenses
    .filter(e => e.approval_status === "submitted" || e.status === "needs_review")
    .reduce((s, e) => s + (e.amount || 0), 0);
  const unreviewedCount = activeExpenses.filter(e => e.status === "needs_review").length;
  const recoverableExpenses = activeExpenses
    .filter(e => e.is_client_recoverable && !["billed", "credited", "written_off"].includes(e.recovery_status))
    .reduce((s, e) => s + (e.amount || 0), 0);

  // ── Profit ───────────────────────────────────────────────────
  const grossProfit  = netRevenue - totalExpenses;
  const profitMargin = netRevenue > 0 ? ((grossProfit / netRevenue) * 100).toFixed(1) : 0;

  // ── Month data ───────────────────────────────────────────────
  const thisMonthEntry   = monthlyData[monthlyData.length - 1];
  const thisMonthRevenue = thisMonthEntry?.revenue || 0;
  const thisMonthKey     = thisMonthEntry?.monthKey || "";
  const lastMonthRevenue = monthlyData[monthlyData.length - 2]?.revenue || 0;
  const revenueGrowth = lastMonthRevenue > 0
    ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1)
    : null;

  // ── Orders ───────────────────────────────────────────────────
  const activeOrders = orders.filter(o =>
    !["delivered", "cancelled"].includes(o.status) && !o.is_archived
  );
  const outstandingBalance = orders
    .filter(o => !o.is_archived && !["cancelled"].includes(o.status))
    .reduce((s, o) => s + Math.max(0, (o.total_amount || 0) - (o.deposit_paid || 0)), 0);

  // ── Test / archived counts ────────────────────────────────────
  const testCount     = [...payments, ...expenses].filter(t => t.is_test).length;
  const archivedCount = [...payments, ...expenses].filter(t => t.is_archived).length;

  // ── Data completeness flags ───────────────────────────────────
  const noExpenses  = totalRevenue > 0 && totalExpenses === 0;
  const hasTestData = testCount > 0;

  return (
    <div className="space-y-3 mb-6">
      {/* Data health warnings */}
      {noExpenses && (
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Expenses may be incomplete.</strong> Revenue is being tracked but no expenses have been added yet.
            Profit figures are overstated — add costs to get an accurate picture.
          </span>
        </div>
      )}
      {hasTestData && (
        <div className="flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600">
          <TestTube className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            <strong>{testCount} test transaction{testCount !== 1 ? "s" : ""}</strong> detected.
            Totals above exclude them. Go to <em>Transactions</em> tab to archive or delete test data.
          </span>
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <KPICard
          label="Total Revenue"
          value={`R${totalRevenue.toLocaleString()}`}
          icon={DollarSign}
          color="green"
          onClick={nav ? () => nav("transactions", { type: "income" }) : undefined}
        />
        <KPICard
          label="This Month"
          value={`R${thisMonthRevenue.toLocaleString()}`}
          sub={revenueGrowth !== null
            ? `${Number(revenueGrowth) > 0 ? "+" : ""}${revenueGrowth}% vs last month`
            : undefined}
          trend={Number(revenueGrowth) > 0 ? "up" : "down"}
          icon={TrendingUp}
          color="blue"
          onClick={nav && thisMonthKey ? () => nav("transactions", { type: "income", month: thisMonthKey }) : undefined}
        />
        <KPICard
          label="Total Expenses"
          value={`R${totalExpenses.toLocaleString()}`}
          sub={pendingExpenses > 0 ? `R${pendingExpenses.toLocaleString()} pending` : undefined}
          icon={CreditCard}
          color={totalExpenses === 0 && totalRevenue > 0 ? "amber" : "red"}
          warning={totalExpenses === 0 && totalRevenue > 0}
          onClick={nav ? () => nav("transactions", { type: "expense" }) : undefined}
        />
        <KPICard
          label="Gross Profit"
          value={`R${grossProfit.toLocaleString()}`}
          sub={`${profitMargin}% margin${noExpenses ? " · may be overstated" : ""}`}
          icon={TrendingUp}
          color={grossProfit >= 0 ? "teal" : "red"}
          warning={noExpenses}
          onClick={nav ? () => nav("insights", {}) : undefined}
        />
        <KPICard
          label="VAT Collected"
          value={`R${totalTax.toLocaleString()}`}
          sub="Output VAT on income"
          icon={Receipt}
          color="purple"
          onClick={nav ? () => nav("transactions", { type: "income" }) : undefined}
        />
        <KPICard
          label="Outstanding"
          value={`R${outstandingBalance.toLocaleString()}`}
          sub={`${activeOrders.length} active order${activeOrders.length !== 1 ? "s" : ""}`}
          icon={ShoppingBag}
          color="orange"
          onClick={nav ? () => nav("transactions", { status: "outstanding" }) : undefined}
        />
        {pendingExpenses > 0 && (
          <KPICard
            label="Pending Expenses"
            value={`R${pendingExpenses.toLocaleString()}`}
            sub={unreviewedCount > 0 ? `${unreviewedCount} need review` : "Awaiting approval"}
            icon={Clock}
            color="amber"
            onClick={nav ? () => nav("transactions", { type: "expense", status: "pending" }) : undefined}
          />
        )}
        {recoverableExpenses > 0 && (
          <KPICard
            label="Recoverable"
            value={`R${recoverableExpenses.toLocaleString()}`}
            sub="Not yet billed"
            icon={RotateCcw}
            color="blue"
            onClick={nav ? () => nav("transactions", { type: "expense", recovery: "recoverable" }) : undefined}
          />
        )}
        {unreviewedCount > 0 && (
          <KPICard
            label="Needs Review"
            value={unreviewedCount}
            sub="Quick captures"
            icon={ClipboardCheck}
            color="orange"
            onClick={nav ? () => nav("transactions", { type: "expense", status: "needs_review" }) : undefined}
          />
        )}
        {testCount > 0 && (
          <KPICard
            label="Test Transactions"
            value={testCount}
            sub="Excluded from totals"
            icon={TestTube}
            color="slate"
            onClick={nav ? () => nav("transactions", { showTestOnly: true }) : undefined}
          />
        )}
        {archivedCount > 0 && (
          <KPICard
            label="Archived"
            value={archivedCount}
            sub="Not in totals"
            icon={Archive}
            color="slate"
            onClick={nav ? () => nav("transactions", { showArchived: true }) : undefined}
          />
        )}
      </div>
    </div>
  );
}



