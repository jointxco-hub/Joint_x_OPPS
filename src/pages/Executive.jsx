import React, { useState, useEffect } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery } from "@tanstack/react-query";
import { BarChart2, Target, Lock, Settings, Eye, EyeOff, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { toast } from "sonner";
import FinanceKPIs from "@/components/executive/FinanceKPIs";
import RevenueExpenseChart from "@/components/executive/RevenueExpenseChart";
import ExpenseBreakdown from "@/components/executive/ExpenseBreakdown";
import ProfitSummary from "@/components/executive/ProfitSummary";
import AddExpenseDrawer from "@/components/executive/AddExpenseDrawer";

const DEFAULT_PIN = "1234";
const PIN_STORAGE_KEY = "exec_pin_hash";

// Simple local PIN — stored in localStorage, settable by admin
function getStoredPin() {
  return localStorage.getItem(PIN_STORAGE_KEY) || DEFAULT_PIN;
}

export default function Executive() {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [showChangePIN, setShowChangePIN] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    dataClient.auth.me().then(setUser).catch(() => {});
  }, []);

  const handlePin = (e) => {
    e.preventDefault();
    if (pin === getStoredPin()) {
      setUnlocked(true);
      setError("");
    } else {
      setError("Incorrect PIN");
      setPin("");
    }
  };

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card rounded-3xl border border-border shadow-apple-xl p-8 w-full max-w-sm text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-1">Executive View</h2>
          <p className="text-muted-foreground text-sm mb-6">Enter PIN to access financial overview</p>
          <form onSubmit={handlePin} className="space-y-3">
            <Input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value)}
              placeholder="Enter PIN"
              className="text-center text-lg tracking-widest rounded-xl"
              maxLength={8}
              autoFocus
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <Button type="submit" className="w-full rounded-xl">Unlock</Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <ExecutiveDashboard
      user={user}
      showChangePIN={showChangePIN}
      setShowChangePIN={setShowChangePIN}
      onLock={() => setUnlocked(false)}
    />
  );
}

function ExecutiveDashboard({ user, showChangePIN, setShowChangePIN, onLock }) {
  const [showAddExpense, setShowAddExpense] = useState(false);
  const { data: orders = [] } = useQuery({
    queryKey: ["exec-orders"],
    queryFn: () => dataClient.entities.Order.list("-created_date", 500),
  });
  const { data: payments = [] } = useQuery({
    queryKey: ["exec-payments"],
    queryFn: () => dataClient.entities.Payment.list("-payment_date", 500),
  });
  const { data: expenses = [], refetch: refetchExpenses } = useQuery({
    queryKey: ["exec-expenses"],
    queryFn: () => dataClient.entities.Expense.list("-date", 500),
  });
  const { data: goals = [] } = useQuery({
    queryKey: ["exec-goals"],
    queryFn: () => dataClient.entities.Goal.list(),
  });

  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const month = subMonths(new Date(), 5 - i);
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    const monthPayments = payments.filter(p => {
      if (!p.payment_date || p.status !== "completed") return false;
      const d = new Date(p.payment_date);
      return d >= start && d <= end;
    });
    const monthExpenses = expenses.filter(e => {
      if (!e.date) return false;
      const d = new Date(e.date);
      return d >= start && d <= end;
    });
    const revenue = monthPayments.reduce((s, p) => s + (p.amount || 0), 0);
    const exp = monthExpenses.reduce((s, e) => s + (e.amount || 0), 0);
    return {
      month: format(month, "MMM"),
      revenue,
      expenses: exp,
      profit: revenue - exp,
    };
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 md:py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-7">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
              <BarChart2 className="w-6 h-6 text-primary" /> Finance Overview
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">{format(new Date(), "MMMM yyyy")}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="rounded-xl gap-1.5" onClick={() => setShowAddExpense(true)}>
              <PlusCircle className="w-3.5 h-3.5" /> Add Expense
            </Button>
            {user?.role === 'admin' && (
              <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={() => setShowChangePIN(true)}>
                <Settings className="w-3.5 h-3.5" /> PIN Settings
              </Button>
            )}
            <Button variant="ghost" size="sm" className="rounded-xl text-muted-foreground" onClick={onLock}>
              <Lock className="w-3.5 h-3.5 mr-1" /> Lock
            </Button>
          </div>
        </div>

        {/* Add Expense Drawer */}
        {showAddExpense && (
          <AddExpenseDrawer
            onClose={() => setShowAddExpense(false)}
            onSaved={refetchExpenses}
          />
        )}

        {/* PIN Settings Modal */}
        {showChangePIN && user?.role === 'admin' && (
          <PINSettingsModal onClose={() => setShowChangePIN(false)} />
        )}

        {/* KPI Cards */}
        <FinanceKPIs payments={payments} expenses={expenses} orders={orders} monthlyData={monthlyData} />

        {/* Revenue vs Expenses Chart */}
        <RevenueExpenseChart monthlyData={monthlyData} />

        {/* Bottom row: Expense Breakdown + P&L Summary + Goals */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
          <ExpenseBreakdown expenses={expenses} />
          <ProfitSummary payments={payments} expenses={expenses} />

          {/* Goals */}
          <div className="bg-card rounded-2xl border border-border shadow-apple-sm p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> Active Goals
            </h2>
            {goals.filter(g => g.status === "active").length === 0 ? (
              <p className="text-muted-foreground text-sm text-center mt-8">No active goals</p>
            ) : (
              <div className="space-y-4">
                {goals.filter(g => g.status === "active").map(g => (
                  <div key={g.id}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-medium text-foreground leading-tight">{g.title}</p>
                      <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">{g.progress || 0}%</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-1.5">
                      <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${g.progress || 0}%` }} />
                    </div>
                    {g.end_date && (
                      <p className="text-xs text-muted-foreground mt-1">Due {format(new Date(g.end_date), "d MMM yyyy")}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PINSettingsModal({ onClose }) {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");

  const handleSave = (e) => {
    e.preventDefault();
    if (currentPin !== getStoredPin()) {
      setError("Current PIN is incorrect");
      return;
    }
    if (newPin.length < 4) {
      setError("New PIN must be at least 4 digits");
      return;
    }
    if (newPin !== confirmPin) {
      setError("PINs don't match");
      return;
    }
    localStorage.setItem(PIN_STORAGE_KEY, newPin);
    toast.success("PIN updated successfully");
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border shadow-apple-xl p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-foreground">Update Executive PIN</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center hover:bg-border transition-all text-muted-foreground">
            ×
          </button>
        </div>
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Current PIN</label>
            <Input type="password" value={currentPin} onChange={e => setCurrentPin(e.target.value)}
              placeholder="••••" className="rounded-xl text-center tracking-widest" maxLength={8} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">New PIN</label>
            <div className="relative">
              <Input type={showNew ? "text" : "password"} value={newPin} onChange={e => setNewPin(e.target.value)}
                placeholder="••••" className="rounded-xl text-center tracking-widest pr-10" maxLength={8} />
              <button type="button" onClick={() => setShowNew(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Confirm New PIN</label>
            <Input type="password" value={confirmPin} onChange={e => setConfirmPin(e.target.value)}
              placeholder="••••" className="rounded-xl text-center tracking-widest" maxLength={8} />
          </div>
          {error && <p className="text-destructive text-xs">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-xl">Cancel</Button>
            <Button type="submit" className="flex-1 rounded-xl">Update PIN</Button>
          </div>
        </form>
        <p className="text-xs text-muted-foreground text-center mt-3">Default PIN: {DEFAULT_PIN}</p>
      </div>
    </div>
  );
}
