import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  DollarSign, TrendingUp, TrendingDown, Package, RefreshCw,
  Plus, Trash2, Upload, FileText, BarChart3, PieChart
} from "lucide-react";
import { toast } from "sonner";
import { startOfMonth, endOfMonth, format, differenceInYears } from "date-fns";
import ConfirmDialog from "@/components/common/ConfirmDialog";

export default function Executive() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [showRawStockForm, setShowRawStockForm] = useState(false);
  const [showFinishedStockForm, setShowFinishedStockForm] = useState(false);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [showLiabilityForm, setShowLiabilityForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const queryClient = useQueryClient();

  // Data queries
  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => base44.entities.Expense.list('-date', 500)
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => base44.entities.Invoice.list('-invoice_date', 500)
  });

  const { data: rawStock = [] } = useQuery({
    queryKey: ['rawStock'],
    queryFn: () => base44.entities.RawStock.list('batch_date', 500)
  });

  const { data: finishedStock = [] } = useQuery({
    queryKey: ['finishedStock'],
    queryFn: () => base44.entities.FinishedStock.list('-production_date', 500)
  });

  const { data: stockMovements = [] } = useQuery({
    queryKey: ['stockMovements'],
    queryFn: () => base44.entities.StockMovement.list('-date', 500)
  });

  const { data: assets = [] } = useQuery({
    queryKey: ['assets'],
    queryFn: () => base44.entities.Asset.list('-created_date', 200)
  });

  const { data: liabilities = [] } = useQuery({
    queryKey: ['liabilities'],
    queryFn: () => base44.entities.Liability.list('-created_date', 200)
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date', 100)
  });

  // Calculate metrics
  const metrics = useMemo(() => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    // This month expenses
    const monthExpenses = expenses.filter(e => {
      const expDate = new Date(e.date);
      return expDate >= monthStart && expDate <= monthEnd;
    });

    const totalExpenses = monthExpenses
      .filter(e => e.category !== 'owner_drawings')
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    const ownerDrawings = monthExpenses
      .filter(e => e.category === 'owner_drawings')
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    const vatPaid = monthExpenses.reduce((sum, e) => sum + (e.vat_amount || 0), 0);

    // This month income
    const monthInvoices = invoices.filter(i => {
      const invDate = new Date(i.invoice_date);
      return invDate >= monthStart && invDate <= monthEnd;
    });

    const totalRevenue = monthInvoices.reduce((sum, i) => sum + (i.gross_amount || 0), 0);
    const paidRevenue = monthInvoices
      .filter(i => i.payment_status === 'paid')
      .reduce((sum, i) => sum + (i.gross_amount || 0), 0);
    const vatCollected = monthInvoices.reduce((sum, i) => sum + (i.vat_amount || 0), 0);

    // Inventory value
    const rawValue = rawStock.reduce((sum, r) => sum + ((r.quantity_remaining || 0) * (r.cost_per_unit || 0)), 0);
    const finishedValue = finishedStock.reduce((sum, f) => sum + ((f.quantity_available || 0) * (f.cost_per_unit || 0)), 0);
    const inventoryValue = rawValue + finishedValue;

    // Net profit
    const netProfit = paidRevenue - totalExpenses;

    // VAT owed
    const vatOwed = vatCollected - vatPaid;

    // Cash balance (paid revenue - expenses - owner drawings)
    const cashBalance = paidRevenue - totalExpenses - ownerDrawings;

    // Assets value (with depreciation)
    const assetsValue = assets.reduce((sum, a) => {
      if (a.category === 'inventory') return sum + inventoryValue;
      if (a.category === 'cash') return sum + cashBalance;
      
      // Calculate depreciation
      if (a.purchase_date && a.useful_life_years) {
        const yearsOld = differenceInYears(now, new Date(a.purchase_date));
        const annualDepreciation = (a.purchase_cost || 0) / a.useful_life_years;
        const totalDepreciation = Math.min(annualDepreciation * yearsOld, a.purchase_cost || 0);
        return sum + Math.max(0, (a.purchase_cost || 0) - totalDepreciation);
      }
      return sum + (a.purchase_cost || 0);
    }, 0);

    // Liabilities total
    const liabilitiesTotal = liabilities
      .filter(l => l.status === 'unpaid')
      .reduce((sum, l) => sum + (l.amount_owed || 0), 0);

    // Business net worth
    const netWorth = assetsValue - liabilitiesTotal;

    // COGS from stock movements
    const cogs = stockMovements
      .filter(m => m.movement_type === 'finished_to_sold')
      .filter(m => {
        const moveDate = new Date(m.date);
        return moveDate >= monthStart && moveDate <= monthEnd;
      })
      .reduce((sum, m) => sum + (m.cost_value || 0), 0);

    return {
      totalRevenue,
      paidRevenue,
      totalExpenses,
      netProfit,
      vatOwed,
      inventoryValue,
      cashBalance,
      netWorth,
      vatCollected,
      vatPaid,
      assetsValue,
      liabilitiesTotal,
      cogs,
      ownerDrawings
    };
  }, [expenses, invoices, rawStock, finishedStock, assets, liabilities, stockMovements]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-3 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Business Finance Tracker</h1>
            <p className="text-sm text-slate-500 mt-1">Founder-friendly financial management</p>
          </div>
          <Button 
            onClick={() => {
              queryClient.invalidateQueries();
              toast.success("Refreshed!");
            }} 
            variant="ghost"
            size="icon"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-3 md:grid-cols-8 w-full mb-6 h-auto">
            <TabsTrigger value="dashboard" className="text-xs md:text-sm">Dashboard</TabsTrigger>
            <TabsTrigger value="expenses" className="text-xs md:text-sm">Expenses</TabsTrigger>
            <TabsTrigger value="income" className="text-xs md:text-sm">Income</TabsTrigger>
            <TabsTrigger value="inventory" className="text-xs md:text-sm">Inventory</TabsTrigger>
            <TabsTrigger value="assets" className="text-xs md:text-sm">Assets</TabsTrigger>
            <TabsTrigger value="liabilities" className="text-xs md:text-sm">Liabilities</TabsTrigger>
            <TabsTrigger value="reports" className="text-xs md:text-sm">Reports</TabsTrigger>
          </TabsList>

          {/* DASHBOARD */}
          <TabsContent value="dashboard">
            <DashboardView metrics={metrics} />
          </TabsContent>

          {/* EXPENSES */}
          <TabsContent value="expenses">
            <ExpensesView 
              expenses={expenses}
              projects={projects}
              onAdd={() => setShowExpenseForm(true)}
              onDelete={(exp) => setDeleteConfirm({ type: 'expense', item: exp })}
            />
          </TabsContent>

          {/* INCOME */}
          <TabsContent value="income">
            <IncomeView 
              invoices={invoices}
              projects={projects}
              onAdd={() => setShowIncomeForm(true)}
              onDelete={(inv) => setDeleteConfirm({ type: 'invoice', item: inv })}
            />
          </TabsContent>

          {/* INVENTORY */}
          <TabsContent value="inventory">
            <InventoryView 
              rawStock={rawStock}
              finishedStock={finishedStock}
              stockMovements={stockMovements}
              expenses={expenses}
              onAddRaw={() => setShowRawStockForm(true)}
              onAddFinished={() => setShowFinishedStockForm(true)}
              onDeleteRaw={(item) => setDeleteConfirm({ type: 'rawStock', item })}
              onDeleteFinished={(item) => setDeleteConfirm({ type: 'finishedStock', item })}
            />
          </TabsContent>

          {/* ASSETS */}
          <TabsContent value="assets">
            <AssetsView 
              assets={assets}
              inventoryValue={metrics.inventoryValue}
              cashBalance={metrics.cashBalance}
              onAdd={() => setShowAssetForm(true)}
              onDelete={(asset) => setDeleteConfirm({ type: 'asset', item: asset })}
            />
          </TabsContent>

          {/* LIABILITIES */}
          <TabsContent value="liabilities">
            <LiabilitiesView 
              liabilities={liabilities}
              vatOwed={metrics.vatOwed}
              onAdd={() => setShowLiabilityForm(true)}
              onDelete={(liability) => setDeleteConfirm({ type: 'liability', item: liability })}
            />
          </TabsContent>

          {/* REPORTS */}
          <TabsContent value="reports">
            <ReportsView 
              metrics={metrics}
              expenses={expenses}
              invoices={invoices}
            />
          </TabsContent>
        </Tabs>

        {/* Forms */}
        {showExpenseForm && <ExpenseFormDialog projects={projects} onClose={() => setShowExpenseForm(false)} />}
        {showIncomeForm && <IncomeFormDialog projects={projects} onClose={() => setShowIncomeForm(false)} />}
        {showRawStockForm && <RawStockFormDialog expenses={expenses} onClose={() => setShowRawStockForm(false)} />}
        {showFinishedStockForm && <FinishedStockFormDialog rawStock={rawStock} onClose={() => setShowFinishedStockForm(false)} />}
        {showAssetForm && <AssetFormDialog onClose={() => setShowAssetForm(false)} />}
        {showLiabilityForm && <LiabilityFormDialog onClose={() => setShowLiabilityForm(false)} />}

        {/* Delete Confirm */}
        <ConfirmDialog 
          open={!!deleteConfirm}
          onOpenChange={() => setDeleteConfirm(null)}
          title={`Delete ${deleteConfirm?.type}?`}
          description="This action cannot be undone."
          confirmText="Delete"
          onConfirm={async () => {
            const entityMap = {
              expense: 'Expense',
              invoice: 'Invoice',
              rawStock: 'RawStock',
              finishedStock: 'FinishedStock',
              asset: 'Asset',
              liability: 'Liability'
            };
            const entityName = entityMap[deleteConfirm?.type];
            if (entityName) {
              await base44.entities[entityName].delete(deleteConfirm.item.id);
              queryClient.invalidateQueries({ queryKey: [deleteConfirm.type === 'rawStock' ? 'rawStock' : deleteConfirm.type === 'finishedStock' ? 'finishedStock' : `${deleteConfirm.type}s`] });
              setDeleteConfirm(null);
              toast.success("Deleted!");
            }
          }}
          variant="destructive"
        />
      </div>
    </div>
  );
}

// Dashboard View Component
function DashboardView({ metrics }) {
  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
        <MetricCard 
          title="Revenue (This Month)"
          value={`R${metrics.totalRevenue.toLocaleString()}`}
          subtitle={`Paid: R${metrics.paidRevenue.toLocaleString()}`}
          icon={DollarSign}
          color="green"
        />
        <MetricCard 
          title="Expenses (This Month)"
          value={`R${metrics.totalExpenses.toLocaleString()}`}
          subtitle="Operating costs"
          icon={TrendingDown}
          color="red"
        />
        <MetricCard 
          title="Net Profit"
          value={`R${metrics.netProfit.toLocaleString()}`}
          subtitle={metrics.netProfit >= 0 ? "Profit" : "Loss"}
          icon={metrics.netProfit >= 0 ? TrendingUp : TrendingDown}
          color={metrics.netProfit >= 0 ? "green" : "red"}
        />
        <MetricCard 
          title="VAT Owed"
          value={`R${metrics.vatOwed.toLocaleString()}`}
          subtitle="Collected - Paid"
          icon={FileText}
          color="blue"
        />
        <MetricCard 
          title="Inventory Value"
          value={`R${metrics.inventoryValue.toLocaleString()}`}
          subtitle="Raw + Finished"
          icon={Package}
          color="purple"
        />
        <MetricCard 
          title="Cash Balance"
          value={`R${metrics.cashBalance.toLocaleString()}`}
          subtitle="Available funds"
          icon={DollarSign}
          color={metrics.cashBalance >= 0 ? "green" : "red"}
        />
        <Card className="col-span-2 bg-gradient-to-br from-emerald-500 to-emerald-600">
          <CardContent className="p-4 md:p-6 text-white">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs md:text-sm opacity-90">Business Net Worth</p>
              <BarChart3 className="w-5 h-5 opacity-90" />
            </div>
            <p className="text-2xl md:text-3xl font-bold">R{metrics.netWorth.toLocaleString()}</p>
            <p className="text-xs opacity-80 mt-1">Assets - Liabilities</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick insights */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Revenue (Paid)</span>
              <span className="font-semibold text-green-600">R{metrics.paidRevenue.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Expenses</span>
              <span className="font-semibold text-red-600">-R{metrics.totalExpenses.toLocaleString()}</span>
            </div>
            <div className="flex justify-between pt-2 border-t">
              <span className="font-semibold">Net Profit</span>
              <span className={`font-bold ${metrics.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                R{metrics.netProfit.toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">VAT Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">VAT Collected</span>
              <span className="font-semibold">R{metrics.vatCollected.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">VAT Paid</span>
              <span className="font-semibold">-R{metrics.vatPaid.toLocaleString()}</span>
            </div>
            <div className="flex justify-between pt-2 border-t">
              <span className="font-semibold">VAT Owed</span>
              <span className="font-bold text-blue-600">R{metrics.vatOwed.toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtitle, icon: Icon, color }) {
  const colors = {
    green: "text-green-600",
    red: "text-red-600",
    blue: "text-blue-600",
    purple: "text-purple-600"
  };

  return (
    <Card>
      <CardContent className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs md:text-sm text-slate-500">{title}</p>
          <Icon className={`w-4 h-4 md:w-5 md:h-5 ${colors[color]}`} />
        </div>
        <p className="text-xl md:text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-xs text-slate-600 mt-1">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

// Placeholder components - I'll create these in the next messages
function ExpensesView({ expenses, projects, onAdd, onDelete }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Expenses</h2>
        <Button onClick={onAdd}><Plus className="w-4 h-4 mr-2" /> Add Expense</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left p-3 text-xs font-semibold">Date</th>
                  <th className="text-left p-3 text-xs font-semibold">Vendor</th>
                  <th className="text-left p-3 text-xs font-semibold">Category</th>
                  <th className="text-right p-3 text-xs font-semibold">Amount</th>
                  <th className="text-right p-3 text-xs font-semibold">VAT</th>
                  <th className="text-center p-3 text-xs font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(exp => (
                  <tr key={exp.id} className="border-b hover:bg-slate-50">
                    <td className="p-3 text-sm">{exp.date}</td>
                    <td className="p-3 text-sm">{exp.vendor}</td>
                    <td className="p-3 text-sm capitalize">{exp.category?.replace('_', ' ')}</td>
                    <td className="p-3 text-sm text-right font-semibold">R{exp.amount?.toLocaleString()}</td>
                    <td className="p-3 text-sm text-right">R{exp.vat_amount?.toLocaleString() || 0}</td>
                    <td className="p-3 text-center">
                      <Button variant="ghost" size="icon" onClick={() => onDelete(exp)}>
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {expenses.length === 0 && (
              <div className="p-8 text-center text-slate-500">No expenses recorded yet</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function IncomeView({ invoices, projects, onAdd, onDelete }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Income</h2>
        <Button onClick={onAdd}><Plus className="w-4 h-4 mr-2" /> Add Invoice</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left p-3 text-xs font-semibold">Date</th>
                  <th className="text-left p-3 text-xs font-semibold">Client</th>
                  <th className="text-left p-3 text-xs font-semibold">Invoice #</th>
                  <th className="text-right p-3 text-xs font-semibold">Gross</th>
                  <th className="text-right p-3 text-xs font-semibold">VAT</th>
                  <th className="text-center p-3 text-xs font-semibold">Status</th>
                  <th className="text-center p-3 text-xs font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} className="border-b hover:bg-slate-50">
                    <td className="p-3 text-sm">{inv.invoice_date}</td>
                    <td className="p-3 text-sm">{inv.client}</td>
                    <td className="p-3 text-sm">{inv.invoice_number}</td>
                    <td className="p-3 text-sm text-right font-semibold">R{inv.gross_amount?.toLocaleString()}</td>
                    <td className="p-3 text-sm text-right">R{inv.vat_amount?.toLocaleString() || 0}</td>
                    <td className="p-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded ${inv.payment_status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {inv.payment_status}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <Button variant="ghost" size="icon" onClick={() => onDelete(inv)}>
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {invoices.length === 0 && (
              <div className="p-8 text-center text-slate-500">No invoices recorded yet</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InventoryView({ rawStock, finishedStock, stockMovements, expenses, onAddRaw, onAddFinished, onDeleteRaw, onDeleteFinished }) {
  const [subTab, setSubTab] = useState("raw");

  return (
    <div>
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="raw">Raw Stock</TabsTrigger>
          <TabsTrigger value="finished">Finished Stock</TabsTrigger>
          <TabsTrigger value="movements">Stock Movement</TabsTrigger>
        </TabsList>

        <TabsContent value="raw">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Raw Stock (FIFO)</h3>
            <Button onClick={onAddRaw}><Plus className="w-4 h-4 mr-2" /> Add Batch</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="text-left p-3 text-xs font-semibold">Item</th>
                      <th className="text-left p-3 text-xs font-semibold">Batch Date</th>
                      <th className="text-right p-3 text-xs font-semibold">Purchased</th>
                      <th className="text-right p-3 text-xs font-semibold">Remaining</th>
                      <th className="text-right p-3 text-xs font-semibold">Cost/Unit</th>
                      <th className="text-right p-3 text-xs font-semibold">Total Value</th>
                      <th className="text-center p-3 text-xs font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rawStock.map(item => (
                      <tr key={item.id} className="border-b hover:bg-slate-50">
                        <td className="p-3 text-sm font-medium">{item.item_name}</td>
                        <td className="p-3 text-sm">{item.batch_date}</td>
                        <td className="p-3 text-sm text-right">{item.quantity_purchased}</td>
                        <td className="p-3 text-sm text-right font-semibold">{item.quantity_remaining}</td>
                        <td className="p-3 text-sm text-right">R{item.cost_per_unit?.toFixed(2)}</td>
                        <td className="p-3 text-sm text-right font-semibold">R{((item.quantity_remaining || 0) * (item.cost_per_unit || 0)).toFixed(2)}</td>
                        <td className="p-3 text-center">
                          <Button variant="ghost" size="icon" onClick={() => onDeleteRaw(item)}>
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rawStock.length === 0 && (
                  <div className="p-8 text-center text-slate-500">No raw stock batches yet</div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="finished">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Finished Stock</h3>
            <Button onClick={onAddFinished}><Plus className="w-4 h-4 mr-2" /> Add Product</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="text-left p-3 text-xs font-semibold">Product</th>
                      <th className="text-left p-3 text-xs font-semibold">Production Date</th>
                      <th className="text-right p-3 text-xs font-semibold">Produced</th>
                      <th className="text-right p-3 text-xs font-semibold">Available</th>
                      <th className="text-right p-3 text-xs font-semibold">Cost/Unit</th>
                      <th className="text-right p-3 text-xs font-semibold">Stock Value</th>
                      <th className="text-center p-3 text-xs font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finishedStock.map(item => (
                      <tr key={item.id} className="border-b hover:bg-slate-50">
                        <td className="p-3 text-sm font-medium">{item.product_name}</td>
                        <td className="p-3 text-sm">{item.production_date}</td>
                        <td className="p-3 text-sm text-right">{item.quantity_produced}</td>
                        <td className="p-3 text-sm text-right font-semibold">{item.quantity_available}</td>
                        <td className="p-3 text-sm text-right">R{item.cost_per_unit?.toFixed(2) || 0}</td>
                        <td className="p-3 text-sm text-right font-semibold">R{((item.quantity_available || 0) * (item.cost_per_unit || 0)).toFixed(2)}</td>
                        <td className="p-3 text-center">
                          <Button variant="ghost" size="icon" onClick={() => onDeleteFinished(item)}>
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {finishedStock.length === 0 && (
                  <div className="p-8 text-center text-slate-500">No finished stock yet</div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="text-left p-3 text-xs font-semibold">Date</th>
                      <th className="text-left p-3 text-xs font-semibold">Item</th>
                      <th className="text-left p-3 text-xs font-semibold">Type</th>
                      <th className="text-right p-3 text-xs font-semibold">Quantity</th>
                      <th className="text-left p-3 text-xs font-semibold">Reason</th>
                      <th className="text-right p-3 text-xs font-semibold">Cost Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockMovements.map(mov => (
                      <tr key={mov.id} className="border-b hover:bg-slate-50">
                        <td className="p-3 text-sm">{mov.date}</td>
                        <td className="p-3 text-sm">{mov.item}</td>
                        <td className="p-3 text-sm capitalize">{mov.movement_type?.replace('_', ' → ')}</td>
                        <td className="p-3 text-sm text-right">{mov.quantity}</td>
                        <td className="p-3 text-sm capitalize">{mov.reason}</td>
                        <td className="p-3 text-sm text-right font-semibold">R{mov.cost_value?.toFixed(2) || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {stockMovements.length === 0 && (
                  <div className="p-8 text-center text-slate-500">No stock movements yet</div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AssetsView({ assets, inventoryValue, cashBalance, onAdd, onDelete }) {
  const now = new Date();
  
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Assets</h2>
        <Button onClick={onAdd}><Plus className="w-4 h-4 mr-2" /> Add Asset</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left p-3 text-xs font-semibold">Asset Name</th>
                  <th className="text-left p-3 text-xs font-semibold">Category</th>
                  <th className="text-right p-3 text-xs font-semibold">Purchase Cost</th>
                  <th className="text-right p-3 text-xs font-semibold">Book Value</th>
                  <th className="text-center p-3 text-xs font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b bg-blue-50">
                  <td className="p-3 text-sm font-medium">Inventory (Auto)</td>
                  <td className="p-3 text-sm">Inventory</td>
                  <td className="p-3 text-sm text-right">-</td>
                  <td className="p-3 text-sm text-right font-semibold">R{inventoryValue.toLocaleString()}</td>
                  <td className="p-3 text-center text-xs text-slate-400">Auto-calc</td>
                </tr>
                <tr className="border-b bg-green-50">
                  <td className="p-3 text-sm font-medium">Cash (Auto)</td>
                  <td className="p-3 text-sm">Cash</td>
                  <td className="p-3 text-sm text-right">-</td>
                  <td className="p-3 text-sm text-right font-semibold">R{cashBalance.toLocaleString()}</td>
                  <td className="p-3 text-center text-xs text-slate-400">Auto-calc</td>
                </tr>
                {assets.map(asset => {
                  let bookValue = asset.purchase_cost || 0;
                  if (asset.purchase_date && asset.useful_life_years) {
                    const yearsOld = differenceInYears(now, new Date(asset.purchase_date));
                    const annualDepreciation = (asset.purchase_cost || 0) / asset.useful_life_years;
                    const totalDepreciation = Math.min(annualDepreciation * yearsOld, asset.purchase_cost || 0);
                    bookValue = Math.max(0, (asset.purchase_cost || 0) - totalDepreciation);
                  }
                  
                  return (
                    <tr key={asset.id} className="border-b hover:bg-slate-50">
                      <td className="p-3 text-sm font-medium">{asset.asset_name}</td>
                      <td className="p-3 text-sm capitalize">{asset.category?.replace('_', ' ')}</td>
                      <td className="p-3 text-sm text-right">R{asset.purchase_cost?.toLocaleString()}</td>
                      <td className="p-3 text-sm text-right font-semibold">R{bookValue.toFixed(2)}</td>
                      <td className="p-3 text-center">
                        <Button variant="ghost" size="icon" onClick={() => onDelete(asset)}>
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LiabilitiesView({ liabilities, vatOwed, onAdd, onDelete }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Liabilities</h2>
        <Button onClick={onAdd}><Plus className="w-4 h-4 mr-2" /> Add Liability</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left p-3 text-xs font-semibold">Name</th>
                  <th className="text-left p-3 text-xs font-semibold">Type</th>
                  <th className="text-right p-3 text-xs font-semibold">Amount Owed</th>
                  <th className="text-left p-3 text-xs font-semibold">Due Date</th>
                  <th className="text-center p-3 text-xs font-semibold">Status</th>
                  <th className="text-center p-3 text-xs font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b bg-amber-50">
                  <td className="p-3 text-sm font-medium">VAT Owed (Auto)</td>
                  <td className="p-3 text-sm">VAT</td>
                  <td className="p-3 text-sm text-right font-semibold">R{vatOwed.toLocaleString()}</td>
                  <td className="p-3 text-sm">Monthly</td>
                  <td className="p-3 text-center">
                    <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700">Unpaid</span>
                  </td>
                  <td className="p-3 text-center text-xs text-slate-400">Auto-calc</td>
                </tr>
                {liabilities.map(liability => (
                  <tr key={liability.id} className="border-b hover:bg-slate-50">
                    <td className="p-3 text-sm font-medium">{liability.liability_name}</td>
                    <td className="p-3 text-sm capitalize">{liability.type?.replace('_', ' ')}</td>
                    <td className="p-3 text-sm text-right font-semibold">R{liability.amount_owed?.toLocaleString()}</td>
                    <td className="p-3 text-sm">{liability.due_date || '-'}</td>
                    <td className="p-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded ${liability.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {liability.status}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <Button variant="ghost" size="icon" onClick={() => onDelete(liability)}>
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {liabilities.length === 0 && (
              <div className="p-8 text-center text-slate-500">No liabilities recorded yet</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReportsView({ metrics, expenses, invoices }) {
  return (
    <div className="space-y-6">
      {/* Profit & Loss */}
      <Card>
        <CardHeader>
          <CardTitle>Profit & Loss Statement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Revenue (Paid)</span>
            <span className="font-semibold">R{metrics.paidRevenue.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-600 pl-4">- Cost of Goods Sold</span>
            <span className="font-semibold text-red-600">-R{metrics.cogs.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-600 pl-4">- Operating Expenses</span>
            <span className="font-semibold text-red-600">-R{metrics.totalExpenses.toLocaleString()}</span>
          </div>
          <div className="flex justify-between pt-3 border-t">
            <span className="font-semibold">Net Profit</span>
            <span className={`font-bold text-lg ${metrics.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              R{metrics.netProfit.toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Tax Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Tax Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">VAT Collected</span>
            <span className="font-semibold">R{metrics.vatCollected.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">VAT Paid</span>
            <span className="font-semibold">-R{metrics.vatPaid.toLocaleString()}</span>
          </div>
          <div className="flex justify-between pt-3 border-t">
            <span className="font-semibold">VAT Owed</span>
            <span className="font-bold text-blue-600">R{metrics.vatOwed.toLocaleString()}</span>
          </div>
          <div className="flex justify-between pt-3 mt-3 border-t">
            <span className="font-semibold">Taxable Income (Net Profit)</span>
            <span className="font-bold">R{metrics.netProfit.toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>

      {/* Balance Sheet */}
      <Card>
        <CardHeader>
          <CardTitle>Balance Sheet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700">Assets</p>
            <div className="flex justify-between text-sm pl-4">
              <span className="text-slate-600">Cash</span>
              <span className="font-semibold">R{metrics.cashBalance.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm pl-4">
              <span className="text-slate-600">Inventory</span>
              <span className="font-semibold">R{metrics.inventoryValue.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm border-t pt-2">
              <span className="font-semibold">Total Assets</span>
              <span className="font-bold">R{metrics.assetsValue.toLocaleString()}</span>
            </div>
          </div>

          <div className="space-y-2 pt-3 border-t">
            <p className="text-sm font-semibold text-slate-700">Liabilities</p>
            <div className="flex justify-between text-sm pl-4">
              <span className="text-slate-600">Total Liabilities</span>
              <span className="font-semibold">R{metrics.liabilitiesTotal.toLocaleString()}</span>
            </div>
          </div>

          <div className="flex justify-between pt-3 border-t">
            <span className="font-semibold text-lg">Owner's Equity (Net Worth)</span>
            <span className="font-bold text-xl text-emerald-600">R{metrics.netWorth.toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Form Dialogs
function ExpenseFormDialog({ projects, onClose }) {
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    vendor: "",
    amount: 0,
    category: "production",
    vat_type: "vatable",
    vat_amount: 0,
    payment_method: "eft",
    project_id: "",
    notes: ""
  });
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Expense.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success("Expense added!");
      onClose();
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const vatAmount = formData.vat_type === 'vatable' ? formData.amount * 0.15 : 0;
    createMutation.mutate({ ...formData, vat_amount: vatAmount });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Expense</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Date *</Label>
              <Input type="date" value={formData.date} onChange={(e) => setFormData({...formData, date: e.target.value})} required />
            </div>
            <div>
              <Label>Vendor *</Label>
              <Input value={formData.vendor} onChange={(e) => setFormData({...formData, vendor: e.target.value})} required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Amount *</Label>
              <Input type="number" step="0.01" value={formData.amount} onChange={(e) => setFormData({...formData, amount: parseFloat(e.target.value) || 0})} required />
            </div>
            <div>
              <Label>Category *</Label>
              <Select value={formData.category} onValueChange={(v) => setFormData({...formData, category: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Production</SelectItem>
                  <SelectItem value="raw_materials">Raw Materials</SelectItem>
                  <SelectItem value="packaging">Packaging</SelectItem>
                  <SelectItem value="shipping">Shipping</SelectItem>
                  <SelectItem value="marketing">Marketing</SelectItem>
                  <SelectItem value="software">Software</SelectItem>
                  <SelectItem value="rent_utilities">Rent & Utilities</SelectItem>
                  <SelectItem value="wages">Wages</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="owner_drawings">Owner Drawings</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>VAT Type</Label>
              <Select value={formData.vat_type} onValueChange={(v) => setFormData({...formData, vat_type: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vatable">VATable (15%)</SelectItem>
                  <SelectItem value="zero_rated">Zero Rated</SelectItem>
                  <SelectItem value="non_vat">Non-VAT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={formData.payment_method} onValueChange={(v) => setFormData({...formData, payment_method: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="eft">EFT</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})} rows={2} />
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add Expense</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IncomeFormDialog({ projects, onClose }) {
  const [formData, setFormData] = useState({
    invoice_date: new Date().toISOString().split('T')[0],
    client: "",
    invoice_number: "",
    gross_amount: 0,
    vat_amount: 0,
    payment_status: "unpaid",
    payment_date: "",
    project_id: ""
  });
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Invoice.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success("Invoice added!");
      onClose();
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const vatAmount = formData.gross_amount * 0.15;
    const netIncome = formData.gross_amount - vatAmount;
    createMutation.mutate({ ...formData, vat_amount: vatAmount, net_income: netIncome });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Invoice</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Invoice Date *</Label>
              <Input type="date" value={formData.invoice_date} onChange={(e) => setFormData({...formData, invoice_date: e.target.value})} required />
            </div>
            <div>
              <Label>Invoice Number *</Label>
              <Input value={formData.invoice_number} onChange={(e) => setFormData({...formData, invoice_number: e.target.value})} required />
            </div>
          </div>

          <div>
            <Label>Client *</Label>
            <Input value={formData.client} onChange={(e) => setFormData({...formData, client: e.target.value})} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Gross Amount (incl VAT) *</Label>
              <Input type="number" step="0.01" value={formData.gross_amount} onChange={(e) => setFormData({...formData, gross_amount: parseFloat(e.target.value) || 0})} required />
            </div>
            <div>
              <Label>Payment Status</Label>
              <Select value={formData.payment_status} onValueChange={(v) => setFormData({...formData, payment_status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {formData.payment_status === 'paid' && (
            <div>
              <Label>Payment Date</Label>
              <Input type="date" value={formData.payment_date} onChange={(e) => setFormData({...formData, payment_date: e.target.value})} />
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add Invoice</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RawStockFormDialog({ expenses, onClose }) {
  const [formData, setFormData] = useState({
    item_name: "",
    batch_date: new Date().toISOString().split('T')[0],
    quantity_purchased: 0,
    quantity_remaining: 0,
    cost_per_unit: 0,
    supplier: "",
    expense_id: ""
  });
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.RawStock.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rawStock'] });
      toast.success("Raw stock added!");
      onClose();
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const totalValue = formData.quantity_remaining * formData.cost_per_unit;
    createMutation.mutate({ ...formData, total_value: totalValue });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Raw Stock Batch</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Item Name *</Label>
            <Input value={formData.item_name} onChange={(e) => setFormData({...formData, item_name: e.target.value})} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Batch Date *</Label>
              <Input type="date" value={formData.batch_date} onChange={(e) => setFormData({...formData, batch_date: e.target.value})} required />
            </div>
            <div>
              <Label>Supplier</Label>
              <Input value={formData.supplier} onChange={(e) => setFormData({...formData, supplier: e.target.value})} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Quantity Purchased *</Label>
              <Input 
                type="number" 
                value={formData.quantity_purchased} 
                onChange={(e) => {
                  const qty = parseFloat(e.target.value) || 0;
                  setFormData({...formData, quantity_purchased: qty, quantity_remaining: qty});
                }} 
                required 
              />
            </div>
            <div>
              <Label>Cost Per Unit *</Label>
              <Input type="number" step="0.01" value={formData.cost_per_unit} onChange={(e) => setFormData({...formData, cost_per_unit: parseFloat(e.target.value) || 0})} required />
            </div>
            <div>
              <Label>Total Value</Label>
              <Input value={`R${(formData.quantity_remaining * formData.cost_per_unit).toFixed(2)}`} disabled />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add Batch</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FinishedStockFormDialog({ rawStock, onClose }) {
  const [formData, setFormData] = useState({
    product_name: "",
    quantity_produced: 0,
    quantity_available: 0,
    production_date: new Date().toISOString().split('T')[0],
    cost_per_unit: 0
  });
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FinishedStock.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finishedStock'] });
      toast.success("Finished stock added!");
      onClose();
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const totalValue = formData.quantity_available * formData.cost_per_unit;
    createMutation.mutate({ ...formData, total_stock_value: totalValue });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Finished Stock</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Product Name *</Label>
            <Input value={formData.product_name} onChange={(e) => setFormData({...formData, product_name: e.target.value})} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Production Date *</Label>
              <Input type="date" value={formData.production_date} onChange={(e) => setFormData({...formData, production_date: e.target.value})} required />
            </div>
            <div>
              <Label>Quantity Produced *</Label>
              <Input 
                type="number" 
                value={formData.quantity_produced} 
                onChange={(e) => {
                  const qty = parseFloat(e.target.value) || 0;
                  setFormData({...formData, quantity_produced: qty, quantity_available: qty});
                }} 
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Cost Per Unit *</Label>
              <Input type="number" step="0.01" value={formData.cost_per_unit} onChange={(e) => setFormData({...formData, cost_per_unit: parseFloat(e.target.value) || 0})} required />
              <p className="text-xs text-slate-500 mt-1">Calculate from raw materials used (FIFO)</p>
            </div>
            <div>
              <Label>Total Stock Value</Label>
              <Input value={`R${(formData.quantity_available * formData.cost_per_unit).toFixed(2)}`} disabled />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add Product</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssetFormDialog({ onClose }) {
  const [formData, setFormData] = useState({
    asset_name: "",
    category: "equipment",
    purchase_date: new Date().toISOString().split('T')[0],
    purchase_cost: 0,
    useful_life_years: 5
  });
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Asset.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      toast.success("Asset added!");
      onClose();
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Asset</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Asset Name *</Label>
            <Input value={formData.asset_name} onChange={(e) => setFormData({...formData, asset_name: e.target.value})} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Category *</Label>
              <Select value={formData.category} onValueChange={(v) => setFormData({...formData, category: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="equipment">Equipment</SelectItem>
                  <SelectItem value="electronics">Electronics</SelectItem>
                  <SelectItem value="furniture">Furniture</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Purchase Date</Label>
              <Input type="date" value={formData.purchase_date} onChange={(e) => setFormData({...formData, purchase_date: e.target.value})} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Purchase Cost *</Label>
              <Input type="number" step="0.01" value={formData.purchase_cost} onChange={(e) => setFormData({...formData, purchase_cost: parseFloat(e.target.value) || 0})} required />
            </div>
            <div>
              <Label>Useful Life (years)</Label>
              <Input type="number" value={formData.useful_life_years} onChange={(e) => setFormData({...formData, useful_life_years: parseInt(e.target.value) || 0})} />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add Asset</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LiabilityFormDialog({ onClose }) {
  const [formData, setFormData] = useState({
    liability_name: "",
    type: "supplier_credit",
    amount_owed: 0,
    due_date: "",
    status: "unpaid"
  });
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Liability.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['liabilities'] });
      toast.success("Liability added!");
      onClose();
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Liability</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Liability Name *</Label>
            <Input value={formData.liability_name} onChange={(e) => setFormData({...formData, liability_name: e.target.value})} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Type *</Label>
              <Select value={formData.type} onValueChange={(v) => setFormData({...formData, type: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tax">Tax</SelectItem>
                  <SelectItem value="loan">Loan</SelectItem>
                  <SelectItem value="supplier_credit">Supplier Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount Owed *</Label>
              <Input type="number" step="0.01" value={formData.amount_owed} onChange={(e) => setFormData({...formData, amount_owed: parseFloat(e.target.value) || 0})} required />
            </div>
          </div>

          <div>
            <Label>Due Date</Label>
            <Input type="date" value={formData.due_date} onChange={(e) => setFormData({...formData, due_date: e.target.value})} />
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add Liability</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}