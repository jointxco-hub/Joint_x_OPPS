import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Plus, Search, ShoppingCart, Check, X, 
  Truck, Package, AlertTriangle, MapPin, Clock, Car,
  Filter, BarChart3, Layers, Archive, Trash2
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { format, differenceInDays } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TypeformPOForm from "@/components/purchaseorders/TypeformPOForm";
import POModal from "@/components/purchaseorders/POModal";
import StockDemandPanel from "@/components/purchaseorders/StockDemandPanel";

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
  const [editingPO, setEditingPO] = useState(null);
  const [selectedPO, setSelectedPO] = useState(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("active");
  const [locationFilter, setLocationFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [showDemand, setShowDemand] = useState(false);
  const [selectedPOs, setSelectedPOs] = useState([]);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, type: null });
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

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 100)
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.PurchaseOrder.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      setShowForm(false);
      setEditingPO(null);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PurchaseOrder.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      setSelectedPO(null);
      setEditingPO(null);
    }
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => base44.entities.PurchaseOrder.update(id, { status: "archived" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      setSelectedPOs([]);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.PurchaseOrder.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      setSelectedPOs([]);
    }
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) {
        await base44.entities.PurchaseOrder.update(id, { status: "archived" });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      setSelectedPOs([]);
      toast.success(`Archived ${selectedPOs.length} POs`);
    }
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) {
        await base44.entities.PurchaseOrder.delete(id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      setSelectedPOs([]);
      toast.success(`Deleted ${selectedPOs.length} POs`);
    }
  });

  const handleStatusChange = (po, newStatus) => {
    updateMutation.mutate({ id: po.id, data: { status: newStatus } });
  };

  const togglePOSelection = (poId) => {
    setSelectedPOs(prev => 
      prev.includes(poId) 
        ? prev.filter(id => id !== poId)
        : [...prev, poId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedPOs.length === filteredPOs.length) {
      setSelectedPOs([]);
    } else {
      setSelectedPOs(filteredPOs.map(po => po.id));
    }
  };

  const handleConfirm = () => {
    if (confirmDialog.type === "bulk_archive") {
      bulkArchiveMutation.mutate(selectedPOs);
    } else if (confirmDialog.type === "bulk_delete") {
      bulkDeleteMutation.mutate(selectedPOs);
    }
    setConfirmDialog({ open: false, type: null });
  };

  // Get unique locations and products
  const supplierLocations = [...new Set(suppliers.map(s => s.location).filter(Boolean))];
  
  const allProducts = useMemo(() => {
    const products = new Set();
    purchaseOrders.forEach(po => {
      po.items?.forEach(item => {
        if (item.name) products.add(item.name);
      });
    });
    return [...products].sort();
  }, [purchaseOrders]);

  // Product demand aggregation
  const productDemand = useMemo(() => {
    const demand = {};
    purchaseOrders
      .filter(po => ['pending', 'approved', 'ordered'].includes(po.status))
      .forEach(po => {
        po.items?.forEach(item => {
          if (!demand[item.name]) {
            demand[item.name] = { total: 0, pos: [] };
          }
          demand[item.name].total += item.quantity || 0;
          demand[item.name].pos.push(po.po_number);
        });
      });
    return demand;
  }, [purchaseOrders]);

  // Enrich POs with supplier info
  const enrichedPOs = purchaseOrders.map(po => {
    const supplier = suppliers.find(s => s.id === po.supplier_id);
    return {
      ...po,
      supplierLocation: supplier?.location,
      avgUberFee: supplier?.avg_uber_fee || 0,
      supplier
    };
  });

  const getUrgency = (po) => {
    if (!po.expected_delivery) return "normal";
    const daysUntil = differenceInDays(new Date(po.expected_delivery), new Date());
    if (daysUntil < 0) return "overdue";
    if (daysUntil <= 2) return "urgent";
    if (daysUntil <= 7) return "soon";
    return "normal";
  };

  const activePOs = enrichedPOs.filter(po => 
    ['draft', 'pending', 'approved', 'ordered', 'partial'].includes(po.status)
  );
  const completedPOs = enrichedPOs.filter(po => 
    ['received', 'cancelled'].includes(po.status)
  );

  const filteredPOs = (activeTab === 'active' ? activePOs : completedPOs).filter(po => {
    const matchesSearch = !search || 
      po.po_number?.toLowerCase().includes(search.toLowerCase()) ||
      po.supplier_name?.toLowerCase().includes(search.toLowerCase());
    const matchesLocation = locationFilter === "all" || po.supplierLocation === locationFilter;
    const matchesProduct = productFilter === "all" || 
      po.items?.some(item => item.name === productFilter);
    return matchesSearch && matchesLocation && matchesProduct;
  });

  const totalEstimatedTransport = activePOs.reduce((sum, po) => sum + (po.avgUberFee || 0), 0);

  const handleSubmit = async (data) => {
    if (editingPO) {
      await updateMutation.mutateAsync({ id: editingPO.id, data });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  if (showForm || editingPO) {
    return (
      <TypeformPOForm 
        purchaseOrder={editingPO}
        suppliers={suppliers}
        inventoryItems={inventory}
        onSubmit={handleSubmit}
        onCancel={() => {
          setShowForm(false);
          setEditingPO(null);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog({ ...confirmDialog, open })}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={handleConfirm}
        confirmText={confirmDialog.type === "bulk_delete" ? "Delete" : "Archive"}
        variant={confirmDialog.type === "bulk_delete" ? "destructive" : "default"}
      />

      {/* PO Modal */}
      {selectedPO && (
        <POModal 
          po={selectedPO}
          supplier={selectedPO.supplier}
          onClose={() => setSelectedPO(null)}
          onStatusChange={handleStatusChange}
          onEdit={(po) => {
            setEditingPO(po);
            setSelectedPO(null);
          }}
        />
      )}

      {/* Demand Panel */}
      {showDemand && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowDemand(false)}
        >
          <div 
            className="bg-white rounded-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Stock & Demand Analysis</h2>
              <button 
                onClick={() => setShowDemand(false)}
                className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <StockDemandPanel 
              orders={orders}
              inventory={inventory}
              purchaseOrders={purchaseOrders}
            />
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {/* Premium Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Purchase Orders</h1>
              <p className="text-slate-500 mt-1">Manage supplier orders and stock</p>
            </div>
            {selectedPOs.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">{selectedPOs.length} selected</span>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setConfirmDialog({
                    open: true,
                    type: "bulk_archive",
                    title: "Archive Selected POs?",
                    description: `Archive ${selectedPOs.length} purchase orders?`
                  })}
                >
                  <Archive className="w-4 h-4 mr-1" /> Archive
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setConfirmDialog({
                    open: true,
                    type: "bulk_delete",
                    title: "Delete Selected POs?",
                    description: `Permanently delete ${selectedPOs.length} purchase orders?`
                  })}
                  className="text-red-600 border-red-200"
                >
                  <Trash2 className="w-4 h-4 mr-1" /> Delete
                </Button>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              onClick={() => setShowDemand(true)}
              className="rounded-xl border-slate-200"
            >
              <BarChart3 className="w-4 h-4 mr-2" /> Stock Analysis
            </Button>
            <Button onClick={() => setShowForm(true)} className="bg-slate-900 hover:bg-slate-800 rounded-xl h-11 px-6">
              <Plus className="w-4 h-4 mr-2" /> New PO
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="border-0 bg-white/80 backdrop-blur shadow-sm rounded-2xl">
            <CardContent className="p-5">
              <p className="text-sm text-slate-500">Active POs</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">{activePOs.length}</p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-white/80 backdrop-blur shadow-sm rounded-2xl">
            <CardContent className="p-5">
              <p className="text-sm text-slate-500">Pending Approval</p>
              <p className="text-3xl font-bold text-amber-600 mt-1">
                {activePOs.filter(p => p.status === 'pending').length}
              </p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-white/80 backdrop-blur shadow-sm rounded-2xl">
            <CardContent className="p-5">
              <p className="text-sm text-slate-500">Total Value</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                R{activePOs.reduce((sum, po) => sum + (po.total || 0), 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-white/80 backdrop-blur shadow-sm rounded-2xl">
            <CardContent className="p-5">
              <div className="flex items-center gap-2">
                <Car className="w-4 h-4 text-slate-400" />
                <p className="text-sm text-slate-500">Est. Transport</p>
              </div>
              <p className="text-3xl font-bold text-slate-900 mt-1">~R{totalEstimatedTransport}</p>
            </CardContent>
          </Card>
        </div>

        {/* Product Demand Summary */}
        {Object.keys(productDemand).length > 0 && (
          <Card className="mb-6 border-0 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl overflow-hidden">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Layers className="w-5 h-5 text-slate-400" />
                <p className="font-medium">Items on Order</p>
              </div>
              <div className="flex flex-wrap gap-3">
                {Object.entries(productDemand).slice(0, 8).map(([product, data]) => (
                  <button
                    key={product}
                    onClick={() => setProductFilter(productFilter === product ? "all" : product)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      productFilter === product
                        ? 'bg-white text-slate-900'
                        : 'bg-white/10 hover:bg-white/20'
                    }`}
                  >
                    {product.split(' ')[0]} <span className="opacity-70">×{data.total}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card className="mb-6 border-0 bg-white/80 backdrop-blur shadow-sm rounded-2xl">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex items-center gap-3">
                <Checkbox 
                  checked={selectedPOs.length === filteredPOs.length && filteredPOs.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-sm text-slate-500">Select all</span>
              </div>
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input 
                  placeholder="Search orders..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-11 h-11 rounded-xl border-slate-200 bg-slate-50"
                />
              </div>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="w-full md:w-44 h-11 rounded-xl border-slate-200">
                  <MapPin className="w-4 h-4 mr-2 text-slate-400" />
                  <SelectValue placeholder="Location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {supplierLocations.map(loc => (
                    <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={productFilter} onValueChange={setProductFilter}>
                <SelectTrigger className="w-full md:w-48 h-11 rounded-xl border-slate-200">
                  <Package className="w-4 h-4 mr-2 text-slate-400" />
                  <SelectValue placeholder="Product" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Products</SelectItem>
                  {allProducts.map(prod => (
                    <SelectItem key={prod} value={prod}>{prod}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 bg-slate-100 p-1 rounded-xl">
            <TabsTrigger value="active" className="rounded-lg">Active ({activePOs.length})</TabsTrigger>
            <TabsTrigger value="completed" className="rounded-lg">Completed ({completedPOs.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            {filteredPOs.length === 0 ? (
              <Card className="p-16 text-center border-0 bg-white/80 backdrop-blur rounded-3xl">
                <ShoppingCart className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-700 mb-2">No purchase orders</h3>
                <p className="text-slate-500 mb-6">Create a PO to restock inventory</p>
                <Button onClick={() => setShowForm(true)} className="rounded-xl">
                  <Plus className="w-4 h-4 mr-2" /> Create PO
                </Button>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPOs.map(po => (
                  <POCard key={po.id} po={po} onClick={() => setSelectedPO(po)} getUrgency={getUrgency} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="completed">
            {filteredPOs.length === 0 ? (
              <Card className="p-16 text-center border-0 bg-white/80 rounded-3xl">
                <p className="text-slate-500">No completed orders</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPOs.map(po => (
                  <div key={po.id} className="relative group">
                    <Checkbox 
                      checked={selectedPOs.includes(po.id)}
                      onCheckedChange={() => togglePOSelection(po.id)}
                      className="absolute top-3 left-3 z-10 bg-white border-2"
                    />
                    <div onClick={() => setSelectedPO(po)}>
                      <POCard po={po} onClick={() => setSelectedPO(po)} getUrgency={getUrgency} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function POCard({ po, onClick, getUrgency }) {
  const config = statusConfig[po.status] || statusConfig.draft;
  const StatusIcon = config.icon;
  const urgency = getUrgency(po);
  
  const urgencyStyles = {
    overdue: "ring-2 ring-red-300",
    urgent: "ring-2 ring-orange-300",
    soon: "",
    normal: ""
  };
  
  return (
    <Card 
      className={`border-0 bg-white/90 backdrop-blur shadow-sm hover:shadow-lg transition-all cursor-pointer rounded-2xl overflow-hidden ${urgencyStyles[urgency]}`}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-900">{po.po_number}</p>
              {po.auto_generated && (
                <span className="w-2 h-2 rounded-full bg-amber-400" title="Auto-generated" />
              )}
            </div>
            <p className="text-sm text-slate-500">{po.supplier_name}</p>
            {po.supplierLocation && (
              <p className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                <MapPin className="w-3 h-3" />
                {po.supplierLocation}
              </p>
            )}
          </div>
          <Badge className={`${config.className} border-0 rounded-full`}>
            {config.label}
          </Badge>
        </div>
        
        {/* Items Preview */}
        <div className="flex flex-wrap gap-1 mb-4">
          {po.items?.slice(0, 3).map((item, i) => (
            <span key={i} className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
              {item.name?.split(' ')[0]} ×{item.quantity}
            </span>
          ))}
          {po.items?.length > 3 && (
            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded-full">
              +{po.items.length - 3}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <div className="text-sm text-slate-500">
            {po.expected_delivery && (
              <span className={urgency === 'overdue' ? 'text-red-600 font-medium' : ''}>
                {format(new Date(po.expected_delivery), "dd MMM")}
              </span>
            )}
          </div>
          <p className="text-lg font-bold text-slate-900">R{(po.total || 0).toLocaleString()}</p>
        </div>
      </CardContent>
    </Card>
  );
}