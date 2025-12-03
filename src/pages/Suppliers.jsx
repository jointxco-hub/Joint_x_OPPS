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
  Mail, Clock, Edit, ChevronRight
} from "lucide-react";
import TypeformWrapper from "@/components/forms/TypeformWrapper";
import TypeformInput from "@/components/forms/TypeformInput";

const typeColors = {
  vinyl: "bg-blue-100 text-blue-700",
  dtf_printing: "bg-purple-100 text-purple-700",
  blanks: "bg-emerald-100 text-emerald-700",
  delivery: "bg-orange-100 text-orange-700",
  other: "bg-slate-100 text-slate-700"
};

const typeLabels = {
  vinyl: "Vinyl",
  dtf_printing: "DTF Printing",
  blanks: "Blanks",
  delivery: "Delivery",
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
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({
    name: "",
    type: "vinyl",
    location: "",
    address: "",
    contact_name: "",
    contact_phone: "",
    contact_email: "",
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
    setCurrentStep(0);
    setFormData({
      name: "", type: "vinyl", location: "", address: "",
      contact_name: "", contact_phone: "", contact_email: "",
      notes: "", is_preferred: false, payment_terms: "cod",
      lead_time_days: 1, products: []
    });
  };

  const handleEdit = (supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name || "",
      type: supplier.type || "vinyl",
      location: supplier.location || "",
      address: supplier.address || "",
      contact_name: supplier.contact_name || "",
      contact_phone: supplier.contact_phone || "",
      contact_email: supplier.contact_email || "",
      notes: supplier.notes || "",
      is_preferred: supplier.is_preferred || false,
      payment_terms: supplier.payment_terms || "cod",
      lead_time_days: supplier.lead_time_days || 1,
      products: supplier.products || []
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (editingSupplier) {
      await updateMutation.mutateAsync({ id: editingSupplier.id, data: formData });
    } else {
      await createMutation.mutateAsync(formData);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const groupedSuppliers = suppliers.reduce((acc, supplier) => {
    const type = supplier.type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(supplier);
    return acc;
  }, {});

  const typeOptions = [
    { value: "vinyl", label: "Vinyl Supplier" },
    { value: "dtf_printing", label: "DTF Printing Partner" },
    { value: "blanks", label: "Blanks Supplier" },
    { value: "delivery", label: "Delivery Service" },
    { value: "other", label: "Other" }
  ];

  const paymentOptions = [
    { value: "cod", label: "Cash on Delivery (COD)" },
    { value: "net_7", label: "Net 7 Days" },
    { value: "net_14", label: "Net 14 Days" },
    { value: "net_30", label: "Net 30 Days" },
    { value: "prepaid", label: "Prepaid" }
  ];

  const preferredOptions = [
    { value: "true", label: "Yes, this is a preferred supplier" },
    { value: "false", label: "No, regular supplier" }
  ];

  if (showForm) {
    const steps = [
      <TypeformInput
        key="name"
        type="text"
        label="What's the supplier name?"
        value={formData.name}
        onChange={(v) => handleChange("name", v)}
        placeholder="e.g., JG Electronics"
        required
        isActive={currentStep === 0}
        questionNumber="1"
      />,
      <TypeformInput
        key="type"
        type="select"
        label="What type of supplier?"
        value={formData.type}
        onChange={(v) => handleChange("type", v)}
        options={typeOptions}
        required
        isActive={currentStep === 1}
        questionNumber="2"
      />,
      <TypeformInput
        key="location"
        type="text"
        label="Where are they located?"
        subtitle="City or area"
        value={formData.location}
        onChange={(v) => handleChange("location", v)}
        placeholder="e.g., Randburg"
        isActive={currentStep === 2}
        questionNumber="3"
      />,
      <TypeformInput
        key="address"
        type="text"
        label="Full address"
        subtitle="Street address for pickups/deliveries"
        value={formData.address}
        onChange={(v) => handleChange("address", v)}
        placeholder="123 Main Street, Randburg"
        isActive={currentStep === 3}
        questionNumber="4"
      />,
      <TypeformInput
        key="contact_name"
        type="text"
        label="Contact person's name"
        value={formData.contact_name}
        onChange={(v) => handleChange("contact_name", v)}
        placeholder="John Smith"
        isActive={currentStep === 4}
        questionNumber="5"
      />,
      <TypeformInput
        key="contact_phone"
        type="text"
        label="Phone number"
        value={formData.contact_phone}
        onChange={(v) => handleChange("contact_phone", v)}
        placeholder="082 123 4567"
        isActive={currentStep === 5}
        questionNumber="6"
      />,
      <TypeformInput
        key="contact_email"
        type="email"
        label="Email address"
        value={formData.contact_email}
        onChange={(v) => handleChange("contact_email", v)}
        isActive={currentStep === 6}
        questionNumber="7"
      />,
      <TypeformInput
        key="payment_terms"
        type="select"
        label="What are the payment terms?"
        value={formData.payment_terms}
        onChange={(v) => handleChange("payment_terms", v)}
        options={paymentOptions}
        isActive={currentStep === 7}
        questionNumber="8"
      />,
      <TypeformInput
        key="lead_time"
        type="number"
        label="Average lead time"
        subtitle="How many days to receive orders?"
        value={formData.lead_time_days}
        onChange={(v) => handleChange("lead_time_days", v)}
        unit="days"
        isActive={currentStep === 8}
        questionNumber="9"
      />,
      <TypeformInput
        key="preferred"
        type="select"
        label="Is this a preferred supplier?"
        subtitle="Preferred suppliers are used for auto-generated purchase orders"
        value={formData.is_preferred ? "true" : "false"}
        onChange={(v) => handleChange("is_preferred", v === "true")}
        options={preferredOptions}
        isActive={currentStep === 9}
        questionNumber="10"
      />,
      <TypeformInput
        key="notes"
        type="textarea"
        label="Any notes about this supplier?"
        subtitle="Pricing info, special instructions, etc."
        value={formData.notes}
        onChange={(v) => handleChange("notes", v)}
        placeholder="e.g., Videoflex R110/m, best quality vinyl..."
        isActive={currentStep === 10}
        questionNumber="11"
      />
    ];

    return (
      <div className="fixed inset-0 z-50 bg-white">
        <button 
          onClick={resetForm}
          className="fixed top-6 right-6 z-50 text-slate-400 hover:text-slate-600 text-sm"
        >
          ✕ Close
        </button>
        
        <TypeformWrapper
          currentStep={currentStep}
          setCurrentStep={setCurrentStep}
          totalSteps={steps.length}
          onSubmit={handleSubmit}
          submitLabel={editingSupplier ? "Update Supplier" : "Add Supplier"}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
        >
          {steps[currentStep]}
        </TypeformWrapper>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-4 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Suppliers</h1>
            <p className="text-slate-500">Manage your suppliers and partners</p>
          </div>
          <Button onClick={() => setShowForm(true)} className="bg-slate-900 hover:bg-slate-800">
            <Plus className="w-4 h-4 mr-2" /> Add Supplier
          </Button>
        </div>

        {/* Suppliers List */}
        {Object.keys(groupedSuppliers).length === 0 ? (
          <Card className="p-12 text-center bg-white border-0">
            <Building2 className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-700 mb-2">No suppliers yet</h3>
            <p className="text-slate-500 mb-4">Add your first supplier to get started</p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Supplier
            </Button>
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
                  {items.map(supplier => (
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
                          
                          {supplier.contact_phone && (
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                              <Phone className="w-4 h-4 text-slate-400" />
                              <span>{supplier.contact_phone}</span>
                              {supplier.contact_name && (
                                <span className="text-slate-400">({supplier.contact_name})</span>
                              )}
                            </div>
                          )}

                          {supplier.contact_email && (
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                              <Mail className="w-4 h-4 text-slate-400" />
                              <span>{supplier.contact_email}</span>
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
                          <p className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg mb-4">
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