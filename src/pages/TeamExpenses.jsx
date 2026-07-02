import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlusCircle, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dataClient } from "@/api/dataClient";
import AddExpenseDrawer from "@/components/executive/AddExpenseDrawer";

export default function TeamExpenses() {
  const [user, setUser] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    dataClient.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: expenses = [], refetch } = useQuery({
    queryKey: ["my-expenses", user?.email, refreshKey],
    enabled: !!user?.email,
    queryFn: () => dataClient.entities.Expense.filter({ submitted_by: user.email }, "-date", 100),
  });

  const handleSaved = () => {
    setRefreshKey(k => k + 1);
    refetch();
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 md:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
              <Receipt className="w-5 h-5 text-primary" /> My Expenses
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Submit receipts without opening the full finance view.</p>
          </div>
          <Button onClick={() => setShowAdd(true)} className="gap-2">
            <PlusCircle className="w-4 h-4" /> Add
          </Button>
        </div>

        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          {expenses.length === 0 ? (
            <div className="text-center py-14">
              <Receipt className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No submitted expenses yet</p>
            </div>
          ) : expenses.map(expense => (
            <div key={expense.id} className="px-4 py-3 border-b border-border last:border-0 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{expense.expense_name || expense.vendor || expense.paid_to_name || expense.notes || "Expense"}</p>
                <p className="text-xs text-muted-foreground">{expense.date || "No date"} · {expense.expense_category || expense.category || "uncategorised"}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-foreground">R{Number(expense.amount || 0).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground capitalize">{expense.status || expense.approval_status || "submitted"}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showAdd && <AddExpenseDrawer onClose={() => setShowAdd(false)} onSaved={handleSaved} />}
    </div>
  );
}


