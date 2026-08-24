import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { supabase } from "@/lib/supabaseClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Pencil, X, Image as ImageIcon, Plus, Trash2, Video, Factory, Copy } from "lucide-react";
import { toast } from "sonner";
import { PLACEMENT_PRESETS, PRINT_COMPONENT_METHODS } from "@/lib/productionStages";
import { buildComponentPayload, buildSetupFeeCompanionPayload } from "@/lib/productComposition";
import ComponentFieldsForm, { COMPONENT_TYPES, emptyComponentForm } from "@/components/composition/ComponentFieldsForm";
import { SearchSelect } from "@/pages/Inventory";

const CATEGORIES = [
  { value: "tshirts", label: "T-Shirts" },
  { value: "hoodies", label: "Hoodies" },
  { value: "sweaters", label: "Sweaters" },
  { value: "hats", label: "Hats" },
  { value: "bottoms", label: "Bottoms" },
  { value: "printing", label: "Printing" },
  { value: "labels", label: "Labels" }
];

export default function CatalogManagement() {
  const [editingItem, setEditingItem] = useState(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingMultiple, setUploadingMultiple] = useState(false);
  const queryClient = useQueryClient();

  const { data: catalogItems = [], isLoading } = useQuery({
    queryKey: ['catalogItems'],
    queryFn: () => dataClient.entities.CatalogItem.list('display_order', 200)
  });

  const createMutation = useMutation({
    mutationFn: (data) => dataClient.entities.CatalogItem.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogItems'] });
      setCreatingNew(false);
      toast.success("Product created!");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.CatalogItem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogItems'] });
      setEditingItem(null);
      toast.success("Catalog item updated!");
    }
  });

  // Product Composition (Phase 1) - what a client_products row is made
  // of. Composition belongs to client_products (client-specific name,
  // price, mockup, artwork, approval lifecycle already live there), not
  // to this global catalog product - so editing it here first requires
  // picking WHICH client product, among those based on this catalog
  // item (via client_products.opps_product_id), to compose. One client
  // product edited at a time, deliberately no bulk-apply action.
  const [selectedClientProductId, setSelectedClientProductId] = useState("");
  const [addingComponent, setAddingComponent] = useState(false);
  const [newComponent, setNewComponent] = useState(emptyComponentForm());
  const [editingComponentId, setEditingComponentId] = useState("");
  const [editComponentForm, setEditComponentForm] = useState(emptyComponentForm());

  // Phase 2A - Product Composition clone. Duplicate an existing
  // composition onto another client_product for the SAME client, so
  // staff never have to rebuild a near-identical setup component by
  // component. v1 is deliberately narrow: whole-composition only, no
  // component selection/merge/replace - see duplicate_product_composition
  // (20260824100000) for the authoritative server-side rules this UI
  // only mirrors for a faster/clearer failure, never enforces alone.
  const [duplicatingComposition, setDuplicatingComposition] = useState(false);
  const [duplicateTargetId, setDuplicateTargetId] = useState("");

  const { data: internalProducts = [] } = useQuery({
    queryKey: ['inventoryProducts'],
    queryFn: () => dataClient.entities.InventoryProduct.list('internal_name', 200),
    enabled: Boolean(editingItem),
  });
  const { data: linkedClientProducts = [] } = useQuery({
    queryKey: ['clientProductsForCatalogItem', editingItem?.id],
    queryFn: () => dataClient.entities.ClientProduct.filter({ opps_product_id: editingItem.id }, 'client_facing_name', 100),
    enabled: Boolean(editingItem?.id),
  });
  const { data: productComponents = [] } = useQuery({
    queryKey: ['productComponents', selectedClientProductId],
    queryFn: () => dataClient.entities.ProductComponent.filter({ client_product_id: selectedClientProductId }, 'sort_order', 100),
    enabled: Boolean(selectedClientProductId),
  });
  const { data: currentArtwork = [] } = useQuery({
    queryKey: ['clientProductArtworkCurrent', selectedClientProductId],
    queryFn: () => dataClient.entities.ClientProductArtwork.filter({ client_product_id: selectedClientProductId, is_current: true }, 'placement', 50),
    enabled: Boolean(selectedClientProductId),
  });
  // Master/default pricing tier - staff-editable, tenant-scoped,
  // production_pricing_defaults. Used only to PREFILL new components;
  // never re-read once a component/snapshot already has its own price.
  const { data: pricingDefaults = [] } = useQuery({
    queryKey: ['productionPricingDefaults'],
    queryFn: () => dataClient.entities.ProductionPricingDefault.filter({ is_active: true }, 'production_method', 100),
    enabled: Boolean(selectedClientProductId),
    staleTime: 60_000,
  });
  const pricingDefaultFor = (method) => (Array.isArray(pricingDefaults) ? pricingDefaults : []).find((d) => d.production_method === method);

  // Explicit staff action, not automatic "new client = setup required".
  // Creates a sibling setup_fee component defaulted to once_per_order,
  // prefilled from production_pricing_defaults for the chosen method but
  // fully editable/removable like any other component.
  const createSetupFeeCompanion = async (printForm) => {
    const method = printForm.production_method;
    const methodLabel = PRINT_COMPONENT_METHODS.find((m) => m.value === method)?.label || method;
    await dataClient.entities.ProductComponent.create(buildSetupFeeCompanionPayload(printForm, {
      clientProductId: selectedClientProductId,
      sortOrder: activeComponents.length + 1,
      methodLabel,
      productionDefault: pricingDefaultFor(method),
    }));
  };

  const createComponentMutation = useMutation({
    mutationFn: async (form) => {
      const created = await dataClient.entities.ProductComponent.create(
        buildComponentPayload(form, { clientProductId: selectedClientProductId, sortOrder: activeComponents.length })
      );
      if (form.component_type === "print_service" && form.setupRequired && form.production_method) {
        await createSetupFeeCompanion(form);
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productComponents', selectedClientProductId] });
      setAddingComponent(false);
      setNewComponent(emptyComponentForm());
      toast.success("Component added");
    },
    onError: () => toast.error("Could not add component"),
  });

  const updateComponentMutation = useMutation({
    mutationFn: ({ id, form }) => dataClient.entities.ProductComponent.update(
      id, buildComponentPayload(form, { clientProductId: selectedClientProductId, sortOrder: undefined })
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productComponents', selectedClientProductId] });
      setEditingComponentId("");
      toast.success("Component updated");
    },
    onError: () => toast.error("Could not update component"),
  });

  const removeComponentMutation = useMutation({
    mutationFn: (id) => dataClient.entities.ProductComponent.update(id, { is_active: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productComponents', selectedClientProductId] });
      toast.success("Component removed");
    },
    onError: () => toast.error("Could not remove component"),
  });

  const startEditingComponent = (component) => {
    setAddingComponent(false);
    setEditingComponentId(component.id);
    const knownPlacement = PLACEMENT_PRESETS.includes(component.placement);
    setEditComponentForm({
      ...emptyComponentForm(),
      component_type: component.component_type,
      inventory_product_id: component.inventory_product_id || "",
      fixed_inventory_variant_id: component.fixed_inventory_variant_id || "",
      quantity_per_unit: component.quantity_per_unit ?? 1,
      default_sell_price: component.default_sell_price ?? "",
      billing_mode: component.billing_mode || "per_unit",
      production_method: component.production_method || "",
      placement: component.placement ? (knownPlacement ? component.placement : "__custom") : "",
      placementCustom: component.placement && !knownPlacement ? component.placement : "",
      production_colour: component.production_colour || "",
      specification: component.specification || "",
      production_instructions: component.production_instructions || "",
      label: component.label || "",
      notes: component.notes || "",
    });
  };

  const activeComponents = (Array.isArray(productComponents) ? productComponents : []).filter((c) => c.is_active !== false);
  const selectedClientProduct = (Array.isArray(linkedClientProducts) ? linkedClientProducts : []).find((cp) => cp.id === selectedClientProductId) || null;
  const invalidateCurrentArtwork = () => queryClient.invalidateQueries({ queryKey: ['clientProductArtworkCurrent', selectedClientProductId] });
  const internalProductLabel = (id) => internalProducts.find((p) => p.id === id)?.internal_name || internalProducts.find((p) => p.id === id)?.internal_code || "Unmapped";
  const hasApprovedArtwork = (placement) => !placement
    ? null
    : (Array.isArray(currentArtwork) ? currentArtwork : []).some((a) => a.placement === placement && a.status === 'approved');

  // Candidate targets - best-effort same-client filter for a faster/
  // clearer picker. The RPC re-validates same-tenant/same-client itself
  // and is the only authority that actually matters (see 20260824100000).
  const { data: cloneTargetCandidates = [] } = useQuery({
    queryKey: ['clientProductsForCompositionClone', selectedClientProduct?.client_id],
    queryFn: () => dataClient.entities.ClientProduct.filter({ client_id: selectedClientProduct.client_id }, 'client_facing_name', 200),
    enabled: Boolean(duplicatingComposition && selectedClientProduct?.client_id),
  });
  const cloneTargetOptions = cloneTargetCandidates.filter((cp) => cp.id !== selectedClientProductId);
  const selectedCloneTarget = cloneTargetOptions.find((cp) => cp.id === duplicateTargetId) || null;

  // Faster/clearer warning only - the RPC's own "Target product already
  // has a composition." rejection is what actually enforces this.
  const { data: targetExistingComponents = [] } = useQuery({
    queryKey: ['productComponents', duplicateTargetId],
    queryFn: () => dataClient.entities.ProductComponent.filter({ client_product_id: duplicateTargetId }, 'sort_order', 100),
    enabled: Boolean(duplicateTargetId),
  });
  const targetAlreadyHasComposition = Boolean(duplicateTargetId) && targetExistingComponents.length > 0;

  const duplicateCompositionMutation = useMutation({
    mutationFn: async (targetId) => {
      const { data, error } = await supabase.rpc('duplicate_product_composition', {
        p_source_client_product_id: selectedClientProductId,
        p_target_client_product_id: targetId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['productComponents', data.target_client_product_id] });
      setDuplicatingComposition(false);
      setDuplicateTargetId("");
      toast.success(`Composition duplicated - ${data.cloned_count} component${data.cloned_count === 1 ? '' : 's'} copied`);
    },
    onError: (error) => toast.error(error.message || "Could not duplicate composition"),
  });

  const handleImageUpload = async (e, item) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    try {
      const { file_url } = await dataClient.integrations.Core.UploadFile({ file, visibility: "public" });
      await updateMutation.mutateAsync({ 
        id: item.id, 
        data: { ...item, image_url: file_url } 
      });
      toast.success("Image updated!");
    } catch (error) {
      toast.error("Failed to upload image");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleUpdate = async (item) => {
    await updateMutation.mutateAsync({ id: item.id, data: item });
  };

  const handleCreate = async (item) => {
    await createMutation.mutateAsync(item);
  };

  const moveItem = async (item, direction) => {
    const currentOrder = item.display_order || 0;
    const newOrder = direction === 'up' ? currentOrder - 1 : currentOrder + 1;
    await updateMutation.mutateAsync({ 
      id: item.id, 
      data: { ...item, display_order: newOrder } 
    });
  };

  const handleMultipleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploadingMultiple(true);
    const uploadedUrls = [];

    for (const file of files) {
      try {
        const { file_url } = await dataClient.integrations.Core.UploadFile({ file, visibility: "public" });
        uploadedUrls.push(file_url);
      } catch (error) {
        console.error("Upload failed:", error);
      }
    }

    setEditingItem({
      ...editingItem,
      images: [...(editingItem.images || []), ...uploadedUrls]
    });
    setUploadingMultiple(false);
    toast.success(`${uploadedUrls.length} images uploaded!`);
  };

  const removeImage = (index) => {
    const newImages = [...(editingItem.images || [])];
    newImages.splice(index, 1);
    setEditingItem({ ...editingItem, images: newImages });
  };

  const groupedItems = catalogItems.reduce((acc, item) => {
    const category = item.category || 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {});

  if (isLoading) {
    return <div className="p-8 text-center">Loading catalog...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Catalog Management</h1>
            <p className="text-slate-500 mt-1">Update product photos and details</p>
          </div>
          <Button onClick={() => setCreatingNew(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-2" />
            New Product
          </Button>
        </div>

        {Object.entries(groupedItems).map(([category, items]) => (
          <div key={category} className="mb-12">
            <h2 className="text-xl font-semibold text-slate-800 mb-4 capitalize">
              {CATEGORIES.find(c => c.value === category)?.label || category}
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {items.map(item => (
                <Card key={item.id} className="bg-white border-0 shadow-sm rounded-2xl overflow-hidden">
                  <div className="relative group">
                    <img 
                      src={item.image_url || "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400"} 
                      alt={item.name}
                      className="w-full aspect-square object-cover"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button
                        size="sm"
                        onClick={() => document.getElementById(`upload-${item.id}`).click()}
                        disabled={uploadingImage}
                        className="bg-white text-slate-900 hover:bg-slate-100"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        {uploadingImage ? "Uploading..." : "Change Photo"}
                      </Button>
                      <input
                        id={`upload-${item.id}`}
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleImageUpload(e, item)}
                        className="hidden"
                      />
                    </div>
                  </div>
                  
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">{item.name}</h3>
                        {item.code && <p className="text-sm text-slate-500">Code: {item.code}</p>}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => moveItem(item, 'up')}
                          className="h-8 w-8"
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => moveItem(item, 'down')}
                          className="h-8 w-8"
                        >
                          ↓
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingItem(item)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    
                    <div className="space-y-1 text-sm text-slate-600">
                      {item.gsm && <p>GSM: {item.gsm}</p>}
                      {item.material && <p>Material: {item.material}</p>}
                      <p className="text-lg font-bold text-emerald-600 mt-2">
                        R{item.base_price ?? item.price ?? 0}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}

        {/* Create Modal */}
        {creatingNew && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold">Create New Product</h2>
                  <Button variant="ghost" size="icon" onClick={() => setCreatingNew(false)}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Product Name *</Label>
                    <Input
                      placeholder="e.g. JV1 T-Shirt"
                      onChange={(e) => setCreatingNew({ ...creatingNew, name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Category *</Label>
                    <Select onValueChange={(v) => setCreatingNew({...creatingNew, category: v})}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(cat => (
                          <SelectItem key={cat.value} value={cat.value}>
                            {cat.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Product Code</Label>
                      <Input
                        placeholder="JV1"
                        onChange={(e) => setCreatingNew({...creatingNew, code: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Base Price (R) *</Label>
                      <Input
                        type="number"
                        placeholder="95"
                        onChange={(e) => setCreatingNew({...creatingNew, base_price: parseFloat(e.target.value)})}
                      />
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button variant="outline" onClick={() => setCreatingNew(false)} className="flex-1">
                      Cancel
                    </Button>
                    <Button 
                      onClick={() => handleCreate(creatingNew)} 
                      disabled={createMutation.isPending || !creatingNew.name || !creatingNew.category || !creatingNew.base_price}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                    >
                      Create Product
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Edit Modal */}
        {editingItem && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold">Edit {editingItem.name}</h2>
                  <Button variant="ghost" size="icon" onClick={() => setEditingItem(null)}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Product Name</Label>
                    <Input
                      value={editingItem.name}
                      onChange={(e) => setEditingItem({...editingItem, name: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Product Code</Label>
                    <Input
                      value={editingItem.code || ""}
                      onChange={(e) => setEditingItem({...editingItem, code: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select 
                      value={editingItem.category} 
                      onValueChange={(v) => setEditingItem({...editingItem, category: v})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(cat => (
                          <SelectItem key={cat.value} value={cat.value}>
                            {cat.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>GSM</Label>
                      <Input
                        value={editingItem.gsm || ""}
                        onChange={(e) => setEditingItem({...editingItem, gsm: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Base Price (R)</Label>
                      <Input
                        type="number"
                        value={editingItem.base_price ?? editingItem.price ?? ""}
                        onChange={(e) => setEditingItem({...editingItem, base_price: parseFloat(e.target.value)})}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Material</Label>
                    <Input
                      value={editingItem.material || ""}
                      onChange={(e) => setEditingItem({...editingItem, material: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      value={editingItem.description || ""}
                      onChange={(e) => setEditingItem({...editingItem, description: e.target.value})}
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Primary Image</Label>
                    {editingItem.image_url && (
                      <img 
                        src={editingItem.image_url} 
                        alt={editingItem.name}
                        className="w-full h-48 object-cover rounded-lg"
                      />
                    )}
                    <Button
                      variant="outline"
                      onClick={() => document.getElementById(`edit-upload-${editingItem.id}`).click()}
                      disabled={uploadingImage}
                      className="w-full"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {uploadingImage ? "Uploading..." : "Upload Primary Image"}
                    </Button>
                    <input
                      id={`edit-upload-${editingItem.id}`}
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, editingItem)}
                      className="hidden"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Additional Images</Label>
                    {editingItem.images && editingItem.images.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        {editingItem.images.map((img, idx) => (
                          <div key={idx} className="relative group">
                            <img 
                              src={img} 
                              alt={`${editingItem.name} ${idx + 1}`}
                              className="w-full h-24 object-cover rounded"
                            />
                            <button
                              onClick={() => removeImage(idx)}
                              className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => document.getElementById(`multi-upload-${editingItem.id}`).click()}
                      disabled={uploadingMultiple}
                      className="w-full"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {uploadingMultiple ? "Uploading..." : "Add More Images"}
                    </Button>
                    <input
                      id={`multi-upload-${editingItem.id}`}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleMultipleImageUpload}
                      className="hidden"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Video URLs (Optional)</Label>
                    <p className="text-xs text-slate-500">Add YouTube or Vimeo links</p>
                    {editingItem.videos?.map((video, idx) => (
                      <div key={idx} className="flex gap-2">
                        <Input
                          value={video}
                          onChange={(e) => {
                            const newVideos = [...(editingItem.videos || [])];
                            newVideos[idx] = e.target.value;
                            setEditingItem({ ...editingItem, videos: newVideos });
                          }}
                          placeholder="https://youtube.com/..."
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            const newVideos = [...(editingItem.videos || [])];
                            newVideos.splice(idx, 1);
                            setEditingItem({ ...editingItem, videos: newVideos });
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingItem({
                        ...editingItem,
                        videos: [...(editingItem.videos || []), ""]
                      })}
                      className="w-full"
                    >
                      <Video className="w-4 h-4 mr-2" />
                      Add Video
                    </Button>
                  </div>

                  <div className="space-y-2 rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2">
                      <Factory className="h-4 w-4 text-slate-500" />
                      <Label className="mb-0">Composition</Label>
                    </div>
                    <p className="text-xs text-slate-500">
                      Composition belongs to the client product this catalog item is used in, not the catalog item itself -
                      pick which client product (based on this catalog item via opps_product_id) to compose.
                    </p>

                    <SearchSelect
                      options={linkedClientProducts}
                      value={selectedClientProductId}
                      onChange={(id) => setSelectedClientProductId(id)}
                      getLabel={(cp) => cp.client_facing_name}
                      placeholder={linkedClientProducts.length ? "Select client product" : "No client products link to this catalog item yet"}
                    />

                    {selectedClientProductId && (
                      <>
                        {activeComponents.length > 0 && (
                          <div className="space-y-1.5">
                            {activeComponents.map((component) => (
                              editingComponentId === component.id ? (
                                <div key={component.id} className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                                  <ComponentFieldsForm
                                    form={editComponentForm}
                                    setForm={setEditComponentForm}
                                    internalProducts={internalProducts}
                                    pricingDefaultFor={pricingDefaultFor}
                                    clientProduct={selectedClientProduct}
                                    currentArtwork={currentArtwork}
                                    onArtworkLinked={invalidateCurrentArtwork}
                                  />
                                  <div className="mt-2 flex gap-2">
                                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditingComponentId("")}>Cancel</Button>
                                    <Button
                                      size="sm"
                                      className="flex-1"
                                      disabled={updateComponentMutation.isPending || (editComponentForm.component_type === "blank_garment" && !editComponentForm.inventory_product_id)}
                                      onClick={() => updateComponentMutation.mutate({ id: component.id, form: editComponentForm })}
                                    >
                                      Save changes
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div key={component.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                                  <div className="min-w-0">
                                    <span className="font-medium text-slate-800">
                                      {COMPONENT_TYPES.find((t) => t.value === component.component_type)?.label || component.component_type}
                                    </span>
                                    {component.placement && <span className="ml-1.5 text-slate-500">- {component.placement}</span>}
                                    {component.inventory_product_id && (
                                      <span className="ml-1.5 text-slate-500">- {internalProductLabel(component.inventory_product_id)}</span>
                                    )}
                                    {component.label && <span className="ml-1.5 text-slate-500">({component.label})</span>}
                                    {component.billing_mode === "once_per_order" ? (
                                      <span className="ml-1.5 text-slate-400">R{component.default_sell_price} ×1 once-off</span>
                                    ) : (
                                      <>
                                        <span className="ml-1.5 text-slate-400">x{component.quantity_per_unit}</span>
                                        {component.default_sell_price != null && (
                                          <span className="ml-1.5 text-slate-400">R{component.default_sell_price}</span>
                                        )}
                                      </>
                                    )}
                                    {component.placement && hasApprovedArtwork(component.placement) === false && (
                                      <span className="ml-1.5 text-amber-600">no approved artwork</span>
                                    )}
                                  </div>
                                  <div className="flex flex-shrink-0 items-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => startEditingComponent(component)}
                                    >
                                      <Pencil className="h-3.5 w-3.5 text-slate-500" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => removeComponentMutation.mutate(component.id)}
                                      disabled={removeComponentMutation.isPending}
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-red-400" />
                                    </Button>
                                  </div>
                                </div>
                              )
                            ))}
                          </div>
                        )}

                        {addingComponent ? (
                          <div>
                            <ComponentFieldsForm
                              form={newComponent}
                              setForm={setNewComponent}
                              internalProducts={internalProducts}
                              pricingDefaultFor={pricingDefaultFor}
                              clientProduct={selectedClientProduct}
                              currentArtwork={currentArtwork}
                              onArtworkLinked={invalidateCurrentArtwork}
                            />
                            <div className="mt-2 flex gap-2">
                              <Button variant="outline" size="sm" className="flex-1" onClick={() => { setAddingComponent(false); setNewComponent(emptyComponentForm()); }}>Cancel</Button>
                              <Button
                                size="sm"
                                className="flex-1"
                                disabled={createComponentMutation.isPending || (newComponent.component_type === "blank_garment" && !newComponent.inventory_product_id)}
                                onClick={() => createComponentMutation.mutate(newComponent)}
                              >
                                Add component
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button variant="outline" size="sm" className="w-full" onClick={() => { setEditingComponentId(""); setAddingComponent(true); }}>
                            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add print option
                          </Button>
                        )}

                        {productComponents.length > 0 && !addingComponent && !editingComponentId && (
                          duplicatingComposition ? (
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                              <p className="text-xs text-slate-500">
                                Duplicating from <span className="font-medium text-slate-700">{selectedClientProduct?.client_facing_name}</span> ({productComponents.length} component{productComponents.length === 1 ? '' : 's'}) into another client product for the same client.
                              </p>
                              <SearchSelect
                                options={cloneTargetOptions}
                                value={duplicateTargetId}
                                onChange={(id) => setDuplicateTargetId(id)}
                                getLabel={(cp) => cp.client_facing_name}
                                placeholder={cloneTargetOptions.length ? "Select target client product" : "No other client products for this client yet"}
                              />
                              {selectedCloneTarget && targetAlreadyHasComposition && (
                                <p className="text-xs text-amber-600">
                                  Target product already has a composition ({targetExistingComponents.length} row{targetExistingComponents.length === 1 ? '' : 's'}) - choose a different target.
                                </p>
                              )}
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="flex-1"
                                  onClick={() => { setDuplicatingComposition(false); setDuplicateTargetId(""); }}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  className="flex-1"
                                  disabled={!duplicateTargetId || targetAlreadyHasComposition || duplicateCompositionMutation.isPending}
                                  onClick={() => duplicateCompositionMutation.mutate(duplicateTargetId)}
                                >
                                  {duplicateCompositionMutation.isPending ? "Duplicating…" : "Confirm duplicate"}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button variant="outline" size="sm" className="w-full" onClick={() => setDuplicatingComposition(true)}>
                              <Copy className="mr-1.5 h-3.5 w-3.5" /> Duplicate composition
                            </Button>
                          )
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button variant="outline" onClick={() => setEditingItem(null)} className="flex-1">
                      Cancel
                    </Button>
                    <Button
                      onClick={() => handleUpdate(editingItem)}
                      disabled={updateMutation.isPending}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                    >
                      Save Changes
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
