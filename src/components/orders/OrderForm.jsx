import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";

const printTypes = [
  { value: "vinyl_videoflex", label: "Vinyl (Videoflex) - R110/m" },
  { value: "vinyl_flock", label: "Vinyl (Flock)" },
  { value: "vinyl_silicon", label: "Vinyl (Silicon)" },
  { value: "dtf_randburg", label: "DTF Randburg (Quality) - R212.75/m" },
  { value: "dtf_joburg", label: "DTF Joburg - R170/m" }
];

export default function OrderForm({ order, onSubmit, onCancel }) {
  const [formData, setFormData] = useState(order || {
    client_name: "",
    client_email: "",
    client_phone: "",
    order_number: `ORD-${Date.now().toString(36).toUpperCase()}`,
    description: "",
    quantity: 1,
    print_type: "vinyl_videoflex",
    blank_type: "",
    status: "received",
    priority: "normal",
    due_date: undefined,
    quoted_price: "",
    deposit_paid: 0,
    materials_cost: "",
    transport_cost: "",
    notes: "",
    tracking_code: Math.random().toString(36).substring(2, 8).toUpperCase()
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <Card className="bg-white border-0 shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle>{order ? "Edit Order" : "New Order"}</CardTitle>
        <Button variant="ghost" size="icon" onClick={onCancel}>
          <X className="w-5 h-5" />
        </Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Client Info */}
          <div className="space-y-4">
            <h3 className="font-semibold text-slate-700">Client Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Client/Brand Name *</Label>
                <Input
                  value={formData.client_name}
                  onChange={(e) => handleChange("client_name", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Order Number</Label>
                <Input value={formData.order_number} disabled className="bg-slate-50" />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={formData.client_email}
                  onChange={(e) => handleChange("client_email", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={formData.client_phone}
                  onChange={(e) => handleChange("client_phone", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Order Details */}
          <div className="space-y-4">
            <h3 className="font-semibold text-slate-700">Order Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Print Type *</Label>
                <Select value={formData.print_type} onValueChange={(v) => handleChange("print_type", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {printTypes.map(pt => (
                      <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Quantity *</Label>
                <Input
                  type="number"
                  min="1"
                  value={formData.quantity}
                  onChange={(e) => handleChange("quantity", parseInt(e.target.value) || 1)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Blank Type</Label>
                <Input
                  value={formData.blank_type}
                  onChange={(e) => handleChange("blank_type", e.target.value)}
                  placeholder="e.g., Cotton T-Shirt, Hoodie"
                />
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => handleChange("due_date", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={formData.priority} onValueChange={(v) => handleChange("priority", v)}>
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
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={(v) => handleChange("status", v)}>
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
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => handleChange("description", e.target.value)}
                placeholder="Order specifications, design details, etc."
                rows={3}
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="space-y-4">
            <h3 className="font-semibold text-slate-700">Pricing</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Quoted Price (R)</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.quoted_price}
                  onChange={(e) => handleChange("quoted_price", parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label>Deposit Paid (R)</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.deposit_paid}
                  onChange={(e) => handleChange("deposit_paid", parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label>Materials Cost (R)</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.materials_cost}
                  onChange={(e) => handleChange("materials_cost", parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Internal Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              placeholder="Notes for the team..."
              rows={2}
            />
          </div>

          {/* Tracking Code Display */}
          <div className="bg-slate-50 p-4 rounded-lg">
            <p className="text-sm text-slate-600">Client Tracking Code:</p>
            <p className="text-xl font-mono font-bold text-slate-900">{formData.tracking_code}</p>
            <p className="text-xs text-slate-500 mt-1">Share this code with the client to track their order</p>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" className="flex-1 bg-slate-900 hover:bg-slate-800">
              {order ? "Update Order" : "Create Order"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}