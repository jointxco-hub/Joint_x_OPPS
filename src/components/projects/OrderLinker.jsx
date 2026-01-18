import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Link2, X } from "lucide-react";
import { toast } from "sonner";

export default function OrderLinker({ projectId, clientName, onClose }) {
  const [activeTab, setActiveTab] = useState("link");
  const [search, setSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const queryClient = useQueryClient();

  // New order form data
  const [formData, setFormData] = useState({
    project_id: projectId,
    client_name: clientName,
    order_number: "",
    description: "",
    quantity: "",
    print_type: "dtf",
    status: "received",
    priority: "normal",
    quoted_price: "",
    notes: ""
  });

  const { data: allOrders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 200)
  });

  const linkOrderMutation = useMutation({
    mutationFn: (orderId) => base44.entities.Order.update(orderId, { project_id: projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectOrders', projectId] });
      toast.success("Order linked to project!");
      onClose();
    }
  });

  const createOrderMutation = useMutation({
    mutationFn: (data) => base44.entities.Order.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectOrders', projectId] });
      toast.success("Order created!");
      onClose();
    }
  });

  const unlinkedOrders = allOrders.filter(o => !o.project_id);
  const filteredOrders = unlinkedOrders.filter(o => 
    !search || 
    o.order_number?.toLowerCase().includes(search.toLowerCase()) ||
    o.client_name?.toLowerCase().includes(search.toLowerCase()) ||
    o.description?.toLowerCase().includes(search.toLowerCase())
  );

  const handleLinkOrder = () => {
    if (selectedOrder) {
      linkOrderMutation.mutate(selectedOrder.id);
    }
  };

  const handleCreateOrder = (e) => {
    e.preventDefault();
    createOrderMutation.mutate(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-3xl max-h-[90vh] overflow-hidden">
        <CardContent className="p-0">
          <div className="flex items-center justify-between p-6 border-b">
            <h2 className="text-xl font-bold">Add Order to Project</h2>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="px-6 pt-4">
              <TabsList className="w-full">
                <TabsTrigger value="link" className="flex-1">Link Existing Order</TabsTrigger>
                <TabsTrigger value="create" className="flex-1">Create New Order</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="link" className="p-6 max-h-[60vh] overflow-y-auto">
              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input 
                    placeholder="Search orders..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>

                {filteredOrders.length === 0 ? (
                  <p className="text-center text-slate-500 py-8">No unlinked orders found</p>
                ) : (
                  <div className="space-y-2">
                    {filteredOrders.map(order => (
                      <div
                        key={order.id}
                        onClick={() => setSelectedOrder(order)}
                        className={`p-4 border rounded-lg cursor-pointer transition-all ${
                          selectedOrder?.id === order.id 
                            ? 'border-slate-900 bg-slate-50' 
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold">{order.order_number}</h3>
                            <p className="text-sm text-slate-500">{order.client_name}</p>
                            {order.description && (
                              <p className="text-sm text-slate-600 mt-1">{order.description}</p>
                            )}
                          </div>
                          <Badge className="capitalize">{order.status.replace(/_/g, ' ')}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <Button variant="outline" onClick={onClose}>Cancel</Button>
                  <Button 
                    onClick={handleLinkOrder} 
                    disabled={!selectedOrder || linkOrderMutation.isPending}
                  >
                    <Link2 className="w-4 h-4 mr-2" />
                    Link Order
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="create" className="p-6 max-h-[60vh] overflow-y-auto">
              <form onSubmit={handleCreateOrder} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Order Number *</Label>
                    <Input
                      value={formData.order_number}
                      onChange={(e) => setFormData({...formData, order_number: e.target.value})}
                      placeholder="e.g., ORD-001"
                      required
                    />
                  </div>
                  <div>
                    <Label>Client Name</Label>
                    <Input
                      value={formData.client_name}
                      onChange={(e) => setFormData({...formData, client_name: e.target.value})}
                      placeholder={clientName}
                    />
                  </div>
                </div>

                <div>
                  <Label>Description *</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    placeholder="Order details..."
                    rows={3}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={formData.quantity}
                      onChange={(e) => setFormData({...formData, quantity: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label>Print Type</Label>
                    <Select value={formData.print_type} onValueChange={(v) => setFormData({...formData, print_type: v})}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dtf">DTF</SelectItem>
                        <SelectItem value="vinyl">Vinyl</SelectItem>
                        <SelectItem value="embroidery">Embroidery</SelectItem>
                        <SelectItem value="none">None</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Status</Label>
                    <Select value={formData.status} onValueChange={(v) => setFormData({...formData, status: v})}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="received">Received</SelectItem>
                        <SelectItem value="materials_needed">Materials Needed</SelectItem>
                        <SelectItem value="in_production">In Production</SelectItem>
                        <SelectItem value="ready">Ready</SelectItem>
                        <SelectItem value="out_for_delivery">Out for Delivery</SelectItem>
                        <SelectItem value="delivered">Delivered</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Priority</Label>
                    <Select value={formData.priority} onValueChange={(v) => setFormData({...formData, priority: v})}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Quoted Price</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={formData.quoted_price}
                    onChange={(e) => setFormData({...formData, quoted_price: e.target.value})}
                    placeholder="0"
                  />
                </div>

                <div>
                  <Label>Notes</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    rows={2}
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                  <Button type="submit" disabled={createOrderMutation.isPending}>
                    Create Order
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}