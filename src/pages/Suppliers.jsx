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
  Plus, Building2, Phone, MapPin, Star, X, Trash2
} from "lucide-react";

const typeColors = {
  vinyl: "bg-blue-100 text-blue-700",
  dtf_printing: "bg-purple-100 text-purple-700",
  blanks: "bg-emerald-100 text-emerald-700",
  delivery: "bg-orange-100 text-orange-700"
};

const typeLabels = {
  vinyl: "Vinyl",
  dtf_printing: "DTF Printing",
  blanks: "Blanks",
  delivery: "Delivery"
};

export default function Suppliers() {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    type: "vinyl",
    location: "",
    address: "",
    contact_name: "",
    contact_phone: "",
    notes: "",
    is_preferred: false
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
      setShowForm(false);
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Supplier.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suppliers'] })
  });

  const resetForm = () => {
    setFormData({
      name: "", type: "vinyl", location: "", address: "",
      contact_name: "", contact_phone: "", notes: "", is_preferred: false
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  const groupedSuppliers = suppliers.reduce((acc, supplier) => {
    const type = supplier.type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(supplier);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-4 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Suppliers</h1>
          <Button onClick={() => setShowForm(true)} className="bg-slate-900 hover:bg-slate-800">
            <Plus className="w-4 h-4 mr-2" /> Add Supplier
          </Button>
        </div>

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md bg-white border-0 shadow-2xl">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle>Add Supplier</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}>
                  <X className="w-5 h-5" />
                </Button>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
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
                        <SelectItem value="vinyl">Vinyl</SelectItem>
                        <SelectItem value="dtf_printing">DTF Printing</SelectItem>
                        <SelectItem value="blanks">Blanks</SelectItem>
                        <SelectItem value="delivery">Delivery</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Location</Label>
                    <Input
                      value={formData.location}
                      onChange={(e) => setFormData({...formData, location: e.target.value})}
                      placeholder="e.g., Randburg, Joburg"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Address</Label>
                    <Input
                      value={formData.address}
                      onChange={(e) => setFormData({...formData, address: e.target.value})}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Contact Name</Label>
                      <Input
                        value={formData.contact_name}
                        onChange={(e) => setFormData({...formData, contact_name: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input
                        value={formData.contact_phone}
                        onChange={(e) => setFormData({...formData, contact_phone: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({...formData, notes: e.target.value})}
                      rows={2}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="preferred"
                      checked={formData.is_preferred}
                      onChange={(e) => setFormData({...formData, is_preferred: e.target.checked})}
                      className="rounded"
                    />
                    <Label htmlFor="preferred" className="cursor-pointer">Preferred supplier</Label>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <Button type="button" variant="outline" onClick={() => setShowForm(false)} className="flex-1">
                      Cancel
                    </Button>
                    <Button type="submit" className="flex-1 bg-slate-900">
                      Add Supplier
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Suppliers List */}
        {Object.keys(groupedSuppliers).length === 0 ? (
          <Card className="p-8 text-center bg-white border-0">
            <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="font-medium text-slate-700 mb-2">No suppliers yet</h3>
            <p className="text-slate-500 mb-4 text-sm">Add your first supplier to get started</p>
            <Button onClick={() => setShowForm(true)}>Add Supplier</Button>
          </Card>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedSuppliers).map(([type, items]) => (
              <div key={type}>
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  {typeLabels[type] || type}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {items.map(supplier => (
                    <Card key={supplier.id} className="bg-white border-0 shadow-sm hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-slate-900">{supplier.name}</h3>
                            {supplier.is_preferred && (
                              <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                            )}
                          </div>
                          <Badge className={`${typeColors[supplier.type]} border-0`}>
                            {typeLabels[supplier.type]}
                          </Badge>
                        </div>
                        
                        {supplier.location && (
                          <div className="flex items-center gap-2 text-sm text-slate-600 mb-1">
                            <MapPin className="w-4 h-4" />
                            <span>{supplier.location}</span>
                          </div>
                        )}
                        
                        {supplier.contact_phone && (
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Phone className="w-4 h-4" />
                            <span>{supplier.contact_phone}</span>
                            {supplier.contact_name && (
                              <span className="text-slate-400">({supplier.contact_name})</span>
                            )}
                          </div>
                        )}

                        {supplier.notes && (
                          <p className="text-sm text-slate-500 mt-2 bg-slate-50 p-2 rounded">
                            {supplier.notes}
                          </p>
                        )}

                        <div className="mt-3 pt-3 border-t flex justify-end">
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
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}