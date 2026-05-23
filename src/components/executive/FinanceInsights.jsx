import React, { useState, useMemo } from "react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { AlertTriangle, TrendingDown, TrendingUp, Info, CheckCircle, X, Lightbulb } from "lucide-react";

const DISMISSED_KEY = "finance_insights_dismissed";

function getDismissed() {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"); } catch { return []; }
}
function saveDismissed(list) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(list)); } catch {}
}

// ── Deterministic insight generation ─────────────────────────

function generateInsights({ payments = [], expenses = [], orders = [] }) {
  const insights = [];
  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const thisMonthEnd = endOfMonth(now);
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const lastMonthEnd = endOfMonth(subMonths(now, 1));

  const completedPayments = payments.filter(p => p.status === "completed" && !p.is_archived && !p.is_test && !p.excluded_from_reports);
  const activeExpenses = expenses.filter(e => !e.is_archived && !e.is_test && !e.excluded_from_reports);

  const totalRevenue = completedPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const totalExpenses = activeExpenses.reduce((s, e) => s + (e.amount || 0), 0);

  // ── 1. Critical: test transactions included ──────────────────
  const testTxCount = [...payments, ...expenses].filter(t => t.is_test).length;
  if (testTxCount > 0) {
    insights.push({
      id: "test_transactions",
      level: "critical",
      icon: "alert",
      title: "Test transactions detected",
      message: `${testTxCount} test transaction${testTxCount !== 1 ? "s are" : " is"} included. Archive or exclude them so your totals are accurate.`,
      action: "Review test transactions",
    });
  }

  // ── 2. Critical: no expenses at all ─────────────────────────
  if (totalRevenue > 0 && totalExpenses === 0) {
    insights.push({
      id: "no_expenses",
      level: "critical",
      icon: "alert",
      title: "No expenses recorded",
      message: "Revenue is being tracked but no expenses have been added. Your profit figure is overstated — add costs to get an accurate picture.",
    });
  }

  // ── 3. Outstanding payments ──────────────────────────────────
  const outstandingOrders = orders.filter(o =>
    !o.is_archived && !["cancelled", "delivered"].includes(o.status) &&
    (o.total_amount || 0) - (o.deposit_paid || 0) > 0
  );
  if (outstandingOrders.length > 0) {
    const outstandingTotal = outstandingOrders.reduce(
      (s, o) => s + ((o.total_amount || 0) - (o.deposit_paid || 0)), 0
    );
    insights.push({
      id: "outstanding_orders",
      level: "warning",
      icon: "warning",
      title: `${outstandingOrders.length} orders have outstanding balances`,
      message: `R${outstandingTotal.toLocaleString()} is still owed across ${outstandingOrders.length} active order${outstandingOrders.length !== 1 ? "s" : ""}. Follow up to improve cash flow.`,
    });
  }

  // ── 4. Uncategorised transactions ───────────────────────────
  const uncatCount = activeExpenses.filter(e => !e.expense_category && !e.category).length +
    completedPayments.filter(p => !p.category).length;
  if (uncatCount > 0) {
    insights.push({
      id: "uncategorised",
      level: "warning",
      icon: "info",
      title: `${uncatCount} uncategorised transaction${uncatCount !== 1 ? "s" : ""}`,
      message: "Some transactions have no category. Categorise them for accurate reporting and expense breakdowns.",
    });
  }

  // ── 5. Expenses missing key categories ──────────────────────
  const expenseCategories = new Set(activeExpenses.map(e => e.expense_category || e.category));
  if (totalRevenue > 0 && !expenseCategories.has("shipping") && !expenseCategories.has("courier_delivery")) {
    insights.push({
      id: "no_courier_expenses",
      level: "info",
      icon: "tip",
      title: "Courier costs not tracked",
      message: "No delivery or courier expenses recorded. If you ship orders, add these costs to keep profit accurate.",
    });
  }
  if (totalRevenue > 0 && !expenseCategories.has("bank_fees") && !expenseCategories.has("bank_payment_fees")) {
    insights.push({
      id: "no_bank_fees",
      level: "info",
      icon: "tip",
      title: "Payment fees not tracked",
      message: "PayFast and bank fees are not recorded as expenses. Adding them will reduce your overstated profit.",
    });
  }

  // ── 6. Month-on-month revenue trend ─────────────────────────
  const thisMonthRev = completedPayments
    .filter(p => { try { const d = new Date(p.payment_date || p.date); return d >= thisMonthStart && d <= thisMonthEnd; } catch { return false; } })
    .reduce((s, p) => s + (p.amount || 0), 0);
  const lastMonthRev = completedPayments
    .filter(p => { try { const d = new Date(p.payment_date || p.date); return d >= lastMonthStart && d <= lastMonthEnd; } catch { return false; } })
    .reduce((s, p) => s + (p.amount || 0), 0);

  if (lastMonthRev > 0) {
    const change = ((thisMonthRev - lastMonthRev) / lastMonthRev) * 100;
    if (change < -20) {
      insights.push({
        id: "revenue_down",
        level: "warning",
        icon: "down",
        title: `Revenue is down ${Math.abs(change).toFixed(0)}% this month`,
        message: `This month: R${thisMonthRev.toLocaleString()} vs last month: R${lastMonthRev.toLocaleString()}. Review your pipeline.`,
      });
    } else if (change > 20) {
      insights.push({
        id: "revenue_up",
        level: "positive",
        icon: "up",
        title: `Revenue up ${change.toFixed(0)}% this month`,
        message: `This month: R${thisMonthRev.toLocaleString()} vs last month: R${lastMonthRev.toLocaleString()}. Strong performance.`,
      });
    }
  } else if (thisMonthRev === 0) {
    insights.push({
      id: "no_revenue_this_month",
      level: "info",
      icon: "info",
      title: `No revenue recorded for ${format(now, "MMMM")} yet`,
      message: "No completed payments this month. If orders exist, make sure payments are recorded.",
    });
  }

  // ── 7. Expense spike ─────────────────────────────────────────
  const thisMonthExp = activeExpenses
    .filter(e => { try { const d = new Date(e.expense_date || e.date); return d >= thisMonthStart && d <= thisMonthEnd; } catch { return false; } })
    .reduce((s, e) => s + (e.amount || 0), 0);
  if (thisMonthExp > thisMonthRev && thisMonthRev > 0) {
    insights.push({
      id: "expenses_exceed_revenue",
      level: "critical",
      icon: "alert",
      title: "Expenses exceed revenue this month",
      message: `Expenses (R${thisMonthExp.toLocaleString()}) are higher than revenue (R${thisMonthRev.toLocaleString()}) this month. Review your spending.`,
    });
  }

  // ── 8. Pending expense approvals ────────────────────────────
  const pendingExpenses = activeExpenses.filter(e => e.approval_status === "submitted");
  if (pendingExpenses.length > 0) {
    const pendingTotal = pendingExpenses.reduce((s, e) => s + (e.amount || 0), 0);
    insights.push({
      id: "pending_expenses",
      level: "info",
      icon: "info",
      title: `${pendingExpenses.length} expense${pendingExpenses.length !== 1 ? "s" : ""} awaiting approval`,
      message: `R${pendingTotal.toLocaleString()} in expenses are submitted but not yet approved.`,
    });
  }

  return insights;
}

// ── Insight card ─────────────────────────────────────────────

const LEVEL_STYLES = {
  critical: { bg: "bg-red-50 border-red-200", text: "text-red-700", icon: "text-red-500" },
  warning:  { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", icon: "text-amber-500" },
  info:     { bg: "bg-blue-50 border-blue-200", text: "text-blue-700", icon: "text-blue-400" },
  positive: { bg: "bg-green-50 border-green-200", text: "text-green-700", icon: "text-green-500" },
};

function InsightIcon({ type, cls }) {
  if (type === "alert")   return <AlertTriangle className={`w-4 h-4 ${cls}`} />;
  if (type === "warning") return <AlertTriangle className={`w-4 h-4 ${cls}`} />;
  if (type === "down")    return <TrendingDown className={`w-4 h-4 ${cls}`} />;
  if (type === "up")      return <TrendingUp className={`w-4 h-4 ${cls}`} />;
  if (type === "tip")     return <Lightbulb className={`w-4 h-4 ${cls}`} />;
  return <Info className={`w-4 h-4 ${cls}`} />;
}

export default function FinanceInsights({ payments, expenses, orders }) {
  const [dismissed, setDismissed] = useState(() => getDismissed());

  const insights = useMemo(() => generateInsights({ payments, expenses, orders }), [payments, expenses, orders]);
  const visible = insights.filter(i => !dismissed.includes(i.id));

  const dismiss = (id) => {
    const next = [...dismissed, id];
    setDismissed(next);
    saveDismissed(next);
  };

  const resetAll = () => {
    setDismissed([]);
    saveDismissed([]);
  };

  if (insights.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-primary" /> Finance Insights
        </h2>
        <div className="flex items-center gap-2 text-muted-foreground py-4">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <p className="text-sm">No issues detected. Your finance data looks clean.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-primary" /> Finance Insights
          {visible.length > 0 && (
            <span className="text-[10px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {visible.length}
            </span>
          )}
        </h2>
        {dismissed.length > 0 && (
          <button onClick={resetAll} className="text-xs text-muted-foreground hover:text-foreground underline">
            Show all ({dismissed.length} hidden)
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <p className="text-sm">All insights dismissed.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.map(insight => {
            const s = LEVEL_STYLES[insight.level] || LEVEL_STYLES.info;
            return (
              <div key={insight.id} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${s.bg}`}>
                <InsightIcon type={insight.icon} cls={s.icon} />
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold ${s.text}`}>{insight.title}</p>
                  <p className={`text-xs mt-0.5 opacity-80 ${s.text}`}>{insight.message}</p>
                </div>
                <button onClick={() => dismiss(insight.id)}
                  className={`flex-shrink-0 w-5 h-5 rounded-full hover:bg-black/10 flex items-center justify-center transition-all ${s.text} opacity-50 hover:opacity-100`}>
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
