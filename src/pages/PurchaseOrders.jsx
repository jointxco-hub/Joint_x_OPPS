import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Plus, Search, ShoppingCart, Check, X, 
  Truck, Package, AlertTriangle, Eye
} from "lucide-react";
import { format } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TypeformPOForm from "@/components/purchaseorders/TypeformPOForm";

const statusConfig = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-700", icon: Package },
  pending: { label: "Pending", className: "bg-amber-100 text-amber-700", icon: AlertTriangle },
  approved: { label: "Approved", className: "bg-blue-100 text-blue-700", icon: Check },
  ordered: { label: "Ordered", className: "bg-purple-100 text-purple-700", icon: Truck },
  partial: { label: "Partial", className: "bg-orange-100 text-orange-700", icon: Package },
  received: { label: "Received", className: "bg-emerald-100 text-emerald-700", icon: Check },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-700", icon: X }
};

export default function PurchaseOrders() {
  const [showForm, setShowForm] = useState(false);
  const [selectedPO, setSelectedPO] = useState(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("active");
  const queryClient = useQueryClient();

  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ['purchaseOrders'],
    queryFn: () => base44.entities.PurchaseOrder.list('-created_date', 200)
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => base44.entities.Supplier.list('name', 100)
  });

  const { data: inventory = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => base44.entities.InventoryItem.list('name', 100)
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.PurchaseOrder.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      setShowForm(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PurchaseOrder.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] })
  });

  const handleStatusChange = (po, newStatus) => {
    updateMutation.mutate({ id: po.id, data: { status: newStatus } });
  };

  const activePOs = purchaseOrders.filter(po => 
    ['draft', 'pending', 'approved', 'ordered', 'partial'].includes(po.status)
  );
  const completedPOs = purchaseOrders.filter(po => 
    ['received', 'cancelled'].includes(po.status)
  );

  const filteredPOs = (activeTab === 'active' ? activePOs : completedPOs).filter(po => 
    !search || 
    po.po_number?.toLowerCase().includes(search.toLowerCase()) ||
    po.supplier_name?.toLowerCase().includes(search.toLowerCase())
  );

  if (showForm) {
    return (
      <TypeformPOForm 
        suppliers={suppliers}
        inventoryItems={inventory}
        onSubmit={(data) => createMutation.mutateAsync(data)}
        onCancel={() => setShowForm(false)}
      />
    );
  }

  if (selectedPO) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-8">
        <div className="max-w-3xl mx-auto">
          <Card className="bg-white border-0 shadow-lg">
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <CardTitle>{selectedPO.po_number}</CardTitle>
                  <Badge className={`${statusConfig[selectedPO.status]?.className} border-0`}>
                    {statusConfig[selectedPO.status]?.label}
                  </Badge>
                  {selectedPO.auto_generated && (
                    <Badge className="bg-amber-50 text-amber-600 border-amber-200">
                      Auto-generated
                    </Badge>
                  )}
                </div>
                <p className="text-slate-500">{selectedPO.supplier_name}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSelectedPO(null)}>
                <X className="w-5 h-5" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-xs text-slate-500 mb-1">Order Date</p>
                  <p className="font-medium">
                    {selectedPO.order_date ? format(new Date(selectedPO.order_date), "dd MMM yyyy") : "-"}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-xs text-slate-500 mb-1">Expected Delivery</p>
                  <p className="font-medium">
                    {selectedPO.expected_delivery ? format(new Date(selectedPO.expected_delivery), "dd MMM yyyy") : "-"}
                  </p>
                </div>
              </div>

              {/* Items */}
              <div>
                <h3 className="font-semibold text-slate-700 mb-3">Items</h3>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left p-3 text-xs font-medium text-slate-500">Item</th>
                        <th className="text-right p-3 text-xs font-medium text-slate-500">Qty</th>
                        <th className="text-right p-3 text-xs font-medium text-slate-500">Unit Price</th>
                        <th className="text-right p-3 text-xs font-medium text-slate-500">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPO.items?.map((item, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-3">{item.name}</td>
                          <td className="p-3 text-right">{item.quantity} {item.unit}</td>
                          <td className="p-3 text-right">R{(item.unit_price || 0).toFixed(2)}</td>
                          <td className="p-3 text-right font-medium">R{(item.total || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-900 text-white">
                      <tr>
                        <td colSpan={3} className="p-3 text-right font-medium">Total</td>
                        <td className="p-3 text-right font-bold">R{(selectedPO.total || 0).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Notes */}
              {selectedPO.notes && (
                <div>
                  <h3 className="font-semibold text-slate-700 mb-2">Notes</h3>
                  <p className="text-slate-600 bg-slate-50 rounded-lg p-4">{selectedPO.notes}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-3 pt-4 border-t">
                {selectedPO.status === 'draft' && (
                  <>
                    <Button onClick={() => handleStatusChange(selectedPO, 'pending')} className="flex-1">
                      Submit for Approval
                    </Button>
                    <Button variant="outline" onClick={() => handleStatusChange(selectedPO, 'cancelled')}>
                      Cancel
                    </Button>
                  </>
                )}
                {selectedPO.status === 'pending' && (
                  <>
                    <Button onClick={() => handleStatusChange(selectedPO, 'approved')} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                      <Check className="w-4 h-4 mr-2" /> Approve
                    </Button>
                    <Button variant="outline" onClick={() => handleStatusChange(selectedPO, 'draft')}>
                      Back to Draft
                    </Button>
                  </>
                )}
                {selectedPO.status === 'approved' && (
                  <Button onClick={() => handleStatusChange(selectedPO, 'ordered')} className="flex-1 bg-purple-600 hover:bg-purple-700">
                    <Truck className="w-4 h-4 mr-2" /> Mark as Ordered
                  </Button>
                )}
                {selectedPO.status === 'ordered' && (
                  <Button onClick={() => handleStatusChange(selectedPO, 'received')} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                    <Package className="w-4 h-4 mr-2" /> Mark as Received
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Purchase Orders</h1>
          <Button onClick={() => setShowForm(true)} className="bg-slate-900 hover:bg-slate-800">
            <Plus className="w-4 h-4 mr-2" /> New Purchase Order
          </Button>
        </div>

        {/* Search */}
        <div className="bg-white rounded-xl p-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Search purchase orders..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="active">Active ({activePOs.length})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({completedPOs.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            {filteredPOs.length === 0 ? (
              <Card className="p-12 text-center bg-white border-0">
                <ShoppingCart className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-700 mb-2">No active purchase orders</h3>
                <p className="text-slate-500 mb-4">Create a purchase order to restock inventory</p>
                <Button onClick={() => setShowForm(true)}>
                  <Plus className="w-4 h-4 mr-2" /> Create PO
                </Button>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPOs.map(po => (
                  <POCard key={po.id} po={po} onClick={() => setSelectedPO(po)} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="completed">
            {filteredPOs.length === 0 ? (
              <Card className="p-12 text-center bg-white border-0">
                <p className="text-slate-500">No completed purchase orders</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPOs.map(po => (
                  <POCard key={po.id} po={po} onClick={() => setSelectedPO(po)} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function POCard({ po, onClick }) {
  const config = statusConfig[po.status] || statusConfig.draft;
  const StatusIcon = config.icon;
  
  return (
    <Card 
      className="bg-white border-0 shadow-sm hover:shadow-md transition-all cursor-pointer"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-900">{po.po_number}</p>
              {po.auto_generated && (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              )}
            </div>
            <p className="text-sm text-slate-500">{po.supplier_name}</p>
          </div>
          <Badge className={`${config.className} border-0`}>
            <StatusIcon className="w-3 h-3 mr-1" />
            {config.label}
          </Badge>
        </div>
        
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Items</span>
            <span>{po.items?.length || 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Total</span>
            <span className="font-semibold">R{(po.total || 0).toFixed(2)}</span>
          </div>
          {po.expected_delivery && (
            <div className="flex justify-between">
              <span className="text-slate-500">Expected</span>
              <span>{format(new Date(po.expected_delivery), "dd MMM")}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}