import React, { useState } from "react";
import TypeformWrapper from "../forms/TypeformWrapper";
import TypeformInput from "../forms/TypeformInput";

const taskTypes = [
  { value: "pickup_materials", label: "Pickup Materials" },
  { value: "pickup_blanks", label: "Pickup Blanks" },
  { value: "drop_for_printing", label: "Drop for Printing" },
  { value: "collect_printing", label: "Collect Printing" },
  { value: "delivery", label: "Delivery" },
  { value: "other", label: "Other Task" }
];

const phases = [
  { value: "design", label: "Design" },
  { value: "mockup", label: "Mockup" },
  { value: "sourcing", label: "Sourcing" },
  { value: "cutting", label: "Cutting" },
  { value: "printing", label: "Printing" },
  { value: "pressing", label: "Pressing" },
  { value: "finishing", label: "Finishing" },
  { value: "packing", label: "Packing" },
  { value: "delivery", label: "Delivery" }
];

const locations = [
  { value: "jg_electronics_randburg", label: "JG Electronics, Randburg" },
  { value: "dtf_randburg", label: "DTF Printer, Randburg" },
  { value: "dtf_joburg", label: "DTF Printer, Joburg" },
  { value: "blanks_joburg", label: "Blanks Supplier, Joburg" },
  { value: "pep_paxi_riverside", label: "Pep Paxi, Riverside View" },
  { value: "client_location", label: "Client Location" },
  { value: "hq", label: "HQ" },
  { value: "other", label: "Other Location" }
];

const priorities = [
  { value: "low", label: "Low priority" },
  { value: "normal", label: "Normal priority" },
  { value: "high", label: "High priority" }
];

export default function TypeformTaskForm({ task, orders = [], projects = [], suppliers = [], onSubmit, onCancel }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState(task || {
    title: "",
    description: "",
    type: "other",
    phase: "",
    location: "",
    order_id: "",
    project_id: "",
    supplier_id: "",
    assigned_to: "",
    status: "pending",
    priority: "normal",
    due_date: "",
    due_week: null,
    estimated_time_hours: null,
    notes: ""
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    await onSubmit(formData);
    setIsSubmitting(false);
  };

  const orderOptions = [
    { value: "", label: "No related order" },
    ...orders.map(o => ({ value: o.id, label: `${o.order_number} - ${o.client_name}` }))
  ];

  const projectOptions = [
    { value: "", label: "No project" },
    ...projects.map(p => ({ value: p.id, label: `${p.name} (${p.client_name})` }))
  ];

  const supplierOptions = [
    { value: "", label: "No supplier" },
    ...suppliers.map(s => ({ value: s.id, label: s.name }))
  ];

  const steps = [
    <TypeformInput
      key="title"
      type="text"
      label="What needs to be done?"
      subtitle="Give this task a clear title"
      value={formData.title}
      onChange={(v) => handleChange("title", v)}
      placeholder="e.g., Collect vinyl from JG Electronics"
      required
      isActive={currentStep === 0}
      questionNumber="1"
    />,
    <TypeformInput
      key="type"
      type="select"
      label="What type of task is this?"
      value={formData.type}
      onChange={(v) => handleChange("type", v)}
      options={taskTypes}
      required
      isActive={currentStep === 1}
      questionNumber="2"
    />,
    <TypeformInput
      key="phase"
      type="select"
      label="Which production phase?"
      subtitle="Helps track workflow progress"
      value={formData.phase}
      onChange={(v) => handleChange("phase", v)}
      options={phases}
      isActive={currentStep === 2}
      questionNumber="3"
    />,
    <TypeformInput
      key="location"
      type="select"
      label="Where does this happen?"
      subtitle="Select the location for this task"
      value={formData.location}
      onChange={(v) => handleChange("location", v)}
      options={locations}
      isActive={currentStep === 3}
      questionNumber="4"
    />,
    <TypeformInput
      key="priority"
      type="select"
      label="How urgent is this?"
      value={formData.priority}
      onChange={(v) => handleChange("priority", v)}
      options={priorities}
      isActive={currentStep === 4}
      questionNumber="5"
    />,
    <TypeformInput
      key="due_date"
      type="date"
      label="When should this be done?"
      value={formData.due_date}
      onChange={(v) => handleChange("due_date", v)}
      isActive={currentStep === 5}
      questionNumber="6"
    />,
    <TypeformInput
      key="estimated_time"
      type="number"
      label="Estimated time (hours)?"
      subtitle="How long will this task take?"
      value={formData.estimated_time_hours}
      onChange={(v) => handleChange("estimated_time_hours", v)}
      placeholder="e.g., 2"
      isActive={currentStep === 6}
      questionNumber="7"
    />,
    <TypeformInput
      key="project"
      type="select"
      label="Link to project?"
      subtitle="Optional - helps organize tasks"
      value={formData.project_id}
      onChange={(v) => handleChange("project_id", v)}
      options={projectOptions}
      isActive={currentStep === 7}
      questionNumber="8"
    />,
    <TypeformInput
      key="order"
      type="select"
      label="Link to order?"
      subtitle="Optional - link this task to an order"
      value={formData.order_id}
      onChange={(v) => handleChange("order_id", v)}
      options={orderOptions}
      isActive={currentStep === 8}
      questionNumber="9"
    />,
    <TypeformInput
      key="supplier"
      type="select"
      label="Related supplier?"
      subtitle="If this involves a supplier"
      value={formData.supplier_id}
      onChange={(v) => handleChange("supplier_id", v)}
      options={supplierOptions}
      isActive={currentStep === 9}
      questionNumber="10"
    />,
    <TypeformInput
      key="assigned_to"
      type="text"
      label="Who's doing this?"
      subtitle="Assign to a team member"
      value={formData.assigned_to}
      onChange={(v) => handleChange("assigned_to", v)}
      placeholder="Team member name..."
      isActive={currentStep === 10}
      questionNumber="11"
    />,
    <TypeformInput
      key="notes"
      type="textarea"
      label="Any additional notes?"
      value={formData.notes}
      onChange={(v) => handleChange("notes", v)}
      placeholder="Extra details..."
      isActive={currentStep === 11}
      questionNumber="12"
    />
  ];

  return (
    <div className="fixed inset-0 z-50 bg-white">
      <button 
        onClick={onCancel}
        className="fixed top-6 right-6 z-50 text-slate-400 hover:text-slate-600 text-sm"
      >
        ✕ Close
      </button>
      
      <TypeformWrapper
        currentStep={currentStep}
        setCurrentStep={setCurrentStep}
        totalSteps={steps.length}
        onSubmit={handleSubmit}
        submitLabel={task ? "Update Task" : "Create Task"}
        isSubmitting={isSubmitting}
      >
        {steps[currentStep]}
      </TypeformWrapper>
    </div>
  );
}