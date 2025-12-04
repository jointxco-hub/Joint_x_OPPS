import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Plus, Building2, Phone, MapPin, Star, X, Trash2,
  Mail, Clock, Edit, Users, Search, Filter
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
    queryFn: () => base44.entities.Supplier.list('name', 100)
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Supplier.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Supplier.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Supplier.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suppliers'] })
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
    if (editingSupplier) {
      updateMutation.mutate({ id: editingSupplier.id, data: formData });
    } else {
      createMutation.mutate(formData);
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

  // Get unique locations for filter
  const uniqueLocations = [...new Set(suppliers.map(s => s.location).filter(Boolean))];

  // Filter suppliers
  const filteredSuppliers = suppliers.filter(supplier => {
    const matchesSearch = !searchTerm || 
      supplier.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      supplier.location?.toLowerCase().includes(searchTerm.toLowerCase());
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
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Suppliers</h1>
            <p className="text-slate-500">Manage your suppliers and partners</p>
          </div>
          <Button onClick={() => setShowForm(true)} className="bg-slate-900 hover:bg-slate-800">
            <Plus className="w-4 h-4 mr-2" /> Add Supplier
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6 bg-white border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search suppliers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="w-full md:w-48">
                  <MapPin className="w-4 h-4 mr-2 text-slate-400" />
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
                <SelectTrigger className="w-full md:w-48">
                  <Filter className="w-4 h-4 mr-2 text-slate-400" />
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
          </CardContent>
        </Card>

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-2xl bg-white border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
              <CardHeader className="flex flex-row items-center justify-between pb-2 sticky top-0 bg-white z-10">
                <CardTitle>{editingSupplier ? "Edit Supplier" : "Add Supplier"}</CardTitle>
                <Button variant="ghost" size="icon" onClick={resetForm}>
                  <X className="w-5 h-5" />
                </Button>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Basic Info */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-slate-700">Basic Information</h3>
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
                      <h3 className="font-semibold text-slate-700 flex items-center gap-2">
                        <Users className="w-4 h-4" /> Team Contacts
                      </h3>
                      <Button type="button" variant="outline" size="sm" onClick={addContact}>
                        <Plus className="w-4 h-4 mr-1" /> Add Contact
                      </Button>
                    </div>
                    
                    {formData.contacts.map((contact, index) => (
                      <div key={index} className="bg-slate-50 rounded-lg p-4 space-y-3">
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
                    <h3 className="font-semibold text-slate-700">Terms & Details</h3>
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

                  <div className="flex gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={resetForm} className="flex-1">
                      Cancel
                    </Button>
                    <Button type="submit" className="flex-1 bg-slate-900">
                      {editingSupplier ? "Update" : "Add Supplier"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Suppliers List */}
        {Object.keys(groupedSuppliers).length === 0 ? (
          <Card className="p-12 text-center bg-white border-0">
            <Building2 className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-700 mb-2">
              {suppliers.length === 0 ? "No suppliers yet" : "No suppliers match filters"}
            </h3>
            <p className="text-slate-500 mb-4">
              {suppliers.length === 0 ? "Add your first supplier to get started" : "Try adjusting your filters"}
            </p>
            {suppliers.length === 0 && (
              <Button onClick={() => setShowForm(true)}>
                <Plus className="w-4 h-4 mr-2" /> Add Supplier
              </Button>
            )}
          </Card>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedSuppliers).map(([type, items]) => (
              <div key={type}>
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Badge className={`${typeColors[type]} border-0`}>
                    {typeLabels[type] || type}
                  </Badge>
                  <span>({items.length})</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {items.map(supplier => {
                    const contacts = supplier.contacts || [];
                    const primaryContact = contacts.find(c => c.is_primary) || contacts[0];
                    
                    return (
                      <Card key={supplier.id} className="bg-white border-0 shadow-sm hover:shadow-md transition-shadow">
                        <CardContent className="p-5">
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-slate-900 text-lg">{supplier.name}</h3>
                              {supplier.is_preferred && (
                                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                              )}
                            </div>
                          </div>
                          
                          <div className="space-y-2 mb-4">
                            {supplier.location && (
                              <div className="flex items-center gap-2 text-sm text-slate-600">
                                <MapPin className="w-4 h-4 text-slate-400" />
                                <span>{supplier.location}</span>
                              </div>
                            )}
                            
                            {/* Primary Contact */}
                            {primaryContact && (primaryContact.phone || primaryContact.name) && (
                              <div className="flex items-center gap-2 text-sm text-slate-600">
                                <Phone className="w-4 h-4 text-slate-400" />
                                <span>
                                  {primaryContact.phone}
                                  {primaryContact.name && ` (${primaryContact.name}${primaryContact.role ? ` - ${primaryContact.role}` : ''})`}
                                </span>
                              </div>
                            )}

                            {primaryContact?.email && (
                              <div className="flex items-center gap-2 text-sm text-slate-600">
                                <Mail className="w-4 h-4 text-slate-400" />
                                <span>{primaryContact.email}</span>
                              </div>
                            )}

                            {/* Additional Contacts Badge */}
                            {contacts.length > 1 && (
                              <div className="flex items-center gap-2 text-sm text-slate-500">
                                <Users className="w-4 h-4 text-slate-400" />
                                <span>+{contacts.length - 1} more contacts</span>
                              </div>
                            )}

                            {supplier.lead_time_days && (
                              <div className="flex items-center gap-2 text-sm text-slate-600">
                                <Clock className="w-4 h-4 text-slate-400" />
                                <span>{supplier.lead_time_days} day lead time</span>
                              </div>
                            )}
                          </div>

                          {supplier.payment_terms && (
                            <Badge variant="outline" className="mb-3">
                              {paymentTermLabels[supplier.payment_terms] || supplier.payment_terms}
                            </Badge>
                          )}

                          {supplier.notes && (
                            <p className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg mb-4 line-clamp-2">
                              {supplier.notes}
                            </p>
                          )}

                          <div className="flex gap-2 pt-3 border-t">
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => handleEdit(supplier)}
                              className="flex-1"
                            >
                              <Edit className="w-4 h-4 mr-1" /> Edit
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => deleteMutation.mutate(supplier.id)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
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