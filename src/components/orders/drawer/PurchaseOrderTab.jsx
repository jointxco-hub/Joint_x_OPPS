import React, { useState } from "react";
import { format } from "date-fns";
import { Pencil, Plus, ShoppingCart } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TypeformPOForm = React.lazy(() => import("@/components/purchaseorders/TypeformPOForm"));

function selectValue(value, fallback = "__none") {
  if (Array.isArray(value)) {
    const first = value.find((item) => item !== null && item !== undefined && String(item).trim() !== "");
    return first === undefined ? fallback : String(first);
  }
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function TabSectionFallback({ label = "Section" }) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/30 p-4">
      <div className="h-4 w-36 animate-pulse rounded bg-secondary" />
      <div className="mt-4 space-y-2">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-12 animate-pulse rounded-xl bg-background/70" />
        ))}
      </div>
      <p className="sr-only">Loading {label}</p>
    </div>
  );
}

export default function PurchaseOrderTab({ order, onUpdate, linkedPO, activePOs = [] }) {
  const [showNewPO, setShowNewPO] = useState(false);
  const [newPOForm, setNewPOForm] = useState({ supplier_name: "", expected_delivery: "", notes: "" });
  const [poCreateError, setPoCreateError] = useState("");
  const [editingLinkedPO, setEditingLinkedPO] = useState(false);
  const queryClient = useQueryClient();
  const linkedPoValue = selectValue(order.linked_po_id);

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => dataClient.entities.Supplier.list('name', 100),
    enabled: editingLinkedPO,
  });

  const { data: inventoryItems = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => dataClient.entities.InventoryItem.list('name', 100),
    enabled: editingLinkedPO,
  });

  const updatePOMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.PurchaseOrder.update(id, data),
    onSuccess: (updated) => {
      queryClient.setQueryData(['purchaseOrders'], (/** @type {any} */ old) =>
        Array.isArray(old) ? old.map(po => po.id === updated?.id ? updated : po) : old
      );
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      setEditingLinkedPO(false);
      toast.success("Purchase order updated");
    },
    onError: (err) => toast.error("PO update failed ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â " + ((/** @type {any} */ err)?.message || "unknown error")),
  });

  const createPOMutation = useMutation({
    mutationFn: (data) => dataClient.entities.PurchaseOrder.create(data),
    onSuccess: (po) => {
      if (!po?.id) {
        setPoCreateError("PO created but no ID returned ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â check Supabase RLS on purchase_orders");
        return;
      }
      setPoCreateError("");
      queryClient.setQueryData(['purchaseOrders'], (/** @type {any} */ old) =>
        Array.isArray(old) ? [po, ...old] : [po]
      );
      onUpdate(order.id, { linked_po_id: po.id });
      setShowNewPO(false);
      setNewPOForm({ supplier_name: "", expected_delivery: "", notes: "" });
      toast.success("Purchase order created and linked");
    },
    onError: (err) => {
      const msg = (/** @type {any} */ (err))?.message || "Unknown error ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â check Supabase purchase_orders table";
      setPoCreateError(msg);
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <ShoppingCart className="w-3.5 h-3.5" /> Linked Purchase Order
          </p>
          <button
            onClick={() => setShowNewPO(v => !v)}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New PO
          </button>
        </div>
        <Select value={linkedPoValue} onValueChange={v => onUpdate(order.id, { linked_po_id: v === '__none' ? '' : v })}>
          <SelectTrigger className="rounded-xl">
            <SelectValue placeholder="Link existing PO..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">No PO linked</SelectItem>
            {activePOs.map(po => (
              <SelectItem key={po.id} value={po.id}>
                {po.po_number} ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â {po.supplier_name}
              </SelectItem>
            ))}
            {linkedPO && !activePOs.find(p => p.id === linkedPO.id) && (
              <SelectItem value={linkedPO.id}>{linkedPO.po_number} ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â {linkedPO.supplier_name}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {showNewPO && (
        <div className="bg-secondary/30 rounded-2xl p-4 space-y-3 border border-border">
          <p className="text-xs font-semibold text-foreground">Create New Purchase Order</p>
          <Input
            placeholder="Supplier name (optional)"
            value={newPOForm.supplier_name}
            onChange={e => setNewPOForm(f => ({ ...f, supplier_name: e.target.value }))}
            className="rounded-xl h-9 text-sm"
            autoFocus
          />
          <Input
            type="date"
            value={newPOForm.expected_delivery}
            onChange={e => setNewPOForm(f => ({ ...f, expected_delivery: e.target.value }))}
            className="rounded-xl h-9 text-sm"
          />
          <Input
            placeholder="Notes (optional)"
            value={newPOForm.notes}
            onChange={e => setNewPOForm(f => ({ ...f, notes: e.target.value }))}
            className="rounded-xl h-9 text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 h-8 rounded-xl text-xs"
              disabled={createPOMutation.isPending}
              onClick={() => {
                setPoCreateError("");
                const poNumber = `PO-${Date.now().toString().slice(-6)}`;
                createPOMutation.mutate({
                  po_number: poNumber,
                  supplier_name: newPOForm.supplier_name.trim() || undefined,
                  linked_order_id: order.id,
                  expected_delivery: newPOForm.expected_delivery || undefined,
                  notes: newPOForm.notes || undefined,
                  status: 'draft',
                  items: [],
                });
              }}
            >
              {createPOMutation.isPending ? 'CreatingÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦' : 'Create & Link PO'}
            </Button>
            <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs" onClick={() => { setShowNewPO(false); setPoCreateError(""); }}>
              Cancel
            </Button>
          </div>
          {poCreateError && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-800 break-words">
              <p className="font-semibold mb-0.5">Create failed</p>
              <p className="font-mono">{poCreateError}</p>
              {poCreateError.includes('migration') && (
                <p className="mt-1 text-red-700">Run <code>supabase/migrations/202605180002_create_purchase_orders_table.sql</code> in Supabase SQL Editor.</p>
              )}
              {poCreateError.includes('RLS') && (
                <p className="mt-1 text-red-700">Go to Supabase ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Authentication ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Policies and add an ALL policy for the <code>purchase_orders</code> table.</p>
              )}
            </div>
          )}
        </div>
      )}

      {editingLinkedPO && linkedPO && (
        <React.Suspense fallback={<TabSectionFallback label="Purchase order editor" />}>
          <TypeformPOForm
            purchaseOrder={linkedPO}
            suppliers={suppliers}
            inventoryItems={inventoryItems}
            onSubmit={(data) => updatePOMutation.mutateAsync({ id: linkedPO.id, data })}
            onCancel={() => setEditingLinkedPO(false)}
          />
        </React.Suspense>
      )}

      {linkedPO ? (
        <div className="bg-secondary/40 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-foreground">{linkedPO.po_number}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditingLinkedPO(true)}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
              >
                <Pencil className="w-3 h-3" /> Edit PO
              </button>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium capitalize">{linkedPO.status}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">Supplier: <span className="text-foreground font-medium">{linkedPO.supplier_name}</span></p>
            {linkedPO.expected_delivery && (
              <p className="text-sm text-muted-foreground">Expected: <span className="text-foreground font-medium">{format(new Date(linkedPO.expected_delivery), 'dd MMM yyyy')}</span></p>
            )}
            {linkedPO.total > 0 && (
              <p className="text-sm text-muted-foreground">PO Value: <span className="text-foreground font-semibold">R{linkedPO.total?.toLocaleString()}</span></p>
            )}
          </div>
          {linkedPO.items?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">Items</p>
              <div className="space-y-1">
                {linkedPO.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{item.name}</span>
                    <span className="text-muted-foreground">ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â{item.quantity} {item.unit || ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        !showNewPO && (
          <div className="text-center py-8">
            <ShoppingCart className="w-10 h-10 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No purchase order linked</p>
            <p className="text-xs text-muted-foreground mt-1">Link an existing PO or create a new one above</p>
          </div>
        )
      )}
    </div>
  );
}
