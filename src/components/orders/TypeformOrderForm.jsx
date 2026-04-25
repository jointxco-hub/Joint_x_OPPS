import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import TypeformWrapper from "../forms/TypeformWrapper";
import TypeformInput from "../forms/TypeformInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Plus } from "lucide-react";
import { dataClient } from "@/api/dataClient";
import { toast } from "sonner";

const printTypes = [
  { value: "dtf", label: "DTF (Direct to Film)" },
  { value: "vinyl", label: "Vinyl" },
  { value: "embroidery", label: "Embroidery" },
  { value: "none", label: "No Printing" }
];

const priorities = [
  { value: "low", label: "Low - Flexible timeline" },
  { value: "normal", label: "Normal - Standard delivery" },
  { value: "high", label: "High - Need it soon" },
  { value: "urgent", label: "Urgent - Rush order" }
];

export default function TypeformOrderForm({ order, onSubmit, onCancel }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [showNewClient, setShowNewClient] = useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => dataClient.entities.Client.list('name', 100)
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => dataClient.entities.Project.list('name', 100)
  });

  const queryClient = useQueryClient();

  const [formData, setFormData] = useState(order || {
    client_name: "",
    client_email: "",
    client_phone: "",
    client_id: "",
    project_id: "",
    order_number: `ORD-${Date.now().toString(36).toUpperCase()}`,
    description: "",
    quantity: 1,
    print_type: "dtf",
    blank_type: "",
    status: "received",
    priority: "normal",
    due_date: undefined,
    quoted_price: 0,
    deposit_paid: 0,
    notes: "",
    invoice_number: "",
    invoice_url: "",
    tracking_code: order?.tracking_code || Math.random().toString(36).substring(2, 8).toUpperCase()
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const createClientMutation = useMutation({
    mutationFn: (data) => dataClient.entities.Client.create(data),
    onSuccess: (newClient) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      handleChange('client_id', newClient.id);
      handleChange('client_name', newClient.name);
      handleChange('client_email', newClient.email);
      handleChange('client_phone', newClient.phone);
      setShowNewClient(false);
      toast.success("Client added!");
    }
  });

  const handleSubmit = async () => {
    setIsSubmitting(true);
    // Auto-create or update client
    if (formData.client_name && !formData.client_id) {
      const newClient = await dataClient.entities.Client.create({
        name: formData.client_name,
        email: formData.client_email,
        phone: formData.client_phone,
        status: 'active',
        total_orders: 1,
        total_revenue: formData.quoted_price || 0,
        last_activity_date: new Date().toISOString().split('T')[0]
      });
      formData.client_id = newClient.id;
    } else if (formData.client_id) {
      // Update existing client stats
      const client = clients.find(c => c.id === formData.client_id);
      if (client) {
        await dataClient.entities.Client.update(formData.client_id, {
          total_orders: (client.total_orders || 0) + 1,
          total_revenue: (client.total_revenue || 0) + (formData.quoted_price || 0),
          last_activity_date: new Date().toISOString().split('T')[0],
          status: 'active'
        });
      }
    }
    await onSubmit(formData);
    setIsSubmitting(false);
  };

  const handleClientSelect = (clientId) => {
    const client = clients.find(c => c.id === clientId);
    if (client) {
      handleChange('client_id', client.id);
      handleChange('client_name', client.name);
      handleChange('client_email', client.email || '');
      handleChange('client_phone', client.phone || '');
    } else if (clientId === 'new') {
      setShowNewClient(true);
    }
  };

  const clientOptions = [
    { value: 'new', label: '+ Add New Client' },
    ...clients.map(c => ({ value: c.id, label: c.name }))
  ];

  const projectOptions = [
    { value: '', label: 'No Project' },
    ...projects.map(p => ({ value: p.id, label: `${p.name} (${p.client_name})` }))
  ];

  const steps = [
    <TypeformInput
      key="client_select"
      type="select"
      label="Select client"
      subtitle="Choose existing client or add new"
      value={formData.client_id || 'new'}
      onChange={handleClientSelect}
      options={clientOptions}
      required
      isActive={currentStep === 0}
      questionNumber="1"
    />,
    ...(showNewClient ? [
      <TypeformInput
        key="new_client_name"
        type="text"
        label="Client name"
        value={formData.client_name}
        onChange={(v) => handleChange("client_name", v)}
        placeholder="Enter client name..."
        required
        isActive={currentStep === 1}
        questionNumber="1b"
      />
    ] : []),
    ...(showNewClient ? [
      <TypeformInput
        key="new_client_phone"
        type="text"
        label="Client phone number"
        value={formData.client_phone}
        onChange={(v) => handleChange("client_phone", v)}
        placeholder="e.g., 082 123 4567"
        isActive={currentStep === 2}
        questionNumber="1c"
      />,
      <TypeformInput
        key="new_client_email"
        type="email"
        label="Client email (optional)"
        value={formData.client_email}
        onChange={(v) => handleChange("client_email", v)}
        isActive={currentStep === 3}
        questionNumber="1d"
      />
    ] : []),
    <TypeformInput
      key="project_select"
      type="select"
      label="Link to project?"
      subtitle="Optional - helps organize orders"
      value={formData.project_id}
      onChange={(v) => handleChange("project_id", v)}
      options={projectOptions}
      isActive={currentStep === (showNewClient ? 4 : 1)}
      questionNumber="2"
    />,
    <TypeformInput
      key="print_type"
      type="select"
      label="What type of printing?"
      subtitle="Choose the printing method for this order"
      value={formData.print_type}
      onChange={(v) => handleChange("print_type", v)}
      options={printTypes}
      required
      isActive={currentStep === (showNewClient ? 5 : 2)}
      questionNumber="3"
    />,
    <TypeformInput
      key="quantity"
      type="number"
      label="How many items?"
      subtitle="Total number of pieces to produce"
      value={formData.quantity}
      onChange={(v) => handleChange("quantity", v)}
      placeholder="1"
      unit="pieces"
      required
      isActive={currentStep === (showNewClient ? 6 : 3)}
      questionNumber="4"
    />,
    <TypeformInput
      key="blank_type"
      type="text"
      label="What type of blanks?"
      subtitle="e.g., Cotton T-Shirt, Hoodie, Golf Shirt"
      value={formData.blank_type}
      onChange={(v) => handleChange("blank_type", v)}
      placeholder="Type of garment..."
      isActive={currentStep === (showNewClient ? 7 : 4)}
      questionNumber="5"
    />,
    <TypeformInput
      key="priority"
      type="select"
      label="What's the priority level?"
      value={formData.priority}
      onChange={(v) => handleChange("priority", v)}
      options={priorities}
      isActive={currentStep === (showNewClient ? 8 : 5)}
      questionNumber="6"
    />,
    <TypeformInput
      key="due_date"
      type="date"
      label="When is this due?"
      subtitle="Expected delivery date to client"
      value={formData.due_date}
      onChange={(v) => handleChange("due_date", v)}
      isActive={currentStep === (showNewClient ? 9 : 6)}
      questionNumber="7"
    />,
    <TypeformInput
      key="quoted_price"
      type="number"
      label="Quoted price to client"
      subtitle="Total amount quoted for this order"
      value={formData.quoted_price}
      onChange={(v) => handleChange("quoted_price", v)}
      placeholder="0"
      unit="R"
      isActive={currentStep === (showNewClient ? 10 : 7)}
      questionNumber="8"
    />,
    <TypeformInput
      key="deposit_paid"
      type="number"
      label="Deposit amount paid"
      subtitle="How much has the client paid upfront?"
      value={formData.deposit_paid}
      onChange={(v) => handleChange("deposit_paid", v)}
      placeholder="0"
      unit="R"
      isActive={currentStep === (showNewClient ? 11 : 8)}
      questionNumber="9"
    />,
    <TypeformInput
      key="description"
      type="textarea"
      label="Order description & specifications"
      subtitle="Design details, colors, sizes, any special requirements"
      value={formData.description}
      onChange={(v) => handleChange("description", v)}
      placeholder="Describe the order..."
      isActive={currentStep === (showNewClient ? 12 : 9)}
      questionNumber="10"
    />,
    <TypeformInput
      key="notes"
      type="textarea"
      label="Any internal notes?"
      subtitle="Notes for the team (client won't see this)"
      value={formData.notes}
      onChange={(v) => handleChange("notes", v)}
      placeholder="Internal notes..."
      isActive={currentStep === (showNewClient ? 13 : 10)}
      questionNumber="11"
    />,
    <div key="invoice" className={currentStep === (showNewClient ? 14 : 11) ? '' : 'hidden'}>
      <div className="mb-6">
        <span className="text-sm text-slate-400 mb-1 block">12 →</span>
        <h2 className="text-2xl md:text-3xl font-medium text-slate-900">
          Upload Invoice (Optional)
        </h2>
        <p className="text-slate-500 mt-2">Attach invoice from Zoho Books if available</p>
      </div>
      
      <div className="space-y-4">
        <div>
          <label className="text-sm text-slate-600 mb-2 block">Invoice Number</label>
          <Input
            value={formData.invoice_number}
            onChange={(e) => handleChange("invoice_number", e.target.value)}
            placeholder="e.g. INV-000138"
            className="text-lg h-12"
          />
        </div>
        
        <div>
          <label className="text-sm text-slate-600 mb-2 block">Upload Invoice</label>
          <Button
            type="button"
            variant="outline"
            onClick={() => document.getElementById('order-invoice-upload').click()}
            disabled={uploadingInvoice}
            className="w-full h-12"
          >
            <Upload className="w-5 h-5 mr-2" />
            {uploadingInvoice ? "Uploading..." : invoiceFile ? invoiceFile.name : "Choose Invoice File"}
          </Button>
          <input
            id="order-invoice-upload"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                setInvoiceFile(file);
                const match = file.name.match(/INV-\d+/i);
                if (match) {
                  handleChange("invoice_number", match[0].toUpperCase());
                }
                
                setUploadingInvoice(true);
                try {
                  const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
                  handleChange("invoice_url", file_url);
                  toast.success("Invoice uploaded!");
                } catch (error) {
                  toast.error("Upload failed");
                } finally {
                  setUploadingInvoice(false);
                }
              }
            }}
            className="hidden"
          />
          {invoiceFile && (
            <p className="text-sm text-slate-500 mt-2">✓ Uploaded: {invoiceFile.name}</p>
          )}
        </div>
      </div>
    </div>
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
        submitLabel={order ? "Update Order" : "Create Order"}
        isSubmitting={isSubmitting}
      >
        {steps[currentStep]}
      </TypeformWrapper>
    </div>
  );
}
