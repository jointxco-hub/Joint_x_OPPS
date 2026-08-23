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
import { Checkbox } from "@/components/ui/checkbox";
import { Archive, ExternalLink, FileText, Mail, MapPin, Package, Phone, Plus, RefreshCw, Search, ShoppingBag, Trash2, Upload, Users, X } from "lucide-react";
import { toast } from "sonner";
import SignedFileLink from "@/components/common/SignedFileLink";
import { listInvoiceItemTemplates, listInvoiceItemVersions } from "@/api/invoices";
import ClientInvoiceItemHistory from "@/features/invoices/ClientInvoiceItemHistory";
import { SearchSelect } from "@/pages/Inventory";
import { adminOnboardClientCommerceProduct, adminGetClientCommerceProducts } from "@/api/commerceOnboarding";

const ACTIVE_ORDER_STATUSES = new Set(['confirmed', 'in_production', 'ready', 'shipped']);
const DONE_ORDER_STATUSES = new Set(['delivered']);
const CLOSED_ORDER_STATUSES = new Set(['delivered', 'cancelled']);

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function clientLinkKeys({ id, client_id, email, client_email, name, client_name }) {
  return [
    client_id || id ? `id:${client_id || id}` : '',
    normalizeKey(email ?? client_email) ? `email:${normalizeKey(email ?? client_email)}` : '',
    normalizeKey(name ?? client_name) ? `name:${normalizeKey(name ?? client_name)}` : '',
  ].filter(Boolean);
}

function clientKeys(client) {
  return clientLinkKeys(client);
}

function orderClientKeys(order) {
  return clientLinkKeys(order);
}

function orderPrimaryClientKey(order) {
  return orderClientKeys(order)[0] || '';
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
    const primaryOrdersByClientKey = new Map();

    orders
      .filter((order) => !order.is_archived && orderPrimaryClientKey(order))
      .forEach((order) => {
        const primaryKey = orderPrimaryClientKey(order);
        const primaryGroup = primaryOrdersByClientKey.get(primaryKey) || [];
        primaryGroup.push(order);
        primaryOrdersByClientKey.set(primaryKey, primaryGroup);

        orderClientKeys(order).forEach((key) => {
          const group = ordersByClientKey.get(key) || [];
          group.push(order);
          ordersByClientKey.set(key, group);
        });
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

    primaryOrdersByClientKey.forEach((group, key) => {
      if (key.startsWith('id:')) return;
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
      client.phone?.toLowerCase().includes(search.toLowerCase()) ||
      client.whatsapp_name?.toLowerCase().includes(search.toLowerCase()) ||
      client.saved_contact_name?.toLowerCase().includes(search.toLowerCase()) ||
      client.pep_code?.toLowerCase().includes(search.toLowerCase()) ||
      client.delivery_note?.toLowerCase().includes(search.toLowerCase());
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
                    {client.whatsapp_name && (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Phone className="w-4 h-4" />
                        WhatsApp: {client.whatsapp_name}
                      </div>
                    )}
                    {client.saved_contact_name && (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Users className="w-4 h-4" />
                        Saved as: {client.saved_contact_name}
                      </div>
                    )}
                    {client.delivery_address && (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <MapPin className="w-4 h-4" />
                        {client.delivery_address}
                      </div>
                    )}
                    {client.pep_code && (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <MapPin className="w-4 h-4" />
                        PEP/Pickup Code: {client.pep_code}
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

  const clientId = client && !client.is_order_only ? client.id : "";
  const { data: availableSavedItems = [] } = useQuery({
    queryKey: ["invoiceItemTemplates", "client-account", clientId],
    queryFn: () => listInvoiceItemTemplates({ clientId, limit: 300 }),
    enabled: Boolean(open && clientId),
  });
  const savedItems = availableSavedItems.filter((item) => item.client_id === clientId);
  const { data: itemHistory = [] } = useQuery({
    queryKey: ["invoiceItemVersions", "client-account", clientId],
    queryFn: () => listInvoiceItemVersions({ clientId, limit: 100 }),
    enabled: Boolean(open && clientId),
  });

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
          {(client.whatsapp_name || client.saved_contact_name) && (
            <p className="mt-1 text-xs text-slate-500">
              {client.whatsapp_name ? `WhatsApp: ${client.whatsapp_name}` : ''}
              {client.whatsapp_name && client.saved_contact_name ? ' · ' : ''}
              {client.saved_contact_name ? `Saved as: ${client.saved_contact_name}` : ''}
            </p>
          )}
          {(client.pep_code || client.preferred_courier || client.delivery_note) && (
            <p className="mt-1 text-xs text-slate-500">
              {[client.preferred_courier, client.pep_code, client.delivery_note].filter(Boolean).join(' · ')}
            </p>
          )}
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

        {clientId && <CommerceProductsSection clientId={clientId} tenantId={client.tenant_id} />}

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
                  <SignedFileLink
                    key={file.id}
                    url={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 rounded-md bg-slate-50 p-3 text-sm hover:bg-slate-100"
                  >
                    <span>
                      <span className="font-medium">{file.name}</span>
                      <span className="block text-xs text-slate-500">{file.type} - {file.order_number || 'Order'}</span>
                    </span>
                    <ExternalLink className="w-4 h-4 text-slate-400" />
                  </SignedFileLink>
                ))}
              </div>
            )}
          </section>
        </div>

        <ClientInvoiceItemHistory items={savedItems} history={itemHistory} />

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

// XOS 3B - internal staff onboarding for the tenant-wide Commerce catalog
// (commerce.products), connecting a client's managed product across
// Commerce, the client-account layer (client_products), OPPS, and X LAB via
// admin_onboard_client_commerce_product/admin_get_client_commerce_products
// (see supabase/migrations/20260823120000_xos_3b_product_onboarding.sql).
// Read-only for XOS itself - nothing here is reachable outside this staff
// admin surface.
function CommerceProductsSection({ clientId, tenantId }) {
  const [onboarding, setOnboarding] = useState(false);
  const queryClient = useQueryClient();

  const { data: commerceProducts = [], isLoading } = useQuery({
    queryKey: ['clientCommerceProducts', clientId],
    queryFn: async () => {
      const { data, error } = await adminGetClientCommerceProducts({ clientId });
      if (error) throw new Error(error);
      return data;
    },
    enabled: Boolean(clientId),
  });

  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Commerce Products</h3>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOnboarding(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Add product
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : commerceProducts.length === 0 ? (
        <p className="text-sm text-slate-500">No commerce products onboarded yet.</p>
      ) : (
        <div className="space-y-2">
          {commerceProducts.map((entry) => (
            <div key={entry.commerce_product.id} className="rounded-md bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-sm">{entry.commerce_product.name}</p>
                <Badge variant="outline" className="capitalize">{entry.commerce_product.status}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">Commerce Connected</Badge>
                <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">Client Account Connected</Badge>
                <Badge variant="outline" className={entry.xlab.linked ? "text-emerald-700 border-emerald-300 bg-emerald-50" : "text-slate-500 border-slate-300"}>
                  {entry.xlab.linked ? "X LAB Connected" : "X LAB Not Linked"}
                </Badge>
                <Badge variant="outline" className={entry.opps.linked ? "text-emerald-700 border-emerald-300 bg-emerald-50" : "text-amber-700 border-amber-300 bg-amber-50"}>
                  {entry.opps.linked ? "OPPS Connected" : "OPPS Mapping Pending"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      {onboarding && (
        <ProductOnboardingDialog
          clientId={clientId}
          tenantId={tenantId}
          onClose={() => setOnboarding(false)}
          onSaved={() => {
            setOnboarding(false);
            queryClient.invalidateQueries({ queryKey: ['clientCommerceProducts', clientId] });
          }}
        />
      )}
    </section>
  );
}

function emptyOnboardingForm() {
  return {
    name: "", description: "", price: "", sale_price: "", currency: "ZAR",
    primary_image_url: "", availability: "available", status: "draft",
    client_price: "", requires_quote: false, visible_in_account: false, reorder_enabled: true,
    existing_opps_product_id: "", existing_xlab_product_id: "",
  };
}

function emptyOnboardingVariant(sortOrder) {
  return { title: "", size: "", color: "", sku: "", price_override: "", availability: "available", sort_order: sortOrder };
}

function ProductOnboardingDialog({ clientId, tenantId, onClose, onSaved }) {
  const [form, setForm] = useState(emptyOnboardingForm());
  const [variants, setVariants] = useState([]);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const { data: oppsProducts = [] } = useQuery({
    queryKey: ['catalogItemsForTenant', tenantId],
    queryFn: () => dataClient.entities.CatalogItem.filter({ tenant_id: tenantId }, 'name', 200),
    enabled: Boolean(tenantId),
  });

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const addVariant = () => setVariants((v) => [...v, emptyOnboardingVariant(v.length)]);
  const updateVariant = (idx, patch) => setVariants((v) => v.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  const removeVariant = (idx) => setVariants((v) => v.filter((_, i) => i !== idx));

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const { file_url } = await dataClient.integrations.Core.UploadFile({ file, visibility: "public" });
      set({ primary_image_url: file_url });
    } catch {
      toast.error("Failed to upload image");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Product name is required");
      return;
    }
    setSaving(true);
    try {
      const idempotencyKey = `xos-onboard-${clientId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data, error } = await adminOnboardClientCommerceProduct({
        clientId,
        product: {
          name: form.name.trim(),
          description: form.description || undefined,
          price: form.price === "" ? undefined : Number(form.price),
          sale_price: form.sale_price === "" ? undefined : Number(form.sale_price),
          currency: form.currency,
          primary_image_url: form.primary_image_url || undefined,
          availability: form.availability,
          status: form.status,
          client_price: form.client_price === "" ? undefined : Number(form.client_price),
          requires_quote: form.requires_quote,
          visible_in_account: form.visible_in_account,
          reorder_enabled: form.reorder_enabled,
        },
        variants: variants.map((v, i) => ({
          title: v.title || undefined,
          size: v.size || undefined,
          color: v.color || undefined,
          sku: v.sku || undefined,
          price_override: v.price_override === "" ? undefined : Number(v.price_override),
          availability: v.availability,
          sort_order: i,
        })),
        existingOppsProductId: form.existing_opps_product_id || undefined,
        existingXlabProductId: form.existing_xlab_product_id.trim() || undefined,
        idempotencyKey,
      });
      if (error || !data) {
        toast.error(error || "Could not onboard product");
        return;
      }
      toast.success("Product onboarded to Commerce");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold">Add Commerce Product</h2>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Product Name *</Label>
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. GSB Signature Hoodie" />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={3} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Retail Price</Label>
                <Input type="number" value={form.price} onChange={(e) => set({ price: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Sale Price</Label>
                <Input type="number" value={form.sale_price} onChange={(e) => set({ sale_price: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Input value={form.currency} onChange={(e) => set({ currency: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Primary Image</Label>
              {form.primary_image_url && (
                <img src={form.primary_image_url} alt="" className="w-full h-40 object-cover rounded-lg" />
              )}
              <Button variant="outline" className="w-full" disabled={uploadingImage} onClick={() => document.getElementById('onboard-primary-image').click()}>
                <Upload className="w-4 h-4 mr-2" />
                {uploadingImage ? "Uploading..." : "Upload Primary Image"}
              </Button>
              <input id="onboard-primary-image" type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Availability</Label>
                <Select value={form.availability} onValueChange={(v) => set({ availability: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="out_of_stock">Out of stock</SelectItem>
                    <SelectItem value="preorder">Preorder</SelectItem>
                    <SelectItem value="unavailable">Unavailable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => set({ status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="mb-0">Variants</Label>
                <Button variant="outline" size="sm" onClick={addVariant}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add variant
                </Button>
              </div>
              {variants.map((v, idx) => (
                <div key={idx} className="grid grid-cols-6 gap-1.5 items-center rounded-md bg-slate-50 p-2">
                  <Input className="col-span-2" placeholder="Title" value={v.title} onChange={(e) => updateVariant(idx, { title: e.target.value })} />
                  <Input placeholder="Size" value={v.size} onChange={(e) => updateVariant(idx, { size: e.target.value })} />
                  <Input placeholder="Color" value={v.color} onChange={(e) => updateVariant(idx, { color: e.target.value })} />
                  <Input placeholder="SKU" value={v.sku} onChange={(e) => updateVariant(idx, { sku: e.target.value })} />
                  <Button variant="ghost" size="icon" onClick={() => removeVariant(idx)}>
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <Label className="mb-0">Managed Client Fields</Label>
              <p className="text-xs text-slate-500">Separate from the retail price above - only applies when a new client account product is created.</p>
              <div className="space-y-2">
                <Label>Client / Service Price</Label>
                <Input type="number" value={form.client_price} onChange={(e) => set({ client_price: e.target.value })} placeholder="Leave blank unless staff sets a distinct managed price" />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.requires_quote} onCheckedChange={(v) => set({ requires_quote: Boolean(v) })} />
                <Label className="mb-0">Requires quote</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.visible_in_account} onCheckedChange={(v) => set({ visible_in_account: Boolean(v) })} />
                <Label className="mb-0">Visible in client account</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.reorder_enabled} onCheckedChange={(v) => set({ reorder_enabled: Boolean(v) })} />
                <Label className="mb-0">Reorder enabled</Label>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <Label className="mb-0">Integration</Label>
              <div className="space-y-2">
                <Label className="text-xs text-slate-500">OPPS Product (optional)</Label>
                <SearchSelect
                  options={oppsProducts}
                  value={form.existing_opps_product_id}
                  onChange={(id) => set({ existing_opps_product_id: id })}
                  getLabel={(p) => p.name}
                  placeholder="Not linked - onboarding will show 'OPPS mapping pending'"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-500">X LAB Template ID (optional)</Label>
                <Input
                  value={form.existing_xlab_product_id}
                  onChange={(e) => set({ existing_xlab_product_id: e.target.value })}
                  placeholder="Paste an existing xlab_products id, or leave blank"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !form.name.trim()} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                {saving ? "Onboarding..." : "Onboard Product"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ClientFormDialog({ open, onOpenChange, client, onSubmit }) {
  const [formData, setFormData] = useState(client || {
    name: "",
    brand_name: "",
    email: "",
    phone: "",
    whatsapp: "",
    whatsapp_name: "",
    saved_contact_name: "",
    delivery_address: "",
    pep_code: "",
    delivery_note: "",
    preferred_courier: "",
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
        whatsapp_name: "",
        saved_contact_name: "",
        delivery_address: "",
        pep_code: "",
        delivery_note: "",
        preferred_courier: "",
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
              <Label>WhatsApp Name</Label>
              <Input
                value={formData.whatsapp_name || ""}
                onChange={(e) => setFormData({...formData, whatsapp_name: e.target.value})}
                placeholder="Name shown in WhatsApp"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Saved Contact Name</Label>
              <Input
                value={formData.saved_contact_name || ""}
                onChange={(e) => setFormData({...formData, saved_contact_name: e.target.value})}
                placeholder="How the client is saved"
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>PEP / Courier Pickup Code</Label>
              <Input
                value={formData.pep_code || ""}
                onChange={(e) => setFormData({...formData, pep_code: e.target.value})}
                placeholder="Client code, PAXI, locker, branch code"
              />
            </div>
            <div>
              <Label>Preferred Courier</Label>
              <Input
                value={formData.preferred_courier || ""}
                onChange={(e) => setFormData({...formData, preferred_courier: e.target.value})}
                placeholder="PEP, Courier Guy, Uber Collect..."
              />
            </div>
          </div>

          <div>
            <Label>Delivery Note</Label>
            <Textarea
              value={formData.delivery_note || ""}
              onChange={(e) => setFormData({...formData, delivery_note: e.target.value})}
              rows={2}
              placeholder="Store name, pickup instructions, address hint, courier note..."
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
