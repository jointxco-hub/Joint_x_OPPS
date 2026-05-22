import React, { useMemo, useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Archive, ExternalLink, FileText, Mail, MapPin, Phone, Plus, RefreshCw, Search, ShoppingBag, Users } from "lucide-react";
import { toast } from "sonner";

const ACTIVE_ORDER_STATUSES = new Set(['confirmed', 'in_production', 'ready', 'shipped']);
const DONE_ORDER_STATUSES = new Set(['delivered']);
const CLOSED_ORDER_STATUSES = new Set(['delivered', 'cancelled']);

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function orderClientKey(order) {
  return normalizeKey(order.client_email) || normalizeKey(order.client_name);
}

function clientKeys(client) {
  return [
    normalizeKey(client.email ?? client.client_email),
    normalizeKey(client.name ?? client.client_name),
  ].filter(Boolean);
}

function orderAmount(order) {
  const direct = Number(order.total_amount ?? order.quoted_price ?? 0);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const products = Array.isArray(order.products) ? order.products : [];
  return products.reduce((sum, item) => {
    const quantity = Number(item?.quantity ?? 1) || 1;
    const price = Number(item?.price ?? item?.unit_price ?? item?.total ?? 0) || 0;
    return sum + (item?.total ? price : quantity * price);
  }, 0);
}

function getOrderDate(order) {
  const value = order.updated_date ?? order.updated_at ?? order.created_date ?? order.created_at;
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function buildStats(orders) {
  const totalRevenue = orders.reduce((sum, order) => sum + orderAmount(order), 0);
  const activeOrders = orders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status)).length;
  const completedOrders = orders.filter((order) => DONE_ORDER_STATUSES.has(order.status)).length;
  const cancelledOrders = orders.filter((order) => order.status === 'cancelled').length;
  const lastOrderAt = orders.reduce((latest, order) => Math.max(latest, getOrderDate(order)), 0);
  const hasOnlyClosedOrders = orders.length > 0 && orders.every((order) => CLOSED_ORDER_STATUSES.has(order.status));
  const daysSinceLastOrder = lastOrderAt ? (Date.now() - lastOrderAt) / 86400000 : Infinity;

  let status = 'lead';
  if (activeOrders > 0) status = 'active';
  else if (completedOrders > 0 && hasOnlyClosedOrders) status = daysSinceLastOrder > 120 ? 'dormant' : 'completed';

  return {
    orders,
    total_orders: orders.length,
    active_orders: activeOrders,
    completed_orders: completedOrders,
    cancelled_orders: cancelledOrders,
    total_revenue: totalRevenue,
    last_order_at: lastOrderAt ? new Date(lastOrderAt).toISOString() : null,
    status,
  };
}

function clientFiles(client) {
  return (client.orders || []).flatMap((order) => {
    const uploadedFiles = (Array.isArray(order.file_urls) ? order.file_urls : []).map((url, index) => ({
      id: `${order.id}:file:${index}`,
      name: `Order file ${index + 1}`,
      url,
      type: 'File',
      order_number: order.order_number,
    }));

    const invoiceFiles = (Array.isArray(order.invoice_files) ? order.invoice_files : []).map((file, index) => ({
      id: `${order.id}:invoice:${index}`,
      name: file?.name || file?.file_name || `Invoice ${index + 1}`,
      url: file?.url || file?.file_url || file,
      type: 'Invoice',
      order_number: order.order_number,
    }));

    return [...uploadedFiles, ...invoiceFiles].filter((file) => file.url);
  });
}

function clientInstructions(client) {
  return (client.orders || [])
    .filter((order) => order.special_instructions || order.notes)
    .map((order) => ({
      id: order.id,
      order_number: order.order_number,
      text: order.special_instructions || order.notes,
    }));
}

export default function Clients() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const queryClient = useQueryClient();

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: () => dataClient.entities.Client.list('-created_date', 200)
  });

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['orders', 'client-rollups'],
    queryFn: () => dataClient.entities.Order.list('-updated_date', 2000),
    staleTime: 30000,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const client = await dataClient.entities.Client.create(data);
      if (client?.id) {
        try {
          // Ensure root "Clients" folder exists
          const allFolders = await dataClient.entities.Folder.list('-created_date', 500);
          let rootFolder = allFolders.find(f => !f.is_archived && !f.parent_id && f.name === 'Clients');
          if (!rootFolder) {
            rootFolder = await dataClient.entities.Folder.create({ name: 'Clients', color: 'blue', parent_id: null });
          }
          // Create sub-folder for this client
          await dataClient.entities.Folder.create({
            name: client.name || data.name,
            color: 'green',
            parent_id: rootFolder.id,
            client_id: client.id,
          });
        } catch {
          // Folder creation is best-effort — don't block client save
        }
      }
      return client;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      setShowForm(false);
      toast.success("Client created! Folder auto-created in Files.");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.Client.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setEditingClient(null);
      setShowForm(false);
      toast.success("Client updated!");
    }
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => dataClient.entities.Client.update(id, { is_archived: true, archived_at: new Date().toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success("Client archived");
    }
  });

  const clientsWithStats = useMemo(() => {
    const ordersByClientKey = new Map();

    orders
      .filter((order) => !order.is_archived && orderClientKey(order))
      .forEach((order) => {
        const key = orderClientKey(order);
        const group = ordersByClientKey.get(key) || [];
        group.push(order);
        ordersByClientKey.set(key, group);
      });

    const linkedOrderKeys = new Set();
    const hydratedClients = clients.map((client) => {
      const matchedOrders = [];
      clientKeys(client).forEach((key) => {
        const group = ordersByClientKey.get(key);
        if (group) {
          matchedOrders.push(...group);
          linkedOrderKeys.add(key);
        }
      });

      const uniqueOrders = Array.from(new Map(matchedOrders.map((order) => [order.id, order])).values());
      const stats = buildStats(uniqueOrders);

      return {
        ...client,
        ...stats,
        status: stats.status,
      };
    });

    const existingClientKeys = new Set(clients.flatMap(clientKeys));
    const orderOnlyClients = [];

    ordersByClientKey.forEach((group, key) => {
      if (linkedOrderKeys.has(key) || existingClientKeys.has(key)) return;
      const newestOrder = [...group].sort((a, b) => getOrderDate(b) - getOrderDate(a))[0] || {};
      const stats = buildStats(group);

      orderOnlyClients.push({
        id: `order-client:${key}`,
        name: newestOrder.client_name || newestOrder.client_email || 'Unnamed client',
        email: newestOrder.client_email || '',
        phone: newestOrder.client_phone || '',
        company_name: '',
        notes: '',
        is_archived: false,
        is_order_only: true,
        created_date: newestOrder.created_date ?? newestOrder.created_at,
        ...stats,
      });
    });

    return [...hydratedClients, ...orderOnlyClients].sort((a, b) => {
      const aTime = Date.parse(a.last_order_at || a.updated_date || a.created_date || '') || 0;
      const bTime = Date.parse(b.last_order_at || b.updated_date || b.created_date || '') || 0;
      return bTime - aTime;
    });
  }, [clients, orders]);

  const filteredClients = clientsWithStats.filter(client => {
    if (client.is_archived) return false;
    const matchesSearch = !search || 
      client.name?.toLowerCase().includes(search.toLowerCase()) ||
      client.email?.toLowerCase().includes(search.toLowerCase()) ||
      client.phone?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || client.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusConfig = {
    lead: { label: "Lead", color: "bg-primary/10 text-primary" },
    active: { label: "Active", color: "bg-green-100 text-green-700" },
    completed: { label: "Completed", color: "bg-slate-100 text-slate-700" },
    dormant: { label: "Dormant", color: "bg-amber-100 text-amber-700" }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
            <p className="text-slate-500 mt-1">
              {clientsWithStats.length} clients tracked from {orders.length} orders
            </p>
          </div>
          <div className="flex gap-3">
            <Button 
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['clients'] });
                queryClient.invalidateQueries({ queryKey: ['orders', 'client-rollups'] });
                toast.success("Refreshed!");
              }} 
              variant="ghost"
              size="icon"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 mr-2" /> New Client
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl p-4 mb-6 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Search clients..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="lead">Lead</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="dormant">Dormant</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Clients Grid */}
        {(isLoading || ordersLoading) ? (
          <div className="bg-white rounded-xl p-12 text-center">
            <RefreshCw className="w-10 h-10 text-primary mx-auto mb-4 animate-spin" />
            <h3 className="text-lg font-medium text-slate-700">Loading client accounts...</h3>
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center">
            <Users className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-700 mb-2">No clients found</h3>
            <p className="text-slate-500 mb-4">Create your first client to get started</p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Client
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredClients.map(client => (
              <Card key={client.id} className="hover:shadow-lg transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900 mb-1">{client.name}</h3>
                      {client.brand_name && (
                        <p className="text-sm text-slate-500">{client.brand_name}</p>
                      )}
                    </div>
                    <Badge className={statusConfig[client.status]?.color}>
                      {statusConfig[client.status]?.label}
                    </Badge>
                  </div>
                  {client.is_order_only && (
                    <p className="text-xs text-primary mb-3">Auto-linked from orders</p>
                  )}

                  <div className="space-y-2 mb-4">
                    {client.email && (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Mail className="w-4 h-4" />
                        {client.email}
                      </div>
                    )}
                    {client.phone && (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Phone className="w-4 h-4" />
                        {client.phone}
                      </div>
                    )}
                    {client.delivery_address && (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <MapPin className="w-4 h-4" />
                        {client.delivery_address}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100">
                    <div>
                      <p className="text-xs text-slate-500">Orders</p>
                      <p className="text-lg font-semibold">{client.total_orders || 0}</p>
                      <p className="text-xs text-slate-500">
                        {client.active_orders || 0} active / {client.completed_orders || 0} done
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Spent</p>
                      <p className="text-lg font-semibold">R{(client.total_revenue || 0).toLocaleString()}</p>
                      {client.last_order_at && (
                        <p className="text-xs text-slate-500">
                          Last {new Date(client.last_order_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 mt-4">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setSelectedClient(client)}
                      className="flex-1"
                    >
                      Open Account
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (client.is_order_only) {
                          setEditingClient(client);
                          setShowForm(true);
                        } else {
                          setEditingClient(client);
                          setShowForm(true);
                        }
                      }}
                    >
                      {client.is_order_only ? 'Create Profile' : 'Edit'}
                    </Button>
                    {!client.is_order_only && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Archive ${client.name}?`)) {
                            archiveMutation.mutate(client.id);
                          }
                        }}
                      >
                        <Archive className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Client Form Dialog */}
        <ClientFormDialog 
          open={showForm}
          onOpenChange={(open) => {
            setShowForm(open);
            if (!open) setEditingClient(null);
          }}
          client={editingClient}
          onSubmit={(data) => {
            if (editingClient && !editingClient.is_order_only) {
              updateMutation.mutate({ id: editingClient.id, data });
            } else {
              createMutation.mutate(data);
            }
          }}
        />
        <ClientAccountDialog
          client={selectedClient}
          open={!!selectedClient}
          onOpenChange={(open) => {
            if (!open) setSelectedClient(null);
          }}
        />
      </div>
    </div>
  );
}

function ClientAccountDialog({ client, open, onOpenChange }) {
  if (!client) return null;

  const files = clientFiles(client);
  const instructions = clientInstructions(client);
  const orders = [...(client.orders || [])].sort((a, b) => getOrderDate(b) - getOrderDate(a));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client.name}</DialogTitle>
          <p className="text-sm text-slate-500">
            {client.is_order_only ? 'Auto-linked from orders' : client.company_name || client.brand_name || 'Client account'}
          </p>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Total spent</p>
            <p className="text-xl font-semibold">R{(client.total_revenue || 0).toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Orders</p>
            <p className="text-xl font-semibold">{client.total_orders || 0}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Active</p>
            <p className="text-xl font-semibold">{client.active_orders || 0}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Done</p>
            <p className="text-xl font-semibold">{client.completed_orders || 0}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <ShoppingBag className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">Linked Orders</h3>
            </div>
            {orders.length === 0 ? (
              <p className="text-sm text-slate-500">No linked orders yet.</p>
            ) : (
              <div className="space-y-2">
                {orders.slice(0, 12).map((order) => (
                  <div key={order.id} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 p-3">
                    <div>
                      <p className="font-medium text-sm">{order.order_number || 'Order'}</p>
                      <p className="text-xs text-slate-500 capitalize">{String(order.status || '').replace(/_/g, ' ')}</p>
                    </div>
                    <p className="font-semibold text-sm">R{orderAmount(order).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">Files & Invoices</h3>
            </div>
            {files.length === 0 ? (
              <p className="text-sm text-slate-500">No files linked from orders yet.</p>
            ) : (
              <div className="space-y-2">
                {files.slice(0, 12).map((file) => (
                  <a
                    key={file.id}
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 rounded-md bg-slate-50 p-3 text-sm hover:bg-slate-100"
                  >
                    <span>
                      <span className="font-medium">{file.name}</span>
                      <span className="block text-xs text-slate-500">{file.type} - {file.order_number || 'Order'}</span>
                    </span>
                    <ExternalLink className="w-4 h-4 text-slate-400" />
                  </a>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold mb-3">Special Instructions</h3>
          {instructions.length === 0 ? (
            <p className="text-sm text-slate-500">No special instructions linked from orders.</p>
          ) : (
            <div className="space-y-2">
              {instructions.slice(0, 8).map((item) => (
                <div key={item.id} className="rounded-md bg-slate-50 p-3">
                  <p className="text-xs text-slate-500 mb-1">{item.order_number || 'Order'}</p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{item.text}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function ClientFormDialog({ open, onOpenChange, client, onSubmit }) {
  const [formData, setFormData] = useState(client || {
    name: "",
    brand_name: "",
    email: "",
    phone: "",
    whatsapp: "",
    delivery_address: "",
    company_name: "",
    status: "lead",
    notes: ""
  });

  React.useEffect(() => {
    if (client) {
      setFormData(client);
    } else {
      setFormData({
        name: "",
        brand_name: "",
        email: "",
        phone: "",
        whatsapp: "",
        delivery_address: "",
        company_name: "",
        status: "lead",
        notes: ""
      });
    }
  }, [client, open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client && !client.is_order_only ? 'Edit Client' : 'New Client'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Client Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                required
              />
            </div>
            <div>
              <Label>Brand Name</Label>
              <Input
                value={formData.brand_name}
                onChange={(e) => setFormData({...formData, brand_name: e.target.value})}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                type="tel"
                inputMode="tel"
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>WhatsApp</Label>
              <Input
                type="tel"
                inputMode="tel"
                value={formData.whatsapp}
                onChange={(e) => setFormData({...formData, whatsapp: e.target.value})}
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({...formData, status: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="dormant">Dormant</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Company Name</Label>
            <Input
              value={formData.company_name}
              onChange={(e) => setFormData({...formData, company_name: e.target.value})}
            />
          </div>

          <div>
            <Label>Delivery Address</Label>
            <Textarea
              value={formData.delivery_address}
              onChange={(e) => setFormData({...formData, delivery_address: e.target.value})}
              rows={2}
            />
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              {client && !client.is_order_only ? 'Update' : 'Create'} Client
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
