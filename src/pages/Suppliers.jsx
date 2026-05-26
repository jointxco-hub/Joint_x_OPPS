import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { 
  Plus, Building2, Phone, MapPin, Star, X, Archive, Trash2,
  Mail, Clock, Edit, Users, Search
} from "lucide-react";

const typeColors = {
  vinyl: "bg-blue-100 text-blue-700",
  dtf_printing: "bg-purple-100 text-purple-700",
  blanks: "bg-emerald-100 text-emerald-700",
  delivery: "bg-orange-100 text-orange-700",
  embroidery: "bg-pink-100 text-pink-700",
  screen_printing: "bg-cyan-100 text-cyan-700",
  other: "bg-slate-100 text-slate-700"
};

const typeLabels = {
  vinyl: "Vinyl",
  dtf_printing: "DTF Printing",
  blanks: "Blanks",
  delivery: "Delivery",
  embroidery: "Embroidery",
  screen_printing: "Screen Printing",
  other: "Other"
};

const paymentTermLabels = {
  cod: "Cash on Delivery",
  net_7: "Net 7 Days",
  net_14: "Net 14 Days",
  net_30: "Net 30 Days",
  prepaid: "Prepaid"
};

export default function Suppliers() {
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [formData, setFormData] = useState({
    name: "",
    type: "vinyl",
    location: "",
    address: "",
    contacts: [{ name: "", role: "", phone: "", email: "", is_primary: true }],
    notes: "",
    is_preferred: false,
    payment_terms: "cod",
    lead_time_days: 1,
    products: []
  });
  const queryClient = useQueryClient();

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => dataClient.entities.Supplier.list('name', 100)
  });

  const createMutation = useMutation({
    mutationFn: (data) => dataClient.entities.Supplier.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.Supplier.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      resetForm();
    }
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => dataClient.entities.Supplier.update(id, { is_archived: true, archived_at: new Date().toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success("Supplier archived");
    }
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingSupplier(null);
    setFormData({
      name: "", type: "vinyl", location: "", address: "",
      contacts: [{ name: "", role: "", phone: "", email: "", is_primary: true }],
      notes: "", is_preferred: false, payment_terms: "cod",
      lead_time_days: 1, avg_uber_fee: 0, avg_errand_time: 0, products: []
    });
  };

  const handleEdit = (supplier) => {
    setEditingSupplier(supplier);
    const contacts = supplier.contacts?.length > 0 
      ? supplier.contacts 
      : [{ 
          name: supplier.contact_name || "", 
          role: "", 
          phone: supplier.contact_phone || "", 
          email: supplier.contact_email || "", 
          is_primary: true 
        }];
    
    setFormData({
      name: supplier.name || "",
      type: supplier.type || "vinyl",
      location: supplier.location || "",
      address: supplier.address || "",
      contacts: contacts,
      notes: supplier.notes || "",
      is_preferred: supplier.is_preferred || false,
      payment_terms: supplier.payment_terms || "cod",
      lead_time_days: supplier.lead_time_days || 1,
      avg_uber_fee: supplier.avg_uber_fee || 0,
      avg_errand_time: supplier.avg_errand_time || 0,
      products: supplier.products || []
    });
    setShowForm(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const cleanedProducts = (Array.isArray(formData.products) ? formData.products : [])
      .map((item) => ({
        name: String(item.name || "").trim(),
        sku: String(item.sku || "").trim(),
        category: String(item.category || "").trim(),
        cost_price: item.cost_price === "" || item.cost_price == null ? null : Number(item.cost_price),
        selling_price: item.selling_price === "" || item.selling_price == null ? null : Number(item.selling_price),
        unit: String(item.unit || "unit").trim(),
        notes: String(item.notes || "").trim(),
      }))
      .filter((item) => item.name);
    const payload = { ...formData, products: cleanedProducts };
    if (editingSupplier) {
      updateMutation.mutate({ id: editingSupplier.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const addContact = () => {
    setFormData({
      ...formData,
      contacts: [...formData.contacts, { name: "", role: "", phone: "", email: "", is_primary: false }]
    });
  };

  const updateContact = (index, field, value) => {
    const updated = [...formData.contacts];
    updated[index][field] = value;
    if (field === 'is_primary' && value) {
      updated.forEach((c, i) => { if (i !== index) c.is_primary = false; });
    }
    setFormData({ ...formData, contacts: updated });
  };

  const removeContact = (index) => {
    if (formData.contacts.length <= 1) return;
    setFormData({ ...formData, contacts: formData.contacts.filter((_, i) => i !== index) });
  };

  const addProduct = () => {
    setFormData({
      ...formData,
      products: [
        ...(Array.isArray(formData.products) ? formData.products : []),
        { name: "", sku: "", category: "", cost_price: "", selling_price: "", unit: "unit", notes: "" },
      ],
    });
  };

  const updateProduct = (index, field, value) => {
    const products = Array.isArray(formData.products) ? [...formData.products] : [];
    products[index] = { ...(products[index] || {}), [field]: value };
    setFormData({ ...formData, products });
  };

  const removeProduct = (index) => {
    const products = Array.isArray(formData.products) ? formData.products : [];
    setFormData({ ...formData, products: products.filter((_, i) => i !== index) });
  };

  // Get unique locations for filter
  const uniqueLocations = [...new Set(suppliers.map(s => s.location).filter(Boolean))];

  // Filter suppliers
  const filteredSuppliers = suppliers.filter(supplier => {
    if (supplier.is_archived) return false;
    const matchesSearch = !searchTerm || 
      supplier.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      supplier.location?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (Array.isArray(supplier.products) && supplier.products.some((item) => item?.name?.toLowerCase().includes(searchTerm.toLowerCase())));
    const matchesLocation = locationFilter === "all" || supplier.location === locationFilter;
    const matchesType = typeFilter === "all" || supplier.type === typeFilter;
    return matchesSearch && matchesLocation && matchesType;
  });

  const groupedSuppliers = filteredSuppliers.reduce((acc, supplier) => {
    const type = supplier.type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(supplier);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 md:py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Suppliers</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage your suppliers and partners</p>
          </div>
          <Button onClick={() => setShowForm(true)} className="gap-2 shadow-apple-sm rounded-xl">
            <Plus className="w-4 h-4" /> Add Supplier
          </Button>
        </div>

        {/* Filters */}
        <div className="bg-card rounded-2xl border border-border shadow-apple-sm p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search suppliers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 rounded-xl h-9"
              />
            </div>
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="w-full md:w-40 rounded-xl h-9">
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {uniqueLocations.map(loc => (
                  <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full md:w-40 rounded-xl h-9">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {Object.entries(typeLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-card rounded-2xl border border-border shadow-apple-xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
                <h2 className="font-semibold text-foreground">{editingSupplier ? "Edit Supplier" : "Add Supplier"}</h2>
                <button onClick={resetForm} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center hover:bg-border transition-all">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <div className="p-5">
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Basic Info */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-foreground text-sm">Basic Information</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2 col-span-2">
                        <Label>Supplier Name *</Label>
                        <Input
                          value={formData.name}
                          onChange={(e) => setFormData({...formData, name: e.target.value})}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select value={formData.type} onValueChange={(v) => setFormData({...formData, type: v})}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(typeLabels).map(([key, label]) => (
                              <SelectItem key={key} value={key}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Location</Label>
                        <Input
                          value={formData.location}
                          onChange={(e) => setFormData({...formData, location: e.target.value})}
                          placeholder="e.g., Randburg"
                        />
                      </div>
                      <div className="space-y-2 col-span-2">
                        <Label>Full Address</Label>
                        <Input
                          value={formData.address}
                          onChange={(e) => setFormData({...formData, address: e.target.value})}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Contacts */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
                        <Users className="w-4 h-4" /> Team Contacts
                      </h3>
                      <Button type="button" variant="outline" size="sm" onClick={addContact}>
                        <Plus className="w-4 h-4 mr-1" /> Add Contact
                      </Button>
                    </div>
                    
                    {formData.contacts.map((contact, index) => (
                      <div key={index} className="bg-secondary/40 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={contact.is_primary}
                              onChange={(e) => updateContact(index, 'is_primary', e.target.checked)}
                              className="rounded"
                            />
                            <Label className="text-sm">Primary Contact</Label>
                          </div>
                          {formData.contacts.length > 1 && (
                            <Button type="button" variant="ghost" size="sm" onClick={() => removeContact(index)}>
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </Button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <Input
                            placeholder="Name"
                            value={contact.name}
                            onChange={(e) => updateContact(index, 'name', e.target.value)}
                          />
                          <Input
                            placeholder="Role (e.g., Sales)"
                            value={contact.role}
                            onChange={(e) => updateContact(index, 'role', e.target.value)}
                          />
                          <Input
                            placeholder="Phone"
                            value={contact.phone}
                            onChange={(e) => updateContact(index, 'phone', e.target.value)}
                          />
                          <Input
                            placeholder="Email"
                            type="email"
                            value={contact.email}
                            onChange={(e) => updateContact(index, 'email', e.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Terms */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-foreground text-sm">Terms & Details</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Payment Terms</Label>
                        <Select value={formData.payment_terms} onValueChange={(v) => setFormData({...formData, payment_terms: v})}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(paymentTermLabels).map(([key, label]) => (
                              <SelectItem key={key} value={key}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Lead Time (days)</Label>
                        <Input
                          type="number"
                          value={formData.lead_time_days}
                          onChange={(e) => setFormData({...formData, lead_time_days: parseInt(e.target.value) || 1})}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Avg Uber/Transport Fee (R)</Label>
                        <Input
                          type="number"
                          value={formData.avg_uber_fee || 0}
                          onChange={(e) => setFormData({...formData, avg_uber_fee: parseFloat(e.target.value) || 0})}
                          placeholder="e.g., 80"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Avg Errand Time (min)</Label>
                        <Input
                          type="number"
                          value={formData.avg_errand_time || 0}
                          onChange={(e) => setFormData({...formData, avg_errand_time: parseInt(e.target.value) || 0})}
                          placeholder="e.g., 45"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.is_preferred}
                        onChange={(e) => setFormData({...formData, is_preferred: e.target.checked})}
                        className="rounded"
                      />
                      <Label>Preferred Supplier (used for auto-generated POs)</Label>
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({...formData, notes: e.target.value})}
                      placeholder="Pricing info, special instructions..."
                      rows={3}
                    />
                  </div>

                  {/* Supplier products */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-foreground text-sm">Supplier Items</h3>
                        <p className="text-xs text-muted-foreground">Save blanks, print services, packaging, courier items, or price references.</p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={addProduct}>
                        <Plus className="w-4 h-4 mr-1" /> Add Item
                      </Button>
                    </div>

                    {(Array.isArray(formData.products) ? formData.products : []).length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
                        No supplier items yet. You can still save the supplier and add items later.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {(Array.isArray(formData.products) ? formData.products : []).map((product, index) => (
                          <div key={index} className="rounded-xl border border-border bg-secondary/30 p-3">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Item {index + 1}</p>
                              <Button type="button" variant="ghost" size="sm" onClick={() => removeProduct(index)} className="h-7 text-red-600">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="col-span-2 space-y-1.5">
                                <Label>Item name</Label>
                                <Input
                                  value={product.name || ""}
                                  onChange={(e) => updateProduct(index, "name", e.target.value)}
                                  placeholder="e.g. 180g Loose Fit Tee / DTF meter / Swing tag"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>SKU / Code</Label>
                                <Input
                                  value={product.sku || ""}
                                  onChange={(e) => updateProduct(index, "sku", e.target.value)}
                                  placeholder="Optional"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Category</Label>
                                <Input
                                  value={product.category || ""}
                                  onChange={(e) => updateProduct(index, "category", e.target.value)}
                                  placeholder="Blanks, DTF, packaging..."
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Cost price</Label>
                                <Input
                                  type="number"
                                  value={product.cost_price ?? ""}
                                  onChange={(e) => updateProduct(index, "cost_price", e.target.value)}
                                  placeholder="R"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Selling / estimate</Label>
                                <Input
                                  type="number"
                                  value={product.selling_price ?? ""}
                                  onChange={(e) => updateProduct(index, "selling_price", e.target.value)}
                                  placeholder="R"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Unit</Label>
                                <Input
                                  value={product.unit || ""}
                                  onChange={(e) => updateProduct(index, "unit", e.target.value)}
                                  placeholder="unit, meter, piece, box"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Notes</Label>
                                <Input
                                  value={product.notes || ""}
                                  onChange={(e) => updateProduct(index, "notes", e.target.value)}
                                  placeholder="Sizes, colours, MOQ..."
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={resetForm} className="flex-1 rounded-xl">
                      Cancel
                    </Button>
                    <Button type="submit" className="flex-1 rounded-xl">
                      {editingSupplier ? "Update" : "Add Supplier"}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Suppliers List */}
        {Object.keys(groupedSuppliers).length === 0 ? (
          <div className="text-center py-20">
            <Building2 className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">
              {suppliers.length === 0 ? "No suppliers yet" : "No suppliers match filters"}
            </p>
            {suppliers.length === 0 && (
              <Button onClick={() => setShowForm(true)} className="mt-4 rounded-xl gap-2">
                <Plus className="w-4 h-4" /> Add Supplier
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedSuppliers).map(([type, items]) => (
              <div key={type}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${typeColors[type]}`}>
                    {typeLabels[type] || type}
                  </span>
                  <span className="text-xs text-muted-foreground">({items.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {items.map(supplier => {
                    const contacts = supplier.contacts || [];
                    const primaryContact = contacts.find(c => c.is_primary) || contacts[0];
                    return (
                      <div key={supplier.id} className="bg-card rounded-2xl border border-border shadow-apple-sm p-5 hover:shadow-apple transition-all">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-foreground">{supplier.name}</h3>
                            {supplier.is_preferred && (
                              <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                            )}
                          </div>
                        </div>
                        <div className="space-y-2 mb-4">
                          {supplier.location && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <MapPin className="w-3.5 h-3.5" />
                              <span>{supplier.location}</span>
                            </div>
                          )}
                          {primaryContact && (primaryContact.phone || primaryContact.name) && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Phone className="w-3.5 h-3.5" />
                              <span>{primaryContact.phone}{primaryContact.name && ` (${primaryContact.name})`}</span>
                            </div>
                          )}
                          {primaryContact?.email && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Mail className="w-3.5 h-3.5" />
                              <span>{primaryContact.email}</span>
                            </div>
                          )}
                          {contacts.length > 1 && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Users className="w-3.5 h-3.5" />
                              <span>+{contacts.length - 1} more contacts</span>
                            </div>
                          )}
                          {supplier.lead_time_days && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Clock className="w-3.5 h-3.5" />
                              <span>{supplier.lead_time_days} day lead time</span>
                            </div>
                          )}
                        </div>
                        {supplier.payment_terms && (
                          <Badge variant="outline" className="mb-3 text-xs">
                            {paymentTermLabels[supplier.payment_terms] || supplier.payment_terms}
                          </Badge>
                        )}
                        {supplier.notes && (
                          <p className="text-sm text-muted-foreground bg-secondary/40 p-3 rounded-xl mb-4 line-clamp-2">
                            {supplier.notes}
                          </p>
                        )}
                        {Array.isArray(supplier.products) && supplier.products.length > 0 && (
                          <div className="mb-4 rounded-xl border border-border bg-secondary/30 p-3">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Supplier items ({supplier.products.length})
                            </p>
                            <div className="space-y-1.5">
                              {supplier.products.slice(0, 4).map((product, index) => (
                                <div key={`${product.name}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                                  <span className="min-w-0 truncate text-foreground">{product.name}</span>
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {product.cost_price ? `R${Number(product.cost_price).toLocaleString()}` : product.category || product.unit || ""}
                                  </span>
                                </div>
                              ))}
                              {supplier.products.length > 4 && (
                                <p className="text-xs text-muted-foreground">+{supplier.products.length - 4} more</p>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="flex gap-2 pt-3 border-t border-border">
                          <Button variant="outline" size="sm" onClick={() => handleEdit(supplier)} className="flex-1 rounded-xl">
                            <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => {
                              if (confirm(`Archive ${supplier.name}?`)) archiveMutation.mutate(supplier.id);
                            }}
                            className="text-muted-foreground hover:bg-secondary rounded-xl">
                            <Archive className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
