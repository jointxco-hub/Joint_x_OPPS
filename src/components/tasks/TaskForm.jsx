import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";

const taskTypes = [
  { value: "pickup_materials", label: "Pickup Materials" },
  { value: "pickup_blanks", label: "Pickup Blanks" },
  { value: "drop_for_printing", label: "Drop for Printing" },
  { value: "collect_printing", label: "Collect Printing" },
  { value: "delivery", label: "Delivery" },
  { value: "other", label: "Other" }
];

const locations = [
  { value: "jg_electronics_randburg", label: "JG Electronics, Randburg" },
  { value: "dtf_randburg", label: "DTF Printer, Randburg" },
  { value: "dtf_joburg", label: "DTF Printer, Joburg" },
  { value: "blanks_joburg", label: "Blanks Supplier, Joburg" },
  { value: "pep_paxi_riverside", label: "Pep Paxi, Riverside View" },
  { value: "client_location", label: "Client Location" },
  { value: "hq", label: "HQ" },
  { value: "other", label: "Other" }
];

export default function TaskForm({ task, orders = [], onSubmit, onCancel }) {
  const [formData, setFormData] = useState(task || {
    title: "",
    description: "",
    type: "other",
    location: "",
    order_id: "",
    assigned_to: "",
    status: "pending",
    priority: "normal",
    due_date: undefined,
    notes: ""
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
        <CardTitle>{task ? "Edit Task" : "New Task"}</CardTitle>
        <Button variant="ghost" size="icon" onClick={onCancel}>
          <X className="w-5 h-5" />
        </Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label>Task Title *</Label>
            <Input
              value={formData.title}
              onChange={(e) => handleChange("title", e.target.value)}
              placeholder="e.g., Collect vinyl from JG Electronics"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type *</Label>
              <Select value={formData.type} onValueChange={(v) => handleChange("type", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {taskTypes.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={formData.location} onValueChange={(v) => handleChange("location", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map(l => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Related Order</Label>
              <Select value={formData.order_id} onValueChange={(v) => handleChange("order_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None</SelectItem>
                  {orders.map(o => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.order_number} - {o.client_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Assigned To</Label>
              <Input
                value={formData.assigned_to}
                onChange={(e) => handleChange("assigned_to", e.target.value)}
                placeholder="Team member name"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Input
                type="date"
                value={formData.due_date}
                onChange={(e) => handleChange("due_date", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              placeholder="Additional details..."
              rows={2}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" className="flex-1 bg-slate-900 hover:bg-slate-800">
              {task ? "Update Task" : "Create Task"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}