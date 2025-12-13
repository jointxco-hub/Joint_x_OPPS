import React, { useState } from "react";
import TypeformWrapper from "../forms/TypeformWrapper";
import TypeformInput from "../forms/TypeformInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload } from "lucide-react";
import { base44 } from "@/api/base44Client";
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
    due_date: "",
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

  const handleSubmit = async () => {
    setIsSubmitting(true);
    await onSubmit(formData);
    setIsSubmitting(false);
  };

  const steps = [
    <TypeformInput
      key="client_name"
      type="text"
      label="What's the client or brand name?"
      subtitle="This helps us keep track of who we're working with"
      value={formData.client_name}
      onChange={(v) => handleChange("client_name", v)}
      placeholder="Type client name..."
      required
      isActive={currentStep === 0}
      questionNumber="1"
    />,
    <TypeformInput
      key="client_contact"
      type="text"
      label="Client phone number"
      subtitle="For order updates and delivery coordination"
      value={formData.client_phone}
      onChange={(v) => handleChange("client_phone", v)}
      placeholder="e.g., 082 123 4567"
      isActive={currentStep === 1}
      questionNumber="2"
    />,
    <TypeformInput
      key="client_email"
      type="email"
      label="Client email address"
      subtitle="Optional - for sending order confirmations"
      value={formData.client_email}
      onChange={(v) => handleChange("client_email", v)}
      isActive={currentStep === 2}
      questionNumber="3"
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
      isActive={currentStep === 3}
      questionNumber="4"
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
      isActive={currentStep === 4}
      questionNumber="5"
    />,
    <TypeformInput
      key="blank_type"
      type="text"
      label="What type of blanks?"
      subtitle="e.g., Cotton T-Shirt, Hoodie, Golf Shirt"
      value={formData.blank_type}
      onChange={(v) => handleChange("blank_type", v)}
      placeholder="Type of garment..."
      isActive={currentStep === 5}
      questionNumber="6"
    />,
    <TypeformInput
      key="priority"
      type="select"
      label="What's the priority level?"
      value={formData.priority}
      onChange={(v) => handleChange("priority", v)}
      options={priorities}
      isActive={currentStep === 6}
      questionNumber="7"
    />,
    <TypeformInput
      key="due_date"
      type="date"
      label="When is this due?"
      subtitle="Expected delivery date to client"
      value={formData.due_date}
      onChange={(v) => handleChange("due_date", v)}
      isActive={currentStep === 7}
      questionNumber="8"
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
      isActive={currentStep === 8}
      questionNumber="9"
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
      isActive={currentStep === 9}
      questionNumber="10"
    />,
    <TypeformInput
      key="description"
      type="textarea"
      label="Order description & specifications"
      subtitle="Design details, colors, sizes, any special requirements"
      value={formData.description}
      onChange={(v) => handleChange("description", v)}
      placeholder="Describe the order..."
      isActive={currentStep === 10}
      questionNumber="11"
    />,
    <TypeformInput
      key="notes"
      type="textarea"
      label="Any internal notes?"
      subtitle="Notes for the team (client won't see this)"
      value={formData.notes}
      onChange={(v) => handleChange("notes", v)}
      placeholder="Internal notes..."
      isActive={currentStep === 11}
      questionNumber="12"
    />,
    <div key="invoice" className={currentStep === 12 ? '' : 'hidden'}>
      <div className="mb-6">
        <span className="text-sm text-slate-400 mb-1 block">13 →</span>
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
                  const { file_url } = await base44.integrations.Core.UploadFile({ file });
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